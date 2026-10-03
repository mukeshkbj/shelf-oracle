import { NextRequest, NextResponse } from "next/server";
import { ensurePersonalOrg } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { z } from "zod";

const Body = z.object({ email: z.string().email(), password: z.string() });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user)
    return NextResponse.json({ error: "Wrong credentials or unconfirmed email." }, { status: 401 });
  try {
    await ensurePersonalOrg(data.user.id, data.user.user_metadata?.org_name);
  } catch {
    return NextResponse.json({ error: "Could not load workspace" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
