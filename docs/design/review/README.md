# Review artifacts

Generated from `docs/design/*.md` — **do not edit by hand**, regenerate instead.

## `SplashTrack-Design-Review-2026-08-31.html`

The full design set as one self-contained page with a review widget under every
section: **Akkoord / Wijzigen / Bespreken** plus a free-text comment box.

1. Download the raw file (GitHub shows source, not the rendered page — use the
   **Download raw file** button).
2. Open it in a browser.
3. Comment per section. Progress is saved in that browser's local storage, so
   finish in one browser and export before clearing site data.
4. Click **Exporteer commentaar** to download a markdown summary grouped by
   verdict, and attach that to this pull request.

## Regenerating

Concatenate `docs/design/0*.md 1*.md`, convert with pandoc (`-f gfm -t html5 -s
--toc --embed-resources`), then inject the review script. No secrets or personal
data are included, so the output is safe to commit.
