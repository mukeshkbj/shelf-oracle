import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, parseCsv, buildPlan, inspectEvent, emptyState, settingsFor, productRows,
  preflight, applyPlan } from "./import-samples.mjs";
import { canonicalHash, canonicalJson } from "../src/lib/hash.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ARCHIVE = process.env.SHELF_ORACLE_SAMPLE_ZIP;
const clone = (value) => structuredClone(value);
const plan = ARCHIVE ? buildPlan({ zip: ARCHIVE, python: process.env.SAMPLE_IMPORT_PYTHON || "python3" }) : null;
const integration = { skip: !ARCHIVE && "Set SHELF_ORACLE_SAMPLE_ZIP and optionally SAMPLE_IMPORT_PYTHON for full local integration coverage" };

function stateFor(item, status = item.fixture.event.status) {
  const event = item.fixture.event;
  const images = item.images.map((image, index) => ({ id: 9000 + index, event_id: event.id,
    image: image.image, detected_count: image.detected_count, created_at: image.created_at }));
  const locked = !["setup", "intake"].includes(status);
  return clone({ event: { id: event.id, org_id: item.orgId, slug: event.slug,
    name: `[SYNTHETIC DEMO] ${event.name}`, location: event.location, created_at: event.createdAt, status,
    settings: settingsFor(item, OWNER, "2026-10-03T10:00:00Z"), settings_version: 0,
    products_version: images.length + item.products.length, draft: locked ? item.draft : null,
    lock_hash: locked ? item.prediction?.hash : null, locked_at: locked ? item.prediction?.locked_at : null,
    reveal: ["revealed", "closed"].includes(status) ? item.reveal : null }, images,
    products: productRows(item, images), predictions: locked && item.prediction ? [item.prediction] : [],
    guesses: locked ? item.guesses : [], votes: locked ? item.votes : [] });
}

