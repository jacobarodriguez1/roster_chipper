"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hhmmToMinutes, minutesToHhmm } from "@/lib/time";

type Upload = { id: string; filename: string };
type ScheduleData = {
  configs: { id: string; createdAt: string }[];
  versions: {
    id: string;
    createdAt: string;
    scheduleConfig: {
      startTime: string;
      pads: {
        id: string;
        name: string;
        isLocked: boolean;
        blocks: { id: string; startMin: number; endMin: number; reason: string }[];
      }[];
    };
    slots: {
      id: string;
      startMin: number;
      endMin: number;
      padId: string;
      isLocked: boolean;
      notes: string | null;
      pad: { id: string; name: string };
      team: {
        id: string;
        brigadeNumber: string;
        schoolOrUnit: string;
        category: string;
        division: string;
        teamNumber: string;
        memberships: {
          cadetIdentityId: string;
          cadetIdentity: { canonicalFirstName: string; canonicalLastName: string };
        }[];
      };
    }[];
  }[];
};

type MatrixSlot = ScheduleData["versions"][number]["slots"][number];

type SlotRisk = {
  label: "Safe" | "Warning" | "Conflict";
  worstGapMin: number | null;
  affectedCadets: number;
  overlaps: number;
  judgeContinuityDisrupted: boolean;
  cadetsDueSoon: number;
  earliestNextReportMin: number | null;
  cadetFollowOns: {
    cadetName: string;
    nextAssignment: string;
    nextPad: string;
    nextTime: string;
    minutesUntilReport: number;
    status: "Safe" | "Warning" | "Conflict";
  }[];
};

function comboKey(slot: MatrixSlot): string {
  return `${slot.team.category}|${slot.team.division}`;
}

function intervalOverlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function getRiskClass(risk: SlotRisk | undefined): string {
  if (!risk) return "";
  if (risk.overlaps > 0) return "risk-critical";
  if (risk.worstGapMin !== null && risk.worstGapMin <= 0) return "risk-critical";
  if (risk.worstGapMin !== null && risk.worstGapMin < 5) return "risk-high";
  if (risk.worstGapMin !== null && risk.worstGapMin < 10) return "risk-medium";
  if (risk.worstGapMin !== null && risk.worstGapMin < 15) return "risk-low";
  return "";
}

