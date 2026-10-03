#!/usr/bin/env node
/**
 * NON-DESTRUCTIVE synthetic-data importer. Node 22.18+ (native TS imports), unzip,
 * and an existing Python with Pillow are required. No dependency installation.
 *
 * Local validation only (the default; no credentials/network needed):
 *   node scripts/import-samples.mjs --zip /path/samples.zip --python /path/python
 * Read-only remote preflight (owner optional, but required before applying):
 *   node --env-file=.env.local scripts/import-samples.mjs --zip /path/samples.zip \
 *     --python /path/python --check-remote --owner CONFIRMED_ORGANIZER_UUID
 * Explicitly apply after reviewing the dry run:
 *   node --env-file=.env.local scripts/import-samples.mjs --zip /path/samples.zip \
 *     --python /path/python --owner CONFIRMED_ORGANIZER_UUID --apply
 *
 * Run ONE importer at a time, without editing the demo workspaces concurrently.
 * No deletes, upserts, auth-user creation, SQL execution, or trigger/RLS changes.
 * A failed run may leave partial demo rows/objects: rerun the exact same archive,
 * owner, importer, and Pillow version. Existing mismatches always stop the run.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { readSampleArchive } from "../src/lib/sample-fixtures.ts";
import { canonicalHash, canonicalJson } from "../src/lib/hash.ts";
import { calculateReveal } from "../src/lib/metrics.ts";
import { PRINCIPLES } from "../src/lib/principles.ts";

export const VERSION = "shelf-oracle-samples-v1";
const PREFIX = "[SYNTHETIC DEMO] ";
const ROOT = "shelf-oracle-sample-data/";
const BUCKET = "shelf-oracle-shelves";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROOF = "synthetic-reconstructed";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const omit = (row, keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
const must = (condition, message) => { if (!condition) throw new ImportError(message); };
class ImportError extends Error {}

export function parseArgs(args) {
  const options = { apply: false, checkRemote: false, python: "python3", dryRun: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    must(!seen.has(arg), `Duplicate option: ${arg}`);
    seen.add(arg);
    if (["--apply", "--check-remote", "--dry-run", "--help"].includes(arg)) {
      options[{ "--apply": "apply", "--check-remote": "checkRemote", "--dry-run": "dryRun", "--help": "help" }[arg]] = true;
    } else if (["--zip", "--python", "--owner"].includes(arg)) {
      const value = args[++i];
      must(value && !value.startsWith("--"), `Missing value for ${arg}`);
      options[arg.slice(2)] = value;
    } else throw new ImportError("Unknown option (use --help)");
  }
  if (options.help) return options;
  must(options.zip, "--zip is required");
  must(!(options.apply && options.dryRun), "--apply cannot be combined with --dry-run");
  must(!options.owner || UUID.test(options.owner), "--owner must be an existing confirmed organizer UUID");
  must(!options.apply || options.owner, "--apply requires --owner CONFIRMED_ORGANIZER_UUID");
  if (options.owner) options.owner = options.owner.toLowerCase();
  return options;
}

/** Strict RFC4180-style parser: quoted commas/newlines/escaped quotes; no eval. */
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", quoted = false, closed = false;
  const endField = () => { row.push(field); field = ""; closed = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else field += ch;
    } else if (ch === ",") endField();
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; endRow(); }
    else if (ch === '"' && !field && !closed) quoted = true;
    else { must(!closed && ch !== '"', "Malformed CSV quoting"); field += ch; }
  }
  must(!quoted, "Unterminated CSV field");
  if (field || closed || row.length) endRow();
  const header = rows.shift();
  must(header?.length && header.every((key) => /^[a-z][a-z0-9_]*$/.test(key)) &&
    new Set(header).size === header.length, "Invalid CSV header");
  return rows.map((values) => {
    must(values.length === header.length, "CSV row has incorrect column count");
    return Object.fromEntries(header.map((key, i) => [key, values[i]]));
  });
}

function uniqueMap(rows, key, label) {
  const result = new Map(rows.map((row) => [key(row), row]));
  must(result.size === rows.length, `Duplicate ${label}`);
  return result;
}
const jsonCell = (value) => value === "" ? null : JSON.parse(value);
const timeValid = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
function svgHash(value) {
  must(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/.test(value), "Expected a synthetic SVG data URL");
  // Only hash the source bytes; never parse, render, execute, or upload SVG.
  return sha256(value);
}

