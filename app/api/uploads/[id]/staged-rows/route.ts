import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { id: uploadId } = await params;
  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim();

  const stagedRows = await prisma.stagedRow.findMany({
    where: {
      uploadId,
      OR: search
        ? [
            { brigadeNumber: { contains: search } },
            { schoolOrUnit: { contains: search } },
            { category: { contains: search } },
            { division: { contains: search } },
            { teamNumber: { contains: search } },
            { cadetLastName: { contains: search } },
            { cadetFirstName: { contains: search } },
          ]
        : undefined,
    },
    include: {
      membership: {
        include: {
          team: true,
          cadetIdentity: true,
        },
      },
    },
    orderBy: { rowNumber: "asc" },
  });

  return NextResponse.json({ stagedRows });
}
