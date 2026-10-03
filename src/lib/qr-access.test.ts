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
const productionEnv = { APP_URL: canonicalOrigin, NODE_ENV: "production" };

function loadModule<T>(path: string, imports: Record<string, unknown>, env = productionEnv): T {
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
    process: { env },
    URL,
  });
  return loaded.exports as T;
}

function urlModule(env = productionEnv) {
  return loadModule<{ siteUrl: (path: string) => string }>("./site-url.ts", { "server-only": {} }, env);
}

function magicLinkHarness(options: { error?: { status?: number; code?: string; message?: string }; throws?: boolean; env?: typeof productionEnv } = {}) {
  const calls: unknown[] = [];
  let clients = 0;
  const { POST } = loadModule<{ POST: (request: Request) => Promise<Response> }>("../app/api/auth/magic-link/route.ts", {
    "next/server": require("next/server"),
    zod: require("zod"),
    "@/lib/site-url": urlModule(options.env),
    "@/lib/supabase/server": {
      supabaseServer: async () => {
        clients += 1;
        return { auth: { signInWithOtp: async (args: unknown) => {
          calls.push(JSON.parse(JSON.stringify(args)));
          if (options.throws) throw new Error("Private provider connection detail");
          return { error: options.error || null };
        } } };
      },
    },
  });
  return {
    calls,
    clients: () => clients,
    post: (body: unknown) => POST(new Request("https://untrusted-host.example/api/auth/magic-link", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })),
    malformed: () => POST(new Request(`${canonicalOrigin}/api/auth/magic-link`, { method: "POST", body: "{" })),
  };
}

