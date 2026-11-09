# Feature-Wiring Plan — implemented

## Changes

- Models: `itemId?` on quote/invoice/bill lines; `managerId?` on Employee; `assigneeId?` on Ticket (+ server create/update schemas); quote→invoice `itemId` passthrough.
- Pickers: Quotes customer + catalog lines; PO supplier + catalog; CapTable SAFE/grant stakeholders + owner dedupe; lead company→customerId; ticket customer + assigneeId; project owner; task assignee/project/customer; recurring-invoice single customer field; HR manager roster-only + id.
- Readers: org chart + department table prefer ids with name fallback (zero migration).

## New files

- None (edits to existing panels/libs).

## Verification goals

- [x] `pnpm typecheck`; full unit suite green.
- [ ] Manual: HUMAN — create quote from catalog item → accept → invoice line keeps the item; hire → set manager → organogram nests; ticket with customer → customer record shows it.

## Manual verification (for the human)

- Confirm no `manual-*` customer ids appear on new quotes (linked accounts used instead).
