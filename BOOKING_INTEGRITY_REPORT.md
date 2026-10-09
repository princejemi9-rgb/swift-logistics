# Authenticated atomic shipment booking

## Files changed in this task

1. `api/index.js`: authenticated-only booking, validation, a single authenticated RPC call, persisted response mapping and safe booking errors.
2. `supabase/004_atomic_shipment_booking.sql` (new): forward migration for the atomic booking RPC and removal of the customer direct-insert policy.
3. `js/app.js`: retain HTTP status on errors; 401/403 booking rejection offers sign-in without a local shipment or tracking ID.
4. `server.js`: one authentication guard on local SQLite booking so the product rule is consistent across runtimes. No other SQLite booking changes.
5. `tests/booking-contract-test.cjs` (new): mock HTTP contracts, source checks and frontend authentication-error tests.
6. `tests/booking-rls.sql` (new): manual disposable-local-Supabase authorization and forced-event-failure suite; **not executed here**.
7. `tests/smoke-test.js`: adds anonymous-booking rejection to the existing real SQLite flow.
8. `tests/ui-test.cjs`: adds signed-out form submission and asserts no localStorage shipment is created.
9. `supabase/README.md`: migration order, test instructions and coordinated-release requirements.
10. `BOOKING_INTEGRITY_REPORT.md` (new): this report.

The browser suite also refreshes `artifacts/ui/results.json` and its existing home/dashboard/ship/tracking/staff screenshots at 375, 768 and 1440px. These are test artifacts, not UI source changes.

Previous migration files, `api/[...path].js`, public-file allowlisting, HTML, CSS, branding and environment files were not changed. Earlier working-tree changes remain intact.

## Previous failure mode and replacement

The Supabase handler performed two independent REST inserts. A customer's shipment could commit before the event insert failed under RLS, leaving an incomplete booking despite an API error. Anonymous booking also conflicted with the owner-based insert policy.

The handler now requires an authenticated Supabase user/profile, validates the submitted shipping fields and invokes `public.create_shipment(jsonb)` with that user's token. It forwards only the supported shipping fields, not ownership, ID, status, progress or other operational fields. The response uses the persisted row and persisted event, including database-generated timestamps. Email notification remains after database success.

The RPC independently requires `auth.uid()` and a corresponding profile; derives `owner_id` from that identity; validates required text, weight and service; generates the tracking ID; inserts the shipment and first event; and returns both as JSON. Caller-supplied ownership/operational fields are ignored even when calling the RPC directly.

Both writes occur inside one PostgreSQL function statement. An event-write error propagates and rolls back the shipment insert. No catch block suppresses write failures. This follows PostgreSQL's documented [function error/transaction rollback behavior](https://www.postgresql.org/docs/18/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING).

## Authorization and RLS

- The new function is `SECURITY DEFINER`, with an empty fixed search path and schema-qualified database references. It must be created by the trusted migration/table owner. Its elevated scope is limited to these fixed inserts and returning the new booking; there is no dynamic SQL or service-role API credential.
- Function execution is revoked from PUBLIC/anon and granted to authenticated. The internal null-identity check remains mandatory even for authenticated-role calls.
- The previous customer direct shipment INSERT policy is removed so customers cannot bypass the atomic operation or set operational fields at creation.
- Customer event INSERT/UPDATE permissions are not broadened. Existing customer read policies, deliberately public tracking RPC and staff policies are unchanged. RLS stays enabled.
- These choices follow [Supabase's function security guidance](https://supabase.com/docs/guides/database/functions).

The API returns 401 for missing/expired identity, 400 for malformed JSON, 422 for booking validation errors, 403 for denied booking permission, and a generic 503 for unexpected RPC failures. It does not expose SQL messages/details for booking failures or retry writes automatically.

## Verification performed

| Command/check | Result and limits |
| --- | --- |
| `node --test tests/booking-contract-test.cjs` | 10 tests passed. Anonymous/expired authentication, one RPC with the user token, stripped owner/operational overrides, persisted response data, invalid input, sanitized errors, public tracking contract, staff/customer API checks, migration structure, and frontend 401/403 behavior. Supabase HTTP responses are mocked; this does not execute RLS. |
| `node tests/smoke-test.js` | Passed real isolated SQLite authentication, authenticated booking, tracking, history, support, and added anonymous 401 assertion. |
| `node tests/static-serving-test.cjs` | 125 checks per entry point, 250 total, passed. |
| `node tests/ui-test.cjs` with the already-installed Playwright package | **Passed at 375px, 768px and 1440px, all 15 pages.** Includes registration/login/logout, customer/staff navigation, booking/review, history/filtering, tracking, estimates, support, staff updates and ticket resolution. The added signed-out booking scenario checks the real SQLite 401 and absence of browser-local booking. No JavaScript/CSP errors or failed frontend assets were recorded. See generated `artifacts/ui/results.json`. |
| `node --check api/index.js`, `node --check js/app.js`, `node --check server.js`, `git diff --check` | Passed. |
| Prior migration comparison | `schema.sql`, 002 and 003 are unchanged. |

No PostgreSQL executable, Supabase CLI, Docker runtime or existing PGlite package was found in the locations checked. No isolated Supabase instance was used, and **the migration has not been executed**. Atomic rollback, policy evaluation, cross-account isolation and real function privileges are supported by source review and provided SQL assertions, not by an executed database test.

The manual SQL suite requires an empty disposable local Supabase application database after migrations 001–004. It tests actual customer-owned creation, attempted ownership/status overrides, rejection of direct customer inserts/events/updates, cross-account reads/updates, anonymous rejection, restricted public tracking and staff writes. A temporary event CHECK constraint forces the second write to fail; row counts assert that neither a shipment nor an event remains. Fixtures and the test constraint roll back. It was not run here.

## Required steps before a future release

1. Review migration 004 and its trusted function owner; apply the migration chain to a fresh disposable local Supabase instance.
2. Execute `tests/booking-rls.sql` there and verify real role/table grants and PostgREST RPC responses. Check existing deployed policy drift separately; this migration assumes the checked-in policy set.
3. Verify staging customer A/B isolation, anonymous rejection, staff operations, initial-event rollback and public tracking using real Supabase tokens.
4. Coordinate migration 004 and the API update in a reviewed maintenance/release window. Applying 004 removes the old API's customer insert path; the new API requires the RPC to exist. Verify PostgREST schema discovery before allowing bookings.
5. Remote application/deployment requires a separately authorized release. Nothing has been applied remotely or deployed by this task; no secrets were inspected or changed.

## Deliberately remaining limitations

The generic localStorage fallback for non-authentication failures remains, as requested. Only 401/403 bypass it in this task. Network loss after a database commit can still leave the caller uncertain whether booking succeeded; the API advises checking history rather than claiming a rollback. Idempotency and the larger fallback removal are separate work. Existing staff status/event updates remain their original separate operations; this task makes initial Supabase booking atomic only. No further task was started.
