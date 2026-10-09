# Swift Logistics — technical handoff

**Review scope:** source inspection and isolated local tests only. No remote Supabase project, Vercel project, credentials, SQL editor, deployment, or GitHub remote was accessed. This is a portfolio/prototype application, not a real courier operation.

## 1. Current status and architecture

Swift Logistics is a server-rendered/static HTML, CSS, and browser JavaScript prototype with two intentionally separate backends:

- **Local development:** `server.js` runs Node's built-in `node:sqlite` database. It is the locally tested runtime.
- **Vercel/Supabase path:** `api/index.js` uses Supabase Auth and PostgREST/RPC over server-side `fetch`. `api/[...path].js` delegates all API paths to it. Root `index.js` only serves an allowlisted set of pages/assets via `public-files.js`.
- **Frontend:** static pages with `js/app.js` for API calls and `js/workspace.js` for dashboard, tracking, account navigation, review, and form presentation. Styling is in `css/style.css` and `css/carrier.css`.
- **Database:** local SQLite tables for users, sessions, shipments, shipment events, support tickets, and idempotency booking requests. Supabase SQL files define an equivalent PostgreSQL/Auth/RLS design.

The local SQLite backend is appropriate for the prototype and must not be considered persistent Vercel storage. The intended hosted path is Vercel Function → Supabase Auth/PostgreSQL.

## 2. Customer experience

### Implemented and locally tested

- Registration, login, logout, account session cookie, profile/dashboard.
- Customer shipment creation with backend-generated `SWF-` tracking ID.
- Idempotency header/key handling for customer bookings; confirmed retry returns the persisted shipment rather than creating another one.
- Customer shipment history, filters/search, shipment status, expected delivery, progress, current location, and event timeline.
- Public tracking without a customer login; returned data omits sender email, recipient phone, contents, owner ID, and recipient/sender names.
- Quote estimator, support/contact ticket creation, error and empty states.
- Staff tracking updates propagate to customer history and public tracking in the SQLite test flow.

### Incomplete or backend-dependent

- The local SQLite server has no password-recovery/reset endpoints; the UI pages exist, but only `api/index.js` implements Supabase recovery/reset requests.
- Supabase registration may return `202` until Auth email confirmation is complete; SQLite registers/signs in immediately.
- The Supabase customer directory intentionally does not return Auth email addresses; it returns profile name, registration date, and shipment count without using a service-role key.

## 3. Current admin/staff experience

### Implemented

- Staff authorization is checked server-side for all staff actions; UI hiding is only an additional presentation layer.
- View all shipments; client-side shipment search by tracking number, recipient, origin/destination, or visible status content.
- Per-shipment management card: update status, country, state/region, city/facility, progress, expected delivery, and update detail.
- Every successful tracking update appends a shipment event, which drives the customer/public tracking timeline.
- View and resolve support tickets.
- View a customer directory. SQLite shows customer name, email, registration date, and shipment count. Supabase shows name, registration date, and shipment count.

### Not implemented

- Customer search/filter in the directory.
- A dedicated customer-detail page/drill-in view.
- **Admin-created shipments.** There is no current staff endpoint or form to create a shipment on behalf of a selected customer. Existing `POST /api/shipments` is customer-booking-only and derives ownership from the authenticated caller.

## 4. Admin-created shipment recommendation (do not implement yet)

### Required files when implementation is approved

- `admin.html` — shipment-creation panel and customer selection UX.
- `js/app.js` — staff form, selection, error states, and API request with an idempotency key.
- `server.js` — SQLite-only staff create endpoint and transaction.
- `api/index.js` — equivalent Supabase staff endpoint.
- A **new migration after `005`** — never edit `004` or `005` after they have been applied.
- `tests/prototype-workflow-test.cjs`, `tests/booking-contract-test.cjs`, plus new staff-create/idempotency/RLS tests.

### Safe SQLite design

Add a staff-only endpoint such as `POST /api/admin/shipments`. It must:

1. Require `user.role === 'staff'` server-side.
2. Accept an explicit selected `ownerId` only in this admin endpoint; validate that it belongs to an existing customer before assignment.
3. Generate the tracking ID only on the server.
4. Insert shipment, initial event, and an admin idempotency ledger record in one SQLite transaction.
5. Scope idempotency by the acting staff account plus idempotency key, not merely the selected customer.
6. Let a `null` owner mean an unregistered recipient shipment; do not create a fake customer account. Such a shipment is publicly trackable but will not appear in a customer dashboard until a deliberate future claim/assignment feature exists.

### Safe Supabase design

Add a new forward-only migration and a new authenticated staff RPC, for example `admin_book_shipment(uuid, uuid, jsonb)`:

- Check `public.is_staff()` inside the security-definer RPC.
- Validate optional assigned owner: it must be an existing `customer` profile, never an arbitrary UUID.
- Do not reuse `create_shipment(jsonb)` directly because it intentionally derives ownership from `auth.uid()`.
- Use a dedicated staff-owned idempotency table/constraint such as `(created_by, idempotency_key)` and persist assigned owner, payload fingerprint, shipment ID, and event in one transaction.
- Keep customer direct inserts disabled. Grant execute only to `authenticated`; the function itself must reject non-staff identities.
- Existing shipment RLS already lets an assigned customer read their own shipment and staff manage all shipments/events.
- A recipient without an account should use `owner_id = null`; public tracking remains available but no account history is fabricated.

## 5. Supabase migration review

Required clean-project sequence:

1. `supabase/schema.sql`
2. `supabase/002_auth_profile_and_public_tracking.sql`
3. `supabase/003_operations_location_fields.sql`
4. `supabase/004_atomic_shipment_booking.sql`
5. `supabase/005_idempotent_shipment_booking.sql`

