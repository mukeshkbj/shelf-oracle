import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RevealDeck from "@/components/reveal/RevealDeck";
import { readPublishedReveal } from "@/components/reveal/public-reveal";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await readPublishedReveal(slug);
  if (!result) return { title: "Result unavailable", robots: { index: false, follow: false } };
  return {
    title: `${result.event.name} — Live reveal`,
    description: `The published AI prediction and real tasting result for ${result.event.name}.`,
  };
}

export default async function RevealPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ autoplay?: string | string[] }> }) {
  const { slug } = await params;
  const result = await readPublishedReveal(slug);
  if (!result) notFound();
  const { autoplay } = await searchParams;
  return <RevealDeck result={result} initialAutoplay={autoplay === "1"} />;
}
