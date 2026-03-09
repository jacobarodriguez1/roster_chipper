"use client";

import { useEffect, useMemo, useState } from "react";

type Upload = { id: string; filename: string };
type StatsResponse = {
  source?: string;
  totalTeams: number;
  brigadeCount: number;
  categoryDivisionCombinationCount: number;
  totalCadets?: number;
  multiCategoryCadetCount?: number;
  teamCountDistribution?: Record<number, number>;
  combinations: { key: string; category: string; division: string; teamCount: number }[];
  byBrigade: { brigadeNumber: string; totalTeams: number; counts: Record<string, number> }[];
};

type CadetInput = {
  firstName: string;
  lastName: string;
  rank?: string;
  gender?: string;
  grade?: string;
};

function numericBrigadeCompare(a: string, b: string): number {
  const aNum = Number(a);
  const bNum = Number(b);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
  return a.localeCompare(b, undefined, { numeric: true });
}

export default function StatsPage() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploadId, setUploadId] = useState("");
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [message, setMessage] = useState("");

  const [brigadeNumber, setBrigadeNumber] = useState("");
  const [schoolOrUnit, setSchoolOrUnit] = useState("");
  const [category, setCategory] = useState("");
  const [division, setDivision] = useState("");
  const [teamNumber, setTeamNumber] = useState("");
  const [cadetLines, setCadetLines] = useState("");
  const [sortMode, setSortMode] = useState<"brigade_asc" | "brigade_desc" | "teams_desc">("brigade_asc");
  const [brigadeFilter, setBrigadeFilter] = useState("");

  async function loadUploads() {
    const res = await fetch("/api/uploads");
    const json = await res.json();
    setUploads(json.uploads ?? []);
    if (!uploadId && json.uploads?.length) {
      setUploadId(json.uploads[0].id);
    }
  }

  async function loadStats() {
    if (!uploadId) return;
    const res = await fetch(`/api/uploads/${uploadId}/stats`);
    const json = await res.json();
    setStats(json);
  }

  useEffect(() => {
    loadUploads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  function parseCadets(text: string): CadetInput[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [lastName, firstName, rank, gender, grade] = line.split(",").map((v) => (v ?? "").trim());
        return { firstName, lastName, rank, gender, grade };
      })
      .filter((c) => c.firstName && c.lastName);
  }

  async function addManualTeam() {
    if (!uploadId) return;
    const cadets = parseCadets(cadetLines);
    const res = await fetch(`/api/uploads/${uploadId}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brigadeNumber, schoolOrUnit, category, division, teamNumber, cadets }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error ?? "Could not add team");
      return;
    }
    setMessage("Team added. Reprocessed.");
    setTeamNumber("");
    setCadetLines("");
    await loadStats();
  }

  const filterBrigades = useMemo(() => {
    if (!brigadeFilter.trim()) return [];
    return brigadeFilter.split(",").map((s) => s.trim()).filter(Boolean);
  }, [brigadeFilter]);

  const visibleBrigadeRows = useMemo(() => {
    const rows = [...(stats?.byBrigade ?? [])];
    if (sortMode === "brigade_asc") rows.sort((a, b) => numericBrigadeCompare(a.brigadeNumber, b.brigadeNumber));
    else if (sortMode === "brigade_desc") rows.sort((a, b) => numericBrigadeCompare(b.brigadeNumber, a.brigadeNumber));
    else rows.sort((a, b) => b.totalTeams - a.totalTeams);
    if (filterBrigades.length === 0) return rows;
    return rows.filter((r) => filterBrigades.includes(r.brigadeNumber));
  }, [stats, sortMode, filterBrigades]);

  const teamCountDist = stats?.teamCountDistribution ?? {};
  const distKeys = Object.keys(teamCountDist).map(Number).sort((a, b) => a - b);

  return (
    <div className="stats-page">
      {/* Toolbar */}
      <div className="stats-toolbar">
        <h2>Stats</h2>
        <select value={uploadId} onChange={(e) => setUploadId(e.target.value)}>
          <option value="">Dataset</option>
          {uploads.map((u) => (
            <option key={u.id} value={u.id}>{u.filename}</option>
          ))}
        </select>
        <button className="secondary" onClick={loadStats}>Refresh</button>
        {message && <span className="stats-msg">{message}</span>}
      </div>

      {/* Snapshot cards */}
      <div className="stats-snapshot-row">
        <div className="stats-snapshot-card">
          <h3>Snapshot</h3>
          <div className="stat-line"><span>Brigades</span><strong>{stats?.brigadeCount ?? 0}</strong></div>
          <div className="stat-line"><span>Teams</span><strong>{stats?.totalTeams ?? 0}</strong></div>
          <div className="stat-line"><span>Cadets</span><strong>{stats?.totalCadets ?? 0}</strong></div>
          <div className="stat-line"><span>Combos</span><strong>{stats?.categoryDivisionCombinationCount ?? 0}</strong></div>
        </div>
        <div className="stats-snapshot-card">
          <h3>Combinations</h3>
          <div className="stat-scroll">
            {stats?.combinations.map((c) => (
              <div key={c.key} className="stat-line">
                <span>{c.category}/{c.division}</span>
                <strong>{c.teamCount}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="stats-snapshot-card">
          <h3>Multi-Category Cadets</h3>
          <div className="stat-line"><span>Total multi-team</span><strong>{stats?.multiCategoryCadetCount ?? 0}</strong></div>
          {distKeys.map((count) => (
            <div key={count} className="stat-line">
              <span>In {count} teams</span>
              <strong>{teamCountDist[count]}</strong>
            </div>
          ))}
        </div>
      </div>

      {/* Main body: table + side panel */}
      <div className="stats-body">
        {/* Brigade table */}
        <div className="stats-table-area">
          <div className="stats-table-header">
            <h3>Brigade Entries</h3>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as typeof sortMode)}>
              <option value="brigade_asc">BDE ↑</option>
              <option value="brigade_desc">BDE ↓</option>
              <option value="teams_desc">Teams ↓</option>
            </select>
            <input
              value={brigadeFilter}
              onChange={(e) => setBrigadeFilter(e.target.value)}
              placeholder="Filter: 1,3,5"
            />
            {brigadeFilter && <button className="secondary" onClick={() => setBrigadeFilter("")}>×</button>}
          </div>
          <div className="stats-table-scroll">
            <table className="stats-grid">
              <thead>
                <tr>
                  <th>BDE</th>
                  <th>Total</th>
                  {stats?.combinations.map((c) => (
                    <th key={c.key}>{c.category}/{c.division}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleBrigadeRows.map((b) => (
                  <tr key={b.brigadeNumber}>
                    <td>{b.brigadeNumber}</td>
                    <td style={{ fontWeight: 700 }}>{b.totalTeams}</td>
                    {stats?.combinations.map((c) => {
                      const val = b.counts[c.key] ?? 0;
                      return (
                        <td key={`${b.brigadeNumber}-${c.key}`} className={val === 0 ? "zero" : undefined}>
                          {val}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Side panel: manual entry */}
        <div className="stats-side-panel">
          <div className="stats-manual-entry">
            <h3>Add Manual Team</h3>
            <input value={brigadeNumber} onChange={(e) => setBrigadeNumber(e.target.value)} placeholder="Brigade #" />
            <input value={schoolOrUnit} onChange={(e) => setSchoolOrUnit(e.target.value)} placeholder="School / Unit" />
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" />
            <input value={division} onChange={(e) => setDivision(e.target.value)} placeholder="Division" />
            <input value={teamNumber} onChange={(e) => setTeamNumber(e.target.value)} placeholder="Team #" />
            <textarea
              value={cadetLines}
              onChange={(e) => setCadetLines(e.target.value)}
              placeholder={"Last,First,Rank,G,Grade\nDoe,Jane,CPT,F,11"}
            />
            <button onClick={addManualTeam}>Add Team</button>
          </div>
        </div>
      </div>
    </div>
  );
}