### Source-level findings

- `schema.sql` creates the base tables, RLS, `is_staff()` predicate, staff/customer policies, and no customer profile-update policy.
- `002` creates the Auth user → profile trigger and the first public tracking RPC.
- `003` adds location/progress/expected-delivery fields, drops the prior same-signature tracking function, then creates the expanded return signature. This ordering is correct.
- `004` removes direct customer shipment inserts and creates atomic `create_shipment(jsonb)`.
- `005` creates `booking_requests`, revokes customer access to the old RPC, then exposes `book_shipment(uuid,jsonb)`. Its owner/key primary key and conflict/read path support retry/replay and payload mismatch detection.

The SQL is source-reviewed for the sequence above, but **none of `004` or `005` has been runtime executed against PostgreSQL/Supabase**. Function privileges, RLS behavior, PostgREST schema discovery, concurrent claim behavior, and Auth-trigger behavior remain unverified until run in an isolated database or the intended project.

## 6. Authentication, authorization, and first staff user

- The frontend does not submit role fields during registration.
- The Supabase trigger creates profiles with role `customer` by default.
- There is no customer-accessible profile update route/policy that can promote a role.
- Server/API staff endpoints explicitly check the loaded profile role and rely on matching SQLite/Supabase authorization rules.

For Supabase, create the first staff account by registering normally, then have the trusted project owner update only that profile from the Supabase SQL Editor:

```sql
update public.profiles
set role = 'staff'
where id = (
  select id from auth.users where email = 'admin@example.com'
);
```

The user should sign out/in afterward so a new API profile lookup sees the staff role. Do not create a public self-service admin registration route. For local SQLite only, `scripts/create-staff.js` creates a local staff account in the local `data` database; it is not part of the Vercel/Supabase deployment path.

## 7. Deployment/GitHub/Vercel readiness

### Source configuration

- `vercel.json` is valid and includes application files for the root serverless function.
- `.vercelignore` excludes `server.js`, SQLite data, tests, scripts, and Docker files, preventing the SQLite server from being treated as the Vercel runtime.
- `/api/*` is handled by `api/[...path].js` → `api/index.js`; static pages/assets are allowlisted by `index.js`/`public-files.js`.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are required Vercel environment variables. `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are optional for prototype email notifications. No service-role key is required or used.
- `.env*` is ignored, `.vercel` is ignored, and `.env.example` is deliberately tracked as a blank documentation template.

### What remains before a public deployment

- The worktree is currently dirty and contains many accumulated application/report changes; review and commit only intended files before GitHub use.
- Apply and verify the Supabase sequence above; do not assume static review equals runtime verification.
- Set Supabase Auth Site URL and allowed reset redirect URL to the Vercel domain.
- Set Vercel environment variables for Production (and Preview if previews should use a separate safe project/configuration).
- Validate a Vercel Preview deployment: clean page routes, assets, `/api/health`, registration/login, customer booking, public tracking, staff update, customer directory, and reset password.

## 8. Tests and results

### Suites in the repository

- `tests/smoke-test.js` — isolated SQLite auth, booking, idempotency replay/mismatch/concurrency, tracking, history, support.
- `tests/prototype-workflow-test.cjs` — customer booking, staff update/customer directory/ticket management, customer refresh, public tracking, and staff authorization.
- `tests/booking-contract-test.cjs` — mocked Supabase API contract/source checks.
- `tests/booking-failure-test.cjs` — client error/retry/no-fake-shipment behavior.
- `tests/static-serving-test.cjs` — static allowlist/traversal/private-file protections.
- `tests/ui-test.cjs` — Playwright/Chrome layout and flows at 375px, 768px, and 1440px.
- `tests/booking-rls.sql` — deferred disposable-local Supabase verification, not executed.

### Executed during this inspection

- `node tests/prototype-workflow-test.cjs` — passed.
- `node tests/smoke-test.js` — passed.
- `node --test tests/booking-contract-test.cjs tests/booking-failure-test.cjs` — 33 passed.
- `node tests/static-serving-test.cjs` — passed for both `server.js` and `index.js` static paths.
- Syntax checks and `git diff --check` — passed.

The Playwright suite was not rerun during this inspection; the latest known prior local result passed all three target viewports with no browser errors/failed assets. PostgreSQL RLS tests have not been run.

## 9. Prioritized roadmap

1. Before hosted use: run the exact Supabase migration sequence on a fresh target and verify Auth/RLS/RPC behavior manually.
2. Configure Vercel environment variables and Supabase Auth URL/redirect settings, then validate a Vercel Preview without adding real-carrier features.
3. If admin-created shipments are approved, implement the dedicated staff-only endpoint/RPC and new post-005 migration with staff-scoped idempotency and atomic initial event creation.
4. Add customer-directory search and a staff customer-detail view only if operationally useful for the prototype.
5. Add Supabase integration tests for staff customer directory, registration confirmation, public tracking privacy, staff update propagation, admin-created bookings, and concurrent idempotency before claiming production readiness.

## 10. Current risks to keep visible

- Supabase/PostgreSQL code is source-reviewed but not live/runtime verified.
- Local SQLite and Supabase are intentionally similar but not identical: SQLite has local staff email visibility and immediate registration; Supabase uses Auth confirmation and avoids exposing Auth email in the staff directory without a service-role key.
- Password recovery is implemented only in the Supabase API path.
- Admin-created shipments are not implemented and must not be simulated by allowing customers to choose arbitrary owner IDs.
- This remains a realistic portfolio prototype; it has no real carrier integration, pickup, label purchasing, payment, or live-rate functionality.
