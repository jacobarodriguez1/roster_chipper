import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const upload = await prisma.upload.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          stagedRows: true,
          issues: true,
          teams: true,
        },
      },
    },
  });
  if (!upload) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  }

  const openHardErrors = await prisma.issue.count({
    where: { uploadId: id, severity: "HARD_ERROR", status: "OPEN" },
  });

  return NextResponse.json({ upload, openHardErrors });
}
