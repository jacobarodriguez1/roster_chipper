import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { patchScheduleSlotSchema } from "@/lib/api-types";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const parsed = patchScheduleSlotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const updated = await prisma.scheduleSlot.update({
    where: { id },
    data: parsed.data,
    include: {
      team: true,
      pad: true,
    },
  });

  return NextResponse.json({ slot: updated });
}
