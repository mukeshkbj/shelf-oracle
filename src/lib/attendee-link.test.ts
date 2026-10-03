import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Script } from "node:vm";
import type { ReactElement, ReactNode } from "react";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof import("typescript");
const react = require("react") as typeof import("react");
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const canonicalOrigin = "https://eat-hack-three.vercel.app";
const browserOrigin = "http://localhost:3000";
const productionEnv = { APP_URL: canonicalOrigin, NODE_ENV: "production" };
const jsx = require("react/jsx-runtime");
const Link = ({ href, children }: { href: string; children: ReactNode }) => react.createElement("a", { href }, children);

function loadModule<T>(path: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const loaded = { exports: {} };
  new Script(outputText, { filename: path }).runInNewContext({
    module: loaded,
    exports: loaded.exports,
    require(name: string) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
      return imports[name];
    },
    URL,
    ...globals,
  });
  return loaded.exports as T;
}

function pageHarness({ slug = "panel/one?token=not-a-credential#space café", user = true, forbidden = false, env = productionEnv } = {}) {
  const event = { id: "event-fixture", slug, name: "Test tasting", status: "voting", created_at: "2026-01-01T00:00:00Z" };
  const reads: string[] = [];
  const memberships: string[] = [];
  class ForbiddenError extends Error {}
  const EventStudio = () => null;
  const { default: EventPage } = loadModule<{ default: (props: { params: Promise<{ slug: string }> }) => Promise<ReactElement<Record<string, unknown>>> }>("../app/app/e/[slug]/page.tsx", {
    "react/jsx-runtime": jsx,
    "next/navigation": { redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } },
    "@/lib/auth": {
      ForbiddenError,
      getUser: async () => user ? { id: "organizer-fixture" } : null,
      requireEventMemberBySlug: async (requestedSlug: string, userId: string) => {
        memberships.push(`${requestedSlug}:${userId}`);
        if (forbidden) throw new ForbiddenError();
        return event;
      },
    },
    "@/lib/supabase/admin": { supabaseAdmin: () => ({ from: (table: string) => {
      reads.push(table);
      const query = {
        select: () => query, eq: () => query, order: () => query, range: () => query, not: () => query, limit: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
      };
      return query;
    } }) },
    "@/lib/site-url": loadModule("./site-url.ts", { "server-only": {} }, { process: { env } }),
    "@/components/organizer/EventStudio": { EventStudio },
  });
  return { event, reads, memberships, EventStudio, render: () => EventPage({ params: Promise.resolve({ slug }) }) };
}

