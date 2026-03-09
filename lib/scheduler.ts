import { type CategoryConfig, type Pad, type PadBlock, type Team, type TeamMembership } from "@prisma/client";

type TeamWithMembers = Team & {
  memberships: (TeamMembership & { cadetIdentityId: string })[];
};

type Lane = Pad & { blocks: PadBlock[] };

export type GeneratedSlot = {
  teamId: string;
  padId: string;
  startMin: number;
  endMin: number;
};

export type ScheduleMetrics = {
  judgeReassignmentRate: number;
  totalComboPadTransitions: number;
  totalComboSlots: number;
  projectedFinishMin: number;
  avgFollowOnBufferMin: number;
  cadetConflicts: number;
  internalHoleCount: number;
};

const PREFERRED_BUFFER_MIN = 15;

function intervalOverlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function findDuration(
  team: Team,
  defaultDuration: number,
  categoryConfigs: CategoryConfig[],
): number {
  const exact = categoryConfigs.find(
    (c) =>
      c.category.toLowerCase() === team.category.toLowerCase() &&
      (c.division?.toLowerCase() ?? "") === team.division.toLowerCase(),
  );
  if (exact) return exact.durationMinutes;
  const categoryOnly = categoryConfigs.find(
    (c) => c.category.toLowerCase() === team.category.toLowerCase() && !c.division,
  );
  return categoryOnly?.durationMinutes ?? defaultDuration;
}

function laneBlockedAt(lane: Lane, start: number, end: number): boolean {
  return lane.blocks.some((b) => intervalOverlaps(start, end, b.startMin, b.endMin));
}

function teamsShareCadet(a: TeamWithMembers, b: TeamWithMembers): boolean {
  const aSet = new Set(a.memberships.map((m) => m.cadetIdentityId));
  return b.memberships.some((m) => aSet.has(m.cadetIdentityId));
}

function teamCategoryKey(team: Team): string {
  return `${team.category}|${team.division}`;
}

function sharedCadetIds(a: TeamWithMembers, b: TeamWithMembers): string[] {
  const aSet = new Set(a.memberships.map((m) => m.cadetIdentityId));
  return b.memberships.filter((m) => aSet.has(m.cadetIdentityId)).map((m) => m.cadetIdentityId);
}

// A continuous block of non-break time on a lane
type TimeSegment = { start: number; end: number };

/**
 * Compute the continuous time segments for a lane within [startMin, endMin],
 * splitting at blocked intervals (breaks).
 */
function computeSegments(lane: Lane, startMin: number, endMin: number, slotDuration: number): TimeSegment[] {
  const sortedBlocks = [...lane.blocks].sort((a, b) => a.startMin - b.startMin);
  const segments: TimeSegment[] = [];
  let cursor = startMin;

  for (const block of sortedBlocks) {
    if (block.startMin > cursor) {
      segments.push({ start: cursor, end: Math.min(block.startMin, endMin) });
    }
    cursor = Math.max(cursor, block.endMin);
  }
  if (cursor < endMin) {
    segments.push({ start: cursor, end: endMin });
  }

  // Only keep segments that can fit at least one slot
  return segments.filter((seg) => seg.end - seg.start >= slotDuration);
}

function slotCapacity(segment: TimeSegment, slotDuration: number): number {
  return Math.floor((segment.end - segment.start) / slotDuration);
}

/**
 * Skip forward past any blocked intervals to find the next usable start time.
 */
