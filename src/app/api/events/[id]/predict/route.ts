import { NextRequest, NextResponse } from "next/server";
import { scoreProducts } from "@/lib/ai";
import { AuthError, ForbiddenError, requireEventMember, requireUser } from "@/lib/auth";
import { weightedScore } from "@/lib/metrics";
import { PRINCIPLES } from "@/lib/principles";
import { eventRows } from "@/lib/reveal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PredictionPayload } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const event = await requireEventMember(id, user.id);
    if (event.status !== "setup" && event.status !== "intake")
      return NextResponse.json({ error: "Prediction is locked" }, { status: 409 });

    const principles = event.settings?.principles ?? PRINCIPLES;
    const defaultKeys = new Set(PRINCIPLES.map((p) => p.key));
    if (!Array.isArray(principles) || principles.length !== PRINCIPLES.length ||
        new Set(principles.map((p) => p.key)).size !== defaultKeys.size ||
        principles.some((p) => !defaultKeys.has(p.key) || !Number.isFinite(p.weight) || p.weight <= 0 || !p.label))
      return NextResponse.json({ error: "Invalid event rubric" }, { status: 409 });

    const products = await eventRows("products", id);
    if (products.length === 0)
      return NextResponse.json({ error: "Add products before predicting" }, { status: 409 });

    const scores = await scoreProducts(products, new Map(products.flatMap((p) => p.thumb ? [[p.id, p.thumb] as const] : [])));
    const rubric = principles.map((p) => ({ key: p.key, weight: p.weight }));
    const items: PredictionPayload["items"] = [];
    const ordering = new Map<string, { raw: number; salience: number }>();
    for (const product of products) {
      const result = scores.get(product.id);
      if (!result || PRINCIPLES.some((p) => result.principles.find((s) => s.principle === p.key)?.rationale === "not scored"))
        return NextResponse.json({ error: "Incomplete AI rubric; please retry" }, { status: 502 });
      const byKey = new Map(result.principles.map((p) => [p.principle, p]));
      const raw = weightedScore(rubric, result.principles);
      const salience = byKey.get("salience")?.score ?? 0;
      items.push({ productId: product.id, brand: product.brand, name: product.name,
        rank: 0, score: Math.round(raw * 100) / 10, principles: result.principles });
      ordering.set(product.id, { raw, salience });
    }
    items.sort((a, b) => {
      const left = ordering.get(a.productId)!;
      const right = ordering.get(b.productId)!;
      return right.raw - left.raw || right.salience - left.salience || a.productId.localeCompare(b.productId);
    });
    items.forEach((item, index) => { item.rank = index + 1; });
    const draft: PredictionPayload = {
      model: process.env.AI_MODEL || "gemini-3.5-flash",
      createdAt: new Date().toISOString(),
      principles: principles.map((p) => ({ key: p.key, weight: p.weight, label: p.label })),
      items,
    };
    const { data: saved, error: saveError } = await supabaseAdmin().from("events")
      .update({ draft, status: "intake" }).eq("id", id).eq("status", event.status)
      .eq("settings_version", event.settings_version).eq("products_version", event.products_version)
      .is("lock_hash", null).is("locked_at", null).select("id").maybeSingle();
    if (saveError) return NextResponse.json({ error: "Could not save prediction" }, { status: 500 });
    if (!saved) return NextResponse.json({ error: "Event changed while predicting; please retry" }, { status: 409 });
    return NextResponse.json({ draft }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Prediction failed; please retry" }, { status: 502 });
  }
}
