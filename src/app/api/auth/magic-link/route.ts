import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { z } from "zod";

const Body = z.object({ email: z.string().trim().max(254).email() }).strict();
const headers = { "Cache-Control": "no-store" };
const unavailable = "Unable to request a sign-in link. Try again later or use your password.";

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400, headers });

  try {
    const emailRedirectTo = siteUrl("/auth/callback");
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: { shouldCreateUser: false, emailRedirectTo },
    });
    if (error) {
      if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
        return NextResponse.json({ error: "Please wait at least a minute before requesting another link, or use your password." }, {
          status: 429,
          headers: { ...headers, "Retry-After": "60" },
        });
      }
      return NextResponse.json({ error: unavailable }, { status: 503, headers });
    }
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ error: unavailable }, { status: 503, headers });
  }
}
