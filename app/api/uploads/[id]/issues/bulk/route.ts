import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const bulkIssueUpdateSchema = z.object({
  severities: z.array(z.enum(["HARD_ERROR", "WARNING"])).min(1),
  status: z.enum(["RESOLVED", "OVERRIDDEN", "OPEN"]).default("RESOLVED"),
  reason: z.string().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id: uploadId } = await params;
  const body = await req.json();
  const parsed = bulkIssueUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { severities, status, reason } = parsed.data;

  const isUnresolve = status === "OPEN";

  const result = await prisma.$transaction(async (tx) => {
    const targets = await tx.issue.findMany({
      where: {
        uploadId,
        status: isUnresolve ? { in: ["RESOLVED", "OVERRIDDEN"] } : "OPEN",
        severity: { in: severities },
      },
      select: { id: true },
    });

    if (targets.length === 0) {
      return { updatedCount: 0 };
    }

    await tx.issue.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: {
        status: isUnresolve ? "OPEN" : status,
        overrideReason: status === "OVERRIDDEN" ? reason : null,
      },
    });

    await tx.issueResolution.createMany({
      data: targets.map((target) => ({
        issueId: target.id,
        action: isUnresolve ? "BULK_UNRESOLVE" : `BULK_${status}`,
        reason,
      })),
    });

    const remainingHardErrors = await tx.issue.count({
      where: {
        uploadId,
        severity: "HARD_ERROR",
        status: "OPEN",
      },
    });

    await tx.upload.update({
      where: { id: uploadId },
      data: { status: remainingHardErrors === 0 ? "READY" : "VALIDATED" },
    });

    return { updatedCount: targets.length };
  });

  return NextResponse.json(result);
}