// Our own trusted renderer; NEVER invokes source Python or opens source SVGs.
// -I isolates Python from PYTHONPATH/current-directory imports. Labels are JSON
// input, not executable code. Fixed dimensions bound CPU/memory use.
const RENDERER = String.raw`
import sys, json, io, base64, hashlib, textwrap
from PIL import Image, ImageDraw, ImageFont, __version__
result = {}
font = ImageFont.load_default()
for item in json.load(sys.stdin):
    shelf = item['kind'] == 'shelf'
    w, h = (800, 600) if shelf else (120, 160)
    digest = hashlib.sha256(item['key'].encode()).digest()
    colour = tuple(45 + n % 100 for n in digest[:3])
    image = Image.new('RGB', (w, h), '#ece8df' if shelf else colour)
    draw = ImageDraw.Draw(image)
    if shelf:
        for y in (195, 395, 590):
            draw.rectangle((0, y, w, y + 8), fill='#8b6b4a')
        lines = ['SYNTHETIC DEMO - NOT A PHOTO', '', *textwrap.wrap(item['label'], 80), '', 'Reconstructed shelf placeholder']
        x, y, step = 35, 245, 18
    else:
        draw.rectangle((3, 87, 116, 156), fill='#faf6ee')
        draw.text((5, 10), 'SYNTHETIC DEMO', font=font, fill='white')
        draw.text((5, 25), 'NOT A PHOTO', font=font, fill='white')
        lines = textwrap.wrap(item['label'], 17)[:5]
        x, y, step = 6, 90, 12
    for line in lines:
        draw.text((x, y), line.encode('ascii', 'replace').decode(), font=font, fill='#222222')
        y += step
    output = io.BytesIO()
    image.save(output, format='JPEG', quality=82, optimize=False, progressive=False, subsampling=0)
    result[item['key']] = base64.b64encode(output.getvalue()).decode('ascii')
print(json.dumps({'pillow': __version__, 'images': result}))
`;

function makeImages(requests, python) {
  try {
    const result = JSON.parse(execFileSync(python, ["-I", "-c", RENDERER], {
      input: JSON.stringify(requests), encoding: "utf8", maxBuffer: 20_000_000,
      timeout: 60_000, stdio: ["pipe", "pipe", "pipe"],
    }));
    must(Object.keys(result.images).length === requests.length, "Incomplete placeholder rendering");
    for (const request of requests) {
      const bytes = Buffer.from(result.images[request.key] ?? "", "base64");
      must(bytes.length > 100 && bytes.length < 5_242_880 && bytes[0] === 255 && bytes[1] === 216 &&
        bytes.at(-2) === 255 && bytes.at(-1) === 217, "Invalid generated JPEG");
    }
    return result;
  } catch {
    throw new ImportError("JPEG generation failed. Pass --python /path/to/an/existing/python-with-Pillow (no packages are installed).");
  }
}

