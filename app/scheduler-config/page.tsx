"use client";

import { useEffect, useState } from "react";

type Upload = { id: string; filename: string };
type ScheduleConfig = { id: string; createdAt: string };
type EventBreak = { label: string; start: string; end: string };
type ScheduleStats = {
  judgeReassignmentRate: string;
  totalComboPadTransitions: number;
  totalComboSlots: number;
  projectedFinishMin: number;
  avgFollowOnBufferMin: number;
  cadetConflicts: number;
  internalHoleCount: number;
  categoryDivisionCombinationCount: number;
  laneCount: number;
} | null;

export default function SchedulerConfigPage() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploadId, setUploadId] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("14:00");
  const [padCount, setPadCount] = useState(4);
  const [latestConfig, setLatestConfig] = useState<ScheduleConfig | null>(null);
  const [message, setMessage] = useState("");
  const [categoryDivisionCombinationCount, setCategoryDivisionCombinationCount] = useState(0);
  const [scheduleStats, setScheduleStats] = useState<ScheduleStats>(null);

  // Event breaks (e.g., lunch)
  const [breaks, setBreaks] = useState<EventBreak[]>([]);
  const [newBreakLabel, setNewBreakLabel] = useState("Lunch");
  const [newBreakStart, setNewBreakStart] = useState("12:00");
  const [newBreakEnd, setNewBreakEnd] = useState("13:00");

  async function loadUploads() {
    const res = await fetch("/api/uploads");
    const json = await res.json();
    setUploads(json.uploads ?? []);
    if (!uploadId && json.uploads?.length) {
      setUploadId(json.uploads[0].id);
    }
  }

  useEffect(() => {
    loadUploads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!uploadId) {
      setCategoryDivisionCombinationCount(0);
      return;
    }
    fetch(`/api/uploads/${uploadId}/stats`)
      .then((res) => res.json())
      .then((json) => {
        setCategoryDivisionCombinationCount(Number(json.categoryDivisionCombinationCount ?? 0));
      });
  }, [uploadId]);

  function addBreak() {
    if (!newBreakLabel.trim() || !newBreakStart || !newBreakEnd) return;
    setBreaks((prev) => [...prev, { label: newBreakLabel.trim(), start: newBreakStart, end: newBreakEnd }]);
    setNewBreakLabel("Lunch");
    setNewBreakStart("12:00");
    setNewBreakEnd("13:00");
  }

  function removeBreak(idx: number) {
    setBreaks((prev) => prev.filter((_, i) => i !== idx));
  }

  function hhmmToMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  async function saveConfig() {
    if (!uploadId) return;

    // Build pad blocks from event breaks — applied to ALL pads
    const breakBlocks = breaks.map((b) => ({
      startMin: hhmmToMinutes(b.start),
      endMin: hhmmToMinutes(b.end),
      reason: b.label,
    }));

    // If user hasn't defined pads, auto-generate and attach break blocks
    const pads = Array.from({ length: padCount }, (_, i) => ({
      name: `Pad ${i + 1}`,
      basePad: undefined as string | undefined,
      subLane: undefined as string | undefined,
      laneOrder: i,
      isLocked: false,
      blocks: breakBlocks,
    }));

    const res = await fetch("/api/schedule/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId,
        startTime,
        endTime,
        defaultDuration: 15,
        padCount,
        groupingWeight: 70,
        efficiencyWeight: 30,
        categoryConfigs: [],
        pads,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error ?? "Config save failed");
      return;
    }
    setLatestConfig({ id: json.config.id, createdAt: json.config.createdAt });
    setMessage("Configuration saved.");
  }

  async function generateSchedule() {
    if (!uploadId || !latestConfig) return;
    setMessage("Generating schedule...");
    const res = await fetch("/api/schedule/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId,
        scheduleConfigId: latestConfig.id,
        allowJudgeReassignment: true,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error ?? "Schedule generation failed");
      return;
    }
    const stats = json.schedulingStats;
    setScheduleStats(stats);
    const finishH = Math.floor(stats.projectedFinishMin / 60).toString().padStart(2, "0");
    const finishM = (stats.projectedFinishMin % 60).toString().padStart(2, "0");
    setMessage(
      `Schedule generated. ${stats.categoryDivisionCombinationCount} combos across ${stats.laneCount} pads. Projected finish: ${finishH}:${finishM}. Judge reassignment: ${stats.judgeReassignmentRate}. Avg buffer: ${stats.avgFollowOnBufferMin} min.`,
    );
  }

  const wavesNeeded = Math.ceil(categoryDivisionCombinationCount / Math.max(1, padCount));

  return (
    <div className="grid" style={{ maxWidth: 700 }}>
      <section className="panel">
        <h2>Competition Setup</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          Configure your competition parameters. The scheduler handles the rest.
        </p>

        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ color: "var(--text-secondary)", fontSize: 13, display: "block", marginBottom: 4 }}>
              Dataset
            </label>
            <select value={uploadId} onChange={(e) => setUploadId(e.target.value)} style={{ width: "100%" }}>
              <option value="">Select upload</option>
              {uploads.map((u) => (
                <option key={u.id} value={u.id}>{u.filename}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={{ color: "var(--text-secondary)", fontSize: 13, display: "block", marginBottom: 4 }}>
                Start time (24h)
              </label>
              <input
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="08:00"
                maxLength={5}
                style={{ width: "100%", fontFamily: "monospace" }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={{ color: "var(--text-secondary)", fontSize: 13, display: "block", marginBottom: 4 }}>
                End time (24h)
              </label>
              <input
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="14:00"
                maxLength={5}
                style={{ width: "100%", fontFamily: "monospace" }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={{ color: "var(--text-secondary)", fontSize: 13, display: "block", marginBottom: 4 }}>
                Number of physical pads
              </label>
              <input type="number" value={padCount} min={1} onChange={(e) => setPadCount(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          </div>

          <div style={{ background: "var(--surface-1-5)", borderRadius: 8, padding: "10px 14px" }}>
            <span className="badge ok" style={{ marginRight: 8 }}>Fixed Slot Model</span>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              10 min active competition + 5 min report / transition buffer = 15 min per team
            </span>
          </div>
        </div>
      </section>

      {/* Event Breaks */}
      <section className="panel">
        <h3>Event Breaks</h3>
        <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Add scheduled breaks (e.g., lunch). The algorithm will block these windows on all pads.
        </p>
        {breaks.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {breaks.map((b, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--divider)" }}>
                <span style={{ flex: 1, fontSize: 13 }}><strong>{b.label}</strong> — {b.start} to {b.end}</span>
                <button className="secondary" onClick={() => removeBreak(i)} style={{ padding: "2px 8px", fontSize: 11 }}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ color: "var(--text-secondary)", fontSize: 11, display: "block", marginBottom: 2 }}>Label</label>
            <input value={newBreakLabel} onChange={(e) => setNewBreakLabel(e.target.value)} style={{ width: 100 }} placeholder="Lunch" />
          </div>
          <div>
            <label style={{ color: "var(--text-secondary)", fontSize: 11, display: "block", marginBottom: 2 }}>From (24h)</label>
            <input value={newBreakStart} onChange={(e) => setNewBreakStart(e.target.value)} placeholder="12:00" maxLength={5} style={{ width: 80, fontFamily: "monospace" }} />
          </div>
          <div>
            <label style={{ color: "var(--text-secondary)", fontSize: 11, display: "block", marginBottom: 2 }}>To (24h)</label>
            <input value={newBreakEnd} onChange={(e) => setNewBreakEnd(e.target.value)} placeholder="13:00" maxLength={5} style={{ width: 80, fontFamily: "monospace" }} />
          </div>
          <button className="secondary" onClick={addBreak} style={{ height: 34 }}>Add Break</button>
        </div>
      </section>

      {categoryDivisionCombinationCount > 0 && (
        <section className="panel" style={{ background: "var(--surface-1-25)" }}>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            <strong>{categoryDivisionCombinationCount}</strong> category/division combinations detected.
            With <strong>{padCount}</strong> pads, the scheduler will use approximately <strong>{wavesNeeded}</strong> grouping {wavesNeeded === 1 ? "wave" : "waves"}.
          </p>
          {categoryDivisionCombinationCount > padCount && (
            <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
              More combinations than pads — the scheduler will rotate groupings across waves.
            </p>
          )}
        </section>
      )}

      <section className="panel">
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={saveConfig} disabled={!uploadId}>
            Save Config
          </button>
          <button onClick={generateSchedule} disabled={!latestConfig}>
            Generate Schedule
          </button>
        </div>
        {message && <p style={{ marginTop: 10, fontSize: 13 }}>{message}</p>}
      </section>

      {scheduleStats && (
        <section className="panel">
          <h3>Schedule Metrics</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 10 }}>
            <div style={{ background: "var(--surface-1-5)", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Judge Reassignment Rate</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: Number(scheduleStats.judgeReassignmentRate.replace("%","")) <= 5 ? "var(--ok)" : "var(--warning)" }}>
                {scheduleStats.judgeReassignmentRate}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Target: ≤ 5%</div>
            </div>
            <div style={{ background: "var(--surface-1-5)", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Avg Follow-On Buffer</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{scheduleStats.avgFollowOnBufferMin} min</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Preferred: ≥ 15 min</div>
            </div>
            <div style={{ background: "var(--surface-1-5)", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Cadet Conflicts</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: scheduleStats.cadetConflicts > 0 ? "var(--error)" : "var(--ok)" }}>
                {scheduleStats.cadetConflicts}
              </div>
            </div>
            <div style={{ background: "var(--surface-1-5)", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Projected Finish</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {Math.floor(scheduleStats.projectedFinishMin / 60).toString().padStart(2, "0")}:{(scheduleStats.projectedFinishMin % 60).toString().padStart(2, "0")}
              </div>
            </div>
            <div style={{ background: "var(--surface-1-5)", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Internal Holes</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: scheduleStats.internalHoleCount > 0 ? "var(--warning)" : "var(--ok)" }}>
                {scheduleStats.internalHoleCount}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Target: 0</div>
            </div>
            <div style={{ background: "var(--surface-1-5)", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Pad Transitions</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{scheduleStats.totalComboPadTransitions}</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>of {scheduleStats.totalComboSlots} slots</div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
