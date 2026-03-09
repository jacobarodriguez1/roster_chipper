import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const uploadId = url.searchParams.get("uploadId");
  if (!uploadId) {
    return NextResponse.json({ error: "uploadId is required" }, { status: 400 });
  }

  const configs = await prisma.scheduleConfig.findMany({
    where: { uploadId },
    include: {
      categoryConfigs: true,
      pads: {
        include: { blocks: true },
        orderBy: { laneOrder: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const versions = await prisma.scheduleVersion.findMany({
    where: { uploadId },
    include: {
      slots: {
        include: {
          pad: true,
          team: {
            include: {
              memberships: {
                include: {
                  cadetIdentity: true,
                },
              },
            },
          },
        },
        orderBy: [{ startMin: "asc" }],
      },
      scheduleConfig: {
        include: {
          pads: {
            include: { blocks: true },
            orderBy: { laneOrder: "asc" },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ configs, versions });
}
