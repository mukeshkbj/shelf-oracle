import "server-only";
import { supabaseServer } from "./supabase/server";
import { supabaseAdmin } from "./supabase/admin";
import type { EventRow } from "./types";

export interface SessionUser {
  id: string;
  email: string;
}

/** Returns the signed-in user or null (route handlers + server components). */
export async function getUser(): Promise<SessionUser | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

/** Throwing variant for protected surfaces. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) throw new AuthError("Not signed in");
  return user;
}

export class AuthError extends Error {}
export class ForbiddenError extends Error {}

export async function ensurePersonalOrg(userId: string, preferredName?: string) {
  const db = supabaseAdmin();
  const { data: existing, error: lookupError } = await db
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1);
  if (lookupError) throw lookupError;
  if (existing?.length) return;

  const name = typeof preferredName === "string"
    ? preferredName.trim().slice(0, 60) || "Personal workspace"
    : "Personal workspace";
  const { data: org, error: orgError } = await db
    .from("orgs")
    .insert({ name })
    .select("id")
    .single();
  if (orgError || !org) throw orgError ?? new Error("Workspace creation failed");
  const { error: memberError } = await db.from("org_members").insert({
    org_id: org.id,
    user_id: userId,
    role: "owner",
  });
  if (memberError) throw memberError;
}

/** Orgs the user belongs to. */
export async function userOrgs(userId: string) {
  const { data, error } = await supabaseAdmin()
    .from("org_members")
    .select("org_id, role, orgs(id, name)")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    org_id: r.org_id as string,
    role: r.role as "owner" | "member",
    org: r.orgs as unknown as { id: string; name: string },
  }));
}

/** Loads an event and asserts the user belongs to its org. */
export async function requireEventMember(eventId: string, userId: string) {
  const { data: event, error } = await supabaseAdmin()
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single();
  if (error || !event) throw new ForbiddenError("Event not found");
  const { data: member } = await supabaseAdmin()
    .from("org_members")
    .select("user_id")
    .eq("org_id", event.org_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) throw new ForbiddenError("Not a member of this event's org");
  return event as EventRow;
}

/** Same, by slug (used by organizer pages which address events by slug). */
export async function requireEventMemberBySlug(slug: string, userId: string) {
  const { data: event, error } = await supabaseAdmin()
    .from("events")
    .select("*")
    .eq("slug", slug)
    .single();
  if (error || !event) throw new ForbiddenError("Event not found");
  const { data: member } = await supabaseAdmin()
    .from("org_members")
    .select("user_id")
    .eq("org_id", event.org_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) throw new ForbiddenError("Not a member of this event's org");
  return event as EventRow;
}
