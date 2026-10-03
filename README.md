# Shelf Oracle

Shelf Oracle turns a product shelf into a live tasting panel. Organizers photograph products, review AI-detected SKUs, lock a behaviour-based ranking before anyone votes, and invite attendees to predict and taste through an event-specific QR link. The reveal compares the locked model ranking, human consensus, and observed ratings. Each event keeps its own history and shareable report.

## Run locally

Requires Node.js 20.9+ and a Supabase project. Use Node.js 24 for the TypeScript test commands below.

1. Run `npm ci`.
2. Copy `.env.local.example` to `.env.local` and fill in the Gemini API key, Supabase project URL, publishable key, server-only secret key, and `APP_URL` (the canonical origin for confirmation links and QR codes). Never commit `.env.local`.
3. Run `supabase/schema.sql` in that project's Supabase SQL Editor. It creates the organizer/event/product/vote tables, row-level security policies, a private `shelf-oracle-shelves` Storage bucket, and the immutable prediction record.
4. In Supabase Auth URL settings, set the site URL to `http://localhost:3000` and allow `http://localhost:3000/auth/callback` as a redirect URL. Email confirmation must be deliverable for new organizer accounts. Add the deployed origin's `/auth/callback` URL when deploying.
5. Run `npm run dev` and open `http://localhost:3000`.

Organizer credentials stay in HttpOnly Supabase session cookies. The Supabase secret key and Gemini API key are used only by server-side route handlers; the publishable key is intentionally exposed to the browser. Public event pages expose results only after an organizer publishes the reveal.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

## Local synthetic fixtures

The sample archive is read locally; its SQL and Python scripts are never executed. No fixture data is imported into Supabase, and conversion makes no Gemini requests. This mode requires the system `unzip` command.

```bash
SHELF_ORACLE_SAMPLE_ZIP="/absolute/path/shelf-oracle-sample-data.zip" npm run test:fixtures
SHELF_ORACLE_SAMPLE_ZIP="/absolute/path/shelf-oracle-sample-data.zip" npm run dev
```

Open `http://localhost:3000/fixtures` for the fixture library, report previews, and reveal decks. With the dev server running, add `SHELF_ORACLE_FIXTURE_BASE_URL=http://localhost:3000` to the test command to also run the SSR/chart-title smoke check. Fixture routes return 404 outside development, even if the archive environment variable is set. Reports stay hidden for setup/intake/voting fixtures. All previews and downloads are labelled synthetic.

Conversion verifies each original SHA-256 hash, normalizes product attributes and voter IDs, recomputes weighted predictions and report metrics using the app's actual calculation functions, and records a distinct adapted hash. The original source hash remains provenance, not proof of a live model call. Placeholder SVGs are not treated as product photos; these fixtures cannot test Gemini shelf detection.

## Optional Supabase demo import

`scripts/import-samples.mjs` validates the complete archive and defaults to a local dry-run. Use `--check-remote` for read-only schema, collision and owner checks. Only an explicit `--apply --owner <confirmed-organizer-uuid>` creates data; it never deletes existing rows, disables guards, or executes the archive's SQL/Python. Pass `--zip <archive>` and `--python <existing-Python-with-Pillow>`. Imported workspaces/events are labelled synthetic; SVG placeholders become labelled JPEGs, and source-only metadata is preserved privately in event settings. Keep the same archive and Pillow version when resuming an interrupted import.

Run importer regressions with `SHELF_ORACLE_SAMPLE_ZIP=<archive> SAMPLE_IMPORT_PYTHON=<python> npm run test:import`.

## Event flow

1. Sign up and create an event in your personal workspace. The organizer login page also offers a QR to open verified sign-in on your phone; it contains only the canonical login URL, never credentials. Email links require an existing account, working mail delivery, and the configured callback URL; open the link in the same browser/device that requested it. Scanning alone does not grant account access.
2. Upload a shelf photo, review detection boxes and confirm or correct products.
3. Generate a draft behavioural prediction and lock it. The SHA-256 hash and timestamp are visible before voting.
4. Share the event's `/e/<slug>/v` QR link. Attendees optionally lock a top-five prediction, then rate products and add comments.
5. Build and publish the reveal. The public report stays at `/e/<slug>/report`; earlier events remain visible in the organizer history.

After publication, the public JSON download at `/api/e/<slug>/report` includes `lockProof.canonical`. Its UTF-8 SHA-256 digest must equal `reveal.lockHash` (the fingerprint visible on the event page before voting). The full prediction stays private until publication.

## Scope and limitations

This is an EAT_HACK prototype, not a validated predictor of real retail demand. Photo recognition can misidentify packaging, so organizers must review every detection. Small, self-selected tasting panels are not representative of shoppers; correlations and p-values describe this event's data, not causal impact. Anonymous voter IDs prevent accidental duplicate submissions in one browser but are not identity verification. Each signup currently gets an isolated personal workspace; multi-user team invitations are not yet self-service. Gemini free-tier requests may be used to improve Google's products; upload only photos and comments you are permitted to share. Obtain consent before collecting comments or displaying handles, and check allergen labels before tasting.
