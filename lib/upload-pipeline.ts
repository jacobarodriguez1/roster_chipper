import { IssueSeverity, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ALL_EXPECTED_HEADERS,
  analyzeParsedRows,
  buildTeamKey,
  parseRosterCsv,
  type ParsedRosterRow,
} from "@/lib/roster";

function normalizeName(first: string, last: string): string {
  return `${last.trim().toLowerCase()},${first.trim().toLowerCase()}`;
}

function stagedRowsToParsedRows(
  stagedRows: {
    rowNumber: number;
    brigadeNumber: string;
    schoolOrUnit: string;
    category: string;
    division: string;
    teamNumber: string;
    cadetLastName: string;
    cadetFirstName: string;
    cadetRank: string;
    cadetGender: string;
    cadetGrade: string;
  }[],
): ParsedRosterRow[] {
  return stagedRows.map((row) => {
    const normalized = normalizeName(row.cadetFirstName, row.cadetLastName);
    return {
      rowNumber: row.rowNumber,
      brigade_number: row.brigadeNumber,
      school_or_unit: row.schoolOrUnit,
      category: row.category,
      division: row.division,
      team_number: row.teamNumber,
      cadet_last_name: row.cadetLastName,
      cadet_first_name: row.cadetFirstName,
      cadet_rank: row.cadetRank,
      cadet_gender: row.cadetGender,
      cadet_grade: row.cadetGrade,
      normalizedName: normalized,
      canonicalIdentityKey: [
        row.brigadeNumber.trim().toLowerCase(),
        row.division.trim().toLowerCase(),
        normalized,
      ].join("|"),
    };
  });
}

async function rebuildDerivedFromParsedRows(
  tx: Prisma.TransactionClient,
  uploadId: string,
  parsedRows: ParsedRosterRow[],
  stagedRows: { id: string; rowNumber: number }[],
) {
  await tx.scheduleVersion.deleteMany({ where: { uploadId } });
  await tx.issue.deleteMany({ where: { uploadId } });
  await tx.teamMembership.deleteMany({ where: { team: { uploadId } } });
  await tx.team.deleteMany({ where: { uploadId } });
  await tx.cadetIdentity.deleteMany({ where: { uploadId } });

  const identityByKey = new Map<string, string>();
  for (const row of parsedRows) {
    if (!identityByKey.has(row.canonicalIdentityKey)) {
      const identity = await tx.cadetIdentity.create({
        data: {
          uploadId,
          canonicalFirstName: row.cadet_first_name,
          canonicalLastName: row.cadet_last_name,
          normalizedName: row.normalizedName,
          canonicalKey: row.canonicalIdentityKey,
        },
      });
      identityByKey.set(row.canonicalIdentityKey, identity.id);
    }
  }

  const teamByKey = new Map<string, string>();
  for (const row of parsedRows) {
    const key = buildTeamKey(row);
    if (!teamByKey.has(key)) {
      const team = await tx.team.create({
        data: {
          uploadId,
          brigadeNumber: row.brigade_number,
          schoolOrUnit: row.school_or_unit,
          category: row.category,
          division: row.division,
          teamNumber: row.team_number,
          teamKey: key,
        },
      });
      teamByKey.set(key, team.id);
    }
  }

  const stagedRowByNumber = new Map(stagedRows.map((row) => [row.rowNumber, row.id]));

  for (const row of parsedRows) {
    const stagedRowId = stagedRowByNumber.get(row.rowNumber);
    const teamId = teamByKey.get(buildTeamKey(row));
    const cadetIdentityId = identityByKey.get(row.canonicalIdentityKey);
    if (!stagedRowId || !teamId || !cadetIdentityId) continue;

    await tx.teamMembership.create({
      data: {
        teamId,
        cadetIdentityId,
        stagedRowId,
      },
    });
  }

  const analyzed = analyzeParsedRows(parsedRows, [...ALL_EXPECTED_HEADERS]);
  const toIssue = [...analyzed.hardErrors, ...analyzed.warnings, ...analyzed.identityReviews];
  for (const i of toIssue) {
    const stagedRowId =
      i.rowNumber !== undefined ? stagedRowByNumber.get(i.rowNumber) : undefined;
    const cadetIdentityId = i.canonicalIdentityKey
      ? identityByKey.get(i.canonicalIdentityKey)
      : undefined;
    await tx.issue.create({
      data: {
        uploadId,
        stagedRowId,
        cadetIdentityId,
        type: i.type,
        code: i.code,
        severity: i.severity,
        message: i.message,
        detailsJson: i.details ? JSON.stringify(i.details) : undefined,
        brigadeNumber: i.brigadeNumber,
        category: i.category,
        division: i.division,
      },
    });
  }

  const hardErrorCount = await tx.issue.count({
    where: { uploadId, severity: IssueSeverity.HARD_ERROR, status: "OPEN" },
  });
  await tx.upload.update({
    where: { id: uploadId },
    data: {
      rowCount: parsedRows.length,
      status: hardErrorCount === 0 ? "READY" : "VALIDATED",
    },
  });
}

export async function ingestUploadFromCsv(args: { filename: string; csvText: string }) {
  const { filename, csvText } = args;
  const parsed = parseRosterCsv(csvText);

  const upload = await prisma.upload.create({
    data: {
      filename,
      rowCount: parsed.rows.length,
      status: "VALIDATED",
    },
  });

  await prisma.$transaction(async (tx) => {
    const rowCreateData: Prisma.StagedRowCreateManyInput[] = parsed.rows.map((row) => ({
      uploadId: upload.id,
      rowNumber: row.rowNumber,
      brigadeNumber: row.brigade_number,
      schoolOrUnit: row.school_or_unit,
      category: row.category,
      division: row.division,
      teamNumber: row.team_number,
      cadetLastName: row.cadet_last_name,
      cadetFirstName: row.cadet_first_name,
      cadetRank: row.cadet_rank,
      cadetGender: row.cadet_gender,
      cadetGrade: row.cadet_grade,
      normalizedName: row.normalizedName,
    }));
    if (rowCreateData.length > 0) {
      await tx.stagedRow.createMany({ data: rowCreateData });
    }

    const createdRows = await tx.stagedRow.findMany({
      where: { uploadId: upload.id },
      select: { id: true, rowNumber: true },
      orderBy: { rowNumber: "asc" },
    });

    await rebuildDerivedFromParsedRows(tx, upload.id, parsed.rows, createdRows);
  });

  return prisma.upload.findUniqueOrThrow({
    where: { id: upload.id },
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
}

export async function rebuildUploadFromStaging(uploadId: string) {
  await prisma.$transaction(async (tx) => {
    const stagedRows = await tx.stagedRow.findMany({
      where: { uploadId },
      orderBy: { rowNumber: "asc" },
      select: {
        id: true,
        rowNumber: true,
        brigadeNumber: true,
        schoolOrUnit: true,
        category: true,
        division: true,
        teamNumber: true,
        cadetLastName: true,
        cadetFirstName: true,
        cadetRank: true,
        cadetGender: true,
        cadetGrade: true,
      },
    });
    const parsedRows = stagedRowsToParsedRows(stagedRows);
    await rebuildDerivedFromParsedRows(tx, uploadId, parsedRows, stagedRows);
  });
}
