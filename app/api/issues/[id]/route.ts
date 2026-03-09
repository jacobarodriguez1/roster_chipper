import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateIssueSchema } from "@/lib/api-types";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const issue = await prisma.issue.findUnique({
    where: { id },
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
      },
    },
  });
  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const details = issue.detailsJson ? (JSON.parse(issue.detailsJson) as Record<string, unknown>) : {};

  const stagedRowsFromDetails = Array.isArray(details.rows)
    ? await prisma.stagedRow.findMany({
        where: {
          uploadId: issue.uploadId,
          rowNumber: { in: details.rows.filter((v) => Number.isInteger(v)) as number[] },
        },
        include: {
          membership: {
            include: {
              team: true,
            },
          },
        },
        orderBy: { rowNumber: "asc" },
      })
    : [];

  let candidateCadets: {
    id: string;
    canonicalFirstName: string;
    canonicalLastName: string;
    memberships: {
      team: { category: string; division: string; teamNumber: string; brigadeNumber: string };
    }[];
  }[] = [];

  if (!issue.cadetIdentityId && issue.code === "MULTI_CATEGORY_CADET") {
    const categories = Array.isArray(details.categories)
      ? (details.categories.filter((v) => typeof v === "string") as string[])
      : [];
    const all = await prisma.cadetIdentity.findMany({
      where: {
        uploadId: issue.uploadId,
        isMerged: false,
      },
      include: {
        memberships: {
          include: {
            team: true,
          },
        },
      },
    });
    candidateCadets = all
      .filter((identity) => {
        const combos = new Set(
          identity.memberships.map((m) => `${m.team.category}::${m.team.division}`),
        );
        return categories.every((combo) => combos.has(combo));
      })
      .map((identity) => ({
        id: identity.id,
        canonicalFirstName: identity.canonicalFirstName,
        canonicalLastName: identity.canonicalLastName,
        memberships: identity.memberships.map((m) => ({
          team: {
            category: m.team.category,
            division: m.team.division,
            teamNumber: m.team.teamNumber,
            brigadeNumber: m.team.brigadeNumber,
          },
        })),
      }));
  }

  return NextResponse.json({
    issue,
    details,
    stagedRowsFromDetails,
    candidateCadets,
  });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const parsed = updateIssueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const issue = await prisma.issue.findUnique({ where: { id } });
  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const status = parsed.data.status;
  const reason = parsed.data.reason;

  const updated = await prisma.$transaction(async (tx) => {
    const out = await tx.issue.update({
      where: { id },
      data: {
        status,
        overrideReason: status === "OVERRIDDEN" ? reason : null,
      },
    });

    await tx.issueResolution.create({
      data: {
        issueId: id,
        action: status,
        reason,
      },
    });

    const remainingHard = await tx.issue.count({
      where: {
        uploadId: issue.uploadId,
        severity: "HARD_ERROR",
        status: "OPEN",
      },
    });

    await tx.upload.update({
      where: { id: issue.uploadId },
      data: { status: remainingHard === 0 ? "READY" : "VALIDATED" },
    });

    return out;
  });

  return NextResponse.json({ issue: updated });
}
