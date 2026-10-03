import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReportView from "@/components/reveal/ReportView";
import { readPublishedReveal } from "@/components/reveal/public-reveal";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await readPublishedReveal(slug);
  if (!result) return { title: "Report unavailable", robots: { index: false, follow: false } };
  return {
    title: `${result.event.name} — Tasting report`,
    description: `Published tasting rankings, AI prediction, human guesses and real comments from ${result.event.name}.`,
  };
}

export default async function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await readPublishedReveal(slug);
  if (!result) notFound();
  return <ReportView result={result} />;
}
