# File Uploads Security Report

## Status: PASS

## Findings

Statement PDF: `Content-Length` pre-check + 8 MB / 80-page caps + `%PDF-` magic-byte check (not extension), in-memory only, never stored/forwarded, filename echoed sliced to 120 chars. Voice STT: 15 MB double-enforced caps; **fixed:** client-supplied MIME now allowlisted to `audio/*` (was passed straight to the Deepgram `Content-Type`). No disk persistence of uploads anywhere. No logo file endpoint (logo is a data-URL string — now validated at render per XSS report).

## What's at risk

Memory exhaustion, malicious file forwarding, content-type spoofing upstream.

## What's already secure

Caps, magic bytes, memory-only handling, no stored uploads.

## Recommendations

1. None open; keep caps + magic-byte checks on any future upload endpoint.
