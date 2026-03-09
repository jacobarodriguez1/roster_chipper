import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ingestUploadFromCsv } from "@/lib/upload-pipeline";

export async function GET() {
  const uploads = await prisma.upload.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { stagedRows: true, issues: true, teams: true, scheduleVersions: true },
      },
    },
  });
  return NextResponse.json({ uploads });
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "CSV file is required." }, { status: 400 });
  }

  const text = await file.text();
  const upload = await ingestUploadFromCsv({
    filename: file.name,
    csvText: text,
  });

  return NextResponse.json({ upload });
}