export function buildPlan({ zip, python = "python3" }) {
  const archive = resolve(zip);
  must(statSync(archive).isFile() && statSync(archive).size <= 50_000_000, "Archive must be a file no larger than 50MB");
  const archiveHash = sha256(readFileSync(archive));
  const names = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8", maxBuffer: 1_000_000 }).trim().split(/\r?\n/);
  must(new Set(names).size === names.length && names.every((name) =>
    name.startsWith(ROOT) && !name.includes("\\") && !name.split("/").includes("..")), "Unsafe or duplicate ZIP entries");
  const readEntry = (name) => {
    must(names.includes(ROOT + name), `Missing archive data: ${name}`);
    return execFileSync("unzip", ["-p", archive, ROOT + name], { encoding: "utf8", maxBuffer: 2_000_000 });
  };
  const csv = Object.fromEntries(["orgs", "org_members", "events", "shelf_images", "products", "predictions", "votes",
    "human_predictions", "voters_ground_truth", "event_metrics_summary"].map((table) => [table, parseCsv(readEntry(`csv/${table}.csv`))]));
  const fixtures = readSampleArchive(archive); // source hash/chronology checks + current scoring, not duplicated here
  const orgs = csv.orgs.map((org) => {
    must(UUID.test(org.id) && timeValid(org.created_at) && org.name, "Invalid source org");
    return { ...org, name: PREFIX + org.name };
  });
  const orgMap = uniqueMap(orgs, (row) => row.id, "org ID");
  const eventMap = uniqueMap(csv.events, (row) => row.id, "event ID");
  const productMap = uniqueMap(csv.products, (row) => row.id, "product ID");
  const imageMap = uniqueMap(csv.shelf_images, (row) => row.id, "source shelf-image ID");
  uniqueMap(fixtures, (fixture) => fixture.event.id, "fixture event ID");
  uniqueMap(csv.voters_ground_truth, (row) => `${row.event_slug}:${row.voter_id}`, "ground-truth voter");
  const summaries = uniqueMap(csv.event_metrics_summary, (row) => row.event_slug, "source metrics summary");
  must(eventMap.size === fixtures.length, "CSV and export event counts differ");
  const slugs = new Set(fixtures.map((fixture) => fixture.event.slug));
  must(csv.org_members.every((row) => orgMap.has(row.org_id) && ["owner", "member"].includes(row.role)), "Invalid source org memberships");
  must(csv.voters_ground_truth.every((row) => slugs.has(row.event_slug)) &&
    csv.event_metrics_summary.every((row) => slugs.has(row.event_slug)), "Unknown event in source auxiliary records");
  must(csv.shelf_images.every((row) => eventMap.has(row.event_id)), "Unknown shelf-image event");
  const expectedTotals = { products: 0, votes: 0, human_predictions: 0, predictions: 0 };
  const requests = [];
  const plans = fixtures.map((fixture) => {
    const raw = JSON.parse(readEntry(`exports/${fixture.event.slug}.json`));
    const sourceEvent = eventMap.get(fixture.event.id);
    must(sourceEvent && orgMap.has(sourceEvent.org_id), "Missing event/org mapping");
    for (const key of ["id", "slug", "name", "location", "status", "created_at", "locked_at", "lock_hash"])
      must(equal(sourceEvent[key] || null, raw.event[key] ?? null), `CSV/export event mismatch: ${key}`);
    must(equal(jsonCell(sourceEvent.settings), raw.event.settings), "CSV/export source settings mismatch");
    must(!sourceEvent.draft, "Source contains an unsupported non-empty draft; refusing to omit it");
    must(equal(jsonCell(sourceEvent.reveal), raw.reveal), "CSV/export source reveal mismatch");
    const sourceImages = csv.shelf_images.filter((row) => row.event_id === fixture.event.id).map((row) => {
      must(/^[1-9][0-9]*$/.test(row.id) && /^\d+$/.test(row.detected_count) && timeValid(row.created_at), "Invalid source shelf row");
      const sourceSvgHash = svgHash(row.image);
      const key = `shelf:${row.id}`;
      requests.push({ key, kind: "shelf", label: `${fixture.event.name} | ${row.detected_count} products | Source shelf ${row.id}` });
      return { sourceId: row.id, key, sourceSvgHash, event_id: fixture.event.id,
        detected_count: Number(row.detected_count), created_at: row.created_at };
    });
    const productSources = raw.products.map((source) => {
      const row = productMap.get(source.id);
      must(row, "Missing CSV product");
      for (const key of ["id", "event_id", "brand", "name", "category", "format", "price", "created_at"])
        must(equal(row[key] || null, source[key] ?? null), `CSV/export product mismatch: ${key}`);
      for (const key of ["claims", "attributes", "box"])
        must(equal(jsonCell(row[key]), source[key] ?? null), `CSV/export product JSON mismatch: ${key}`);
      must(String(source.source_image_id ?? "") === row.source_image_id, "Product image mapping differs between sources");
      must(row.source_image_id && imageMap.get(row.source_image_id)?.event_id === fixture.event.id, "Product references missing/wrong-event shelf image");
      const sourceThumbHash = svgHash(row.thumb);
      requests.push({ key: `thumb:${source.id}`, kind: "thumb", label: `${source.brand} ${source.name}` });
      return { id: source.id, sourceImageId: row.source_image_id, sourceThumbHash };
    });
    // Verify the CSV copies of all interaction/prediction records, not only totals.
    for (const [table, rows, keys] of [
      ["votes", raw.votes, ["event_id", "voter_id", "product_id", "rating", "comment", "created_at"]],
      ["human_predictions", raw.guesses, ["event_id", "voter_id", "display_name", "top5", "created_at"]],
      ["predictions", raw.prediction ? [raw.prediction] : [], ["event_id", "locked_at", "hash", "payload"]],
    ]) {
      const toRecord = (row, fromCsv) => Object.fromEntries(keys.map((key) => [key,
        fromCsv && ["top5", "payload"].includes(key) ? jsonCell(row[key]) :
          fromCsv && key === "rating" ? Number(row[key]) : (row[key] === "" ? null : row[key])]));
      const a = rows.map((row) => canonicalJson(toRecord(row, false))).sort();
      const b = csv[table].filter((row) => row.event_id === fixture.event.id).map((row) => canonicalJson(toRecord(row, true))).sort();
      must(equal(a, b), `CSV/export ${table} mismatch`);
      expectedTotals[table] += rows.length;
    }
    expectedTotals.products += fixture.products.length;
    return { fixture, orgId: sourceEvent.org_id, raw, sourceImages, productSources,
      summary: summaries.get(fixture.event.slug) ?? null,
      groundTruth: csv.voters_ground_truth.filter((row) => row.event_slug === fixture.event.slug),
      org: csv.orgs.find((row) => row.id === sourceEvent.org_id),
      orgMembers: csv.org_members.filter((row) => row.org_id === sourceEvent.org_id) };
  });
  for (const [table, count] of Object.entries(expectedTotals)) must(csv[table].length === count, `Unmapped ${table} records`);
  must(plans.reduce((sum, plan) => sum + plan.sourceImages.length, 0) === csv.shelf_images.length, "Unmapped images");
  must(plans.every((plan) => plan.sourceImages.every((image) =>
    plan.productSources.filter((product) => product.sourceImageId === image.sourceId).length === image.detected_count)), "Shelf detected_count differs from mapped products");
  const rendered = makeImages(requests, python);
  for (const plan of plans) {
    const { fixture } = plan;
    plan.images = plan.sourceImages.map(({ key, ...image }) => {
      const bytes = Buffer.from(rendered.images[key], "base64");
      const jpegHash = sha256(bytes);
      return { ...image, bytes, jpegHash,
        image: `${plan.orgId}/${fixture.event.id}/synthetic-v1-${image.sourceId}-${jpegHash.slice(0, 16)}.jpg` };
    });
    plan.products = fixture.products.map((product) => ({ ...product, thumb: `data:image/jpeg;base64,${rendered.images[`thumb:${product.id}`]}` }));
    plan.votes = fixture.votes.map((row) => omit(row, ["id"]));
    plan.guesses = fixture.guesses.map((row) => omit(row, ["id"]));
    plan.prediction = fixture.prediction ? { event_id: fixture.event.id, locked_at: fixture.prediction.lockedAt,
      hash: fixture.lockHash, payload: fixture.prediction } : null;
    plan.draft = fixture.prediction ? Object.fromEntries(Object.entries(fixture.prediction).filter(([key]) => key !== "lockedAt")) : null;
    plan.reveal = fixture.reveal ? { ...calculateReveal(fixture.prediction, plan.products, fixture.votes, fixture.guesses,
      fixture.lockHash, fixture.reveal.generatedAt), synthetic: true, proofKind: PROOF } : null;
    plan.baseSettings = {
      ...plan.raw.event.settings,
      principles: PRINCIPLES.map((principle) => ({ ...principle,
        weight: plan.raw.event.settings.principles.find((item) => item.key === principle.key)?.weight ?? principle.weight })),
      synthetic: true, proofKind: PROOF, importerVersion: VERSION, archiveHash,
      sourceHash: fixture.provenance.sourceHash ?? canonicalHash(plan.raw),
      sourceHashVerified: fixture.provenance.sourceHashVerified,
      sourceHistory: {
        event: plan.raw.event, org: plan.org, membershipReferences: plan.orgMembers,
        // Auxiliary source records have no current tables: preserve as labeled
        // source-only metadata, not replacement metrics or real memberships.
        metricsSummary: plan.summary, voterGroundTruth: plan.groundTruth,
        originalSyntheticReveal: plan.raw.reveal,
        predictionProvenance: fixture.provenance,
        shelfImages: plan.images.map((image) => omit(image, ["bytes"])),
        productImages: plan.productSources,
        imageKind: "safe-recreated-jpeg-placeholder-not-photo", pillowVersion: rendered.pillow,
      },
    };
    plan.planHash = canonicalHash({ version: VERSION, settings: plan.baseSettings, products: plan.products,
      votes: plan.votes, guesses: plan.guesses, prediction: plan.prediction, reveal: plan.reveal });
    // Drop raw source product attributes (including nested prediction scores).
    delete plan.raw;
  }
  return { archiveHash, orgs, events: plans, counts: {
    orgs: orgs.length, ownerMembershipsToCreate: orgs.length, sourceMembershipReferences: csv.org_members.length,
    events: fixtures.length, shelfImages: csv.shelf_images.length, jpegThumbnails: csv.products.length,
    products: csv.products.length, votes: csv.votes.length,
    comments: fixtures.reduce((sum, fixture) => sum + fixture.votes.filter((vote) => vote.comment).length, 0),
    guesses: csv.human_predictions.length, lockedPredictions: csv.predictions.length,
    regeneratedReports: fixtures.filter((fixture) => fixture.reveal).length,
    sourceMetricSummaries: csv.event_metrics_summary.length, sourceVoterGroundTruth: csv.voters_ground_truth.length,
    statuses: Object.fromEntries([...new Set(fixtures.map((fixture) => fixture.event.status))].map((status) =>
      [status, fixtures.filter((fixture) => fixture.event.status === status).length])),
  }, pillowVersion: rendered.pillow };
}

