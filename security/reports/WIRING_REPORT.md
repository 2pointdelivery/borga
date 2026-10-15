# Feature Wiring Report (cross-entity handoffs)

## Status: PASS (gaps closed this pass)

## Findings

`SearchSelect` (search + optional custom + clearable) is the standard picker; `ProjectSelect`/`AccountSelect` wrap it. Closed gaps:
- Quotes customer → `SearchSelect allowCustom` (was native select + shadow `manual-*` ids); email auto-fills from the account, editable per quote; lines get catalog picker writing `QuoteLine.itemId` (new model field, flows into invoice lines on accept).
- PO supplier + catalog lines → `SearchSelect` (were native selects).
- CapTable SAFE/grant stakeholder → `SearchSelect`; add-owner refuses case-insensitive duplicates.
- Lead capture writes `customerId` via customer `SearchSelect allowCustom` (was company string only).
- Ticket create gains customer picker writing `customerId` (+ `assigneeId` from roster; server schemas extended).
- Project owner + task assignee → `SearchSelect` (values stay agent names — automation-safe); tasks gain project/customer pickers (model already had the fields).
- Recurring-invoice dual field merged into one `SearchSelect allowCustom` (picker and input no longer fight over `customerId`).
- HR manager: roster-only (no custom) + `managerId` written alongside the name; org chart + department table prefer the id with name fallback (zero migration).
- New models: `itemId?` on quote/invoice/bill lines (recurring builders spread it through automatically), `managerId?` on Employee, `assigneeId?` on Ticket (+ server create/update schemas).
- Left out deliberately: filing preparer/reviewer (no FK on `FilingRecord` — add if wanted), comps peers (external, correctly free-text).

## Duplication eliminated

Shadow customers (quotes), re-typed line items (now catalog-linked), unlinkable leads, customer-less tickets, ghost managers, recurring dual-field fight, triplicate stakeholder names — all resolved per above.

## Recommendations

1. Recurring invoice/bill line editors: add the same catalog picker when touched next.
2. Filing preparer/reviewer employee picker if attribution matters.
