import { notFound } from "next/navigation";
import { TasteProfile } from "@/components/attendee/taste-profile";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function MyTastePage({ params }: Props) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) notFound();
  const { data, error } = await supabaseAdmin()
    .from("events")
    .select("name")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error("Unable to load event");
  if (!data) notFound();

  return <TasteProfile slug={slug} eventName={data.name as string} />;
}
