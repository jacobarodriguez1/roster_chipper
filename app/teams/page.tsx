"use client";

import { useEffect, useMemo, useState } from "react";

type Upload = { id: string; filename: string };
type StagedRow = {
  id: string;
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
};
type Team = {
  id: string;
  brigadeNumber: string;
  schoolOrUnit: string;
  category: string;
  division: string;
  teamNumber: string;
  memberships: {
    id: string;
    cadetIdentity: { canonicalFirstName: string; canonicalLastName: string };
    stagedRow: StagedRow;
  }[];
};

/**
 * CACC CR 3-8 prescribed team sizes by category (case-insensitive match).
 * min/max define the normal range. Outside = anomaly.
 */
const TEAM_SIZE_RULES: { pattern: RegExp; min: number; max: number }[] = [
  { pattern: /color\s*guard/i, min: 4, max: 4 },
  { pattern: /individual/i, min: 1, max: 1 },
  { pattern: /dual/i, min: 2, max: 2 },
  { pattern: /squad/i, min: 8, max: 12 },
  { pattern: /platoon/i, min: 13, max: 30 },
  { pattern: /exhibition/i, min: 1, max: 30 },
  { pattern: /inspection/i, min: 4, max: 30 },
];

function getTeamSizeAnomaly(category: string, size: number): { label: string; badge: string } | null {
  const rule = TEAM_SIZE_RULES.find((r) => r.pattern.test(category));
  if (!rule) {
    if (size < 4) return { label: `Small (${size}/${4}+)`, badge: "warning" };
    return null;
  }
  if (size < rule.min) return { label: `Under min (${size}/${rule.min})`, badge: "warning" };
  if (size > rule.max) return { label: `Over max (${size}/${rule.max})`, badge: "warning" };
  return null;
}

function numericBrigadeCompare(a: string, b: string): number {
  const aNum = Number(a);
  const bNum = Number(b);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
  return a.localeCompare(b, undefined, { numeric: true });
}

export default function TeamsPage() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploadId, setUploadId] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [brigade, setBrigade] = useState("");
  const [category, setCategory] = useState("");
  const [division, setDivision] = useState("");
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);

  async function loadUploads() {
    const res = await fetch("/api/uploads");
    const json = await res.json();
    setUploads(json.uploads ?? []);
    if (!uploadId && json.uploads?.length) {
      setUploadId(json.uploads[0].id);
    }
  }

  async function loadTeams() {
    if (!uploadId) return;
    const params = new URLSearchParams();
    if (brigade) params.set("brigade", brigade);
    if (category) params.set("category", category);
    if (division) params.set("division", division);
    const res = await fetch(`/api/uploads/${uploadId}/teams?${params.toString()}`);
    const json = await res.json();
    setTeams(json.teams ?? []);
  }

  useEffect(() => {
    loadUploads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const distinct = useMemo(
    () => ({
      brigades: [...new Set(teams.map((t) => t.brigadeNumber))].sort(numericBrigadeCompare),
      categories: [...new Set(teams.map((t) => t.category))].sort(),
      divisions: [...new Set(teams.map((t) => t.division))].sort(),
    }),
    [teams],
  );

  const sortedTeams = useMemo(
    () =>
      [...teams].sort((a, b) => {
        const bCmp = numericBrigadeCompare(a.brigadeNumber, b.brigadeNumber);
        if (bCmp !== 0) return bCmp;
        const catCmp = a.category.localeCompare(b.category);
        if (catCmp !== 0) return catCmp;
        const divCmp = a.division.localeCompare(b.division);
        if (divCmp !== 0) return divCmp;
        return a.teamNumber.localeCompare(b.teamNumber, undefined, { numeric: true });
      }),
    [teams],
  );

  function toggleDrawer(teamId: string) {
    setOpenTeamId((prev) => (prev === teamId ? null : teamId));
  }

  return (
    <div className="grid">
      <section className="panel">
        <h2>Teams</h2>
        <div className="row" style={{ marginTop: 10 }}>
          <select value={uploadId} onChange={(e) => setUploadId(e.target.value)}>
            <option value="">Select upload</option>
            {uploads.map((u) => (
              <option key={u.id} value={u.id}>
                {u.filename}
              </option>
            ))}
          </select>
          <select value={brigade} onChange={(e) => setBrigade(e.target.value)}>
            <option value="">All brigades</option>
            {distinct.brigades.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {distinct.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={division} onChange={(e) => setDivision(e.target.value)}>
            <option value="">All divisions</option>
            {distinct.divisions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button className="secondary" onClick={loadTeams}>
            Apply filters
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>Grouped Team View</h3>
        <table>
          <thead>
            <tr>
              <th>Brigade</th>
              <th>Unit</th>
              <th>Category / Division</th>
              <th>Team #</th>
              <th>Team Size</th>
              <th>Anomalies</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map((team) => {
              const anomaly = getTeamSizeAnomaly(team.category, team.memberships.length);
              const isOpen = openTeamId === team.id;
              return (
                <>
                  <tr key={team.id}>
                    <td>{team.brigadeNumber}</td>
                    <td>{team.schoolOrUnit}</td>
                    <td>
                      {team.category} / {team.division}
                    </td>
                    <td>{team.teamNumber}</td>
                    <td>{team.memberships.length}</td>
                    <td>
                      {anomaly ? (
                        <span className={`badge ${anomaly.badge}`}>{anomaly.label}</span>
                      ) : (
                        <span className="badge ok">Normal</span>
                      )}
                    </td>
                    <td>
                      <button className="secondary" onClick={() => toggleDrawer(team.id)}>
                        {isOpen ? "Close" : "Details"}
                      </button>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr key={`${team.id}-detail`}>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <div style={{ padding: "10px 14px", background: "var(--surface-1-5)", borderTop: "1px solid var(--divider)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <strong style={{ fontSize: 13 }}>
                              {team.category}/{team.division} Team {team.teamNumber} — Members
                            </strong>
                            <button className="secondary" onClick={() => setOpenTeamId(null)} style={{ padding: "3px 8px", fontSize: 11 }}>
                              Close
                            </button>
                          </div>
                          <table style={{ fontSize: 13 }}>
                            <thead>
                              <tr>
                                <th>Last Name</th>
                                <th>First Name</th>
                                <th>Rank</th>
                                <th>Gender</th>
                                <th>Grade</th>
                              </tr>
                            </thead>
                            <tbody>
                              {team.memberships.map((m) => (
                                <tr key={m.id}>
                                  <td>{m.stagedRow.cadetLastName}</td>
                                  <td>{m.stagedRow.cadetFirstName}</td>
                                  <td>{m.stagedRow.cadetRank || "—"}</td>
                                  <td>{m.stagedRow.cadetGender || "—"}</td>
                                  <td>{m.stagedRow.cadetGrade || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
