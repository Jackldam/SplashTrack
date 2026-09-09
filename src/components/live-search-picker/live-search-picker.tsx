"use client";

/**
 * A live-typeahead text field that resolves to an id, for use inside an
 * otherwise ordinary server-rendered `<form action={...}>`.
 *
 * THE FIRST CLIENT COMPONENT IN THIS CODEBASE, and deliberately the only kind
 * of interactivity it adds: everything downstream of a pick — the form
 * submit, the server action, the authorization check — stays exactly what it
 * was. This component's whole job is replacing the two-step "GET a name
 * search, then choose from a `<select>`" pattern (`git show 60529c6`,
 * `git show e30775c`) with one field, without moving any scoping decision
 * into the browser: it calls a Route Handler, and that handler calls the
 * SAME reach-narrowed service the old page-level search did. Nothing here
 * decides who may see whom.
 *
 * THE RESPONSE CONTRACT IS DELIBERATELY FLAT. A search endpoint returns
 * `{ ok: true, results: { id, label, sublabel? }[] }` or
 * `{ ok: false, permission }` — the same `guarded()` shape used everywhere
 * else in this app, with the entity-specific formatting (name order, which
 * number to show) already done server-side. That is what keeps this
 * component usable for both the pupil picker and the relative picker without
 * either one leaking its row shape into client code.
 *
 * A pick fills a HIDDEN input (`name`), which is the only thing the
 * surrounding `<form>` reads — exactly the `<select>` it replaces, whose
 * `value` was the id and never typed by anyone. Editing the text after a pick
 * clears the hidden value, so a half-changed query can never submit a stale
 * id.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export interface LiveSearchPickerResult {
  readonly id: string;
  readonly label: string;
  readonly sublabel?: string;
}

interface LiveSearchPickerResponse {
  readonly ok: boolean;
  readonly results?: LiveSearchPickerResult[];
  readonly permission?: string;
}

export interface LiveSearchPickerProps {
  /** Name of the hidden input the surrounding form submits. */
  name: string;
  /** Visible label for the text field. */
  label: string;
  placeholder?: string;
  /** The Route Handler to query, e.g. `/api/people/student-candidates`. */
  searchUrl: string;
  /** Query-string parameter carrying the typed text. Defaults to `q`. */
  queryParam?: string;
  /** Results whose `id` is in this list are dropped from what is shown. */
  excludeIds?: readonly string[];
  /** Debounce, in ms, between the last keystroke and the request. */
  debounceMs?: number;
  required?: boolean;
}

/** Nothing shorter than this is worth a round trip. */
const MIN_QUERY_LENGTH = 1;

export function LiveSearchPicker({
  name,
  label,
  placeholder,
  searchUrl,
  queryParam = "q",
  excludeIds,
  debounceMs = 300,
  required,
}: LiveSearchPickerProps) {
  const t = useTranslations("common.livePicker");
  const inputId = useId();
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [results, setResults] = useState<LiveSearchPickerResult[]>([]);
  const [status, setStatus] = useState<
    "idle" | "loading" | "done" | "error" | "denied"
  >("idle");
  const [deniedPermission, setDeniedPermission] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const visibleResults = excludeIds
    ? results.filter((r) => !excludeIds.includes(r.id))
    : results;

  const runSearch = useCallback(
    (text: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");

      const url = new URL(searchUrl, window.location.origin);
      url.searchParams.set(queryParam, text);

      fetch(url.toString(), { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`status ${response.status}`);
          return (await response.json()) as LiveSearchPickerResponse;
        })
        .then((body) => {
          if (controller.signal.aborted) return;
          if (!body.ok) {
            setResults([]);
            setDeniedPermission(body.permission ?? "");
            setStatus("denied");
            setOpen(true);
            return;
          }
          setResults(body.results ?? []);
          setStatus("done");
          setOpen(true);
          setHighlighted(-1);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setResults([]);
          setStatus("error");
          setOpen(true);
        });
    },
    [searchUrl, queryParam],
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Close the dropdown on an outside click.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function handleChange(text: string) {
    setQuery(text);
    setSelectedId("");
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = text.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      setResults([]);
      setStatus("idle");
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => runSearch(trimmed), debounceMs);
  }

  function select(result: LiveSearchPickerResult) {
    setSelectedId(result.id);
    setQuery(result.label);
    setOpen(false);
    setHighlighted(-1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || visibleResults.length === 0) {
      if (event.key === "Escape") setOpen(false);
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlighted((i) => (i + 1) % visibleResults.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlighted(
          (i) => (i - 1 + visibleResults.length) % visibleResults.length,
        );
        break;
      case "Enter":
        if (highlighted >= 0 && highlighted < visibleResults.length) {
          event.preventDefault();
          select(visibleResults[highlighted]!);
        }
        break;
      case "Escape":
        setOpen(false);
        setHighlighted(-1);
        break;
      default:
        break;
    }
  }

  return (
    <div className="position-relative" ref={containerRef}>
      <label className="form-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="form-control"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          highlighted >= 0 ? `${listboxId}-${highlighted}` : undefined
        }
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        required={required}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (results.length > 0 || status !== "idle") setOpen(true);
        }}
      />
      <input type="hidden" name={name} value={selectedId} />

      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          className="list-group position-absolute w-100 mt-1"
          style={{ zIndex: 1000, maxHeight: "16rem", overflowY: "auto" }}
        >
          {status === "loading" ? (
            <li className="list-group-item text-muted">{t("searching")}</li>
          ) : status === "denied" ? (
            <li className="list-group-item text-muted">
              {t("denied", { permission: deniedPermission })}
            </li>
          ) : status === "error" ? (
            <li className="list-group-item text-muted">{t("error")}</li>
          ) : visibleResults.length === 0 ? (
            <li className="list-group-item text-muted">
              {t("noResults", { query })}
            </li>
          ) : (
            visibleResults.map((result, index) => (
              <li
                id={`${listboxId}-${index}`}
                key={result.id}
                role="option"
                aria-selected={index === highlighted}
                className={
                  "list-group-item list-group-item-action" +
                  (index === highlighted ? " active" : "")
                }
                onPointerDown={(event) => {
                  // Fires before the input's blur, so a click always lands.
                  event.preventDefault();
                  select(result);
                }}
              >
                {result.label}
                {result.sublabel ? (
                  <span className="text-muted"> ({result.sublabel})</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
