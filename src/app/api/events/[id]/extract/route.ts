import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, ForbiddenError, requireEventMember, requireUser } from "@/lib/auth";
import { extractProduct } from "@/lib/ai";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  crop: z.string().max(2_000_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const event = await requireEventMember(id, user.id);
    if (event.status !== "setup" && event.status !== "intake")
      return NextResponse.json({ error: "Intake is closed" }, { status: 409 });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Expected a JPEG crop (max ~1.5MB)" }, { status: 400 });
    const details = await extractProduct(parsed.data.crop);
    return NextResponse.json({ details });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (e instanceof ForbiddenError)
      return NextResponse.json({ error: e.message }, { status: 403 });
    console.error("extract failed:", e);
    return NextResponse.json({ error: "Extraction failed — try again." }, { status: 502 });
  }
}