function attendeeHarness(votingUrl: string, { fail = false, origin = browserOrigin } = {}) {
  const payloads: string[] = [];
  const clipboard: string[] = [];
  const effects: Array<() => void | (() => void)> = [];
  const states: unknown[] = [];
  let cursor = 0;
  const { AttendeeLink } = loadModule<{ AttendeeLink: (props: { votingUrl: string }) => ReactElement }>("../components/organizer/AttendeeLink.tsx", {
    react: {
      useState<T>(initial: T) {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (value: T) => { states[index] = value; }];
      },
      useEffect: (effect: () => void | (() => void)) => effects.push(effect),
    },
    "react/jsx-runtime": jsx,
    "next/image": ({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) => react.createElement("img", { src, alt, width, height }),
    "next/link": Link,
    qrcode: { toDataURL: async (url: string) => {
      payloads.push(url);
      if (fail) throw new Error("QR failed");
      return "data:image/png;base64,cXItZml4dHVyZQ==";
    } },
  }, {
    window: { location: { origin }, setTimeout: () => 0 },
    navigator: { clipboard: { writeText: async (url: string) => { clipboard.push(url); } } },
  });
  return {
    payloads, clipboard,
    render: () => { cursor = 0; return AttendeeLink({ votingUrl }); },
    generate: async () => { const cleanup = effects[0](); await new Promise(resolve => setImmediate(resolve)); return cleanup; },
  };
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!react.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

test("EventPage creates an encoded canonical public voting URL on the server and EventStudio passes it unchanged", async () => {
  const page = pageHarness();
  const result = await page.render();
  const expected = `${canonicalOrigin}/e/panel%2Fone%3Ftoken%3Dnot-a-credential%23space%20caf%C3%A9/v`;
  assert.equal(result.type, page.EventStudio);
  assert.equal(result.props.votingUrl, expected);
  assert.deepEqual(page.memberships, [`${page.event.slug}:organizer-fixture`]);
  assert.equal(new URL(expected).search + new URL(expected).hash, "");
  const forwarded: string[] = [];
  const { EventStudio } = loadModule<{ EventStudio: (props: Record<string, unknown>) => ReactElement }>("../components/organizer/EventStudio.tsx", {
    react, "react/jsx-runtime": jsx, "next/link": Link,
    "next/navigation": { useRouter: () => ({ refresh: () => { throw new Error("Unexpected refresh"); } }) },
    "@/lib/principles": { PRINCIPLES: [] },
    "@/lib/demo": { isSyntheticEvent: () => true, SYNTHETIC_DISCLOSURE: "Synthetic fixture disclosure", SYNTHETIC_PROOF_DISCLOSURE: "Synthetic proof disclosure" },
    "./api": { apiFetch: () => { throw new Error("Unexpected API call"); } },
    "./RubricEditor": { RubricEditor: () => null },
    "./IntakePanel": { IntakePanel: () => null },
    "./AttendeeLink": { AttendeeLink: ({ votingUrl }: { votingUrl: string }) => { forwarded.push(votingUrl); return null; } },
  });
  const html = renderToStaticMarkup(react.createElement(EventStudio, result.props));
  assert.deepEqual(forwarded, [expected]);
  assert.match(html, /Synthetic demo disclosure/);
  assert.match(html, /Synthetic fixture disclosure/);
});

test("Canonical QR, display, copy, and open link agree when organizer browser runs on localhost or a preview", async () => {
  const votingUrl = String((await pageHarness().render()).props.votingUrl);
  for (const origin of [browserOrigin, "https://organizer-preview.vercel.app"]) {
    const attendee = attendeeHarness(votingUrl, { origin });
    const initial = renderToStaticMarkup(attendee.render());
    assert.ok(initial.includes(`<div class="so-link-box">${votingUrl}</div>`));
    assert.ok(initial.includes(`href="${votingUrl}"`));
    await attendee.generate();
    assert.deepEqual(attendee.payloads, [votingUrl]);
    const tree = attendee.render();
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Attendee voting QR/);
    assert.match(html, /vote anonymously/);
    assert.match(html, /No organizer sign-in required/);
    assert.ok(html.includes(`alt="QR code to join this event at ${votingUrl}"`));
    assert.ok(!html.includes(origin));
    assert.doesNotMatch(html, /Local-only|APP_URL|\/auth\/callback|href="\/login/);
    const button = elements(tree).find(element => element.type === "button");
    assert.ok(button);
    await (button.props.onClick as () => Promise<void>)();
    assert.deepEqual(attendee.clipboard, [votingUrl]);
    assert.match(renderToStaticMarkup(attendee.render()), /Copied/);
  }
});

test("QR generation failure retains the existing fallback and working canonical copy/open links", async () => {
  const votingUrl = `${canonicalOrigin}/e/fixture/v`;
  const attendee = attendeeHarness(votingUrl, { fail: true });
  attendee.render();
  await attendee.generate();
  const tree = attendee.render();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /QR unavailable/);
  assert.match(html, /QR code unavailable; use the voting link instead/);
  assert.ok(html.includes(`href="${votingUrl}"`));
  const button = elements(tree).find(element => element.type === "button");
  assert.ok(button);
  await (button.props.onClick as () => Promise<void>)();
  assert.deepEqual(attendee.clipboard, [votingUrl]);
  assert.deepEqual(attendee.payloads, [votingUrl]);
});

test("Loopback canonical URLs and the unconfigured development fallback clearly warn against phone sharing", async () => {
  const fallback = await pageHarness({ env: { APP_URL: "", NODE_ENV: "development" } }).render();
  assert.equal(new URL(String(fallback.props.votingUrl)).origin, browserOrigin);
  for (const origin of [browserOrigin, "http://localhost.:3000", "http://panel.localhost:3000", "http://127.0.0.1:3000", "http://127.1.2.3:3000", "http://[::1]:3000", "http://0.0.0.0:3000"]) {
    const votingUrl = `${origin}/e/fixture/v`;
    const attendee = attendeeHarness(votingUrl);
    const html = renderToStaticMarkup(attendee.render());
    assert.match(html, /role="alert"/);
    assert.match(html, /Local-only voting link/);
    assert.match(html, /attendees cannot reach this event from their phones/);
    assert.match(html, /Set APP_URL to the public deployment URL before sharing/);
    assert.doesNotMatch(html, /Scan to vote|Project this QR/);
    assert.ok(html.includes(`href="${votingUrl}"`));
    await attendee.generate();
    assert.deepEqual(attendee.payloads, [votingUrl]);
  }
});

test("Canonical URL plumbing preserves organizer authentication and membership checks", async () => {
  const anonymous = pageHarness({ user: false });
  await assert.rejects(anonymous.render, /redirect:\/login/);
  assert.deepEqual(anonymous.memberships, []);
  assert.deepEqual(anonymous.reads, []);
  const forbidden = pageHarness({ forbidden: true });
  await assert.rejects(forbidden.render, /not-found/);
  assert.equal(forbidden.memberships.length, 1);
  assert.deepEqual(forbidden.reads, []);
});
