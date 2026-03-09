import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { rebuildUploadFromStaging } from "@/lib/upload-pipeline";

type Params = { params: Promise<{ id: string }> };

const createTeamSchema = z.object({
  brigadeNumber: z.string().min(1),
  schoolOrUnit: z.string().min(1),
  category: z.string().min(1),
  division: z.string().min(1),
  teamNumber: z.string().min(1),
  cadets: z
    .array(
      z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        rank: z.string().optional(),
        gender: z.string().optional(),
        grade: z.string().optional(),
      }),
    )
    .default([]),
});

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const url = new URL(req.url);
  const brigade = url.searchParams.get("brigade");
  const category = url.searchParams.get("category");
  const division = url.searchParams.get("division");

  const teams = await prisma.team.findMany({
    where: {
      uploadId: id,
      brigadeNumber: brigade || undefined,
      category: category || undefined,
      division: division || undefined,
    },
    include: {
      memberships: {
        include: {
          cadetIdentity: true,
          stagedRow: true,
        },
      },
    },
    orderBy: [
      { brigadeNumber: "asc" },
      { category: "asc" },
      { division: "asc" },
      { teamNumber: "asc" },
    ],
  });

  const issueByTeam = await prisma.issue.groupBy({
    by: ["category", "division", "brigadeNumber"],
    where: {
      uploadId: id,
      status: "OPEN",
    },
    _count: true,
  });

  return NextResponse.json({ teams, issueByTeam });
}

export async function POST(req: Request, { params }: Params) {
  const { id: uploadId } = await params;
  const body = await req.json();
  const parsed = createTeamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const payload = parsed.data;
  const incomingCadets = payload.cadets.length
    ? payload.cadets
    : [
        {
          firstName: "TBD",
          lastName: "TBD",
          rank: "",
          gender: "",
          grade: "",
        },
      ];

  await prisma.$transaction(async (tx) => {
    const maxRow =
      (await tx.stagedRow.aggregate({
        where: { uploadId },
        _max: { rowNumber: true },
      }))._max.rowNumber ?? 1;

    let rowNumber = maxRow;
    for (const cadet of incomingCadets) {
      rowNumber += 1;
      await tx.stagedRow.create({
        data: {
          uploadId,
          rowNumber,
          brigadeNumber: payload.brigadeNumber.trim(),
          schoolOrUnit: payload.schoolOrUnit.trim(),
          category: payload.category.trim(),
          division: payload.division.trim(),
          teamNumber: payload.teamNumber.trim(),
          cadetLastName: cadet.lastName.trim(),
          cadetFirstName: cadet.firstName.trim(),
          cadetRank: cadet.rank?.trim() ?? "",
          cadetGender: cadet.gender?.trim() ?? "",
          cadetGrade: cadet.grade?.trim() ?? "",
          normalizedName: `${cadet.lastName.trim().toLowerCase()},${cadet.firstName.trim().toLowerCase()}`,
        },
      });
    }
  });

  await rebuildUploadFromStaging(uploadId);
  return NextResponse.json({ ok: true, reprocessed: true });
}
