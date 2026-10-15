# No-change categories (verified, nothing to fix)

Covers: SECRETS_EXPOSURE, DATABASE_ACCESS, FRONTEND_SECRETS, CORS, SQL_INJECTION,
PASSWORD_HASHING (params pinned — code change but behavior-identical), DEPENDENCIES
(pins applied — supply-chain, behavior-identical), FILE_UPLOADS (MIME allowlist was the only change).

## Verification goals

- [x] Findings in each report re-checked post-change (`pnpm audit --prod` clean, frozen install green).
- [ ] Manual: HUMAN — production URL scan (headers/CORS `/.env` `/.git` sourcemaps) once the URL is provided; localhost equivalents verified in AUDIT_SUMMARY.