// A deliberately guarded in-memory Supabase double. This tests the actual apply
// orchestration without any network, SQL, credentials, or external mutations.
function memoryDb() {
  const live = { id: OTHER, org_id: OTHER, slug: "e2e-live", name: "Existing E2E event", status: "setup", settings: {} };
  const tables = { orgs: [{ id: OTHER, name: "Live org" }], org_members: [{ org_id: OTHER, user_id: OWNER, role: "owner" }],
    events: [live], shelf_images: [{ id: 1, event_id: OTHER, image: "live.jpg" }],
    products: [], predictions: [], human_predictions: [], votes: [] };
  const objects = new Map([["live.jpg", Buffer.from("preserve me")]]);
  const operations = [];
  const counters = { shelf_images: 2, human_predictions: 1, votes: 1 };
  let failVoteBatch = false;
  const result = (data) => ({ data: clone(data), error: null });
  const eventFor = (id) => tables.events.find((event) => event.id === id);
  function add(table, source) {
    const row = clone(source);
    if (table === "events") {
      assert.equal(row.status, "setup");
      assert.ok(!eventFor(row.id));
      Object.assign(row, { draft: null, locked_at: null, lock_hash: null, reveal: null,
        settings_version: 0, products_version: 0 });
    }
    if (["shelf_images", "products"].includes(table)) {
      const event = eventFor(row.event_id);
      assert.ok(["setup", "intake"].includes(event.status), "intake guard");
      event.products_version++;
      event.draft = null;
    }
    if (["votes", "human_predictions"].includes(table)) {
      assert.equal(eventFor(row.event_id).status, "voting", "voting guard");
      if (table === "human_predictions") assert.ok(!tables.votes.some((vote) => vote.event_id === row.event_id && vote.voter_id === row.voter_id), "guess-before-vote");
    }
    if (table in counters) {
      assert.ok(!("id" in row), "never overwrite identity IDs");
      row.id = counters[table]++;
    }
    assert.ok(!tables[table].some((existing) => table === "org_members" ? existing.org_id === row.org_id && existing.user_id === row.user_id :
      table === "predictions" ? existing.event_id === row.event_id : existing.id === row.id), "insert-only collision");
    tables[table].push(row);
    operations.push({ table, operation: "insert", eventId: row.event_id ?? row.id });
    return row;
  }
  function changeEvent(event, patch) {
    if (event.lock_hash) {
      for (const key of ["lock_hash", "locked_at", "settings", "draft", "products_version"])
        if (key in patch) assert.deepEqual(patch[key], event[key], `immutable ${key}`);
      if (patch.status && patch.status !== event.status) assert.ok(
        (event.status === "voting" && patch.status === "locked") ||
        (event.status === "locked" && patch.status === "revealed" && event.reveal) ||
        (event.status === "revealed" && patch.status === "closed"), "lifecycle guard");
      if (patch.reveal && !event.reveal) assert.equal(event.status, "locked", "freeze before building reveal");
      if (event.reveal && "reveal" in patch) assert.deepEqual(patch.reveal, event.reveal, "immutable reveal");
    }
    Object.assign(event, clone(patch));
    operations.push({ table: "events", operation: "update", eventId: event.id, patch: clone(patch) });
  }
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.action = "select"; this.offset = 0; this.end = Infinity; }
    select() { return this; }
    in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
    eq(key, value) { this.filters.push((row) => (key.includes("->>") ? row.settings?.[key.split("->>")[1]] : row[key]) === value); return this; }
    is(key, value) { return this.eq(key, value); }
    order() { return this; }
    range(start, end) { this.offset = start; this.end = end; return this; }
    insert(rows) { this.action = "insert"; this.input = Array.isArray(rows) ? rows : [rows]; return this; }
    update(patch) { this.action = "update"; this.patch = patch; return this; }
    maybeSingle() { this.singleRow = true; return this; }
    single() { this.singleRow = true; return this; }
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        let rows;
        if (this.action === "insert") {
          if (this.table === "votes" && failVoteBatch && tables.votes.length >= 100) {
            failVoteBatch = false;
            return { data: null, error: { message: "simulated interruption" } };
          }
          rows = this.input.map((row) => add(this.table, row));
        } else {
          rows = tables[this.table].filter((row) => this.filters.every((predicate) => predicate(row))).slice(this.offset, this.end + 1);
          if (this.action === "update") {
            assert.equal(this.table, "events", "existing child rows never updated");
            rows.forEach((row) => changeEvent(row, this.patch));
          }
        }
        return result(this.singleRow ? rows[0] ?? null : rows);
      }).then(resolve, reject);
    }
  }
  const db = {
    from: (table) => new Query(table),
    auth: { admin: { getUserById: async (id) => result({ user: { id, email_confirmed_at: "2025-01-01T00:00:00Z" } }) } },
    storage: {
      getBucket: async () => result({ public: false, allowed_mime_types: ["image/jpeg"], file_size_limit: 5242880 }),
      from: () => ({
        list: async (prefix) => result([...objects.keys()].filter((key) => key.startsWith(prefix + "/")).map((key) => ({ name: key.slice(prefix.length + 1) }))),
        download: async (key) => ({ data: new Blob([objects.get(key)]), error: null }),
        upload: async (key, bytes, options) => {
          assert.equal(options.upsert, false);
          assert.ok(!objects.has(key), "storage must be insert-only");
          objects.set(key, Buffer.from(bytes));
          operations.push({ table: "storage", operation: "insert" });
          return result({ path: key });
        },
      }),
    },
    rpc: async (name, args) => {
      assert.equal(name, "lock_event_prediction");
      const event = eventFor(args.p_event_id);
      assert.ok(["setup", "intake"].includes(event.status));
      assert.equal(event.lock_hash, null);
      assert.deepEqual(event.draft, args.p_expected_draft);
      assert.deepEqual(Object.fromEntries(Object.entries(args.p_payload).filter(([key]) => key !== "lockedAt")), event.draft);
      assert.equal(args.p_canonical, canonicalJson(args.p_payload));
      assert.equal(args.p_hash, canonicalHash(args.p_payload));
      assert.equal(event.draft.items.length, tables.products.filter((product) => product.event_id === event.id).length);
      add("predictions", { event_id: event.id, locked_at: args.p_payload.lockedAt, hash: args.p_hash, payload: args.p_payload });
      Object.assign(event, { status: "voting", locked_at: args.p_payload.lockedAt, lock_hash: args.p_hash });
      operations.push({ table: "events", operation: "rpc-lock", eventId: event.id });
      return result({ outcome: "locked" });
    },
  };
  return { db, tables, objects, operations, live: clone(live), interruptVotes: () => { failVoteBatch = true; } };
}

async function withoutLogs(fn) {
  const original = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = original; }
}

