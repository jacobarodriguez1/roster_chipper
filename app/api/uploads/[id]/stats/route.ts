import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id: uploadId } = await params;

  const stagedRows = await prisma.stagedRow.findMany({
    where: { uploadId },
    select: {
      brigadeNumber: true,
      category: true,
      division: true,
      teamNumber: true,
      cadetFirstName: true,
      cadetLastName: true,
    },
    orderBy: [
      { brigadeNumber: "asc" },
      { category: "asc" },
      { division: "asc" },
      { teamNumber: "asc" },
    ],
  });

  const stagingTeamEntries = [
    ...new Set(
      stagedRows.map(
        (row) =>
          `${row.brigadeNumber.trim()}|${row.category.trim()}|${row.division.trim()}|${row.teamNumber.trim()}`,
      ),
    ),
  ].map((key) => {
    const [brigadeNumber, category, division, teamNumber] = key.split("|");
    return { brigadeNumber, category, division, teamNumber };
  });

  const brigades = [...new Set(stagingTeamEntries.map((t) => t.brigadeNumber))];
  const combinations = [...new Set(stagingTeamEntries.map((t) => `${t.category}|${t.division}`))];

  const byBrigade = brigades.map((brigadeNumber) => {
    const brigadeTeams = stagingTeamEntries.filter((t) => t.brigadeNumber === brigadeNumber);
    const counts: Record<string, number> = {};
    for (const combo of combinations) {
      const [category, division] = combo.split("|");
      counts[combo] = brigadeTeams.filter(
        (team) => team.category === category && team.division === division,
      ).length;
    }
    return {
      brigadeNumber,
      totalTeams: brigadeTeams.length,
      counts,
    };
  });

  // Multi-category cadet analysis
  const cadetTeamMap = new Map<string, Set<string>>();
  for (const row of stagedRows) {
    const cadetKey = `${row.brigadeNumber.trim().toLowerCase()}|${row.cadetLastName.trim().toLowerCase()}|${row.cadetFirstName.trim().toLowerCase()}`;
    const teamKey = `${row.category.trim()}|${row.division.trim()}|${row.teamNumber.trim()}`;
    const teams = cadetTeamMap.get(cadetKey) ?? new Set<string>();
    teams.add(teamKey);
    cadetTeamMap.set(cadetKey, teams);
  }

  let multiCategoryCadetCount = 0;
  const teamCountDistribution: Record<number, number> = {};
  for (const [, teams] of cadetTeamMap) {
    if (teams.size > 1) {
      multiCategoryCadetCount++;
      teamCountDistribution[teams.size] = (teamCountDistribution[teams.size] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    totalTeams: stagingTeamEntries.length,
    brigadeCount: brigades.length,
    categoryDivisionCombinationCount: combinations.length,
    source: "staged_rows",
    combinations: combinations.map((key) => {
      const [category, division] = key.split("|");
      return {
        key,
        category,
        division,
        teamCount: stagingTeamEntries.filter((t) => `${t.category}|${t.division}` === key).length,
      };
    }),
    byBrigade,
    multiCategoryCadetCount,
    teamCountDistribution,
    totalCadets: cadetTeamMap.size,
  });
}
