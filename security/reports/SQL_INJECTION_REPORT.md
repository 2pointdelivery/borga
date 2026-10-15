# SQL Injection Security Report

## Status: PASS

## Findings

All queries via drizzle builders (`eq`/`like`); the two `sql` uses are column references (`version + 1`), never user input. `listBorgaKeys` binds the LIKE pattern as a parameter and every caller passes a hardcoded pattern. Auth queries parameterized. Migrations run repo-owned SQL with `?` placeholders, `multipleStatements: false`. `escapeLike` blocks `_`-wildcard cross-tenant prefix matches. No template-literal or concatenated SQL found.

## What's at risk

Data exfiltration/modification via crafted input. No injection surface found.

## What's already secure

ORM-only access, bound parameters, wildcard escaping.

## Recommendations

1. Keep raw `sql` usage to column references; grep on each PR touching persistence.
