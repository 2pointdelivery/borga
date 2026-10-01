# Company Engine (the company's API portal)

AI Platform → **Company Engine** (formerly "2Point Engine"). Each company connects its own CRM or company API, and Borga pulls customers and deals from it. It also drives the engine workflow calls (`/api/borga/orchestrate`).

## Connect
1. Create an API key in your CRM (read access is enough).
2. Company → Company Engine → enter the **API base URL** and **key**. The key is stored encrypted, per company, and is never returned to the browser.
3. If your API differs from the defaults, set the optional fields: auth header (default `Authorization`), prefix (default `Bearer`; `none` sends the raw key), **customers path** (`/customers`), **deals path** (`/leads`), **list key** (the field holding the array).
4. **Test connection**, then **Pull now**.

## What a pull does
- Fetches customers and deals (read-only), following the API's own `next` links (max 10 pages / 1000 records per resource per pull).
- Understands common wrappers (`data`, `results`, `items`, nested `data.items`...) and many field spellings (`company_name`, `email_address`, `address.city`, `pipeline_stage`, ...). Records with no id or name are skipped and counted.
- Merges into Sales → Customers and the pipeline: matched by CRM id, then e-mail, then name. Pulling again updates, never duplicates. Empty CRM values never erase Borga data; Borga-only fields (owner, notes) are never touched. Deals link to a customer when the company or e-mail matches. Nothing is written back to your CRM.
- **Keep in sync automatically** pulls every 30 minutes while Borga is open in a browser.

## Safety
- The URL is fetched from the server, so it must be **https and a public address** (DNS is resolved and private/internal addresses are refused; redirects are not followed). For a CRM on a private network set `BORGA_ALLOW_PRIVATE_ENGINE=1`; local development allows it automatically.
- Deployment-wide fallbacks: `BORGA_ENGINE_URL`, `COMPANY_ENGINE_API_KEY` (legacy `TWOPOINT_API_KEY` values saved earlier still resolve).

## Notes
- The collapsed "Operations dashboard" on the tab (bookings, fleet, drivers) is **sample logistics data** and is not pulled from your CRM.
- Companies that configured the old endpoint under Settings keep working for workflows, but pulling requires saving the connection above.
- Verified with a fake CRM (X-API-Key auth, wrapped and paginated responses, unusual field names): pagination, mapping, deal-to-customer linking, idempotent re-pull, wrong-key error, no key leakage. Not yet run against a real CRM.
