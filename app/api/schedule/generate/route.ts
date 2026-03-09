import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateScheduleSchema } from "@/lib/api-types";
import { generateSchedule } from "@/lib/scheduler";
import { hhmmToMinutes } from "@/lib/time";

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = generateScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { uploadId, scheduleConfigId, allowJudgeReassignment } = parsed.data;
  const openHardErrors = await prisma.issue.count({
    where: {
      uploadId,
      severity: "HARD_ERROR",
      status: "OPEN",
    },
  });
  if (openHardErrors > 0) {
    return NextResponse.json(
      { error: "Resolve all hard errors before schedule generation." },
      { status: 400 },
    );
  }

  const config = await prisma.scheduleConfig.findUnique({
    where: { id: scheduleConfigId },
    include: {
      categoryConfigs: true,
      pads: {
        include: { blocks: true },
      },
    },
  });
  if (!config || config.uploadId !== uploadId) {
    return NextResponse.json({ error: "Schedule config not found" }, { status: 404 });
  }

  const teams = await prisma.team.findMany({
    where: { uploadId },
    include: { memberships: true },
  });
  const stagedRows = await prisma.stagedRow.findMany({
    where: { uploadId },
    select: { category: true, division: true },
  });
  const categoryDivisionCombinationCount = new Set(
    stagedRows.map((row) => `${row.category}|${row.division}`),
  ).size;

  const startMin = hhmmToMinutes(config.startTime);
  const endMin = hhmmToMinutes(config.endTime);

  const created = await prisma.$transaction(async (tx) => {
    const version = await tx.scheduleVersion.create({
      data: {
        uploadId,
        scheduleConfigId,
        status: "DRAFT",
      },
    });

    const { slots, metrics } = generateSchedule({
      teams,
      lanes: config.pads,
      defaultDuration: config.defaultDuration,
      categoryConfigs: config.categoryConfigs,
      startMin,
      endMin,
      categoryDivisionCombinationCount,
      allowJudgeReassignment,
    });

    if (slots.length > 0) {
      await tx.scheduleSlot.createMany({
        data: slots.map((s) => ({
          scheduleVersionId: version.id,
          teamId: s.teamId,
          padId: s.padId,
          startMin: s.startMin,
          endMin: s.endMin,
        })),
      });
    }

    const full = await tx.scheduleVersion.findUniqueOrThrow({
      where: { id: version.id },
      include: {
        slots: {
          include: {
            team: true,
            pad: true,
          },
          orderBy: [{ startMin: "asc" }],
        },
        scheduleConfig: {
          include: {
            pads: {
              include: { blocks: true },
            },
          },
        },
      },
    });

    return { version: full, metrics };
  });

  return NextResponse.json({
    scheduleVersion: created.version,
    schedulingStats: {
      categoryDivisionCombinationCount,
      laneCount: config.pads.length,
      judgeReassignmentRate: `${created.metrics.judgeReassignmentRate}%`,
      totalComboPadTransitions: created.metrics.totalComboPadTransitions,
      totalComboSlots: created.metrics.totalComboSlots,
      projectedFinishMin: created.metrics.projectedFinishMin,
      avgFollowOnBufferMin: created.metrics.avgFollowOnBufferMin,
      cadetConflicts: created.metrics.cadetConflicts,
      internalHoleCount: created.metrics.internalHoleCount,
      judgeContinuityRule:
        allowJudgeReassignment
          ? "Judge teams stay bound to category/division and may move pads only after completing that category/division."
          : "Strict station mode: category/division stays on one judging station; stations handle at most two combos.",
    },
  });
}
