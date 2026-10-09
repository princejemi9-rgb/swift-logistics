# Static-file exposure fix

## Files changed for this task

- `server.js`: replaces unrestricted project-directory serving with the shared public-file handler; validates raw paths before URL parsing.
- `index.js`: uses the same handler and validation; rejects API JavaScript implementation-file URLs instead of treating them as API endpoints.
- `public-files.js` (new): exact public manifest, canonical-path validation, physical-file checks and responses.
- `tests/static-serving-test.cjs` (new): isolated regression coverage for both entry points.
- `STATIC_SERVING_SECURITY_REPORT.md` (new): this report.

No redesigned HTML, frontend CSS/JavaScript, images, existing tests, database schemas, RLS, booking code, authentication implementation, environment files or package files were edited for this task. Existing working-tree changes from the earlier redesign were preserved.

The existing browser test refreshes these verification outputs:

```text
artifacts/ui/results.json
artifacts/ui/home-375.png
artifacts/ui/home-768.png
artifacts/ui/home-1440.png
artifacts/ui/dashboard-375.png
artifacts/ui/dashboard-768.png
artifacts/ui/dashboard-1440.png
artifacts/ui/ship-375.png
artifacts/ui/ship-768.png
artifacts/ui/ship-1440.png
artifacts/ui/tracking-375.png
artifacts/ui/tracking-768.png
artifacts/ui/tracking-1440.png
artifacts/ui/staff-375.png
artifacts/ui/staff-768.png
artifacts/ui/staff-1440.png
```

## Original exposure

`server.js` mapped arbitrary request paths into the repository and served existing files without a public-file allowlist. This could expose environment files, databases and internal code. Root `index.js` limited extensions, but allowed `.js`, including backend source. Both used string-prefix containment, which does not distinguish a directory from a sibling sharing its name, and neither constrained resolved symlink/junction targets to the approved physical file.

## Public boundary

The shared manifest allows only these 15 HTML page files: index, ship, rates, track, history, support, contact, login, register, forgot-password, reset-password, profile, admin, privacy and terms. `/` and clean page URLs are preserved; legacy `.html` URLs keep their redirects.

The only public asset files are:

- `css/style.css`
- `css/carrier.css`
- `css/operations.css`
- `js/app.js`
- `js/workspace.js`
- `assets/swift-logistics-van.png`

Extensions and directories do not grant access. Even a new `.js`, `.css`, `.html` or `.png` file inside an existing frontend directory is private until deliberately added to the manifest. New fonts/icons/images require explicit entries. The admin HTML shell is public as before; its existing account/role checks and API authorization continue to protect operations.

Unknown and rejected static paths return a generic 404 without filesystem details. Public content supports GET and HEAD, accurate content types and `nosniff`. Existing local security headers remain in place. Normal API requests continue to their existing handlers; no API implementation file is read by the static handler.

## Path handling

1. Inspect the original request target before WHATWG URL normalization can collapse dot segments or reinterpret backslashes.
2. Reject malformed escapes, control characters, backslashes, encoded separators, dot segments, repeated slashes, drive/alternate-stream syntax and residual percent escapes used for double encoding. Query strings do not participate in file selection.
3. Resolve only an exact manifest entry against the canonical application root.
4. Use `path.relative` and absolute-path checks for containment, rather than a string-prefix comparison.
5. Resolve the physical file with `realpath`. Require both containment and equality with the expected approved physical path. This also rejects a public symlink/junction redirected to a private file inside the project, not just an external target.
6. Require a regular file before reading it.

## Tests and results

- `node tests/static-serving-test.cjs`: **passed, 125 checks per entry point (250 total)**, plus malformed-target parser checks. Exercises root `index.js` over HTTP with a harmless API stub and exercises the real standalone `server.js` in an isolated copied fixture.
- `node tests/smoke-test.js`: **passed** registration/authentication, shipment creation, public tracking, account history and support.
- `node --check public-files.js`, `node --check index.js`, `node --check server.js`, `node --check tests/static-serving-test.cjs`: **passed**.
- `git diff --check`: **passed**; Git emitted only existing Windows line-ending notices.
- Browser regression command: `$env:PLAYWRIGHT_MODULE='C:/Users/princ/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright'; node tests/ui-test.cjs`: **passed at 375px, 768px and 1440px**, checking all 15 pages in logged-out/staff states and customer workflows. Registration/login/logout, customer/staff navigation, shipment creation/review, search/filtering, tracking, estimates, support submission, shipment updates and ticket resolution passed. No JavaScript/CSP errors or failed CSS/JavaScript/PNG requests were recorded. Results are in `artifacts/ui/results.json`.

The security fixture contains only harmless sentinels for environment-like files, database-like files, migrations, scripts, tests, Markdown, repository metadata, configuration and deployment files. No real secrets or customer database files are read. The fixture also tests backend source requests, private files with frontend extensions, missing files, redirects, HEAD, public content byte equality, URL-encoded/double-encoded/raw traversal, Windows paths, sibling-prefix tricks and directory junctions to internal/external sentinel targets. Raw HTTP requests preserve attack strings that a browser URL parser would otherwise normalize before sending.

## Remaining boundaries

- No deployment was performed. Tests verify the two application entry points; any hosting/CDN rule that serves repository files independently of these handlers must also use a restricted public output configuration. Live Vercel routing was not audited or changed.
- Filesystem checks assume trusted application/deployment writers. They are not a sandbox against an attacker who can concurrently replace application files or create hard links on the host.
- Previously identified Supabase/RLS booking issues and unrelated authentication/security limitations remain unchanged for separate review. No live Supabase tests were performed.
