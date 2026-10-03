import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { PRINCIPLES, TOTAL_WEIGHT } from "./principles";
import type { DetectedItem, PrincipleScore, Product } from "./types";

let client: OpenAI | null = null;

function ai(): OpenAI {
  if (!client) {
    if (!process.env.AI_API_KEY) throw new Error("AI_API_KEY not configured");
    client = new OpenAI({
      apiKey: process.env.AI_API_KEY,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
  }
  return client;
}

const MODEL = () => process.env.AI_MODEL || "gemini-3.5-flash";

/* ---------- helpers ---------- */

async function chat<T>(
  schema: z.ZodType<T>,
  name: string,
  system: string,
  userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[]
): Promise<T> {
  const res = await ai().chat.completions.create({
    model: MODEL(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name,
        strict: true,
        schema: z.toJSONSchema(schema, { target: "draft-7" }) as never,
      },
    },
    temperature: 0.2,
  });
  const text = res.choices[0]?.message?.content;
  if (!text) throw new Error("Empty AI response");
  return schema.parse(JSON.parse(text));
}

const img = (dataUrl: string): OpenAI.Chat.Completions.ChatCompletionContentPart =>
  ({ type: "image_url", image_url: { url: dataUrl } });

const text = (t: string): OpenAI.Chat.Completions.ChatCompletionContentPart =>
  ({ type: "text", text: t });

/* ---------- 1. whole-shelf detection ---------- */

const DetectedSchema = z.object({
  items: z.array(
    z.object({
      brand: z.string(),
      nameGuess: z.string(),
      format: z.string().nullable(),
      box: z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        w: z.number().min(0).max(1),
        h: z.number().min(0).max(1),
      }),
    })
  ),
});

export async function detectShelf(imageDataUrl: string): Promise<DetectedItem[]> {
  const out = await chat(
    DetectedSchema,
    "shelf_detection",
    `You are a retail shelf analyst. Identify EVERY distinct retail product visible in this shelf photo — every pack, box, pouch, tin or bottle that is a separate product or SKU. If a brand has multiple flavours/variants, list each visible variant separately. Do not merge different products; do not list the same product twice if it appears twice — list it once at its most visible instance.`,
    [
      text(`List every distinct product. For each: brand name (as printed on pack, your best reading), a short product/variant name guess, packaging format (pouch/box/tin/bottle/can/bar/other), and a bounding box as fractions of image width/height: {x,y,w,h} with x,y = top-left corner. Boxes should tightly bound ONE product facing/facing-group. Order left-to-right, top-to-bottom.`),
      img(imageDataUrl),
    ]
  );
  return out.items;
}

/* ---------- 2. per-product detail extraction ---------- */

const DetailSchema = z.object({
  brand: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  format: z.string().nullable(),
  price: z.string().nullable(),
  claims: z.array(z.string()).max(8),
  attributes: z.object({
    flavour: z.string().nullable(),
    pack_size: z.string().nullable(),
    dietary: z.string().nullable(),
    tagline: z.string().nullable(),
  }),
});

export async function extractProduct(imageDataUrl: string): Promise<
  z.infer<typeof DetailSchema>
> {
  return chat(
    DetailSchema,
    "product_details",
    `You are reading a food/beverage product pack for a retail intelligence panel. Extract exactly what is printed. If a field is not legible, return null rather than guessing.`,
    [
      text(`Extract: brand (exact), product/variant name, category (e.g. crisps, protein snack, kombucha), format, visible price or size claim, marketing claims exactly as written (e.g. "high protein", "no added sugar"), flavour, pack size, dietary markers (vegan/GF/etc), and the pack's tagline.`),
      img(imageDataUrl),
    ]
  );
}

/* ---------- 3. rubric scoring ---------- */

const ScoreSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string(),
      principles: z.array(
        z.object({
          principle: z.string(),
          score: z.number().min(1).max(10),
          rationale: z.string().max(160),
        })
      ),
    })
  ),
});

export async function scoreProducts(
  products: Pick<Product, "id" | "brand" | "name" | "category" | "claims" | "price" | "attributes">[],
  thumbs: Map<string, string>
): Promise<Map<string, { score: number; principles: PrincipleScore[] }>> {
  const list = products.map((p) => ({
    productId: p.id,
    brand: p.brand,
    name: p.name,
    category: p.category,
    price: p.price,
    claims: p.claims,
    attributes: p.attributes,
  }));
  const rubric = PRINCIPLES.map(
    (p) => `- ${p.key} (weight ${p.weight}): ${p.label}`
  ).join("\n");
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    text(`Score every product below on each principle, 1-10, with a ≤20-word rationale grounded in what is visible/known about the product. Judge as "how strongly will curious food-hackathon tasters rate this after tasting" — this predicts the room's ranking, not objective quality.\n\nPrinciples:\n${rubric}\n\nProducts:\n${JSON.stringify(list, null, 2)}`),
    ...products.slice(0, 30).flatMap((p) => {
      const t = thumbs.get(p.id);
      return t ? [text(`${p.brand} — ${p.name} (${p.id})`), img(t)] : [];
    }),
  ];
  const out = await chat(
    ScoreSchema,
    "rubric_scores",
    `You are a behavioural-science retail analyst scoring products for a tasting panel prediction.`,
    parts
  );
  const expectedIds = new Set(products.map((p) => p.id));
  const foundIds = new Set(out.items.map((p) => p.productId));
  if (foundIds.size !== expectedIds.size || out.items.length !== expectedIds.size ||
      out.items.some((p) => !expectedIds.has(p.productId))) {
    throw new Error("AI did not score every product exactly once");
  }
  const map = new Map<string, { score: number; principles: PrincipleScore[] }>();
  for (const item of out.items) {
    const byKey = new Map(item.principles.map((p) => [p.principle, p]));
    if (byKey.size !== PRINCIPLES.length ||
        PRINCIPLES.some((p) => !byKey.has(p.key))) {
      throw new Error(`AI did not score every principle for ${item.productId}`);
    }
    const ordered: PrincipleScore[] = PRINCIPLES.map((p) => ({
      principle: p.key,
      score: byKey.get(p.key)!.score,
      rationale: byKey.get(p.key)!.rationale,
    }));
    const score =
      (PRINCIPLES.reduce((s, p, i) => s + p.weight * ordered[i].score, 0) /
        TOTAL_WEIGHT) * 10;
    map.set(item.productId, {
      score: Math.round(score * 10) / 10,
      principles: ordered,
    });
  }
  return map;
}

/* ---------- 4. explain misses ---------- */

const MissSchema = z.object({
  notes: z.array(z.object({ productId: z.string(), note: z.string().max(220) })),
});

export async function explainMisses(
  misses: {
    productId: string;
    brand: string;
    name: string;
    predictedRank: number;
    actualRank: number;
    topComments: string[];
  }[]
): Promise<Map<string, string>> {
  if (misses.length === 0) return new Map();
  const out = await chat(
    MissSchema,
    "miss_explanations",
    `You explain prediction misses for a retail tasting panel. One candid sentence per product — what the model under/over-weighted, grounded in the voter comments given. No hedging.`,
    [text(JSON.stringify(misses, null, 2))]
  );
  return new Map(out.notes.map((n) => [n.productId, n.note]));
}
