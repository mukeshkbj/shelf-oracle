import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser, userOrgs } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { slugify } from "@/lib/slug";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgs = await userOrgs(user.id);
  const orgIds = orgs.map((o) => o.org_id);
  if (orgIds.length === 0) return NextResponse.json({ events: [] });
  const { data, error } = await supabaseAdmin()
    .from("events")
    .select("id, slug, name, location, status, lock_hash, locked_at, created_at, org_id")
    .in("org_id", orgIds)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}

const CreateBody = z.object({
  name: z.string().min(1).max(80),
  location: z.string().max(120).optional(),
  slug: z.string().max(60).optional(),
  orgId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid event data" }, { status: 400 });
  const { name, location, orgId } = parsed.data;

  const orgs = await userOrgs(user.id);
  if (!orgs.some((o) => o.org_id === orgId))
    return NextResponse.json({ error: "Not a member of that org" }, { status: 403 });

  let slug = slugify(parsed.data.slug || name);
  // Ensure uniqueness with a numeric suffix if taken.
  for (let i = 0; i < 10; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    const { data: existing } = await supabaseAdmin()
      .from("events")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!existing) {
      slug = candidate;
      break;
    }
  }

  const { data, error } = await supabaseAdmin()
    .from("events")
    .insert({ org_id: orgId, name, location: location || null, slug })
    .select("id, slug")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}