function nextUnblockedStart(lane: Lane, from: number, duration: number, endMin: number): number | null {
  for (let t = from; t + duration <= endMin; t += 1) {
    if (!laneBlockedAt(lane, t, t + duration)) return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// MAIN SCHEDULER — "Judge-first" approach
//
// 1. Calculate judge math: bin-pack combos onto pads by capacity & affinity
// 2. Order combos within each pad (largest first)
// 3. Round-robin sequential fill, respecting cadet constraints
// 4. Overflow & compaction
// ---------------------------------------------------------------------------

export function generateSchedule(args: {
  teams: TeamWithMembers[];
  lanes: Lane[];
  defaultDuration: number;
  categoryConfigs: CategoryConfig[];
  startMin?: number;
  endMin?: number;
  categoryDivisionCombinationCount?: number;
  maxCombinationsPerJudgingStation?: number;
  allowJudgeReassignment?: boolean;
}): { slots: GeneratedSlot[]; metrics: ScheduleMetrics } {
  const {
    teams,
    lanes,
    defaultDuration,
    categoryConfigs,
    startMin = 0,
    endMin = 17 * 60,
  } = args;

  if (teams.length === 0 || lanes.length === 0) {
    return {
      slots: [],
      metrics: { judgeReassignmentRate: 0, totalComboPadTransitions: 0, totalComboSlots: 0, projectedFinishMin: startMin, avgFollowOnBufferMin: 0, cadetConflicts: 0, internalHoleCount: 0 },
    };
  }

  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const slots: GeneratedSlot[] = [];
  const scheduled = new Set<string>();

  // Build cadet→teams index
  const cadetToTeams = new Map<string, Set<string>>();
  for (const team of teams) {
    for (const m of team.memberships) {
      const set = cadetToTeams.get(m.cadetIdentityId) ?? new Set();
      set.add(team.id);
      cadetToTeams.set(m.cadetIdentityId, set);
    }
  }

  // Group teams by category/division combo
  const comboTeams = new Map<string, TeamWithMembers[]>();
  for (const team of teams) {
    const key = teamCategoryKey(team);
    const list = comboTeams.get(key) ?? [];
    list.push(team);
    comboTeams.set(key, list);
  }
  const sortedCombos = [...comboTeams.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  const activeLanes = lanes.filter((l) => !l.isLocked);

  // Build combo cadet sets for affinity calculation
  const comboCadetSets = new Map<string, Set<string>>();
  for (const [ck, ct] of sortedCombos) {
    const cadets = new Set<string>();
    for (const t of ct) for (const m of t.memberships) cadets.add(m.cadetIdentityId);
    comboCadetSets.set(ck, cadets);
  }

  function cOverlap(a: string, b: string): number {
    const sa = comboCadetSets.get(a);
    const sb = comboCadetSets.get(b);
    if (!sa || !sb) return 0;
    let n = 0;
    for (const id of sa) if (sb.has(id)) n++;
    return n;
  }

  // ===================================================================
  // PHASE 1: JUDGE PANEL PLANNING
  //
  // Capacity-aware First-Fit-Decreasing bin-packing.
  // Each pad has a slot capacity (total available minutes / slotDuration).
  // Each combo needs N slots (one per team).
  // Pack combos onto pads so:
  //   - each pad's assigned teams ≤ pad capacity
  //   - minimize judge transitions (fewer combos per pad)
  //   - co-locate combos sharing cadets (reduces cross-pad conflicts)
  // ===================================================================

  const padSlotCapacity = new Map<string, number>();
  for (const lane of activeLanes) {
    const segs = computeSegments(lane, startMin, endMin, defaultDuration);
    padSlotCapacity.set(
      lane.id,
      segs.reduce((s, seg) => s + slotCapacity(seg, defaultDuration), 0),
    );
  }

  const comboAssignment = new Map<string, string>();
  const padCombos = new Map<string, string[]>();
  const padUsedSlots = new Map<string, number>();
  for (const lane of activeLanes) {
    padCombos.set(lane.id, []);
    padUsedSlots.set(lane.id, 0);
  }

  for (const [ck, ct] of sortedCombos) {
    const need = ct.length;
    let bestPad = activeLanes[0];
    let bestScore = -Infinity;

    for (const lane of activeLanes) {
      const remaining = (padSlotCapacity.get(lane.id) ?? 0) - (padUsedSlots.get(lane.id) ?? 0);
      const fits = remaining >= need;
      const capacityPenalty = fits ? 0 : -100000;

      const existing = padCombos.get(lane.id)!;
      // Fewer combos per pad = fewer judge transitions (strong preference)
      const transitionPenalty = -(existing.length * 5000);

      // Affinity: shared cadets with combos already on this pad
      let aff = 0;
      for (const eck of existing) aff += cOverlap(ck, eck);
      const affinityBonus = aff * 200;

      // Prefer emptier pads for balance
      const balanceBonus = remaining * 10;

      // Tight-fit: combo nearly fills remaining → minimal waste
      const waste = remaining - need;
      const fitBonus = waste >= 0 && waste <= 4 ? 1000 : 0;

      const score = capacityPenalty + transitionPenalty + affinityBonus + balanceBonus + fitBonus;
      if (score > bestScore) {
        bestScore = score;
        bestPad = lane;
      }
    }

    comboAssignment.set(ck, bestPad.id);
    padCombos.get(bestPad.id)!.push(ck);
    padUsedSlots.set(bestPad.id, (padUsedSlots.get(bestPad.id) ?? 0) + need);
  }

  // ===================================================================
  // PHASE 2: ORDER COMBOS WITHIN EACH PAD
  //
  // Larger combo first — judges spend the longest uninterrupted stretch
  // on the biggest category, then switch once to a smaller one.
  //
  // Within each combo, order teams so the least-constrained (fewest
  // cross-pad cadet links) go first — easy to place, leaving flexibility
  // for the harder teams.
  // ===================================================================

  const laneComboQueue = new Map<string, string[]>();
  for (const lane of activeLanes) {
    const combos = [...padCombos.get(lane.id)!];
    combos.sort(
      (a, b) => (comboTeams.get(b)?.length ?? 0) - (comboTeams.get(a)?.length ?? 0),
    );
    laneComboQueue.set(lane.id, combos);
  }

  const comboTeamOrder = new Map<string, TeamWithMembers[]>();
  for (const [ck, ct] of comboTeams) {
    const scored = ct.map((team) => {
      let crossLinks = 0;
      for (const m of team.memberships) {
        const ts = cadetToTeams.get(m.cadetIdentityId);
        if (ts && ts.size > 1) crossLinks += ts.size - 1;
      }
      return { team, crossLinks };
    });
    scored.sort((a, b) => a.crossLinks - b.crossLinks);
    comboTeamOrder.set(ck, scored.map((x) => x.team));
  }

  // ===================================================================
  // PHASE 3: ROUND-ROBIN SEQUENTIAL FILL
  //
  // Pick the pad with the earliest cursor. Place the next team from
  // that pad's current combo. Only consider teams from the current
  // combo (preserving judge continuity). When a combo is done, advance
  // to the next combo on that pad (one judge transition).
  //
  // On cadet conflict, try other teams in the same combo. If none fit,
  // advance cursor by 1 minute.
  // ===================================================================

  const laneCursor = new Map<string, number>();
  const laneComboIdx = new Map<string, number>();

  for (const lane of activeLanes) {
    const segs = computeSegments(lane, startMin, endMin, defaultDuration);
    laneCursor.set(lane.id, segs.length > 0 ? segs[0].start : endMin);
    laneComboIdx.set(lane.id, 0);
  }

  let maxIter = teams.length * activeLanes.length * 10;
  while (scheduled.size < teams.length && maxIter-- > 0) {
    let bestLane: Lane | null = null;
    let bestCur = Infinity;
    for (const lane of activeLanes) {
      const c = laneCursor.get(lane.id)!;
      if (c >= endMin) continue;
      if (c < bestCur) { bestCur = c; bestLane = lane; }
    }
    if (!bestLane) break;

    const lane = bestLane;
    const cursor = laneCursor.get(lane.id)!;
    const cIdx = laneComboIdx.get(lane.id) ?? 0;
    const cQueue = laneComboQueue.get(lane.id) ?? [];

    if (cIdx >= cQueue.length) {
      laneCursor.set(lane.id, endMin);
      continue;
    }

    const curCK = cQueue[cIdx];
    const orderedTeams = comboTeamOrder.get(curCK) ?? [];
    const unplaced = orderedTeams.filter((t) => !scheduled.has(t.id));

    if (unplaced.length === 0) {
      laneComboIdx.set(lane.id, cIdx + 1);
      continue;
    }

    const ubs = nextUnblockedStart(lane, cursor, defaultDuration, endMin);
    if (ubs === null) { laneCursor.set(lane.id, endMin); continue; }
    if (ubs > cursor) { laneCursor.set(lane.id, ubs); continue; }
    const slotStart = ubs;

    let placed = false;
    for (const team of unplaced) {
      const dur = findDuration(team, defaultDuration, categoryConfigs);
      const slotEnd = slotStart + dur;
      if (slotEnd > endMin) continue;
      if (laneBlockedAt(lane, slotStart, slotEnd)) continue;

      if (slots.some((s) => s.padId === lane.id && intervalOverlaps(slotStart, slotEnd, s.startMin, s.endMin))) continue;

      let cadetConflict = false;
      for (const s of slots) {
        if (!intervalOverlaps(slotStart, slotEnd, s.startMin, s.endMin)) continue;
        const ot = teamMap.get(s.teamId);
        if (ot && teamsShareCadet(team, ot)) { cadetConflict = true; break; }
      }
      if (cadetConflict) continue;

      let cpConflict = false;
      for (const s of slots) {
        if (s.padId === lane.id) continue;
        if (!intervalOverlaps(slotStart, slotEnd, s.startMin, s.endMin)) continue;
        const ot = teamMap.get(s.teamId);
        if (ot && teamCategoryKey(ot) === curCK) { cpConflict = true; break; }
      }
      if (cpConflict) continue;

      slots.push({ teamId: team.id, padId: lane.id, startMin: slotStart, endMin: slotEnd });
      scheduled.add(team.id);
      laneCursor.set(lane.id, slotEnd);
      placed = true;
      break;
    }

    if (!placed) {
      laneCursor.set(lane.id, slotStart + 1);
    }
  }

  // ===================================================================
  // PHASE 4: OVERFLOW
  // Any team that couldn't be placed on its assigned pad (due to
  // cadet conflicts or capacity) goes to any valid slot on any pad.
  // ===================================================================
  if (scheduled.size < teams.length) {
    for (const team of teams) {
      if (scheduled.has(team.id)) continue;
      const dur = findDuration(team, defaultDuration, categoryConfigs);
      let placed = false;
      for (let m = startMin; m + dur <= endMin && !placed; m++) {
        for (const lane of activeLanes) {
          if (laneBlockedAt(lane, m, m + dur)) continue;
          if (slots.some((s) => s.padId === lane.id && intervalOverlaps(m, m + dur, s.startMin, s.endMin))) continue;
          let cc = false;
          for (const s of slots) {
            if (!intervalOverlaps(m, m + dur, s.startMin, s.endMin)) continue;
            const ot = teamMap.get(s.teamId);
            if (ot && teamsShareCadet(team, ot)) { cc = true; break; }
          }
          if (cc) continue;
          const ck = teamCategoryKey(team);
          let cp = false;
          for (const s of slots) {
            if (!intervalOverlaps(m, m + dur, s.startMin, s.endMin)) continue;
            const ot = teamMap.get(s.teamId);
            if (ot && teamCategoryKey(ot) === ck) { cp = true; break; }
          }
          if (cp) continue;
          slots.push({ teamId: team.id, padId: lane.id, startMin: m, endMin: m + dur });
          scheduled.add(team.id);
          placed = true;
          break;
        }
      }
    }
  }

  // ===================================================================
  // PHASE 5: COMPACTION — fill internal holes
  // ===================================================================
  compactHoles(slots, lanes, teams, teamMap, scheduled, defaultDuration, categoryConfigs, startMin, endMin, comboAssignment, cadetToTeams);

  const metrics = computeMetrics(slots, teams, teamMap, comboAssignment, startMin, lanes, defaultDuration);
  return { slots, metrics };
}

// ---------------------------------------------------------------------------
// Build list of teams that can legally be placed at (slotStart) on (lane)
// ---------------------------------------------------------------------------
function buildCandidateList(
  slotStart: number,
  lane: Lane,
  slots: GeneratedSlot[],
  teams: TeamWithMembers[],
  teamMap: Map<string, TeamWithMembers>,
  scheduled: Set<string>,
  defaultDuration: number,
  categoryConfigs: CategoryConfig[],
  endMin: number,
): TeamWithMembers[] {
  const candidates: TeamWithMembers[] = [];

  for (const team of teams) {
    if (scheduled.has(team.id)) continue;
    const duration = findDuration(team, defaultDuration, categoryConfigs);
    const slotEnd = slotStart + duration;
    if (slotEnd > endMin) continue;
    if (laneBlockedAt(lane, slotStart, slotEnd)) continue;

    const laneConflict = slots.some(
      (s) => s.padId === lane.id && intervalOverlaps(slotStart, slotEnd, s.startMin, s.endMin),
    );
    if (laneConflict) continue;

    let cadetConflict = false;
    for (const s of slots) {
      if (!intervalOverlaps(slotStart, slotEnd, s.startMin, s.endMin)) continue;
      const other = teamMap.get(s.teamId);
      if (other && teamsShareCadet(team, other)) { cadetConflict = true; break; }
    }
    if (cadetConflict) continue;

    const ck = teamCategoryKey(team);
    let comboParallel = false;
    for (const s of slots) {
      if (!intervalOverlaps(slotStart, slotEnd, s.startMin, s.endMin)) continue;
      const other = teamMap.get(s.teamId);
      if (other && teamCategoryKey(other) === ck) { comboParallel = true; break; }
    }
    if (comboParallel) continue;

    candidates.push(team);
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Score candidates: combo continuity > follow-on buffer > judge movement
// ---------------------------------------------------------------------------
function scoreCandidates(
  candidates: TeamWithMembers[],
  slotStart: number,
  lane: Lane,
  slots: GeneratedSlot[],
  teamMap: Map<string, TeamWithMembers>,
  comboAssignment: Map<string, string>,
  currentLaneCombo: string | null | undefined,
  cadetToTeams: Map<string, Set<string>>,
  scheduled: Set<string>,
  defaultDuration: number,
  categoryConfigs: CategoryConfig[],
): TeamWithMembers {
  let best = candidates[0];
  let bestScore = -Infinity;

  for (const team of candidates) {
    let score = 0;
    const ck = teamCategoryKey(team);
    const duration = findDuration(team, defaultDuration, categoryConfigs);
    const slotEnd = slotStart + duration;

    // +10000: combo matches this lane's current stream (judge stays in place)
    if (currentLaneCombo && ck === currentLaneCombo) {
      score += 10000;
    }

    // +5000: combo is assigned to this lane
    if (comboAssignment.get(ck) === lane.id) {
      score += 5000;
    }

    // +500 to +2000: follow-on buffer quality
    const cadetIds = new Set(team.memberships.map((m) => m.cadetIdentityId));
    let worstBuffer = Infinity;
    for (const s of slots) {
      const other = teamMap.get(s.teamId);
      if (!other) continue;
      const shared = sharedCadetIds(team, other);
      if (shared.length === 0) continue;
      const gapAfter = s.startMin >= slotEnd ? s.startMin - slotEnd : Infinity;
      const gapBefore = slotStart >= s.endMin ? slotStart - s.endMin : Infinity;
      const gap = Math.min(gapAfter, gapBefore);
      if (gap < worstBuffer) worstBuffer = gap;
    }
    if (worstBuffer >= PREFERRED_BUFFER_MIN) {
      score += 2000;
    } else if (worstBuffer >= 10) {
      score += 1500;
    } else if (worstBuffer >= 5) {
      score += 1000;
    } else if (worstBuffer >= 0) {
      score += 500;
    }

    // Penalty: cross-combo cadet entanglements
    let crossCount = 0;
    for (const cid of cadetIds) {
      const teamSet = cadetToTeams.get(cid);
      if (teamSet) {
        for (const tid of teamSet) {
          if (tid !== team.id && !scheduled.has(tid)) crossCount++;
        }
      }
    }
    score -= crossCount * 50;

    score -= slotStart * 0.001;

    if (score > bestScore) {
      bestScore = score;
      best = team;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Compaction: fill internal holes
// ---------------------------------------------------------------------------
function compactHoles(
  slots: GeneratedSlot[],
  lanes: Lane[],
  teams: TeamWithMembers[],
  teamMap: Map<string, TeamWithMembers>,
  scheduled: Set<string>,
  defaultDuration: number,
  categoryConfigs: CategoryConfig[],
  startMin: number,
  endMin: number,
  comboAssignment: Map<string, string>,
  cadetToTeams: Map<string, Set<string>>,
): void {
  for (const lane of lanes) {
    if (lane.isLocked) continue;
    const laneSlots = slots
      .filter((s) => s.padId === lane.id)
      .sort((a, b) => a.startMin - b.startMin);
    if (laneSlots.length < 2) continue;

    for (let i = 0; i < laneSlots.length - 1; i++) {
      const gapStart = laneSlots[i].endMin;
      const gapEnd = laneSlots[i + 1].startMin;
      if (gapEnd <= gapStart) continue;
      if (laneBlockedAt(lane, gapStart, gapEnd)) continue;

      const unscheduledExist = teams.some((t) => !scheduled.has(t.id));
      if (!unscheduledExist) continue;

      const candidates = buildCandidateList(
        gapStart, lane, slots, teams, teamMap, scheduled, defaultDuration, categoryConfigs, endMin,
      );
      if (candidates.length === 0) continue;

      const currentCombo = teamCategoryKey(teamMap.get(laneSlots[i].teamId)!);
      const best = scoreCandidates(
        candidates, gapStart, lane, slots, teamMap, comboAssignment, currentCombo, cadetToTeams, scheduled, defaultDuration, categoryConfigs,
      );

      const duration = findDuration(best, defaultDuration, categoryConfigs);
      if (gapStart + duration <= gapEnd) {
        slots.push({ teamId: best.id, padId: lane.id, startMin: gapStart, endMin: gapStart + duration });
        scheduled.add(best.id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Count internal holes on active lanes
// ---------------------------------------------------------------------------
function countInternalHoles(
  slots: GeneratedSlot[],
  lanes: Lane[],
  defaultDuration: number,
): number {
  let holes = 0;
  for (const lane of lanes) {
    if (lane.isLocked) continue;
    const laneSlots = slots
      .filter((s) => s.padId === lane.id)
      .sort((a, b) => a.startMin - b.startMin);
    if (laneSlots.length < 2) continue;

    for (let i = 0; i < laneSlots.length - 1; i++) {
      const gapStart = laneSlots[i].endMin;
      const gapEnd = laneSlots[i + 1].startMin;
      if (gapEnd <= gapStart) continue;
      if (laneBlockedAt(lane, gapStart, gapStart + defaultDuration)) continue;
      const gapSlots = Math.floor((gapEnd - gapStart) / defaultDuration);
      holes += gapSlots;
    }
  }
  return holes;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
function computeMetrics(
  slots: GeneratedSlot[],
  teams: TeamWithMembers[],
  teamMap: Map<string, TeamWithMembers>,
  comboAssignment: Map<string, string>,
  startMin: number,
  lanes: Lane[],
  defaultDuration: number,
): ScheduleMetrics {
  let totalComboPadTransitions = 0;
  let totalComboSlots = 0;

  const comboSlotPads = new Map<string, string[]>();
  for (const slot of slots) {
    const team = teamMap.get(slot.teamId);
    if (!team) continue;
    const key = teamCategoryKey(team);
    const list = comboSlotPads.get(key) ?? [];
    list.push(slot.padId);
    comboSlotPads.set(key, list);
  }

  for (const [, pads] of comboSlotPads) {
    totalComboSlots += pads.length;
    // Count distinct pads used — transitions = slots not on the most-used pad
    const padCounts = new Map<string, number>();
    for (const pad of pads) padCounts.set(pad, (padCounts.get(pad) ?? 0) + 1);
    let maxOnOnePad = 0;
    for (const count of padCounts.values()) {
      if (count > maxOnOnePad) maxOnOnePad = count;
    }
    totalComboPadTransitions += pads.length - maxOnOnePad;
  }

  const judgeReassignmentRate = totalComboSlots > 0
    ? totalComboPadTransitions / totalComboSlots
    : 0;

  const projectedFinishMin = slots.length > 0
    ? Math.max(...slots.map((s) => s.endMin))
    : startMin;

  let totalBuffer = 0;
  let bufferCount = 0;
  let cadetConflicts = 0;

  for (const slot of slots) {
    const team = teamMap.get(slot.teamId);
    if (!team) continue;
    const cadetIds = new Set(team.memberships.map((m) => m.cadetIdentityId));
    let worstGap = Infinity;
    for (const other of slots) {
      if (other.teamId === slot.teamId) continue;
      if (other.startMin <= slot.startMin) continue;
      const otherTeam = teamMap.get(other.teamId);
      if (!otherTeam) continue;
      const shared = otherTeam.memberships.some((m) => cadetIds.has(m.cadetIdentityId));
      if (!shared) continue;
      const gap = other.startMin - slot.endMin;
      if (gap < worstGap) worstGap = gap;
    }
    if (worstGap < Infinity) {
      totalBuffer += worstGap;
      bufferCount++;
      if (worstGap < 0) cadetConflicts++;
    }
  }

  const internalHoleCount = countInternalHoles(slots, lanes, defaultDuration);

  return {
    judgeReassignmentRate: Math.round(judgeReassignmentRate * 1000) / 10,
    totalComboPadTransitions,
    totalComboSlots,
    projectedFinishMin,
    avgFollowOnBufferMin: bufferCount > 0 ? Math.round(totalBuffer / bufferCount) : 0,
    cadetConflicts,
    internalHoleCount,
  };
}
