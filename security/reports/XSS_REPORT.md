# XSS Security Report

## Status: PASS (2 sinks hardened this pass)

## Findings

**Fixed:** `logoBlock` (`lib/borga/report-template.ts`) interpolated `logoDataUrl`/`color`/initials raw into `document.write` HTML — now validates `data:image/(png|jpeg|gif|webp);base64` ≤ ~700 KB (else initials fallback), hex-only colors, escaped initials. `csvWithHeader` now defuses formula cells (`= + - @` → leading `'`), matching the filing export. `brandedDocHtml` documents its trusted-markup contract for future callers. Already sound: single `dangerouslySetInnerHTML` fed by escape-first `safe-markdown` (https-only links, tag allowlist); invoice/bill/filing exports escape user content; unsubscribe page escapes; CSP nonces (this pass) contain any residual inline execution.

## What's at risk

Stored XSS via company profile fields rendered into printable docs; Excel formula injection via exports.

## What's already secure

Escape-first markdown, pre-escaped templates, CSV defusing in filings (now everywhere).

## Recommendations

1. Cap `logoDataUrl` length at workspace save time too (defense in depth for DB row size).