test("Magic-link requests validate email before calling auth", async () => {
  const route = magicLinkHarness();
  for (const body of [null, {}, { email: "not-an-email" }, { email: "x".repeat(255) + "@example.com" }, { email: 1 }, { email: "user@example.com", redirectTo: "https://attacker.example" }]) {
    const response = await route.post(body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Enter a valid email address." });
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal((await route.malformed()).status, 400);
  assert.equal(route.clients(), 0);
  assert.deepEqual(route.calls, []);
});

test("Magic links use the cookie-bound client, existing accounts only, and canonical callback", async () => {
  const route = magicLinkHarness();
  const response = await route.post({ email: "  organizer@example.com  " });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("location"), null);
  assert.equal(route.clients(), 1);
  assert.deepEqual(route.calls, [{ email: "organizer@example.com", options: { shouldCreateUser: false, emailRedirectTo: `${canonicalOrigin}/auth/callback` } }]);
});

test("Provider throttles return retry guidance, never successful delivery messaging", async () => {
  for (const error of [{ status: 429 }, { status: 400, code: "over_email_send_rate_limit" }, { code: "over_request_rate_limit" }]) {
    const route = magicLinkHarness({ error: { ...error, message: "Private provider detail" } });
    const response = await route.post({ email: "organizer@example.com" });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
    const body = await response.json();
    assert.equal(body.ok, undefined);
    assert.match(body.error, /wait at least a minute/);
    assert.doesNotMatch(body.error, /Private provider detail/);
  }
});

test("Provider rejections and exceptions have generic failures without account or credential details", async () => {
  for (const options of [{ error: { code: "otp_disabled", message: "No such user: organizer@example.com" } }, { error: { status: 500, message: "SMTP key: secret" } }, { throws: true }]) {
    const response = await magicLinkHarness(options).post({ email: "organizer@example.com" });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Unable to request a sign-in link. Try again later or use your password." });
  }
});

test("Missing or unsafe production APP_URL fails closed before creating an auth client", async () => {
  for (const APP_URL of ["", "http://example.com", "https://user:secret@example.com", "https://example.com/extra", "https://example.com?token=secret", "https://example.com#secret"]) {
    const route = magicLinkHarness({ env: { ...productionEnv, APP_URL } });
    assert.equal((await route.post({ email: "organizer@example.com" })).status, 503);
    assert.equal(route.clients(), 0);
    assert.deepEqual(route.calls, []);
  }
});

function qrHarness({ fail = false, env = productionEnv } = {}) {
  const payloads: string[] = [];
  const component = loadModule<{ OrganizerLoginQR: () => Promise<ReactElement> }>("../components/organizer/OrganizerLoginQR.tsx", {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/image": ({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) => react.createElement("img", { src, alt, width, height }),
    qrcode: { toDataURL: async (url: string) => { payloads.push(url); if (fail) throw new Error("QR failed"); return "data:image/png;base64,cXItZml4dHVyZQ=="; } },
    "@/lib/site-url": urlModule(env),
  });
  return { ...component, payloads };
}

test("Organizer QR contains only the canonical entry URL, never credentials or session transfer data", async () => {
  const qr = qrHarness();
  const html = renderToStaticMarkup(await qr.OrganizerLoginQR());
  assert.deepEqual(qr.payloads, [`${canonicalOrigin}/login?via=qr`]);
  const url = new URL(qr.payloads[0]);
  assert.equal(url.origin, canonicalOrigin);
  assert.equal(url.pathname, "/login");
  assert.deepEqual([...url.searchParams], [["via", "qr"]]);
  assert.equal(url.username + url.password + url.hash, "");
  assert.match(html, /Organizer QR/);
  assert.match(html, /does not grant access or sign in this browser/);
  assert.match(html, /min-height:44px/);
});

test("QR failures preserve a usable form or canonical link rather than an unsafe fallback origin", async () => {
  const failed = qrHarness({ fail: true });
  const html = renderToStaticMarkup(await failed.OrganizerLoginQR());
  assert.match(html, /QR unavailable/);
  assert.ok(html.includes(`href="${canonicalOrigin}/login?via=qr"`));
  const unconfigured = qrHarness({ env: { ...productionEnv, APP_URL: "" } });
  assert.match(renderToStaticMarkup(await unconfigured.OrganizerLoginQR()), /sign in using the form above/);
  assert.deepEqual(unconfigured.payloads, []);
});

test("Login page awaits searchParams, hides the repeat QR on phones, and does not pass untrusted query data", async () => {
  const AuthForm = () => null;
  const OrganizerLoginQR = () => null;
  const { default: LoginPage } = loadModule<{ default: (props: { searchParams: Promise<Record<string, string | string[]>> }) => Promise<ReactElement<{ viaQr: boolean; initialError: string; organizerQR?: ReactElement }>> }>("../app/login/page.tsx", {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/components/organizer/AuthForm": { AuthForm },
    "@/components/organizer/OrganizerLoginQR": { OrganizerLoginQR },
  });
  const normal = await LoginPage({ searchParams: Promise.resolve({ email: "secret@example.com", token: "secret", next: "https://attacker.example" }) });
  assert.equal(normal.type, AuthForm);
  assert.equal(normal.props.viaQr, false);
  assert.equal(normal.props.organizerQR?.type, OrganizerLoginQR);
  assert.doesNotMatch(JSON.stringify(normal.props), /secret|attacker/);
  const phone = await LoginPage({ searchParams: Promise.resolve({ via: "qr" }) });
  assert.equal(phone.props.viaQr, true);
  assert.equal(phone.props.organizerQR, undefined);
  const error = await LoginPage({ searchParams: Promise.resolve({ error: "confirmation" }) });
  assert.match(error.props.initialError, /same browser on this device/);
});

test("Organizer forms retain password/signup paths, labels and same-browser email guidance", () => {
  const { AuthForm } = loadModule<{ AuthForm: (props: { mode: "login" | "signup"; viaQr?: boolean; organizerQR?: ReactNode }) => ReactElement }>("../components/organizer/AuthForm.tsx", {
    react,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": ({ href, children }: { href: string; children: ReactNode }) => react.createElement("a", { href }, children),
    "next/navigation": { useRouter: () => ({ replace: () => { throw new Error("Unexpected navigation"); }, refresh: () => { throw new Error("Unexpected navigation"); } }) },
    "./Brand": { Brand: () => react.createElement("div", null, "Shelf Oracle") },
  });
  const login = renderToStaticMarkup(react.createElement(AuthForm, { mode: "login" }));
  assert.match(login, /type="email"/);
  assert.match(login, /type="password"/);
  assert.match(login, /type="button"[^>]*>Email me a sign-in link/);
  assert.match(login, /same browser on the same device/);
  assert.match(login, /aria-describedby="sign-in-link-help"/);
  const phone = renderToStaticMarkup(react.createElement(AuthForm, { mode: "login", viaQr: true, organizerQR: "REDUNDANT QR" }));
  assert.match(phone, /Sign in on this device/);
  assert.doesNotMatch(phone, /REDUNDANT QR|so-auth-aside/);
  const signup = renderToStaticMarkup(react.createElement(AuthForm, { mode: "signup" }));
  assert.match(signup, /Workspace name/);
  assert.match(signup, /Create workspace/);
  assert.match(signup, /minLength="8"/);
  assert.doesNotMatch(signup, /Email me a sign-in link/);
});

test("Attendee QR remains a separately labelled anonymous voting entry with an encoded event slug", () => {
  const { AttendeeLink } = loadModule<{ AttendeeLink: (props: { votingUrl: string }) => ReactElement }>("../components/organizer/AttendeeLink.tsx", {
    react,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/image": () => null,
    "next/link": ({ href, children }: { href: string; children: ReactNode }) => react.createElement("a", { href }, children),
    qrcode: { toDataURL: () => { throw new Error("QR generation should wait for the browser"); } },
  });
  const votingUrl = `${canonicalOrigin}/e/${encodeURIComponent("panel/one?token=not-a-credential")}/v`;
  const html = renderToStaticMarkup(react.createElement(AttendeeLink, { votingUrl }));
  assert.match(html, /Attendee voting QR/);
  assert.match(html, /vote anonymously/);
  assert.match(html, /No organizer sign-in required/);
  assert.ok(html.includes(`href="${votingUrl}"`));
  assert.doesNotMatch(html, /href="\/login|\/auth\/callback/);
});
