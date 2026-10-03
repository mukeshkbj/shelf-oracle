import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { EventPulse } from "@/components/attendee/event-pulse";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site-url";
import type { EventRow } from "@/lib/types";
import { isSyntheticEvent } from "@/lib/demo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function EventLanding({ params }: Props) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) notFound();

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("events")
    .select("id,slug,name,location,status,locked_at,lock_hash,settings")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error("Unable to load event");
  if (!data) notFound();
  const event = data as Pick<EventRow, "id" | "slug" | "name" | "location" | "status" | "locked_at" | "lock_hash" | "settings">;
  const { count, error: countError } = await db
    .from("votes")
    .select("id", { count: "exact", head: true })
    .eq("event_id", event.id);
  if (countError) throw new Error("Unable to load rating count");

  const votePath = `/e/${encodeURIComponent(slug)}/v`;
  let url: string | null = null;
  try { url = siteUrl(votePath); } catch {}
  const qr = url ? await QRCode.toDataURL(url, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0f172aff", light: "#ffffffff" },
  }) : null;

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-50 sm:px-10 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="inline-flex min-h-11 items-center font-semibold tracking-wide text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-400">SHELF ORACLE</Link>
        <div className="mt-10 grid items-start gap-10 lg:grid-cols-[1fr_21rem] lg:gap-14">
          <EventPulse initial={{
            event: {
              slug: event.slug,
              name: event.name,
              location: event.location,
              status: event.status,
              lockedAt: event.locked_at,
              lockHash: event.lock_hash,
              synthetic: isSyntheticEvent(event),
            },
            voteCount: count ?? 0,
          }} />
          <section aria-label="Join this tasting" className="rounded-3xl border border-slate-700 bg-white p-6 text-slate-950 shadow-xl sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Join on your phone</p>
            <h2 className="mt-2 text-2xl font-semibold">Build your shelf</h2>
            <p className="mt-2 text-sm text-slate-600">Scan to guess before you taste, then rate each product.</p>
            {qr ? <Image src={qr} alt="QR code to this event's tasting page" width={320} height={320} unoptimized className="mx-auto my-5 aspect-square w-full max-w-80" /> : <p role="status" className="my-5 text-sm text-amber-800">QR unavailable until the organizer configures the public site URL.</p>}
            <Link href={votePath} className="mt-5 flex min-h-12 items-center justify-center rounded-xl bg-emerald-600 px-5 text-center font-semibold text-white hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600">Open tasting page</Link>
            {url && <p className="mt-4 break-all text-center font-mono text-xs text-slate-600">{url}</p>}
          </section>
        </div>
      </div>
    </main>
  );
}
