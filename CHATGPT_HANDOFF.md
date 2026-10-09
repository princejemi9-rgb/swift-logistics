# Swift Logistics: handoff for ChatGPT

Please review this project briefing and tell my coding agent what to do next. Give a prioritized, concrete plan with affected files, acceptance criteria, and tests. Distinguish confirmed source-code findings from issues requiring live verification. Start with the single most useful next task. Do not assume deployment or database access, and do not request secrets.

## Context and inspection

The project directory is Swift_Carrier_PRO; the product is branded Swift Logistics. It is a carrier-service MVP. This briefing was prepared from the local source on September 28, 2026. The user asked the coding agent to explain the project to ChatGPT and get next-step guidance. The agent has no tool for messaging a separate ChatGPT conversation, so this document is a manual handoff, not a response from ChatGPT.

The existing .gitignore modification belongs to the pre-existing working state and was left untouched. No application code was changed during this review. Credentials, local database contents, and customer records were not read or included. Live deployment status, applied database migrations, and external service configuration are unverified.

## Product and file map

- Static HTML, CSS, and vanilla browser JavaScript; no frontend framework or declared npm dependencies.
- Pages: home, shipping, rate estimates, tracking, history, profile, login, registration, forgotten/reset password, staff operations, support, contact, privacy, and terms.
- `js/app.js`: forms, navigation, client-side rate estimates, shipment tracking, history/profile, staff updates, support queue, and authentication flows.
- `server.js`: standalone Node HTTP server with built-in SQLite, local authentication, sessions, shipments/events, and tickets.
- `index.js`: exported request handler for pages/static files and delegation of `/api/` requests.
- `api/index.js`: Supabase REST/Auth backend using native fetch; optional Resend notification emails.
- `api/[...path].js`: exports the same Supabase API handler.
- `supabase/schema.sql`: PostgreSQL tables and row-level-security policies.
- `supabase/002_auth_profile_and_public_tracking.sql`: new-user profile trigger and public tracking RPC.
- `supabase/003_operations_location_fields.sql`: location, progress, expected delivery, and updated tracking RPC.
- `scripts/create-staff.js`: local staff provisioning. Supabase staff roles need separate provisioning.
- Dockerfile/compose.yaml support the local SQLite service. Vercel configuration includes all files in the root function bundle.
- `.github/workflows/ci.yml` runs the SQLite smoke test with Node 24.

## How it works

Customers can register/sign in, enter shipment details, view history, track a shipment, and submit support tickets. Staff can update shipment status, country/state/city, progress, expected delivery, and ticket status. Tracking events form a timeline. Rate estimates use a hard-coded browser formula and delivery-day estimates; they are not carrier quotes or payments. The browser can save shipments in localStorage when the API request fails.

SQLite stores users, sessions, shipments, shipment_events, and support_tickets. Passwords use scrypt. Supabase uses Auth plus profiles, shipments, shipment_events, and support_tickets, with RLS controlling access. Public Supabase tracking uses an RPC returning a narrower set of fields. Supabase authentication uses an access token in an HTTP-only Secure SameSite cookie. Shipment creation and status updates can send email via Resend when configured.

## Verification performed

`node --version` returned v24.11.1. `node tests/smoke-test.js` passed: registration, authenticated shipment creation, public tracking, account history, and support ticket creation. It uses a temporary SQLite database. This does not test the Supabase handler, actual RLS behavior, Vercel routing, email delivery, browser interactions, password recovery, or staff operations.

## Findings to prioritize

1. **Local static serving exposes too much of the project.** `server.js` serves any existing path under the project root without a public-file allowlist. Source inspection indicates requests for private files such as environment files or the SQLite database could return them if present. Do not test this by printing secrets. Add explicit public routes/assets and regression tests using harmless sentinel files. The root `index.js` handler limits extensions but still permits server-side `.js` source paths; it also deserves an explicit public allowlist. Prefix-only path containment checks should be replaced with robust containment checks.

2. **Supabase shipment creation conflicts with the checked-in RLS policies.** The API permits anonymous shipment creation, but the schema's insert policy requires `owner_id = auth.uid()`, which does not permit an anonymous null owner. For signed-in customers, shipment insertion is permitted but the subsequent event insertion has no customer insert policy; only staff can manage events. With the checked-in schema, this appears likely to leave a shipment row committed while returning an error on event creation. Verify against an isolated Supabase database; decide the guest-booking policy and implement an atomic, authorized shipment-plus-event operation. Do not broadly open event writes or bypass RLS indiscriminately.

3. **The browser masks all booking failures with a local shipment.** `js/app.js` catches any shipment API error and generates a new browser-only tracking ID, including validation/auth/database errors. This can hide the partial-write problem above and create competing tracking IDs. Clarify whether an explicit demo/offline mode is wanted; production booking should show actionable errors and only confirm server-persisted shipments.

4. **Tests exercise a different backend from the deployment-oriented code.** Add meaningful tests for the Supabase API contract, RLS permissions, cross-account isolation, staff actions, missing tracking IDs, and partial failures. Existing passing SQLite tests are insufficient evidence for production readiness.

5. **Backend behavior has drifted.** Local password-recovery routes are absent although the frontend calls them. If Supabase variables are set in the local server process, public tracking reads Supabase while booking/history still use SQLite. Local public tracking includes names, contents, and weight, unlike the narrower Supabase RPC. Choose a coherent development/production strategy and align contracts.

6. **Authentication UX needs completion.** Supabase registration can return 202 asking for email confirmation, but the browser treats every successful response as a reason to navigate immediately to history. The Supabase handler stores access tokens without a refresh flow. Logout clears the cookie without calling upstream sign-out. Recovery links and expiry behavior need end-to-end verification.

7. **Additional correctness and hardening gaps.** Local `safeShipment` destructures its input even when lookup returns null, so unknown tracking can produce a 400 error instead of the intended 404. Weight validation checks only `<= 0` and should reject non-finite values. Shipment/status writes and event writes are separate operations. The local session cookie lacks Secure even in production. The Supabase handler has no explicit rate limiter equivalent to the local one. Local CSP disallows inline styles while browser tracking inserts style elements/attributes. Review these in scoped follow-up tasks.

8. **Operational claims need verification.** Resend responses are not checked for unsuccessful HTTP status. The health route reports the configured backend without querying database health. Domain, mail sender, auth redirect allowlists, migrations, backups, monitoring, and real carrier/payment integrations are unverified. Avoid claiming that shipment booking schedules an actual carrier pickup; no carrier integration was identified in the reviewed backend.

9. **Documentation/configuration is stale.** `package.json` declares Node >=20 while local SQLite documentation and CI use Node 24. The Supabase README says an adapter still needs to be written, although `api/index.js` already exists. The build command only prints a readiness message. Update setup instructions to describe both runtimes accurately and specify what has actually been tested.

## Requested answer from ChatGPT

Recommend the next implementation task, then a short ordered roadmap. Explain whether security containment, Supabase booking/RLS consistency, and removal of misleading local fallback should be handled before additional UI features. Give the coding agent a ready-to-use instruction with scope, relevant files, and acceptance checks. Ask only questions that materially block implementation, and label assumptions. Treat all live-service conclusions as unverified until checked.
