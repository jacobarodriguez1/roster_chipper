import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createPadBlockSchema = z.object({
  startMin: z.number().int().min(0),
  endMin: z.number().int().min(1),
  reason: z.string().min(1),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const parsed = createPadBlockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (parsed.data.endMin <= parsed.data.startMin) {
    return NextResponse.json({ error: "endMin must be greater than startMin" }, { status: 400 });
  }

  const block = await prisma.padBlock.create({
    data: {
      padId: id,
      startMin: parsed.data.startMin,
      endMin: parsed.data.endMin,
      reason: parsed.data.reason,
    },
  });
  return NextResponse.json({ block });
}