test("CLI defaults to local dry run; apply requires explicit owner and rejects contradictory flags", () => {
  assert.equal(parseArgs(["--zip", "sample.zip"]).apply, false);
  assert.equal(parseArgs(["--zip", "sample.zip"]).checkRemote, false);
  assert.throws(() => parseArgs(["--zip", "sample.zip", "--apply"]), /requires --owner/);
  assert.throws(() => parseArgs(["--zip", "sample.zip", "--apply", "--dry-run", "--owner", OWNER]), /cannot be combined/);
  assert.throws(() => parseArgs(["--zip", "sample.zip", "--owner", "email@example.com"]), /UUID/);
  assert.throws(() => parseArgs(["--zip", "sample.zip", "--apply", "--apply"]), /Duplicate/);
});

test("CSV parser supports escaped quotes, CRLF and multiline fields without executing formulas", () => {
  assert.deepEqual(parseCsv('id,name,notes\r\n1,"Name, One","line1\nline2 ""quoted"""\r\n2,Two,=1+1\r\n'), [
    { id: "1", name: "Name, One", notes: 'line1\nline2 "quoted"' }, { id: "2", name: "Two", notes: "=1+1" },
  ]);
  for (const csv of ['a,b\n"oops', 'a,b\n"x"junk,y', 'a,a\nx,y', 'a,b\nx']) assert.throws(() => parseCsv(csv));
});

test("archive accounts for every source category and original status", integration, () => {
  assert.deepEqual(plan.counts, { orgs: 2, ownerMembershipsToCreate: 2, sourceMembershipReferences: 3,
    events: 17, shelfImages: 21, jpegThumbnails: 200, products: 200, votes: 5215, comments: 1226,
    guesses: 370, lockedPredictions: 15, regeneratedReports: 14, sourceMetricSummaries: 14, sourceVoterGroundTruth: 564,
    statuses: { setup: 1, intake: 1, voting: 1, revealed: 1, closed: 13 } });
  for (const item of plan.events) {
    assert.equal(item.baseSettings.synthetic, true);
    assert.equal(item.baseSettings.proofKind, "synthetic-reconstructed");
    for (const product of item.products) {
      assert.ok(product.thumb.startsWith("data:image/jpeg;base64,/9j/"));
      assert.ok(!("principle_scores" in product.attributes));
      assert.ok(Object.values(product.attributes).every((value) => typeof value === "string"));
    }
    assert.ok(item.votes.every((vote) => /^v_[a-f0-9]{32}$/.test(vote.voter_id) && !("id" in vote)));
    if (item.prediction) assert.equal(canonicalHash(item.prediction.payload), item.prediction.hash);
    if (item.reveal) {
      assert.equal(item.reveal.voteCount, item.votes.length);
      assert.equal(item.reveal.lockHash, item.prediction.hash);
      assert.ok(item.reveal.predicted.every((product) => product.thumb.startsWith("data:image/jpeg;base64,")));
    }
  }
});

test("exact completed records skip, timestamp formatting is normalized and identity mapping does not use source IDs", integration, () => {
  for (const item of plan.events) {
    const state = stateFor(item);
    state.event.created_at = new Date(state.event.created_at).toISOString();
    assert.equal(inspectEvent(item, state, OWNER).complete, true);
    assert.ok(state.products.every((product) => product.source_image_id >= 9000));
  }
});

test("non-demo ID, foreign owner and modified immutable content fail closed", integration, () => {
  const item = plan.events.find((event) => event.fixture.event.status === "closed");
  for (const mutate of [
    (state) => { state.event.name = "Live event"; },
    (state) => { state.event.settings.synthetic = false; },
    (state) => { state.event.settings.importOwnerId = OTHER; },
    (state) => { state.predictions[0].hash = "tampered"; },
    (state) => { state.products[0].name = "modified product"; },
    (state) => { state.event.reveal.metrics.spearman = 123; },
    (state) => { state.votes[0].rating = state.votes[0].rating === 1 ? 2 : 1; },
    (state) => { state.guesses[0].display_name = "changed"; },
  ]) {
    const state = stateFor(item);
    mutate(state);
    assert.throws(() => inspectEvent(item, state, OWNER), /refusing|differs/);
  }
});

