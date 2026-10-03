import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ForbiddenError, getUser, requireEventMemberBySlug } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site-url";
import type { EventRow, Product } from "@/lib/types";
import { EventStudio } from "@/components/organizer/EventStudio";

export const metadata: Metadata = { title: "Event studio" };

export default async function EventPage({ params }: PageProps<"/app/e/[slug]">) {
  const { slug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  let event: EventRow;
  try { event = await requireEventMemberBySlug(slug, user.id); }
  catch (error) { if (error instanceof ForbiddenError) notFound(); throw error; }
  const voters = new Set<string>();
  async function loadVoters() {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin().from("votes").select("id,voter_id").eq("event_id", event.id).order("id").range(offset, offset + 999);
      if (error) throw error;
      for (const row of data || []) voters.add(row.voter_id);
      if (!data || data.length < 1000) break;
    }
  }
  const [productsResult, votesResult, guessesResult, photosResult, commentsResult] = await Promise.all([
    supabaseAdmin().from("products").select("*").eq("event_id", event.id).order("created_at"),
    supabaseAdmin().from("votes").select("id", { count: "exact", head: true }).eq("event_id", event.id),
    supabaseAdmin().from("human_predictions").select("id", { count: "exact", head: true }).eq("event_id", event.id),
    supabaseAdmin().from("shelf_images").select("id", { count: "exact", head: true }).eq("event_id", event.id),
    supabaseAdmin().from("votes").select("product_id,rating,comment,created_at").eq("event_id", event.id).not("comment", "is", null).order("created_at", { ascending: false }).limit(5),
    loadVoters(),
  ]);
  if (productsResult.error || votesResult.error || guessesResult.error || photosResult.error || commentsResult.error) throw new Error("Could not load this event. Please try again.");
  const votingUrl = siteUrl(`/e/${encodeURIComponent(event.slug)}/v`);
  return <EventStudio event={event} votingUrl={votingUrl} initialProducts={(productsResult.data || []) as Product[]} imageCount={photosResult.count || 0} monitor={{ voteCount: votesResult.count || 0, voterCount: voters.size, guessCount: guessesResult.count || 0, comments: (commentsResult.data || []).filter(v => v.comment).map(v => ({ text: v.comment as string, rating: v.rating, productId: v.product_id, createdAt: v.created_at })) }} />;
}
