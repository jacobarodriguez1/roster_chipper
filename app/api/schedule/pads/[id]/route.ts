import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const patchPadSchema = z.object({
  isLocked: z.boolean(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const parsed = patchPadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const pad = await prisma.pad.update({
    where: { id },
    data: { isLocked: parsed.data.isLocked },
  });
  return NextResponse.json({ pad });
}
