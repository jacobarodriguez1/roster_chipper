import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hhmmToMinutes, minutesToHhmm } from "@/lib/time";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const version = await prisma.scheduleVersion.findUnique({
    where: { id },
    include: {
      scheduleConfig: true,
      slots: {
        include: {
          team: true,
          pad: true,
        },
        orderBy: [{ startMin: "asc" }],
      },
    },
  });
  if (!version) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  const csvLines = [
    "time_start,time_end,pad,brigade,category,division,team_number",
    ...version.slots.map(
      (slot) =>
        `${minutesToHhmm(slot.startMin + hhmmToMinutes(version.scheduleConfig.startTime))},${minutesToHhmm(slot.endMin + hhmmToMinutes(version.scheduleConfig.startTime))},${slot.pad.name},${slot.team.brigadeNumber},${slot.team.category},${slot.team.division},${slot.team.teamNumber}`,
    ),
  ];

  const drillBoardPayload = {
    scheduleVersionId: version.id,
    uploadId: version.uploadId,
    generatedAt: new Date().toISOString(),
    slots: version.slots.map((slot) => ({
      lane: slot.pad.name,
      start: minutesToHhmm(slot.startMin + hhmmToMinutes(version.scheduleConfig.startTime)),
      end: minutesToHhmm(slot.endMin + hhmmToMinutes(version.scheduleConfig.startTime)),
      team: {
        brigadeNumber: slot.team.brigadeNumber,
        schoolOrUnit: slot.team.schoolOrUnit,
        category: slot.team.category,
        division: slot.team.division,
        teamNumber: slot.team.teamNumber,
      },
    })),
  };

  return NextResponse.json({
    operationsCsv: csvLines.join("\n"),
    drillBoardJson: drillBoardPayload,
  });
}
