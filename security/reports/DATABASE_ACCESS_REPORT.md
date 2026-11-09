# Database Access Security Report

## Status: PASS

## Findings

MySQL via `mysql2` + drizzle (`lib/borga/persistence.ts`); no Supabase/Firebase, so RLS-as-such does not apply. The equivalent isolation is key namespacing: every row lives under `u::<userId>::ws::<ws>::<entity>` (`lib/borga/keys.ts`) or per-user keys, and no route builds a key from client-supplied ids alone (verified across all new entities: `capTable`, `quotes`, `purchaseOrders`, `valuationSnapshots`, `valuationPeers`, `payrollSettings`).

## What's at risk

A missing user id in a key would leak across tenants. Live tenancy suite (`scripts/tenancy.test.mjs`, now extended to the new entities + v1 key scoping) proves isolation per release.

## What's already secure

Namespaced keys, `LIKE`-wildcard escaping (`escapeLike`), named-lock migrations, live cross-tenant tests.

## Recommendations

1. Keep the rule: new entity → `ALLOWED_ENTITIES` + default state + tenancy test in the same PR.
