import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mergeIdentitiesSchema } from "@/lib/api-types";

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = mergeIdentitiesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { sourceIdentityIds, targetIdentityId } = parsed.data;
  await prisma.$transaction(async (tx) => {
    for (const sourceId of sourceIdentityIds) {
      if (sourceId === targetIdentityId) continue;

      await tx.teamMembership.updateMany({
        where: { cadetIdentityId: sourceId },
        data: { cadetIdentityId: targetIdentityId },
      });

      await tx.issue.updateMany({
        where: { cadetIdentityId: sourceId },
        data: { cadetIdentityId: targetIdentityId },
      });

      await tx.cadetIdentity.update({
        where: { id: sourceId },
        data: {
          isMerged: true,
          mergedIntoId: targetIdentityId,
        },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
