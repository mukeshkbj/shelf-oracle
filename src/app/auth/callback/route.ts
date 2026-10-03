import { NextRequest, NextResponse } from "next/server";
import { ensurePersonalOrg } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  let appUrl: string;
  try { appUrl = siteUrl("/"); }
  catch { return NextResponse.json({ error: "APP_URL must be a valid site origin" }, { status: 500 }); }
  const redirect = new URL("/app", appUrl);
  if (!code) return NextResponse.redirect(new URL("/login?error=confirmation", appUrl));

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user)
    return NextResponse.redirect(new URL("/login?error=confirmation", appUrl));
  try {
    await ensurePersonalOrg(data.user.id, data.user.user_metadata?.org_name);
  } catch {
    return NextResponse.redirect(new URL("/login?error=workspace", appUrl));
  }
  return NextResponse.redirect(redirect);
}
