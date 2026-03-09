import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { splitIdentitySchema } from "@/lib/api-types";

function normalizedName(first: string, last: string) {
  return `${last.trim().toLowerCase()},${first.trim().toLowerCase()}`;
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = splitIdentitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { identityId, stagedRowIds, newFirstName, newLastName } = parsed.data;
  const source = await prisma.cadetIdentity.findUnique({
    where: { id: identityId },
  });
  if (!source) {
    return NextResponse.json({ error: "Identity not found" }, { status: 404 });
  }

  const identity = await prisma.$transaction(async (tx) => {
    const next = await tx.cadetIdentity.create({
      data: {
        uploadId: source.uploadId,
        canonicalFirstName: newFirstName,
        canonicalLastName: newLastName,
        normalizedName: normalizedName(newFirstName, newLastName),
        canonicalKey: `${source.uploadId}|${normalizedName(newFirstName, newLastName)}`,
      },
    });

    await tx.teamMembership.updateMany({
      where: {
        cadetIdentityId: identityId,
        stagedRowId: { in: stagedRowIds },
      },
      data: {
        cadetIdentityId: next.id,
      },
    });

    await tx.issue.create({
      data: {
        uploadId: source.uploadId,
        cadetIdentityId: next.id,
        type: "IDENTITY",
        code: "IDENTITY_SPLIT",
        severity: "WARNING",
        status: "RESOLVED",
        message: "Identity split applied manually.",
      },
    });

    return next;
  });

  return NextResponse.json({ identity });
}