export function settingsFor(plan, owner, importedAt) {
  return { ...plan.baseSettings, importPlanHash: plan.planHash, importOwnerId: owner, importedAt };
}
function eventFields(plan) {
  const event = plan.fixture.event;
  return { id: event.id, org_id: plan.orgId, slug: event.slug, name: PREFIX + event.name,
    location: event.location, created_at: event.createdAt };
}
function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    ["created_at", "locked_at"].includes(key) && value !== null ? new Date(value).toISOString() : value]));
}
export function assertFields(actual, expected, label) {
  const projected = Object.fromEntries(Object.keys(expected).map((key) => [key, actual[key]]));
  must(equal(normalizeRow(projected), normalizeRow(expected)), `${label} differs; refusing to overwrite existing data`);
}
function subset(actual, expected, key, label) {
  const wanted = uniqueMap(expected, key, `${label} input`);
  const present = uniqueMap(actual, key, `${label} stored`);
  for (const row of actual) {
    const match = wanted.get(key(row));
    must(match, `Unexpected ${label}; refusing to change this event`);
    assertFields(row, match, label);
  }
  return expected.filter((row) => !present.has(key(row)));
}
const imageRow = (image) => ({ event_id: image.event_id, image: image.image,
  detected_count: image.detected_count, created_at: image.created_at });
