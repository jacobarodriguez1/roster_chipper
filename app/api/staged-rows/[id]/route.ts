import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rebuildUploadFromStaging } from "@/lib/upload-pipeline";

const patchStagedRowSchema = z.object({
  brigadeNumber: z.string().optional(),
  schoolOrUnit: z.string().optional(),
  category: z.string().optional(),
  division: z.string().optional(),
  teamNumber: z.string().optional(),
  cadetLastName: z.string().optional(),
  cadetFirstName: z.string().optional(),
  cadetRank: z.string().optional(),
  cadetGender: z.string().optional(),
  cadetGrade: z.string().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const parsed = patchStagedRowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const existing = await prisma.stagedRow.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Staged row not found" }, { status: 404 });
  }

  const updated = await prisma.stagedRow.update({
    where: { id },
    data: {
      ...parsed.data,
      normalizedName:
        parsed.data.cadetFirstName !== undefined || parsed.data.cadetLastName !== undefined
          ? `${(parsed.data.cadetLastName ?? existing.cadetLastName).trim().toLowerCase()},${(
              parsed.data.cadetFirstName ?? existing.cadetFirstName
            )
              .trim()
              .toLowerCase()}`
          : existing.normalizedName,
    },
  });

  await rebuildUploadFromStaging(existing.uploadId);

  return NextResponse.json({ stagedRow: updated, reprocessed: true });
}
