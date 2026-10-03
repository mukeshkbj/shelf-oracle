import { NextRequest, NextResponse } from "next/server";
import { ensurePersonalOrg } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { z } from "zod";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  orgName: z.string().min(1).max(60).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid email or password (min 8 chars)" }, { status: 400 });
  const { email, password, orgName } = parsed.data;

  // Create the user through email verification instead of pre-confirming an untrusted address.
  let confirmationUrl: string;
  try { confirmationUrl = siteUrl("/auth/callback"); }
  catch { return NextResponse.json({ error: "APP_URL must be a valid site origin" }, { status: 500 }); }
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: confirmationUrl,
      data: { org_name: orgName || "Personal workspace" },
    },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Personal workspace org + owner membership waits until the address is confirmed.
  if (data.session && data.user) {
    try {
      await ensurePersonalOrg(data.user.id, orgName);
    } catch {
      return NextResponse.json({ error: "Workspace creation failed" }, { status: 500 });
    }
  }

  // Sign in happens immediately only if the project's email confirmation is disabled.
  return NextResponse.json({ ok: true, requiresConfirmation: !data.session });
}