export function productRows(plan, images) {
  const byPath = new Map(images.map((image) => [image.image, image.id]));
  return plan.products.map((product) => {
    const sourceId = plan.productSources.find((source) => source.id === product.id).sourceImageId;
    const image = plan.images.find((image) => image.sourceId === sourceId);
    return { ...product, source_image_id: byPath.get(image.image) ?? null };
  });
}
export const emptyState = () => ({ event: null, images: [], products: [], predictions: [], votes: [], guesses: [] });

/** Pure collision/resume checks, also exercised by importer-specific tests. */
export function inspectEvent(plan, state, owner) {
  const { event, images, products, predictions, votes, guesses } = state;
  if (!event) {
    must(![images, products, predictions, votes, guesses].some((rows) => rows.length), "Orphaned event records");
    return { complete: false, missingImages: plan.images.map(imageRow), missingProducts: plan.products,
      missingVotes: plan.votes, missingGuesses: plan.guesses };
  }
  assertFields(event, eventFields(plan), "Event identity/non-demo collision");
  must(timeValid(event.settings?.importedAt), "Existing event has no importer provenance");
  assertFields(event, { settings: settingsFor(plan, owner ?? event.settings.importOwnerId, event.settings.importedAt),
    settings_version: 0 }, "Event synthetic provenance");
  must(UUID.test(event.settings.importOwnerId ?? ""), "Invalid existing demo owner");
  const missingImages = subset(images, plan.images.map(imageRow), (row) => row.image, "shelf image");
  const missingProducts = subset(products, productRows(plan, images), (row) => row.id, "product");
  for (const product of products) must(product.source_image_id !== null, "Stored product is missing its image mapping");
  const missingGuesses = subset(guesses, plan.guesses, (row) => row.voter_id, "guess");
  const missingVotes = subset(votes, plan.votes, (row) => `${row.voter_id}:${row.product_id}`, "vote");
  must(!missingGuesses.some((guess) => votes.some((vote) => vote.voter_id === guess.voter_id)),
    "Cannot resume a missing guess after that participant has already voted");
  must(event.products_version === images.length + products.length, "Unexpected product/intake version");
  const intakeComplete = !missingImages.length && !missingProducts.length;
  const interactionsComplete = !missingVotes.length && !missingGuesses.length;
  const target = plan.fixture.event.status;
  const path = plan.prediction ? ["setup", "intake", "voting", ...(target === "voting" ? [] : ["locked"]),
    ...(["revealed", "closed"].includes(target) ? ["revealed"] : []), ...(target === "closed" ? ["closed"] : [])]
    : target === "intake" ? ["setup", "intake"] : ["setup"];
  must(path.includes(event.status), "Event status cannot be resumed without a forbidden transition");
  must(event.draft === null || (intakeComplete && equal(event.draft, plan.draft)), "Existing draft differs from the reconstructed prediction");
  if (event.lock_hash) {
    must(plan.prediction && intakeComplete && !["setup", "intake"].includes(event.status), "Incomplete immutable intake");
    assertFields(event, { lock_hash: plan.prediction.hash, locked_at: plan.prediction.locked_at, draft: plan.draft }, "Event lock");
    must(predictions.length === 1, "Missing or duplicate immutable prediction");
    assertFields(predictions[0], plan.prediction, "Locked prediction");
    if (event.status !== "voting") must(interactionsComplete, "Frozen event has missing votes/guesses; will not reopen it");
  } else {
    must(["setup", "intake"].includes(event.status) && event.locked_at === null && !predictions.length &&
      !votes.length && !guesses.length && event.reveal === null, "Inconsistent pre-lock event");
  }
  if (event.reveal !== null) {
    must(plan.reveal && ["locked", "revealed", "closed"].includes(event.status), "Unexpected cached/published reveal");
    assertFields(event, { reveal: plan.reveal }, "Immutable reveal");
  }
  if (["revealed", "closed"].includes(event.status)) must(event.reveal !== null, "Published event is missing its report");
  return { complete: event.status === target && intakeComplete && interactionsComplete &&
    Boolean(event.lock_hash) === Boolean(plan.prediction) && equal(event.reveal, plan.reveal),
    missingImages, missingProducts, missingVotes, missingGuesses };
}