test("partially imported intake and voting are resumable but frozen/misordered data are not", integration, () => {
  const item = plan.events.find((event) => event.fixture.event.status === "closed");
  const intake = stateFor(item, "setup");
  intake.products = [];
  intake.event.products_version = intake.images.length;
  assert.equal(inspectEvent(item, intake, OWNER).missingProducts.length, item.products.length);
  const voting = stateFor(item, "voting");
  voting.votes = voting.votes.slice(0, 100);
  assert.equal(inspectEvent(item, voting, OWNER).complete, false);
  voting.event.status = "locked";
  assert.throws(() => inspectEvent(item, voting, OWNER), /Frozen event/);
  const mistimed = stateFor(item, "voting");
  const index = mistimed.guesses.findIndex((guess) => mistimed.votes.some((vote) => vote.voter_id === guess.voter_id));
  mistimed.guesses.splice(index, 1);
  assert.throws(() => inspectEvent(item, mistimed, OWNER), /already voted/);
  const extra = stateFor(item);
  extra.votes.push({ ...extra.votes[0], voter_id: "v_liveparticipant" });
  assert.throws(() => inspectEvent(item, extra, OWNER), /Unexpected vote/);
  assert.equal(inspectEvent(item, emptyState(), OWNER).complete, false);
});

test("full apply through guarded in-memory DB preserves live E2E records and second run performs zero writes", integration, async () => {
  const memory = memoryDb();
  await withoutLogs(async () => {
    const remote = await preflight(memory.db, plan, OWNER);
    assert.equal(memory.operations.length, 0, "preflight is strictly read-only");
    await applyPlan(memory.db, plan, OWNER, remote);
    const final = await preflight(memory.db, plan, OWNER);
    assert.ok([...final.events.values()].every((item) => item.result.complete));
    const beforeRerun = memory.operations.length;
    await applyPlan(memory.db, plan, OWNER, final);
    assert.equal(memory.operations.length, beforeRerun, "rerun must not write any matching record");
  });
  assert.equal(memory.tables.orgs.length, 3);
  assert.equal(memory.tables.org_members.length, 3);
  assert.equal(memory.tables.events.length, 18);
  assert.equal(memory.tables.shelf_images.length, 22);
  assert.equal(memory.objects.size, 22);
  assert.equal(memory.tables.products.length, 200);
  assert.equal(memory.tables.predictions.length, 15);
  assert.equal(memory.tables.votes.length, 5215);
  assert.equal(memory.tables.human_predictions.length, 370);
  assert.deepEqual(memory.tables.events.find((event) => event.id === OTHER), memory.live);
  assert.deepEqual(memory.tables.shelf_images.find((image) => image.id === 1), { id: 1, event_id: OTHER, image: "live.jpg" });
  assert.equal(memory.objects.get("live.jpg").toString(), "preserve me");
  assert.ok(memory.tables.products.every((product) => product.source_image_id !== 1));
});

test("interrupted interaction batch resumes without changing locked payload or duplicating rows", integration, async () => {
  const memory = memoryDb();
  memory.interruptVotes();
  await withoutLogs(async () => {
    await assert.rejects(() => preflight(memory.db, plan, OWNER).then((remote) => applyPlan(memory.db, plan, OWNER, remote)), /Insert votes failed/);
    const lockedBefore = clone(memory.tables.predictions);
    const progress = await preflight(memory.db, plan, OWNER);
    assert.ok([...progress.events.values()].some((item) => item.state.event && !item.result.complete));
    await applyPlan(memory.db, plan, OWNER, progress);
    const final = await preflight(memory.db, plan, OWNER);
    assert.ok([...final.events.values()].every((item) => item.result.complete));
    for (const prediction of lockedBefore) assert.deepEqual(memory.tables.predictions.find((row) => row.event_id === prediction.event_id), prediction);
  });
  assert.equal(memory.tables.votes.length, 5215);
  assert.equal(memory.tables.human_predictions.length, 370);
  assert.equal(memory.tables.predictions.length, 15);
});

test("global collision checks fail before any writes (org, slug, product and storage)", integration, async () => {
  const cases = [
    (memory) => memory.tables.orgs.push({ ...plan.orgs[0], name: "Live unrelated org" }),
    (memory) => memory.tables.events.push({ id: "33333333-3333-4333-8333-333333333333", slug: plan.events[0].fixture.event.slug, org_id: OTHER }),
    (memory) => memory.tables.products.push({ id: plan.events.flatMap((item) => item.products)[0].id, event_id: OTHER }),
    (memory) => memory.objects.set(plan.events.flatMap((item) => item.images)[0].image, Buffer.from("wrong jpeg")),
  ];
  for (const mutate of cases) {
    const memory = memoryDb();
    mutate(memory);
    await assert.rejects(() => preflight(memory.db, plan, OWNER), /collision|different|differs/);
    assert.equal(memory.operations.length, 0);
  }
});
