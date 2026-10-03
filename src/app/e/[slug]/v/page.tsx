import { notFound } from "next/navigation";
import { VoterShelf } from "@/components/attendee/voter-shelf";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { EventStatus } from "@/lib/types";
import { isSyntheticEvent } from "@/lib/demo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function VotingPage({ params }: Props) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) notFound();
  const { data, error } = await supabaseAdmin()
    .from("events")
    .select("name,status,settings")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error("Unable to load event");
  if (!data) notFound();

  return <VoterShelf slug={slug} eventName={data.name as string} initialStatus={data.status as EventStatus} synthetic={isSyntheticEvent(data)} />;
}