// Never print Supabase/HTTP errors, which may carry sensitive request details.
async function checked(request, operation) {
  const result = await request;
  if (result.error) throw new ImportError(`${operation} failed (status ${result.status ?? "unknown"}, code ${result.error.code || "unavailable"}; no data overwritten).`);
  return result.data;
}
async function allRows(db, table, column, values) {
  if (!values.length) return [];
  const rows = [];
  for (let start = 0; start < values.length; start += 75) {
    const ids = values.slice(start, start + 75);
    for (let offset = 0; ; offset += 500) {
      const data = await checked(db.from(table).select("*").in(column, ids)
        .order(table === "predictions" ? "event_id" : table === "org_members" ? "user_id" : "id").range(offset, offset + 499), `Read ${table}`);
      rows.push(...data);
      if (data.length < 500) break;
    }
  }
  return rows;
}
async function loadEvent(db, plan) {
  const id = plan.fixture.event.id;
  const event = await checked(db.from("events").select("*").eq("id", id).maybeSingle(), "Read event");
  const tables = ["shelf_images", "products", "predictions", "votes", "human_predictions"];
  const [images, products, predictions, votes, guesses] = await Promise.all(tables.map((table) => allRows(db, table, "event_id", [id])));
  return { event, images, products, predictions, votes, guesses };
}
async function inspectStorage(db, plan) {
  const present = new Set();
  if (!plan.images.length) return present;
  const prefix = `${plan.orgId}/${plan.fixture.event.id}`;
  const objects = await checked(db.storage.from(BUCKET).list(prefix, { limit: 1000 }), "List private shelf objects");
  for (const image of plan.images) {
    if (!objects.some((object) => `${prefix}/${object.name}` === image.image)) continue;
    const blob = await checked(db.storage.from(BUCKET).download(image.image), "Verify existing shelf JPEG");
    must(sha256(Buffer.from(await blob.arrayBuffer())) === image.jpegHash, "Existing storage object differs; refusing to overwrite");
    present.add(image.image);
  }
  return present;
}

async function checkRpcAvailability(url, key) {
  // GET OpenAPI metadata; never invoke the mutating RPC just to test it.
  const response = await fetch(new URL("rest/v1/", url.endsWith("/") ? url : `${url}/`), {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
    signal: AbortSignal.timeout(20_000),
  });
  must(response.ok, "Could not read remote REST schema metadata");
  const schema = await response.json();
  must(schema.paths?.["/rpc/lock_event_prediction"]?.post, "lock_event_prediction RPC is not exposed to the service role");
}

export async function preflight(db, plan, owner) {
  // Explicit columns detect an incompatible/old schema even when demo IDs do
  // not exist yet. SELECT only: no probes that create or mutate a live record.
  const columns = {
    orgs: "id,name,created_at", org_members: "org_id,user_id,role",
    events: "id,org_id,slug,name,location,status,draft,settings,settings_version,products_version,reveal,locked_at,lock_hash,created_at",
    shelf_images: "id,event_id,image,detected_count,created_at",
    products: "id,event_id,brand,name,category,format,price,claims,attributes,box,thumb,source_image_id,created_at",
    predictions: "event_id,locked_at,hash,payload",
    human_predictions: "id,event_id,voter_id,display_name,top5,created_at",
    votes: "id,event_id,voter_id,product_id,rating,comment,created_at",
  };
  for (const [table, fields] of Object.entries(columns))
    await checked(db.from(table).select(fields).range(0, 0), `Check ${table} schema availability`);
  if (owner) {
    const data = await checked(db.auth.admin.getUserById(owner), "Read chosen organizer");
    must(data?.user?.id === owner && (data.user.email_confirmed_at || data.user.confirmed_at) &&
      !(data.user.banned_until && Date.parse(data.user.banned_until) > Date.now()), "Owner must be an existing confirmed, unbanned user");
    const memberships = await allRows(db, "org_members", "user_id", [owner]);
    must(memberships.length > 0, "Chosen user is not an existing organizer (no org membership)");
  }
  const bucket = await checked(db.storage.getBucket(BUCKET), "Read private shelf bucket");
  must(bucket && bucket.public === false && (!bucket.allowed_mime_types || bucket.allowed_mime_types.includes("image/jpeg")),
    "Shelf bucket must already exist, be private, and allow JPEG; importer will not alter it");
  const largest = Math.max(0, ...plan.events.flatMap((event) => event.images.map((image) => image.bytes.length)));
  must(!bucket.file_size_limit || Number(bucket.file_size_limit) >= largest, "Shelf bucket file-size limit is too small");
  const orgIds = plan.orgs.map((org) => org.id);
  const orgs = await allRows(db, "orgs", "id", orgIds);
  for (const org of orgs) assertFields(org, plan.orgs.find((source) => source.id === org.id), "Org collision");
  // Inspect every event and member in the target orgs: don't attach our import
  // to a live workspace merely because its ID or display name happens to match.
  const orgEvents = await allRows(db, "events", "org_id", orgIds);
  const members = await allRows(db, "org_members", "org_id", orgIds);
  const ids = plan.events.map((item) => item.fixture.event.id);
  must(orgEvents.every((event) => ids.includes(event.id)), "Target org contains non-import events");
  for (const member of members) {
    const expectedOwner = owner ?? orgEvents.find((event) => event.org_id === member.org_id)?.settings?.importOwnerId;
    must(expectedOwner && member.user_id === expectedOwner && member.role === "owner", "Target org has unexpected membership; refusing to change it");
  }
  const bySlug = await allRows(db, "events", "slug", plan.events.map((item) => item.fixture.event.slug));
  for (const event of bySlug) must(plan.events.some((item) => item.fixture.event.id === event.id && item.fixture.event.slug === event.slug),
    "Event slug belongs to a different/non-demo event");
  const allProducts = await allRows(db, "products", "id", plan.events.flatMap((item) => item.products.map((product) => product.id)));
  for (const product of allProducts) must(plan.events.some((item) => item.fixture.event.id === product.event_id &&
    item.products.some((source) => source.id === product.id)), "Product ID collision with another event");
  const events = new Map();
  for (const item of plan.events) {
    const state = await loadEvent(db, item);
    const result = inspectEvent(item, state, owner);
    const objects = await inspectStorage(db, item);
    events.set(item.fixture.event.id, { state, result, objects });
  }
  return { orgs, members, events };
}

