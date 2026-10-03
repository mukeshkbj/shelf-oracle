import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser, userOrgs } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { EventRow } from "@/lib/types";
import { EventsOverview } from "@/components/organizer/EventsOverview";

export const metadata: Metadata = { title: "Your events" };

export default async function AppPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  const orgs = await userOrgs(user.id);
  const ids = orgs.map(o => o.org_id);
  if (ids.length === 0) return <EventsOverview events={[]} />;
  const { data: events, error } = await supabaseAdmin().from("events").select("*").in("org_id", ids).order("created_at", { ascending: false });
  if (error) throw new Error("Could not load your events. Please try again.");
  const rows = (events || []) as EventRow[];
  if (!rows.length) return <EventsOverview events={[]} />;
  const eventIds = rows.map(e => e.id);
  async function loadActivity(table: "products" | "votes") {
    const records: { event_id: string; thumb?: string | null; voter_id?: string }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin().from(table).select(table === "products" ? "id,event_id,thumb" : "id,event_id,voter_id").in("event_id", eventIds).order("id").range(offset, offset + 999);
      if (error) throw new Error("Could not load event activity. Please try again.");
      records.push(...(data || []));
      if (!data || data.length < 1000) return records;
    }
  }
  const [products, votes] = await Promise.all([loadActivity("products"), loadActivity("votes")]);
  return <EventsOverview events={rows.map(event => {
    const eventProducts = products.filter(p => p.event_id === event.id);
    const eventVotes = votes.filter(v => v.event_id === event.id);
    return { ...event, productCount: eventProducts.length, thumbs: eventProducts.filter(p => p.thumb).slice(0, 4).map(p => p.thumb as string), voteCount: eventVotes.length, voterCount: new Set(eventVotes.map(v => v.voter_id).filter(Boolean)).size };
  })} />;
}
