import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const identities = await prisma.cadetIdentity.findMany({
    where: { uploadId: id, isMerged: false },
    include: {
      memberships: {
        include: {
          team: true,
          stagedRow: true,
        },
      },
    },
    orderBy: [{ canonicalLastName: "asc" }, { canonicalFirstName: "asc" }],
  });
  return NextResponse.json({ identities });
}