async function insertRows(db, table, rows) {
  for (let i = 0; i < rows.length; i += 100) await checked(db.from(table).insert(rows.slice(i, i + 100)), `Insert ${table}`);
}
async function updateEvent(db, plan, state, changes) {
  const old = state.event;
  let query = db.from("events").update(changes).eq("id", old.id).eq("status", old.status)
    .eq("settings_version", old.settings_version).eq("products_version", old.products_version)
    .eq("settings->>importPlanHash", plan.planHash);
  query = old.lock_hash ? query.eq("lock_hash", old.lock_hash) : query.is("lock_hash", null);
  const rows = await checked(query.select("*"), "Advance demo event lifecycle");
  must(rows.length === 1, "Event changed concurrently; stop and rerun validation");
  state.event = rows[0];
}

/** All write paths are contained here, reachable only after explicit CLI opt-in. */
export async function applyPlan(db, plan, owner, remote) {
  must(UUID.test(owner ?? ""), "Apply requires an owner UUID");
  for (const org of plan.orgs) {
    if (!remote.orgs.some((row) => row.id === org.id)) await insertRows(db, "orgs", [org]);
    if (!remote.members.some((row) => row.org_id === org.id && row.user_id === owner))
      await insertRows(db, "org_members", [{ org_id: org.id, user_id: owner, role: "owner" }]);
  }
  for (const item of plan.events) {
    const existing = remote.events.get(item.fixture.event.id);
    if (existing.result.complete && existing.objects.size === item.images.length) {
      console.log(`SKIP complete: ${item.fixture.event.slug}`);
      continue;
    }
    let state = await loadEvent(db, item);
    inspectEvent(item, state, owner); // recheck immediately before changing this event
    if (!state.event) {
      state.event = await checked(db.from("events").insert({ ...eventFields(item), status: "setup",
        settings: settingsFor(item, owner, new Date().toISOString()) }).select("*").single(), "Create synthetic demo event");
    }
    for (const image of item.images) {
      if (!existing.objects.has(image.image)) await checked(db.storage.from(BUCKET).upload(image.image, image.bytes,
        { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" }), "Upload synthetic shelf JPEG");
      if (!state.images.some((row) => row.image === image.image)) {
        must(["setup", "intake"].includes(state.event.status), "Cannot insert a shelf row after lock");
        const row = await checked(db.from("shelf_images").insert(imageRow(image)).select("*").single(), "Insert shelf-image identity row");
        state.images.push(row); // real generated ID, never the source identity value
      }
    }
    const products = productRows(item, state.images);
    must(products.every((product) => product.source_image_id !== null), "Incomplete generated shelf-image mapping");
    const missingProducts = subset(state.products, products, (row) => row.id, "product");
    if (missingProducts.length) await insertRows(db, "products", missingProducts);
    state = await loadEvent(db, item); // intake triggers changed products_version/draft
    inspectEvent(item, state, owner);
    if (!item.prediction) {
      if (item.fixture.event.status === "intake" && state.event.status === "setup") await updateEvent(db, item, state, { status: "intake" });
    } else {
      if (!state.event.lock_hash) {
        if (state.event.draft === null) await updateEvent(db, item, state, { draft: item.draft });
        const locked = await checked(db.rpc("lock_event_prediction", { p_event_id: item.fixture.event.id,
          p_expected_draft: item.draft, p_payload: item.prediction.payload,
          p_canonical: canonicalJson(item.prediction.payload), p_hash: item.prediction.hash }), "Lock reconstructed synthetic prediction");
        must(locked?.outcome === "locked", "Lock RPC refused the payload; no lock was overwritten");
        state = await loadEvent(db, item);
      }
      let progress = inspectEvent(item, state, owner);
      if (progress.missingGuesses.length || progress.missingVotes.length) {
        must(state.event.status === "voting", "Cannot import interactions outside voting");
        await insertRows(db, "human_predictions", progress.missingGuesses); // always guesses before votes
        await insertRows(db, "votes", progress.missingVotes);
      }
      state = await loadEvent(db, item);
      progress = inspectEvent(item, state, owner);
      must(!progress.missingGuesses.length && !progress.missingVotes.length, "Interaction import is incomplete");
      if (item.fixture.event.status !== "voting") {
        if (state.event.status === "voting") await updateEvent(db, item, state, { status: "locked" });
        // Freeze first, then re-read to ensure concurrent votes cannot leak into
        // a report computed from a different dataset. Never silently omit them.
        state = await loadEvent(db, item);
        inspectEvent(item, state, owner);
        if (item.reveal) {
          if (state.event.reveal === null) await updateEvent(db, item, state, { reveal: item.reveal });
          if (state.event.status === "locked") await updateEvent(db, item, state, { status: "revealed" });
          if (item.fixture.event.status === "closed" && state.event.status === "revealed") await updateEvent(db, item, state, { status: "closed" });
        }
      }
    }
    const final = inspectEvent(item, await loadEvent(db, item), owner);
    must(final.complete, "Final imported state is incomplete; rerun to resume");
    console.log(`COMPLETE: ${item.fixture.event.slug} (${item.fixture.event.status})`);
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log("Usage: node [--env-file=.env.local] scripts/import-samples.mjs --zip ZIP [--python PYTHON] [--owner UUID] [--check-remote] [--dry-run | --apply]\nDefault: local dry run, no network. --check-remote: read-only collision/owner/storage checks. --apply: explicit writes after the same checks.");
    return;
  }
  const plan = buildPlan(options);
  console.log(JSON.stringify({ mode: options.apply ? "APPLY REQUESTED" : "DRY RUN (no remote writes)",
    sourceArchiveSha256: plan.archiveHash, counts: plan.counts, pillowVersion: plan.pillowVersion,
    actions: ["Prefix org/event names with [SYNTHETIC DEMO]; mark settings synthetic with source/proof provenance",
      "Map both demo workspaces to the explicitly selected existing organizer; retain original member references only",
      "Create private JPEG placeholders + generated shelf identity rows, map 200 thumbnail/product records",
      "Setup -> intake rows -> compatible draft -> lock RPC -> guesses -> votes -> freeze -> regenerated reveal -> original status",
      "Keep original timestamps and source metadata; skip exact matches, resume compatible partial imports, refuse all mismatches"],
    adaptations: ["Source SVGs are never executed or uploaded; labeled JPEG placeholders are recreated, not photographs",
      "Original synthetic metrics and voter ground-truth rows are archived in settings.sourceHistory (not treated as current/live metrics)",
      "Nested product attributes, including prediction scores, are stripped by the existing adapter; source membership emails do not create auth users",
      "setup/intake/voting source events remain in those states; the voting demo stays open and must not receive real participant traffic during import"],
  }, null, 2));
  if (!options.apply && !options.checkRemote) {
    console.log("LOCAL VALIDATION PASSED. Remote collisions/schema/owner not checked. Nothing uploaded. Use --check-remote for read-only preflight.");
    return;
  }
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  must(url && key, "Remote checks require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY via --env-file=.env.local");
  must(new URL(url).protocol === "https:" || ["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Refusing non-HTTPS remote Supabase URL");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  await checkRpcAvailability(url, key);
  const remote = await preflight(db, plan, options.owner);
  console.log(JSON.stringify({ remotePreflight: "PASSED (read-only)", schemaColumnsAvailable: true,
    lockRpcAvailable: true, ownerVerified: Boolean(options.owner),
    orgsToCreate: plan.orgs.length - remote.orgs.length,
    membershipsToCreate: plan.orgs.length - remote.members.length,
    eventsToCreate: [...remote.events.values()].filter((item) => !item.state.event).length,
    completeEventsToSkip: [...remote.events.values()].filter((item) => item.result.complete && item.objects.size === item.state.images.length).length,
    eventsToResume: [...remote.events.values()].filter((item) => item.state.event && !item.result.complete).length,
    note: "No SQL/trigger changes are attempted. Guard/RPC definitions must match supabase/schema.sql; read-only API checks cannot prove function bodies." }, null, 2));
  if (options.apply) {
    await applyPlan(db, plan, options.owner, remote);
    const final = await preflight(db, plan, options.owner);
    must([...final.events.values()].every((item) => item.result.complete && item.objects.size === item.state.images.length), "Final full verification failed");
    console.log("IMPORT VERIFIED: all source categories accounted for; no existing rows were overwritten or deleted.");
  } else console.log("REMOTE DRY RUN PASSED. Nothing uploaded; --apply and a verified --owner are required for writes.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof ImportError ? error.message : "Import failed during validation/IO; no secret-bearing error details are printed. Check archive, tools, schema, and connectivity.");
    process.exitCode = 1;
  });
}
