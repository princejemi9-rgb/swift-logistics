# Swift Logistics

Swift Logistics is a local carrier-service MVP with quoting, shipment creation, public tracking, account-owned history, staff operations, and a support queue.

## Run locally

Requires Node.js 24 or later (the project uses Node's built-in SQLite module).

```powershell
node server.js
```

Open `http://localhost:3000`. If PowerShell blocks `npm`, run the Node command directly.

## Verify the service

```powershell
node tests/smoke-test.js
```

The smoke test uses a temporary SQLite database and covers registration, shipment creation, public tracking, account history, and support tickets.

## Run with Docker

```powershell
docker compose up --build
```

This persists the SQLite database in a named Docker volume. For production, back up the volume and use managed PostgreSQL before scaling beyond one application instance.

## First staff account

```powershell
node scripts/create-staff.js "Operations Lead" ops@example.com "use-a-strong-password"
```

Sign in, then open `/admin.html`.

## Production checklist

- Deploy behind HTTPS (for example, a managed host or reverse proxy); set `NODE_ENV=production`.
- Keep `data/swift-logistics.db` on encrypted, backed-up persistent storage. It is excluded from source control.
- Move to managed PostgreSQL before multi-instance deployment.
- Set up transactional email, SMS/WhatsApp, payments, address validation, maps, and carrier integrations using credentials stored only in platform secrets.
- Add email verification, password-reset emails, audit logging, monitored backups, error monitoring, and staff MFA.
- Register a domain and publish accurate privacy, terms, insurance, prohibited-items, and delivery-policy documents before taking real shipments.

## Security notes

Passwords use salted `scrypt` hashes. Sessions use HTTP-only, SameSite cookies. The server applies baseline security headers and an in-memory request limit. A shared production deployment should use a Redis or gateway-backed rate limiter.
