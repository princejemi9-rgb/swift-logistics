# Idempotent shipment booking

## Contract

Each logical shipment booking supplies one UUID in the `Idempotency-Key` request header. The server derives the owner from the authenticated identity; it never accepts an owner, tracking number, operational status, or event from the browser. The request is normalized into a stable JSONB payload before it is compared or stored.

| Condition | Result |
| --- | --- |
| Missing or malformed key | `400` |
| Invalid booking fields | `422` |
| Missing/expired identity | `401` |
| Permission denial | `403` |
| Same owner/key and same payload | `201`, original shipment, `Idempotency-Replayed: true` |
| Same owner/key and changed payload | `409`, no new shipment |
| New owner/key | `201`, new shipment, `Idempotency-Replayed: false` |
| Unclassified database/transport uncertainty | `503`, no internal details |

## Server design

`supabase/005_idempotent_shipment_booking.sql` adds `booking_requests` with a database-enforced `(owner_id, idempotency_key)` primary key. `book_shipment(uuid,jsonb)` claims that key before it creates the shipment/event. A losing concurrent caller locks and reads the already-recorded request, then replays its persisted shipment. The insert, event, and key-to-shipment association are in one database transaction, so an error rolls all of them back. The function has a fixed empty search path and authenticated-only execution; it is not a service-role path.

`server.js` has the matching SQLite ledger and a `BEGIN IMMEDIATE` transaction for its development backend. It uses the same normalized payload and owner/key uniqueness rule.

## Client behavior

`js/app.js` writes only retry metadata (owner/key) to session storage before the request. It keeps the key for timeout/network uncertainty, reuses it for unchanged retry, and clears it after confirmed success or reset. It never manufactures a local tracking ID or booking. Browser UUID generation uses `crypto.randomUUID()` with a cryptographically secure `getRandomValues()` compatibility fallback.

## Verification status

Automated source/contract, SQLite smoke, static-serving, UI/browser and syntax checks are run locally where available. `tests/booking-rls.sql` is included for a later fresh local Supabase verification only; it has not been executed and no production Supabase project was read or changed. A real two-session Supabase concurrency check remains part of that disposable verification.
