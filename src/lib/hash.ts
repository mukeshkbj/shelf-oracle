import { createHash } from "crypto";

/** Recursively sort object keys so hashing is stable across key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function canonicalJson(payload: unknown): string {
  return JSON.stringify(canonicalize(payload));
}

export function canonicalHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
