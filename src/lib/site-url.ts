import "server-only";

export function siteUrl(path: string): string {
  const value = process.env.APP_URL || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "");
  if (!value) throw new Error("APP_URL is not configured");
  const base = new URL(value);
  if (!(["http:", "https:"].includes(base.protocol)) || base.username || base.password ||
      base.pathname !== "/" || base.search || base.hash ||
      (process.env.NODE_ENV === "production" && base.protocol !== "https:")) {
    throw new Error("APP_URL must be a canonical HTTPS origin in production");
  }
  return new URL(path, base).href;
}
