# Swift Logistics frontend redesign

The existing static HTML/CSS/vanilla JavaScript application now uses a shared carrier-style interface. Swift Logistics naming, navy/orange identity, wordmark and existing van asset are preserved. No third-party carrier branding, graphics, frameworks or production dependencies were introduced.

## Pages and files

- `index.html`: immediate tracking entry, four shipping shortcuts, domestic/international/business services and support.
- `history.html`: customer dashboard at `/history#overview`, with actual shipment totals, recent shipments, client-side search/status filtering and mobile shipment cards. `/history#shipments` shows the full filtered list.
- `ship.html`: sender, recipient, package, shipping details and review sections, retaining original form names and submission contract.
- `track.html`: status, origin/destination, expected delivery, recorded location, native progress indicator and chronological activity. Missing values are explicitly described; no upcoming events or locations are invented.
- `admin.html`: staff console with shipment lookup, existing update fields and support queue. Controls render only after the existing account response identifies a staff user; backend authorization is unchanged.
- `rates.html`: existing estimate calculation with clear estimated-rate wording.
- `profile.html`, `support.html`, `contact.html`, `login.html`, `register.html`, `forgot-password.html`, `reset-password.html`, `privacy.html`, `terms.html`: shared navigation/footer, typography, forms and responsive layout. Demo wording was removed; policy copy has not received legal review.
- `css/style.css`: shared stylesheet entry point; `css/carrier.css`: reusable layout, forms, navigation, dashboard, status and tracking styles.
- `js/workspace.js`: presentation helpers, account navigation, dashboard statistics/table/filtering, shipment review, tracking rendering and accessible validation feedback.
- `js/app.js`: connects these views to existing requests, reuses the account request and preserves shipment/support/authentication endpoints.
- `tests/ui-test.cjs`: browser verification with real local API flows and a temporary SQLite database.
- `artifacts/ui/`: desktop/tablet/mobile screenshots and machine-readable results.

## Verification

- Existing `node tests/smoke-test.js` passed.
- JavaScript syntax checks passed.
- Chrome/Playwright checks cover 375px, 768px and 1440px: all 15 pages, navigation, registration/login/logout, customer dashboard, empty states, shipment creation/review, search/status filters, quotes, tracking, support submission, staff shipment updates and support-ticket resolution.
- Staff checks promote only a temporary test account in an isolated test database. Logged-out and ordinary customer visits do not display staff forms.
- Checked page overflow and control bounds. Captured screenshots for home, dashboard, booking, tracking and staff screens at all three widths; visually reviewed representative mobile, tablet and desktop screenshots.
- Checked 263 local HTML navigation/asset references. No missing targets were found.
- No JavaScript or CSP errors were found in the completed browser checks. Tests distinguish JavaScript/CSP errors from resource errors, and explicitly fail for broken CSS/JavaScript/PNG requests. The local server can return expected authentication failures on signed-out account pages; the UI provides sign-in guidance.
- Source comparison confirms no changes to `server.js`, `index.js`, `api/`, `supabase/`, environment variables or package/API contracts. The pre-existing `.gitignore` edit was preserved.
- No FedEx references or new assets were introduced in the frontend source.

Browser testing uses an installed Playwright package and Chrome. This machine already had Playwright in the npm cache, so no install was needed:

```powershell
$env:PLAYWRIGHT_MODULE = 'C:/Users/princ/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright'
node tests/ui-test.cjs
```

On another machine, set `PLAYWRIGHT_MODULE` to its installed Playwright package directory and optionally `CHROME_PATH` to its Chrome executable. The test starts and stops its own local server, never reads `.env.local`, and removes only its own temporary database directory. It restarts its isolated server between test batches to avoid the existing in-memory rate limit.

## Frontend bugs addressed

- Replaced injected inline tracking CSS/styles with an external stylesheet and native `<progress>`, compatible with the current local CSP.
- Ordinary customers no longer see staff update forms when directly visiting the operations page.
- The registration screen now displays an existing email-confirmation response instead of immediately redirecting to a signed-in dashboard.
- Staff status selectors preserve the record's current status when the form renders.
- Shared account controls now consistently show dashboard, customer name and logout; staff receive a separate operations link.

## Existing limitations left unchanged

- The Supabase shipment/event writes and checked-in RLS policies still require the separate backend work described in `CHATGPT_HANDOFF.md`. Live Supabase booking and permissions were not tested here.
- The browser still falls back to localStorage on booking errors, as it did before. Browser-only shipments are not included in server-backed dashboard statistics.
- SQLite and Supabase authentication/recovery behavior still differs. Live email confirmation, password-reset delivery, session refresh and Resend delivery are unverified.
- Rate estimates remain the original client-side formula, not live carrier quotes.
- The existing local rate limiter counts page and asset requests as well as API requests; a long automated sweep can hit it. Production behavior was not altered.
- Existing server file-serving/security issues, unknown-tracking error semantics and deployment concerns were outside this UI task and remain unchanged.

## Remaining validation

The requested local UI work is complete. Deployment-specific checks remain: real Supabase accounts/data, configured mail/recovery flows, and the deployed Vercel site. This change has not been deployed. Browser verification used Chrome; Safari/Firefox and physical touch-device testing were not performed.

Run `node server.js` and open `http://localhost:3000` to review locally.
