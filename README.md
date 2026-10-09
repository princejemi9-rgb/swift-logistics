# Swift Logistics

Swift Logistics is a polished portfolio prototype for a carrier-service experience. It demonstrates quoting, shipment creation, server-generated tracking numbers, account-owned history, public tracking, staff operations, customer management, and a support queue. It does not process real carrier pickups, labels, payments, rates, or package movement.

## Run locally

Requires Node.js 24 or later (the project uses Node's built-in SQLite module).

```powershell
node server.js
```

Open `http://localhost:3000`. If PowerShell blocks `npm`, run the Node command directly. `npm run local` is also available where npm scripts are enabled.

## Verify the service

```powershell
node tests/smoke-test.js
```

The smoke test uses a temporary SQLite database and covers registration, shipment creation, public tracking, account history, and support tickets.

For the complete prototype workflow (customer booking, staff shipment/location/event update, staff customer directory and ticket management, then customer/public tracking confirmation), run:

```powershell
node tests/prototype-workflow-test.cjs
```

## Run with Docker

```powershell
docker compose up --build
```

This persists the SQLite database in a named Docker volume. For production, back up the volume and use managed PostgreSQL before scaling beyond one application instance.

## First staff account

```powershell
node scripts/create-staff.js "Operations Lead" ops@example.com "use-a-strong-password"
```

Sign in, then open `/admin`. Staff controls are protected server-side; standard customer accounts cannot access the customer directory, shipment updates, or support queue.

## Vercel + Supabase prototype configuration

For the Vercel function path, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` as Vercel environment variables. `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are optional and only enable prototype shipment emails. Do not set or expose a Supabase service-role key: the deployed API uses each signed-in user's access token and the database's RLS policies.

## If this ever becomes a real service

- The current SQLite backend is designed for local prototype use, not a multi-user real courier operation.
- Deploy behind HTTPS (for example, a managed host or reverse proxy); set `NODE_ENV=production`.
- Keep `data/swift-logistics.db` on encrypted, backed-up persistent storage. It is excluded from source control.
- Move to managed PostgreSQL before multi-instance deployment.
- Set up transactional email, SMS/WhatsApp, payments, address validation, maps, and carrier integrations using credentials stored only in platform secrets.
- Add email verification, password-reset emails, audit logging, monitored backups, error monitoring, and staff MFA.
- Register a domain and publish accurate privacy, terms, insurance, prohibited-items, and delivery-policy documents before taking real shipments.

## Security notes

Passwords use salted `scrypt` hashes. Sessions use HTTP-only, SameSite cookies. The server applies baseline security headers and an in-memory request limit. A shared production deployment should use a Redis or gateway-backed rate limiter.
