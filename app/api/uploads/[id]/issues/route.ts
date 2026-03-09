import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const url = new URL(req.url);
  const severity = url.searchParams.get("severity");
  const status = url.searchParams.get("status");
  const brigade = url.searchParams.get("brigade");
  const category = url.searchParams.get("category");
  const search = url.searchParams.get("search");

  const issues = await prisma.issue.findMany({
    where: {
      uploadId: id,
      severity: severity === "HARD_ERROR" || severity === "WARNING" ? severity : undefined,
      status:
        status === "OPEN" || status === "RESOLVED" || status === "OVERRIDDEN"
          ? status
          : undefined,
      brigadeNumber: brigade || undefined,
      category: category || undefined,
      OR: search
        ? [
            { message: { contains: search } },
            { brigadeNumber: { contains: search } },
            { division: { contains: search } },
            { category: { contains: search } },
          ]
        : undefined,
    },
    include: {
      stagedRow: {
        include: {
          membership: {
            include: {
              team: true,
            },
          },
        },
      },
      cadetIdentity: {
        include: {
          memberships: {
            include: {
              team: true,
              stagedRow: true,
            },
          },
        },
      },
      resolutions: {
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ issues });
}
