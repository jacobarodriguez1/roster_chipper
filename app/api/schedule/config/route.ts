import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scheduleConfigSchema } from "@/lib/api-types";

export async function PATCH(req: Request) {
  const body = await req.json();
  const parsed = scheduleConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const data = parsed.data;
  const config = await prisma.$transaction(async (tx) => {
    const created = await tx.scheduleConfig.create({
      data: {
        uploadId: data.uploadId,
        startTime: data.startTime,
        endTime: data.endTime,
        defaultDuration: data.defaultDuration,
        padCount: data.padCount,
        groupingWeight: data.groupingWeight,
        efficiencyWeight: data.efficiencyWeight,
      },
    });

    if (data.categoryConfigs.length > 0) {
      await tx.categoryConfig.createMany({
        data: data.categoryConfigs.map((c) => ({
          scheduleConfigId: created.id,
          category: c.category,
          division: c.division,
          durationMinutes: c.durationMinutes,
        })),
      });
    }

    const pads = data.pads.length
      ? data.pads
      : Array.from({ length: data.padCount }, (_, i) => ({
          name: `Pad ${i + 1}`,
          basePad: undefined,
          subLane: undefined,
          laneOrder: i,
          isLocked: false,
          blocks: [],
        }));

    for (const pad of pads) {
      const createdPad = await tx.pad.create({
        data: {
          scheduleConfigId: created.id,
          name: pad.name,
          basePad: pad.basePad,
          subLane: pad.subLane,
          isLocked: pad.isLocked,
          laneOrder: pad.laneOrder,
        },
      });

      if (pad.blocks.length > 0) {
        await tx.padBlock.createMany({
          data: pad.blocks.map((b) => ({
            padId: createdPad.id,
            startMin: b.startMin,
            endMin: b.endMin,
            reason: b.reason,
          })),
        });
      }
    }

    return tx.scheduleConfig.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        categoryConfigs: true,
        pads: {
          include: { blocks: true },
          orderBy: { laneOrder: "asc" },
        },
      },
    });
  });

  return NextResponse.json({ config });
}
