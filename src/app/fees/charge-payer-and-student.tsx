"use client";

/**
 * D-090's automatic payer default, wired at the one point it can be: the
 * moment a student is picked in the charge-creation form. `LiveSearchPicker`
 * itself stays a plain, reusable field with no idea a "default" concept
 * exists — this component owns exactly the sibling-field wiring between the
 * payer and student pickers, and nothing else about either one.
 *
 * THE RULE: fetch `/api/people/guardian-candidates` for the picked student;
 * if it names EXACTLY ONE active `GUARDIAN_OF` relative, and the payer field
 * has not already been given a value BY THE PERSON FILLING IN THE FORM, fill
 * the payer field with that candidate — through
 * `LiveSearchPickerHandle.setSelection`, so it lands exactly as if the
 * administrator had picked it, and remains exactly as editable (D-090's own
 * "per-charge override", never removed by this). Zero or several candidates
 * leaves the payer field untouched: an administrator still chooses,
 * explicitly, precisely because the relationship data does not determine one
 * unambiguously.
 *
 * NEVER OVERWRITES A MANUAL PICK. `onSelect` on the payer field (fired only by
 * an actual pick, mouse or keyboard — never by `setSelection`) latches
 * `payerChosenRef`, and the moment it is set this component stops touching
 * the payer field at all, whichever student is picked afterwards. A
 * suggestion nobody has confirmed may keep changing as the student changes;
 * a person's own choice never does.
 */
import { useRef } from "react";

import {
  LiveSearchPicker,
  type LiveSearchPickerHandle,
  type LiveSearchPickerResult,
} from "@/components/live-search-picker/live-search-picker";

interface GuardianCandidatesResponse {
  readonly ok: boolean;
  readonly results?: LiveSearchPickerResult[];
}

export interface ChargePayerAndStudentFieldsProps {
  payerLabel: string;
  payerPlaceholder: string;
  studentLabel: string;
  studentPlaceholder: string;
  studentHelp: string;
}

export function ChargePayerAndStudentFields({
  payerLabel,
  payerPlaceholder,
  studentLabel,
  studentPlaceholder,
  studentHelp,
}: ChargePayerAndStudentFieldsProps) {
  const payerRef = useRef<LiveSearchPickerHandle>(null);
  const payerChosenRef = useRef(false);
  // Guards against a slower, now-stale response landing after a later
  // student pick — the same "ignore an outdated response" rule
  // `LiveSearchPicker`'s own `AbortController` applies to its search calls.
  const requestSeqRef = useRef(0);

  async function onStudentSelect(result: LiveSearchPickerResult) {
    if (payerChosenRef.current) return;
    const seq = ++requestSeqRef.current;

    const url = new URL(
      "/api/people/guardian-candidates",
      window.location.origin,
    );
    url.searchParams.set("studentProfileId", result.id);

    let body: GuardianCandidatesResponse;
    try {
      const response = await fetch(url.toString());
      if (!response.ok) return;
      body = (await response.json()) as GuardianCandidatesResponse;
    } catch {
      return;
    }

    if (seq !== requestSeqRef.current) return;
    if (payerChosenRef.current) return;
    if (!body.ok || !body.results || body.results.length !== 1) return;

    payerRef.current?.setSelection(body.results[0]!);
  }

  return (
    <>
      <div className="col-md-4">
        <LiveSearchPicker
          ref={payerRef}
          name="payerPersonId"
          label={payerLabel}
          placeholder={payerPlaceholder}
          searchUrl="/api/people/relative-candidates"
          required
          onSelect={() => {
            payerChosenRef.current = true;
          }}
        />
      </div>
      <div className="col-md-4">
        <LiveSearchPicker
          name="studentProfileId"
          label={studentLabel}
          placeholder={studentPlaceholder}
          searchUrl="/api/people/student-candidates"
          onSelect={onStudentSelect}
        />
        <div className="form-text">{studentHelp}</div>
      </div>
    </>
  );
}
