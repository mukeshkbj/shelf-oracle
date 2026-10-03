import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ForbiddenError, getUser, requireEventMemberBySlug } from "@/lib/auth";
import { OrganizerReport } from "@/components/organizer/OrganizerReport";

export const metadata: Metadata = { title: "Event report" };

export default async function ReportPage({ params }: PageProps<"/app/e/[slug]/report">) {
  const { slug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  let event;
  try { event = await requireEventMemberBySlug(slug, user.id); }
  catch (error) { if (error instanceof ForbiddenError) notFound(); throw error; }
  if (!event.reveal || !["revealed", "closed"].includes(event.status)) redirect(`/app/e/${encodeURIComponent(slug)}`);
  return <OrganizerReport event={event} />;
}
