# Authoritative booking confirmation

## Files changed in this task

- `js/app.js`: removes local booking and tracking fallback; validates authoritative success; adds safe failure messages, timeout and submission guard.
- `tests/booking-failure-test.cjs` (new): 21 frontend regression tests.
- `tests/booking-contract-test.cjs`: adds browser timer/AbortController globals to its existing frontend test harness.
- `tests/ui-test.cjs`: adds a browser failure matrix, legacy localStorage exclusion, pending-submit verification, and a staff count assertion.
- `BOOKING_FAILURE_REPORT.md` (new): this report.

The existing browser suite also refreshes `artifacts/ui/results.json` and home/dashboard/ship/tracking/staff screenshots at 375, 768 and 1440px. Earlier working-tree changes are preserved. No backend, migration, RLS, HTML, CSS, branding, environment or static-serving changes were made in this task.

## Removed behavior

The booking error handler previously generated a browser-side `SWF-...` identifier, created a synthetic event, saved the record under `swift-logistics-shipments`, and presented it as a shipment. Tracking also read that localStorage array whenever the backend lookup failed. Both paths and their storage helpers are removed.

## Current success and failure behavior

Booking success requires HTTP 201 and a response matching the current persisted shipment contract: a valid backend tracking ID, origin/destination/service/status, a valid creation timestamp, and at least one valid initial event with its timestamp. A 200, 202, empty or malformed response is not treated as a booking confirmation. No identifier is generated in the browser. The form resets only after confirmation.

- 401/403: sign-in guidance and a sign-in link; entered data remains.
- 400/422: safe guidance to check required fields, weight and service; entered data remains. Raw backend error text is not rendered.
- Network errors, a 30-second timeout, unexpected responses, and other server failures: explicitly state that booking was not confirmed, retain the form, and offer history/support links before retrying.

The UI deliberately does not claim that an uncertain request definitely rolled back. A backend may have committed even if the client never received its response. The message distinguishes lack of confirmation from proof of non-persistence.

Tracking now renders only a validated backend response matching the requested identifier. Failed or malformed lookups clear/hide the result and show a safe error. They never search local records.

## localStorage audit and authoritative surfaces

All shipment-related localStorage uses were pretending to be authoritative booking/tracking data; no legitimate draft/cache usage was found. There are now **no localStorage or sessionStorage calls in production browser JavaScript**. No offline/draft system was added.

Old `swift-logistics-shipments` values may remain in an existing browser, but the application neither reads nor writes them. They are ignored rather than silently deleted.

Dashboard totals, recent shipments, history and staff operations already used server-returned shipment lists. Those paths remain unchanged. Removing tracking's fallback closes the remaining path by which a browser-only record could appear authoritative. A browser regression seeds a valid-looking legacy local record, confirms empty backend history/totals, verifies that tracking cannot display it, and later confirms staff sees only the genuine backend booking.

## Duplicate submission protection

A synchronous in-flight guard blocks additional submit events while a request is pending, in addition to disabling the submit button. A timeout aborts the client request; the guard and button are restored in `finally`. There is no automatic retry. Unit and browser tests trigger three submit events and observe one POST.

This is **not server-side idempotency**. Both runtimes generate a new tracking ID for each new accepted booking request and have no shared request/idempotency key. Separate tabs, reloads, or manual retries after a lost response can still create duplicates. The small client guard addresses double-clicks only. A durable, authenticated, server-side idempotency contract remains a follow-up; none was introduced here.

## Tests executed

- `node --test tests/booking-failure-test.cjs tests/booking-contract-test.cjs`: **31 passed, 0 failed** (21 new failure-flow tests plus 10 existing booking-contract tests). Covers real-ID success, 401/403/400/422/500/503, fetch rejection, abort/timeout, malformed and incomplete responses, unconfirmed 200/202, invalid identifiers/timestamps, preserved fields, deliberate successful retry, repeat-submit protection, and legacy-record exclusion from dashboard/tracking.
- `node tests/smoke-test.js`: **passed**, including genuine persisted SQLite booking and anonymous rejection.
- `node tests/static-serving-test.cjs`: **125 checks per entry point; 250 passed**.
- `node tests/ui-test.cjs`, using the already-installed Playwright package: **passed at 375px, 768px and 1440px, all 15 pages**. Existing customer/staff flows still pass. The desktop run additionally exercises eight injected failure cases, stale localStorage records, preserved inputs and pending-submit protection. Genuine successful booking proceeds through the real isolated SQLite server afterward.
- Browser results contain **zero JavaScript/CSP errors and zero failed CSS/JavaScript/image assets**. Intentionally injected API failures produce expected HTTP/network resource errors, which are distinct from JavaScript/CSP failures.
- `node --check js/app.js`, `node --check tests/booking-failure-test.cjs`, `node --check tests/ui-test.cjs`: **passed**.
- `git diff --check`: **passed**, with existing Windows line-ending notices only.
- Production browser-source search found no remaining localStorage/sessionStorage or client tracking-number generation.

## Findings and remaining verification

The tracking fallback was an additional false-authority path and is now removed. No new backend defect was found beyond the known lack of idempotency. The existing SQLite unknown-tracking error can return 400 rather than 404; the UI safely reports retrieval failure either way, and that unrelated backend behavior was not changed.

Tests verify the current client and real SQLite behavior plus mocked Supabase-facing contracts. No isolated or live Supabase database was used, and migration 004 remains unapplied by this work. Its SQL execution, actual RLS/rollback behavior and live PostgREST response compatibility still require separate isolated/staging verification. No secrets were accessed, nothing was deployed, and no remote migrations were applied. Work stopped after this task.