export default function MatrixPage() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploadId, setUploadId] = useState("");
  const [data, setData] = useState<ScheduleData | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [message, setMessage] = useState("");
  const [breakPadId, setBreakPadId] = useState("");
  const [breakStart, setBreakStart] = useState(120);
  const [breakEnd, setBreakEnd] = useState(135);
  const [breakReason, setBreakReason] = useState("Manual break");
  const [draggingSlotId, setDraggingSlotId] = useState("");
  const [activeDropTarget, setActiveDropTarget] = useState<{ padId: string; startMin: number } | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [workingSlots, setWorkingSlots] = useState<MatrixSlot[]>([]);
  const [historyPast, setHistoryPast] = useState<MatrixSlot[][]>([]);
  const [historyFuture, setHistoryFuture] = useState<MatrixSlot[][]>([]);
  const [configCollapsed, setConfigCollapsed] = useState(true);
  const [dropTargetValid, setDropTargetValid] = useState<boolean | null>(null);
  const [justDroppedId, setJustDroppedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorPinned, setInspectorPinned] = useState(false);

  // Assign-to-slot state
  const [assignPadId, setAssignPadId] = useState("");
  const [assignTime, setAssignTime] = useState("");

  async function loadUploads() {
    const res = await fetch("/api/uploads");
    const json = await res.json();
    setUploads(json.uploads ?? []);
    if (!uploadId && json.uploads?.length) {
      setUploadId(json.uploads[0].id);
    }
  }

  async function loadSchedule() {
    if (!uploadId) return;
    const res = await fetch(`/api/schedule?uploadId=${uploadId}`);
    const json = await res.json();
    setData(json);
    if (!selectedVersionId && json.versions?.length) {
      setSelectedVersionId(json.versions[0].id);
    }
  }

  useEffect(() => {
    loadUploads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const selectedVersion = useMemo(
    () => data?.versions.find((v) => v.id === selectedVersionId) ?? null,
    [data, selectedVersionId],
  );

  useEffect(() => {
    if (!selectedVersion) {
      setWorkingSlots([]);
      setHistoryPast([]);
      setHistoryFuture([]);
      return;
    }
    setWorkingSlots(selectedVersion.slots.map((slot) => ({ ...slot })));
    setHistoryPast([]);
    setHistoryFuture([]);
  }, [selectedVersion]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && inspectorOpen && !inspectorPinned) {
        setInspectorOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inspectorOpen, inspectorPinned]);

  const lanes = useMemo(() => {
    if (!selectedVersion) return [];
    return selectedVersion.scheduleConfig.pads.map((pad) => ({
      id: pad.id,
      name: pad.name,
      isLocked: pad.isLocked,
      blocks: pad.blocks,
    }));
  }, [selectedVersion]);

  // Slot times are stored in absolute minutes (e.g. 480 = 08:00), no offset needed for display
  const startOffset = 0;

  // Build time rows from all slots
  const timeRows = useMemo(() => {
    if (workingSlots.length === 0) return [];
    const minStart = Math.min(...workingSlots.map((s) => s.startMin));
    const maxEnd = Math.max(...workingSlots.map((s) => s.endMin));
    const rows: number[] = [];
    for (let t = minStart; t < maxEnd; t += 15) {
      rows.push(t);
    }
    return rows;
  }, [workingSlots]);

  // Map of padId -> startMin -> slot
  const slotGrid = useMemo(() => {
    const grid = new Map<string, Map<number, MatrixSlot>>();
    workingSlots.forEach((slot) => {
      if (!grid.has(slot.padId)) grid.set(slot.padId, new Map());
      grid.get(slot.padId)!.set(slot.startMin, slot);
    });
    return grid;
  }, [workingSlots]);

  const buildRiskMap = useCallback(function buildRiskMap(slots: MatrixSlot[]): Map<string, SlotRisk> {
    const out = new Map<string, SlotRisk>();
    const byCombo = new Map<string, MatrixSlot[]>();
    slots.forEach((slot) => {
      const key = comboKey(slot);
      const list = byCombo.get(key) ?? [];
      list.push(slot);
      byCombo.set(key, list);
    });

    for (const slot of slots) {
      const cadetFollowOns: SlotRisk["cadetFollowOns"] = [];
      const affectedCadetIds = new Set<string>();
      let overlapCount = 0;
      let worstGapMin: number | null = null;
      let earliestNextReportMin: number | null = null;
      let cadetsDueSoon = 0;

      for (const membership of slot.team.memberships) {
        const cadetId = membership.cadetIdentityId;
        const next = slots
          .filter(
            (s) =>
              s.id !== slot.id &&
              s.startMin >= slot.startMin &&
              s.team.memberships.some((m) => m.cadetIdentityId === cadetId),
          )
          .sort((a, b) => a.startMin - b.startMin)[0];
        if (!next) continue;

        const minutesUntilReport = next.startMin - slot.endMin;
        const status: SlotRisk["cadetFollowOns"][number]["status"] =
          minutesUntilReport <= 0 ? "Conflict" : minutesUntilReport < 15 ? "Warning" : "Safe";
        if (status === "Conflict") overlapCount += 1;
        if (minutesUntilReport <= 30) cadetsDueSoon += 1;
        affectedCadetIds.add(cadetId);
        worstGapMin =
          worstGapMin === null ? minutesUntilReport : Math.min(worstGapMin, minutesUntilReport);
        earliestNextReportMin =
          earliestNextReportMin === null
            ? next.startMin
            : Math.min(earliestNextReportMin, next.startMin);

        cadetFollowOns.push({
          cadetName: `${membership.cadetIdentity.canonicalLastName}, ${membership.cadetIdentity.canonicalFirstName}`,
          nextAssignment: `${next.team.category} / ${next.team.division}`,
          nextPad: next.pad.name,
          nextTime: `${minutesToHhmm(next.startMin + startOffset)}\u2013${minutesToHhmm(next.endMin + startOffset)}`,
          minutesUntilReport,
          status,
        });
      }

      const comboSlots = [...(byCombo.get(comboKey(slot)) ?? [])].sort(
        (a, b) => a.startMin - b.startMin,
      );
      const comboIndex = comboSlots.findIndex((s) => s.id === slot.id);
      const prevCombo = comboIndex > 0 ? comboSlots[comboIndex - 1] : null;
      const nextCombo =
        comboIndex >= 0 && comboIndex < comboSlots.length - 1 ? comboSlots[comboIndex + 1] : null;
      const judgeContinuityDisrupted =
        (prevCombo ? prevCombo.padId !== slot.padId : false) ||
        (nextCombo ? nextCombo.padId !== slot.padId : false);

      const label: SlotRisk["label"] =
        overlapCount > 0 ? "Conflict" : worstGapMin !== null && worstGapMin < 15 ? "Warning" : "Safe";

      out.set(slot.id, {
        label,
        worstGapMin,
        affectedCadets: affectedCadetIds.size,
        overlaps: overlapCount,
        judgeContinuityDisrupted,
        cadetsDueSoon,
        earliestNextReportMin,
        cadetFollowOns,
      });
    }
    return out;
  }, [startOffset]);

  const riskMap = useMemo(() => buildRiskMap(workingSlots), [workingSlots, buildRiskMap]);

  const selectedSlot = useMemo(
    () => workingSlots.find((slot) => slot.id === selectedSlotId) ?? null,
    [workingSlots, selectedSlotId],
  );

  function applyLocalChange(nextSlots: MatrixSlot[]) {
    setHistoryPast((prev) => [...prev, workingSlots]);
    setHistoryFuture([]);
    setWorkingSlots(nextSlots);
  }

  const isPlacementValid = useCallback(
    (slot: MatrixSlot, candidatePadId: string, candidateStart: number, slots: MatrixSlot[]) => {
      const candidateEnd = candidateStart + 15;
      const candidatePad = lanes.find((lane) => lane.id === candidatePadId);
      if (!candidatePad) return false;

      const padBlocked = candidatePad.blocks.some((block) =>
        intervalOverlaps(candidateStart, candidateEnd, block.startMin, block.endMin),
      );
      if (padBlocked) return false;

      const others = slots.filter((s) => s.id !== slot.id);
      const padOverlap = others.some(
        (s) => s.padId === candidatePadId && intervalOverlaps(candidateStart, candidateEnd, s.startMin, s.endMin),
      );
      if (padOverlap) return false;

      const cadetOverlap = others.some((s) => {
        if (!intervalOverlaps(candidateStart, candidateEnd, s.startMin, s.endMin)) return false;
        const ids = new Set(slot.team.memberships.map((m) => m.cadetIdentityId));
        return s.team.memberships.some((m) => ids.has(m.cadetIdentityId));
      });
      if (cadetOverlap) return false;

      const sameComboParallel = others.some((s) => {
        if (!intervalOverlaps(candidateStart, candidateEnd, s.startMin, s.endMin)) return false;
        return comboKey(s) === comboKey(slot);
      });
      if (sameComboParallel) return false;

      return true;
    },
    [lanes],
  );

  async function patchSlot(
    slotId: string,
    payload: Partial<{ padId: string; startMin: number; endMin: number; isLocked: boolean }>,
  ) {
    const res = await fetch(`/api/schedule/slots/${slotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const json = await res.json();
      throw new Error(json.error ?? "Slot update failed");
    }
  }

  function downloadTextFile(filename: string, contents: string, mimeType: string) {
    const blob = new Blob([contents], { type: mimeType });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(href);
  }

  async function downloadOperationsCsv() {
    if (!selectedVersionId) return;
    const res = await fetch(`/api/schedule/${selectedVersionId}/export`);
    const json = await res.json();
    downloadTextFile(`operations_${selectedVersionId.slice(0, 8)}.csv`, json.operationsCsv, "text/csv;charset=utf-8");
    setMessage("Operations CSV downloaded.");
  }

  async function downloadDrillBoardJson() {
    if (!selectedVersionId) return;
    const res = await fetch(`/api/schedule/${selectedVersionId}/export`);
    const json = await res.json();
    downloadTextFile(
      `drill_board_${selectedVersionId.slice(0, 8)}.json`,
      JSON.stringify(json.drillBoardJson, null, 2),
      "application/json;charset=utf-8",
    );
    setMessage("Drill Board JSON downloaded.");
  }

  async function insertBreak() {
    if (!breakPadId) return;
    const res = await fetch(`/api/schedule/pads/${breakPadId}/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startMin: breakStart,
        endMin: breakEnd,
        reason: breakReason,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error ?? "Failed to insert break");
      return;
    }
    setMessage(`Break inserted on pad ${breakPadId}`);
    await loadSchedule();
  }

  async function toggleLaneLock(padId: string, current: boolean) {
    await fetch(`/api/schedule/pads/${padId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isLocked: !current }),
    });
    await loadSchedule();
  }

  async function handleDropToCell(targetPadId: string, targetStartMin: number) {
    if (!draggingSlotId) return;
    const targetLane = lanes.find((lane) => lane.id === targetPadId);
    if (targetLane?.isLocked) {
      setMessage("Cannot drop into a locked lane.");
      setActiveDropTarget(null);
      return;
    }
    const slot = workingSlots.find((s) => s.id === draggingSlotId);
    if (!slot) return;
    if (slot.isLocked) {
      setMessage("Locked team cannot be moved.");
      setActiveDropTarget(null);
      return;
    }
    if (!isPlacementValid(slot, targetPadId, targetStartMin, workingSlots)) {
      setMessage("Invalid move blocked (conflict/continuity/pad collision).");
      setActiveDropTarget(null);
      return;
    }
    const nextSlots = workingSlots.map((s) =>
      s.id === slot.id ? { ...s, padId: targetPadId, startMin: targetStartMin, endMin: targetStartMin + 15 } : s,
    );
    applyLocalChange(nextSlots);
    setJustDroppedId(slot.id);
    setTimeout(() => setJustDroppedId(null), 350);
    try {
      await patchSlot(slot.id, { padId: targetPadId, startMin: targetStartMin, endMin: targetStartMin + 15 });
      setMessage("Slot reassigned.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Move failed");
    }
    setDraggingSlotId("");
    setActiveDropTarget(null);
  }

  function undo() {
    if (historyPast.length === 0) return;
    const prev = historyPast[historyPast.length - 1];
    setHistoryPast((h) => h.slice(0, -1));
    setHistoryFuture((f) => [workingSlots, ...f]);
    setWorkingSlots(prev);
    setMessage("Undid last change.");
  }

  function redo() {
    if (historyFuture.length === 0) return;
    const next = historyFuture[0];
    setHistoryFuture((f) => f.slice(1));
    setHistoryPast((h) => [...h, workingSlots]);
    setWorkingSlots(next);
    setMessage("Redid change.");
  }

  async function toggleCardLock(slot: MatrixSlot) {
    const next = workingSlots.map((s) => (s.id === slot.id ? { ...s, isLocked: !s.isLocked } : s));
    applyLocalChange(next);
    try {
      await patchSlot(slot.id, { isLocked: !slot.isLocked });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lock change failed");
    }
  }

  async function persistAllChangedSlots(nextSlots: MatrixSlot[]) {
    const prevById = new Map(workingSlots.map((slot) => [slot.id, slot]));
    const changed = nextSlots.filter((slot) => {
      const prev = prevById.get(slot.id);
      return prev && (prev.padId !== slot.padId || prev.startMin !== slot.startMin || prev.isLocked !== slot.isLocked);
    });
    for (const slot of changed) {
      await patchSlot(slot.id, { padId: slot.padId, startMin: slot.startMin, endMin: slot.endMin, isLocked: slot.isLocked });
    }
  }

  function aggregateMetrics(slots: MatrixSlot[], map: Map<string, SlotRisk>) {
    return {
      conflicts: slots.filter((s) => map.get(s.id)?.label === "Conflict").length,
      warnings: slots.filter((s) => map.get(s.id)?.label === "Warning").length,
      finish: slots.length ? Math.max(...slots.map((s) => s.endMin)) : 0,
      continuityPenalty: slots.filter((s) => map.get(s.id)?.judgeContinuityDisrupted).length,
    };
  }

  async function optimizeUnlocked() {
    const beforeMap = buildRiskMap(workingSlots);
    const before = aggregateMetrics(workingSlots, beforeMap);
    let optimized = [...workingSlots].map((slot) => ({ ...slot }));
    const unlocked = optimized.filter((slot) => !slot.isLocked);
    unlocked.sort((a, b) => {
      const la = beforeMap.get(a.id)?.label;
      const lb = beforeMap.get(b.id)?.label;
      const rank = (label?: string) => (label === "Conflict" ? 2 : label === "Warning" ? 1 : 0);
      return rank(lb) - rank(la);
    });

    const start = Math.min(...optimized.map((s) => s.startMin));
    const end = Math.max(...optimized.map((s) => s.endMin)) + 120;

    for (const slot of unlocked) {
      const current = optimized.find((s) => s.id === slot.id);
      if (!current) continue;
      let best = { padId: current.padId, startMin: current.startMin, score: Number.POSITIVE_INFINITY };
      for (const lane of lanes) {
        if (lane.isLocked) continue;
        for (let t = start; t <= end; t += 15) {
          if (!isPlacementValid(current, lane.id, t, optimized)) continue;
          const candidate = optimized.map((s) =>
            s.id === current.id ? { ...s, padId: lane.id, startMin: t, endMin: t + 15 } : s,
          );
          const risk = buildRiskMap(candidate).get(current.id);
          if (!risk) continue;
          // Priority: 1) No cadet overlap  2) Judge continuity  3) 15-min buffer  4) Finish within window
          const riskPenalty = risk.label === "Conflict" ? 50000 : risk.label === "Warning" ? 2000 : 0;
          const continuityPenalty = risk.judgeContinuityDisrupted ? 5000 : 0;
          const gapPenalty = risk.worstGapMin !== null ? Math.max(0, 15 - risk.worstGapMin) * 20 : 0;
          const timePenalty = (t - start) * 0.1;
          const score = riskPenalty + continuityPenalty + gapPenalty + timePenalty;
          if (score < best.score) best = { padId: lane.id, startMin: t, score };
        }
      }
      optimized = optimized.map((s) =>
        s.id === current.id ? { ...s, padId: best.padId, startMin: best.startMin, endMin: best.startMin + 15 } : s,
      );
    }

    applyLocalChange(optimized);
    try {
      await persistAllChangedSlots(optimized);
      const afterMap = buildRiskMap(optimized);
      const after = aggregateMetrics(optimized, afterMap);
      setMessage(
        `${Math.max(0, before.conflicts - after.conflicts)} conflict risks reduced, ${Math.max(
          0,
          before.warnings - after.warnings,
        )} warning gaps improved, ${Math.max(0, before.finish - after.finish)} minutes removed, judge continuity improved for ${Math.max(
          0,
          before.continuityPenalty - after.continuityPenalty,
        )} slots.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Optimize failed");
    }
  }

  // Assign-to-slot: force place a team at a specific pad+time, displacing any occupant
  async function forceAssignSlot() {
    if (!selectedSlot || !assignPadId || !assignTime) return;
    const targetStartMin = hhmmToMinutes(assignTime) - startOffset;
    const targetEndMin = targetStartMin + 15;

    // Find any existing slot at that position
    const displaced = workingSlots.find(
      (s) => s.id !== selectedSlot.id && s.padId === assignPadId && s.startMin === targetStartMin,
    );

    let nextSlots = workingSlots.map((s) =>
      s.id === selectedSlot.id
        ? { ...s, padId: assignPadId, startMin: targetStartMin, endMin: targetEndMin, isLocked: true }
        : s,
    );

    if (displaced && !displaced.isLocked) {
      // Find first available slot for displaced team
      const allStart = Math.min(...nextSlots.map((s) => s.startMin));
      const allEnd = Math.max(...nextSlots.map((s) => s.endMin)) + 120;
      let found = false;
      for (const lane of lanes) {
        if (lane.isLocked) continue;
        for (let t = allStart; t <= allEnd; t += 15) {
          if (isPlacementValid(displaced, lane.id, t, nextSlots)) {
            nextSlots = nextSlots.map((s) =>
              s.id === displaced.id ? { ...s, padId: lane.id, startMin: t, endMin: t + 15 } : s,
            );
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) {
        setMessage("Could not find alternative placement for displaced team.");
        return;
      }
    } else if (displaced && displaced.isLocked) {
      setMessage("Target slot is occupied by a locked team. Cannot displace.");
      return;
    }

    applyLocalChange(nextSlots);
    try {
      await persistAllChangedSlots(nextSlots);
      setMessage(`Team assigned to ${assignTime} on ${lanes.find((l) => l.id === assignPadId)?.name ?? assignPadId} and locked.${displaced ? " Displaced team relocated." : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Assignment failed");
    }
    setAssignPadId("");
    setAssignTime("");
  }

  const suggestedMoves = useMemo(() => {
    if (!selectedSlot || workingSlots.length === 0) return [];
    const suggestions: { padId: string; padName: string; startMin: number; text: string; why: string }[] = [];
    const start = Math.min(...workingSlots.map((s) => s.startMin));
    const end = Math.max(...workingSlots.map((s) => s.endMin)) + 60;
    for (const lane of lanes) {
      if (lane.isLocked) continue;
      for (let t = start; t <= end; t += 15) {
        if (!isPlacementValid(selectedSlot, lane.id, t, workingSlots)) continue;
        const candidate = workingSlots.map((s) =>
          s.id === selectedSlot.id ? { ...s, padId: lane.id, startMin: t, endMin: t + 15 } : s,
        );
        const risk = buildRiskMap(candidate).get(selectedSlot.id);
        if (!risk) continue;
        const reasons = [];
        if (risk.label === "Safe") reasons.push("larger cadet gap");
        if (!risk.judgeContinuityDisrupted) reasons.push("better judge continuity");
        if (t < selectedSlot.startMin) reasons.push("earlier finish");
        suggestions.push({
          padId: lane.id,
          padName: lane.name,
          startMin: t,
          text: `${lane.name} ${minutesToHhmm(t + startOffset)}\u2013${minutesToHhmm(t + 15 + startOffset)}`,
          why: reasons.join(", ") || "alternative",
        });
      }
    }
    return suggestions.slice(0, 5);
  }, [selectedSlot, lanes, workingSlots, isPlacementValid, startOffset, buildRiskMap]);

  function handleCellDragEnter(padId: string, startMin: number) {
    if (!draggingSlotId) return;
    const slot = workingSlots.find((s) => s.id === draggingSlotId);
    if (!slot || slot.isLocked) {
      setActiveDropTarget(null);
      setDropTargetValid(null);
      return;
    }
    const lane = lanes.find((l) => l.id === padId);
    if (lane?.isLocked) {
      setActiveDropTarget({ padId, startMin });
      setDropTargetValid(false);
      return;
    }
    const valid = isPlacementValid(slot, padId, startMin, workingSlots);
    setActiveDropTarget({ padId, startMin });
    setDropTargetValid(valid);
  }

  function handleCellDragLeave() {
    setActiveDropTarget(null);
    setDropTargetValid(null);
  }

  return (
    <div className="matrix-layout">
      <div className="matrix-main">
        {/* Command bar */}
        <div className={`matrix-config-bar ${configCollapsed ? "matrix-config-collapsed" : ""}`}>
          <div className="row" style={{ flex: 1, flexWrap: "wrap" }}>
            <select value={uploadId} onChange={(e) => setUploadId(e.target.value)} style={{ fontSize: 12 }}>
              <option value="">Select upload</option>
              {uploads.map((u) => (
                <option key={u.id} value={u.id}>{u.filename}</option>
              ))}
            </select>
            <select value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)} style={{ fontSize: 12 }}>
              <option value="">Select version</option>
              {data?.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {new Date(v.createdAt).toLocaleString()} ({v.id.slice(0, 8)})
                </option>
              ))}
            </select>
            <button className="secondary" onClick={loadSchedule} style={{ fontSize: 12, padding: "4px 8px" }}>Refresh</button>
            <button className="secondary" onClick={undo} disabled={historyPast.length === 0} style={{ fontSize: 12, padding: "4px 8px" }}>Undo</button>
            <button className="secondary" onClick={redo} disabled={historyFuture.length === 0} style={{ fontSize: 12, padding: "4px 8px" }}>Redo</button>
            <button onClick={optimizeUnlocked} style={{ fontSize: 12, padding: "4px 8px" }}>Optimize</button>
            <button onClick={downloadOperationsCsv} disabled={!selectedVersionId} style={{ fontSize: 12, padding: "4px 8px" }}>CSV</button>
            <button onClick={downloadDrillBoardJson} disabled={!selectedVersionId} style={{ fontSize: 12, padding: "4px 8px" }}>JSON</button>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
            {workingSlots.length} teams · {workingSlots.filter((s) => s.isLocked).length} locked
          </span>
          <button
            className="secondary"
            onClick={() => setInspectorOpen((o) => !o)}
            style={{ padding: "4px 8px", fontSize: 11 }}
          >
            {inspectorOpen ? "Hide Panel" : "Inspector"}
          </button>
          <button
            className="secondary"
            onClick={() => setConfigCollapsed((c) => !c)}
            style={{ padding: "4px 8px", fontSize: 11 }}
          >
            {configCollapsed ? "Config \u25BC" : "Config \u25B2"}
          </button>
        </div>
        <div className="matrix-config-details" style={{ display: configCollapsed ? "none" : "block" }}>
          <div className="panel" style={{ margin: 8, marginTop: 0 }}>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Insert break:</span>
              <select value={breakPadId} onChange={(e) => setBreakPadId(e.target.value)} style={{ fontSize: 12 }}>
                <option value="">Pad</option>
                {selectedVersion?.scheduleConfig.pads.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input type="number" value={breakStart} onChange={(e) => setBreakStart(Number(e.target.value))} style={{ width: 55, fontSize: 12 }} />
              <input type="number" value={breakEnd} onChange={(e) => setBreakEnd(Number(e.target.value))} style={{ width: 55, fontSize: 12 }} />
              <input value={breakReason} onChange={(e) => setBreakReason(e.target.value)} placeholder="Reason" style={{ width: 100, fontSize: 12 }} />
              <button onClick={insertBreak} style={{ fontSize: 12, padding: "4px 8px" }}>Insert</button>
            </div>
            <div className="row" style={{ marginTop: 6, flexWrap: "wrap", gap: 6 }}>
              {selectedVersion?.scheduleConfig.pads.map((pad) => (
                <button key={pad.id} className="secondary" onClick={() => toggleLaneLock(pad.id, pad.isLocked)} style={{ padding: "3px 8px", fontSize: 11 }}>
                  {pad.name}: {pad.isLocked ? "Unlock" : "Lock"}
                </button>
              ))}
            </div>
          </div>
        </div>
        {message && <p className="muted" style={{ padding: "3px 10px", margin: 0, fontSize: 12 }}>{message}</p>}

        {/* Board — time-axis table */}
        <div className="matrix-board">
          <table className="matrix-grid-table">
            <thead>
              <tr>
                <th style={{ minWidth: 52 }}>Time</th>
                {lanes.map((lane) => (
                  <th key={lane.id}>
                    {lane.name}
                    {lane.isLocked && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--cacc-gold)" }}>Locked</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeRows.map((timeMin) => (
                <tr key={timeMin}>
                  <td className="matrix-time-cell">
                    {minutesToHhmm(timeMin + startOffset)}
                  </td>
                  {lanes.map((lane) => {
                    const slot = slotGrid.get(lane.id)?.get(timeMin);
                    const isDropHere = activeDropTarget?.padId === lane.id && activeDropTarget?.startMin === timeMin;
                    const isValidDrop = isDropHere && dropTargetValid === true;
                    const isInvalidDrop = isDropHere && dropTargetValid === false;

                    return (
                      <td
                        key={lane.id}
                        className={`matrix-pad-cell ${isValidDrop ? "drag-over-valid" : ""} ${isInvalidDrop ? "drag-over-invalid" : ""}`}
                        onDragOver={(e) => e.preventDefault()}
                        onDragEnter={() => handleCellDragEnter(lane.id, timeMin)}
                        onDragLeave={handleCellDragLeave}
                        onDrop={() => { handleDropToCell(lane.id, timeMin); setDropTargetValid(null); }}
                      >
                        {slot ? (() => {
                          const risk = riskMap.get(slot.id);
                          const riskClass = getRiskClass(risk);
                          const isSelected = selectedSlotId === slot.id;
                          const isDragging = draggingSlotId === slot.id;
                          const isJustDropped = justDroppedId === slot.id;
                          return (
                            <div
                              className={`matrix-slot-card ${riskClass} ${isSelected ? "matrix-slot-selected" : ""} ${slot.isLocked ? "matrix-slot-locked" : ""} ${isDragging ? "matrix-slot-dragging" : ""} ${isJustDropped ? "matrix-slot-just-dropped" : ""}`}
                              draggable={!slot.isLocked}
                              onDragStart={() => setDraggingSlotId(slot.id)}
                              onDragEnd={() => { setDraggingSlotId(""); setActiveDropTarget(null); setDropTargetValid(null); }}
                              onClick={() => { setSelectedSlotId(slot.id); setInspectorOpen(true); }}
                            >
                              <div style={{ fontWeight: 600 }}>
                                BDE {slot.team.brigadeNumber} {"\u2013"} {slot.team.schoolOrUnit}
                                {slot.isLocked && <span className="lock-badge">Locked</span>}
                              </div>
                              <div style={{ fontSize: 11, color: "#555", marginTop: 1 }}>
                                {slot.team.category} {slot.team.division && `\u00B7 ${slot.team.division}`}
                              </div>
                            </div>
                          );
                        })() : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspector drawer */}
      <aside className={`matrix-inspector ${inspectorOpen ? "inspector-open" : ""}`}>
        <div className="matrix-inspector-header">
          <h3>Inspector</h3>
          <div className="matrix-inspector-actions">
            <button
              className={inspectorPinned ? "active" : ""}
              onClick={() => setInspectorPinned((p) => !p)}
              title={inspectorPinned ? "Unpin panel" : "Pin panel open"}
            >
              {inspectorPinned ? "Pinned" : "Pin"}
            </button>
            <button onClick={() => setInspectorOpen(false)} title="Close inspector">{"\u00D7"}</button>
          </div>
        </div>
        <div className="matrix-inspector-content">
          {selectedSlot ? (
            <>
              <h4 style={{ margin: "0 0 10px", fontSize: "0.85rem", color: "var(--text-primary)" }}>Team Overview</h4>
              <dl style={{ margin: 0, fontSize: 12 }}>
                <dt style={{ color: "var(--text-tertiary)", marginTop: 6, fontSize: 11 }}>BDE</dt>
                <dd style={{ margin: "1px 0 0" }}>{selectedSlot.team.brigadeNumber}</dd>
                <dt style={{ color: "var(--text-tertiary)", marginTop: 6, fontSize: 11 }}>School / Unit</dt>
                <dd style={{ margin: "1px 0 0" }}>{selectedSlot.team.schoolOrUnit}</dd>
                <dt style={{ color: "var(--text-tertiary)", marginTop: 6, fontSize: 11 }}>Category / Division</dt>
                <dd style={{ margin: "1px 0 0" }}>{selectedSlot.team.category} / {selectedSlot.team.division}</dd>
                <dt style={{ color: "var(--text-tertiary)", marginTop: 6, fontSize: 11 }}>Pad</dt>
                <dd style={{ margin: "1px 0 0" }}>{selectedSlot.pad.name}</dd>
                <dt style={{ color: "var(--text-tertiary)", marginTop: 6, fontSize: 11 }}>Time</dt>
                <dd style={{ margin: "1px 0 0" }}>
                  {minutesToHhmm(selectedSlot.startMin + startOffset)}{"\u2013"}{minutesToHhmm(selectedSlot.endMin + startOffset)}
                </dd>
              </dl>

              <button
                className={selectedSlot.isLocked ? "" : "secondary"}
                onClick={() => toggleCardLock(selectedSlot)}
                style={{ marginTop: 12, width: "100%", fontSize: 12, padding: "6px 10px" }}
              >
                {selectedSlot.isLocked ? "Unlock Team Placement" : "Lock Team Placement"}
              </button>
              {selectedSlot.isLocked && (
                <p style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 3 }}>
                  This team is locked. Optimize will not move it.
                </p>
              )}

              {/* Force assign to specific slot */}
              <h4 style={{ marginTop: 16, marginBottom: 5, fontSize: "0.82rem", color: "var(--text-primary)" }}>Assign to Slot</h4>
              <p style={{ fontSize: 10, color: "var(--text-tertiary)", marginBottom: 6 }}>
                Force this team to a specific time and pad. Displaced teams are relocated automatically.
              </p>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <select value={assignPadId} onChange={(e) => setAssignPadId(e.target.value)} style={{ fontSize: 11, flex: 1 }}>
                  <option value="">Pad</option>
                  {lanes.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <input
                  type="time"
                  value={assignTime}
                  onChange={(e) => setAssignTime(e.target.value)}
                  style={{ fontSize: 11, flex: 1 }}
                />
                <button
                  onClick={forceAssignSlot}
                  disabled={!assignPadId || !assignTime}
                  style={{ fontSize: 11, padding: "4px 8px" }}
                >
                  Assign
                </button>
              </div>

              <h4 style={{ marginTop: 16, marginBottom: 5, fontSize: "0.82rem", color: "var(--text-primary)" }}>Follow-On Reporting Risk</h4>
              {(() => {
                const risk = riskMap.get(selectedSlot.id);
                const followOns = risk?.cadetFollowOns ?? [];
                return (
                  <>
                    <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "7px 9px", marginBottom: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                        <span>Next Report Risk</span>
                        <span className={`badge ${risk?.label === "Conflict" ? "error" : risk?.label === "Warning" ? "warning" : "neutral"}`} style={{ fontSize: 10 }}>
                          {risk?.label ?? "Safe"}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 3 }}>
                        <span>Tightest Buffer</span>
                        <span style={{ fontWeight: 600 }}>{risk?.worstGapMin ?? "\u2014"} min</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 3 }}>
                        <span>Cadets Due Elsewhere Soon</span>
                        <span style={{ fontWeight: 600 }}>{risk?.cadetsDueSoon ?? 0}</span>
                      </div>
                      {risk?.earliestNextReportMin != null && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 3 }}>
                          <span>Earliest Follow-On</span>
                          <span style={{ fontWeight: 600 }}>{minutesToHhmm(risk.earliestNextReportMin + startOffset)}</span>
                        </div>
                      )}
                    </div>
                    {followOns.length > 0 ? (
                      <table style={{ fontSize: 10 }}>
                        <thead>
                          <tr>
                            <th style={{ padding: 3 }}>Cadet</th>
                            <th style={{ padding: 3 }}>Next</th>
                            <th style={{ padding: 3 }}>Pad</th>
                            <th style={{ padding: 3 }}>Buffer</th>
                            <th style={{ padding: 3 }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {followOns.map((c, i) => (
                            <tr key={`${c.cadetName}-${i}`}>
                              <td style={{ padding: 3 }}>{c.cadetName}</td>
                              <td style={{ padding: 3 }}>{c.nextAssignment}</td>
                              <td style={{ padding: 3 }}>{c.nextPad}</td>
                              <td style={{ padding: 3 }}>{c.minutesUntilReport} min</td>
                              <td style={{ padding: 3 }}>
                                <span className={`badge ${c.status === "Conflict" ? "error" : c.status === "Warning" ? "warning" : "neutral"}`} style={{ fontSize: 10 }}>
                                  {c.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>No cadets with upcoming follow-on assignments.</p>
                    )}
                  </>
                );
              })()}

              <h4 style={{ marginTop: 16, marginBottom: 5, fontSize: "0.82rem", color: "var(--text-primary)" }}>Judge Impact</h4>
              {(() => {
                const risk = riskMap.get(selectedSlot.id);
                const disrupted = risk?.judgeContinuityDisrupted ?? false;
                return (
                  <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "7px 9px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span>Judge Continuity</span>
                      <span className={`badge ${disrupted ? "warning" : "neutral"}`} style={{ fontSize: 10 }}>
                        {disrupted ? "Disrupted" : "Preserved"}
                      </span>
                    </div>
                    <p style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 3 }}>
                      {disrupted
                        ? "Moving this slot may force judge reassignment or fragment a category/division stream."
                        : "Judge continuity preserved for this category/division on this pad."}
                    </p>
                  </div>
                );
              })()}

              <h4 style={{ marginTop: 16, marginBottom: 5, fontSize: "0.82rem", color: "var(--text-primary)" }}>Suggested Moves</h4>
              {suggestedMoves.length === 0 ? (
                <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>No better alternatives found.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {suggestedMoves.map((move) => (
                    <button
                      key={`${move.padId}-${move.startMin}`}
                      className="secondary"
                      style={{ textAlign: "left", padding: "6px 8px", fontSize: 11 }}
                      onClick={async () => {
                        if (!selectedSlot) return;
                        const next = workingSlots.map((s) =>
                          s.id === selectedSlot.id ? { ...s, padId: move.padId, startMin: move.startMin, endMin: move.startMin + 15 } : s,
                        );
                        applyLocalChange(next);
                        try {
                          await patchSlot(selectedSlot.id, { padId: move.padId, startMin: move.startMin, endMin: move.startMin + 15 });
                          setMessage("Slot moved.");
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : "Move failed");
                        }
                      }}
                    >
                      <strong>{move.text}</strong>
                      <br />
                      <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{move.why}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="matrix-inspector-empty">
              Select a slot to inspect details.
            </div>
          )}
        </div>
        <div className="matrix-inspector-footer">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span>Total teams</span>
            <span style={{ fontWeight: 600 }}>{workingSlots.length}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span>Locked</span>
            <span style={{ fontWeight: 600 }}>{workingSlots.filter((s) => s.isLocked).length}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span><span className="badge error" style={{ fontSize: 9 }}>Conflict</span></span>
            <span style={{ fontWeight: 600 }}>{workingSlots.filter((s) => riskMap.get(s.id)?.label === "Conflict").length}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span><span className="badge warning" style={{ fontSize: 9 }}>Warning</span></span>
            <span style={{ fontWeight: 600 }}>{workingSlots.filter((s) => riskMap.get(s.id)?.label === "Warning").length}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Projected finish</span>
            <span style={{ fontWeight: 600 }}>
              {workingSlots.length ? minutesToHhmm(Math.max(...workingSlots.map((s) => s.endMin)) + startOffset) : "\u2014"}
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}
