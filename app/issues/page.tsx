"use client";

import { useEffect, useMemo, useState } from "react";

type Upload = { id: string; filename: string };
type IssueStagedRow = {
  id: string;
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
  membership?: {
    team: {
      brigadeNumber: string;
      category: string;
      division: string;
      teamNumber: string;
    };
  } | null;
};

type Issue = {
  id: string;
  type: string;
  code: string;
  severity: "HARD_ERROR" | "WARNING";
  status: "OPEN" | "RESOLVED" | "OVERRIDDEN";
  message: string;
  brigadeNumber: string | null;
  category: string | null;
  division: string | null;
  overrideReason: string | null;
  detailsJson: string | null;
  cadetIdentityId: string | null;
  stagedRow?: IssueStagedRow | null;
  cadetIdentity?: {
    id: string;
    canonicalFirstName: string;
    canonicalLastName: string;
    memberships: {
      id: string;
      team: {
        brigadeNumber: string;
        category: string;
        division: string;
        teamNumber: string;
      };
    }[];
  } | null;
};

type IssueDetailResponse = {
  issue: Issue;
  details: Record<string, unknown>;
  stagedRowsFromDetails: IssueStagedRow[];
  candidateCadets: {
    id: string;
    canonicalFirstName: string;
    canonicalLastName: string;
    memberships: {
      team: { category: string; division: string; teamNumber: string; brigadeNumber: string };
    }[];
  }[];
};

type Identity = {
  id: string;
  canonicalFirstName: string;
  canonicalLastName: string;
  memberships: { id: string; stagedRowId: string; team: { teamNumber: string } }[];
};

const SILENT_CODES = ["MISSING_REQUIRED_VALUE", "IDENTITY_VARIANT"];

export default function IssuesPage() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploadId, setUploadId] = useState<string>("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [tab, setTab] = useState<"HARD_ERROR" | "WARNING" | "IDENTITY" | "SILENT">("HARD_ERROR");
  const [search, setSearch] = useState("");
  const [bulkMessage, setBulkMessage] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [issueDraft, setIssueDraft] = useState<IssueStagedRow | null>(null);
  const [detailMessage, setDetailMessage] = useState("");
  const [issueDetail, setIssueDetail] = useState<IssueDetailResponse | null>(null);
  const [inspecting, setInspecting] = useState(false);

  // Merge/split state (inside inspect panel)
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeSource, setMergeSource] = useState("");
  const [splitIdentity, setSplitIdentity] = useState("");
  const [splitRows, setSplitRows] = useState("");
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");

  async function loadUploads() {
    const res = await fetch("/api/uploads");
    const json = await res.json();
    setUploads(json.uploads ?? []);
    if (!uploadId && json.uploads?.length) {
      setUploadId(json.uploads[0].id);
    }
  }

  async function loadIssues() {
    if (!uploadId) return;
    const res = await fetch(`/api/uploads/${uploadId}/issues?search=${encodeURIComponent(search)}`);
    const json = await res.json();
    setIssues(json.issues ?? []);
  }

  async function loadIdentities() {
    if (!uploadId) return;
    const res = await fetch(`/api/uploads/${uploadId}/identities`);
    const json = await res.json();
    setIdentities(json.identities ?? []);
  }

  useEffect(() => {
    loadUploads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadIssues();
    loadIdentities();
    setIssueDetail(null);
    setSelectedIssueId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const selectedIssue = useMemo(() => issueDetail?.issue ?? null, [issueDetail]);

  useEffect(() => {
    const selectedRow = selectedIssue?.stagedRow ?? issueDetail?.stagedRowsFromDetails?.[0] ?? null;
    setIssueDraft(selectedRow ? { ...selectedRow } : null);
  }, [selectedIssue, issueDetail]);

  const filteredIssues = useMemo(() => {
    if (tab === "SILENT") {
      return issues.filter((i) => SILENT_CODES.includes(i.code));
    }
    if (tab === "IDENTITY") {
      return issues.filter((i) => i.type === "IDENTITY" && !SILENT_CODES.includes(i.code));
    }
    if (tab === "HARD_ERROR") {
      return issues.filter((i) => i.severity === "HARD_ERROR" && !SILENT_CODES.includes(i.code));
    }
    if (tab === "WARNING") {
      return issues.filter((i) => i.severity === "WARNING" && !SILENT_CODES.includes(i.code) && i.type !== "IDENTITY");
    }
    return issues.filter((i) => i.severity === tab);
  }, [issues, tab]);

  async function patchIssue(id: string, status: "RESOLVED" | "OVERRIDDEN") {
    await fetch(`/api/issues/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await loadIssues();
    if (selectedIssueId === id) {
      await inspectIssue(id);
    }
  }

  async function mergeIdentities() {
    if (!mergeTarget || !mergeSource) return;
    await fetch("/api/identities/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceIdentityIds: [mergeSource],
        targetIdentityId: mergeTarget,
      }),
    });
    setDetailMessage("Identities merged.");
    await loadIdentities();
    await loadIssues();
  }

  async function splitIdentityAction() {
    if (!splitIdentity || !splitRows || !newFirst || !newLast) return;
    await fetch("/api/identities/split", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identityId: splitIdentity,
        stagedRowIds: splitRows.split(",").map((s) => s.trim()),
        newFirstName: newFirst,
        newLastName: newLast,
      }),
    });
    setDetailMessage("Identity split.");
    await loadIdentities();
    await loadIssues();
  }

  async function bulkResolve(severities: ("HARD_ERROR" | "WARNING")[]) {
    if (!uploadId) return;
    setBulkMessage("");
    const res = await fetch(`/api/uploads/${uploadId}/issues/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ severities, status: "RESOLVED" }),
    });
    const json = await res.json();
    if (!res.ok) {
      setBulkMessage(json.error ?? "Bulk resolve failed");
      return;
    }
    setBulkMessage(`Resolved ${json.updatedCount} issue(s).`);
    await loadIssues();
  }

  async function bulkUnresolve(severities: ("HARD_ERROR" | "WARNING")[]) {
    if (!uploadId) return;
    setBulkMessage("");
    const res = await fetch(`/api/uploads/${uploadId}/issues/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ severities, status: "OPEN" }),
    });
    const json = await res.json();
    if (!res.ok) {
      setBulkMessage(json.error ?? "Bulk unresolve failed");
      return;
    }
    setBulkMessage(`Unreolved ${json.updatedCount} issue(s).`);
    await loadIssues();
  }

  const openHardErrorCount = issues.filter(
    (i) => i.severity === "HARD_ERROR" && i.status === "OPEN",
  ).length;
  const openWarningCount = issues.filter(
    (i) => i.severity === "WARNING" && i.status === "OPEN",
  ).length;
  const resolvedHardErrorCount = issues.filter(
    (i) => i.severity === "HARD_ERROR" && i.status !== "OPEN",
  ).length;
  const resolvedWarningCount = issues.filter(
    (i) => i.severity === "WARNING" && i.status !== "OPEN",
  ).length;

  function patchIssueDraft(patch: Partial<IssueStagedRow>) {
    setIssueDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function saveIssueContextEdits() {
    if (!issueDraft) return;
    setDetailMessage("");
    const res = await fetch(`/api/staged-rows/${issueDraft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brigadeNumber: issueDraft.brigadeNumber,
        schoolOrUnit: issueDraft.schoolOrUnit,
        category: issueDraft.category,
        division: issueDraft.division,
        teamNumber: issueDraft.teamNumber,
        cadetLastName: issueDraft.cadetLastName,
        cadetFirstName: issueDraft.cadetFirstName,
        cadetRank: issueDraft.cadetRank,
        cadetGender: issueDraft.cadetGender,
        cadetGrade: issueDraft.cadetGrade,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setDetailMessage(json.error ?? "Failed to save edits");
      return;
    }
    setDetailMessage("Saved edits. System reprocessed from staging table.");
    await loadIssues();
    await loadIdentities();
    if (selectedIssueId) {
      await inspectIssue(selectedIssueId);
    }
  }

  async function inspectIssue(id: string) {
    setInspecting(true);
    setSelectedIssueId(id);
    setDetailMessage("");
    const res = await fetch(`/api/issues/${id}`);
    const json = await res.json();
    if (!res.ok) {
      setIssueDetail(null);
      setInspecting(false);
      setDetailMessage(json.error ?? "Could not load issue details");
      return;
    }
    setIssueDetail(json);
    setInspecting(false);
  }

  const isIdentityIssue = selectedIssue?.type === "IDENTITY" || selectedIssue?.code === "MULTI_CATEGORY_CADET";

  return (
    <div className="grid">
      <section className="panel">
        <h2>Issues / Resolution</h2>
        <div className="row" style={{ marginTop: 10 }}>
          <select value={uploadId} onChange={(e) => setUploadId(e.target.value)}>
            <option value="">Select upload</option>
            {uploads.map((u) => (
              <option key={u.id} value={u.id}>
                {u.filename}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brigade/category/cadet"
          />
          <button className="secondary" onClick={loadIssues}>
            Search
          </button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className={tab === "HARD_ERROR" ? "" : "secondary"} onClick={() => setTab("HARD_ERROR")}>
            Hard Errors
          </button>
          <button className={tab === "WARNING" ? "" : "secondary"} onClick={() => setTab("WARNING")}>
            Warnings
          </button>
          <button className={tab === "IDENTITY" ? "" : "secondary"} onClick={() => setTab("IDENTITY")}>
            Identity Review
          </button>
          <button className={tab === "SILENT" ? "" : "secondary"} onClick={() => setTab("SILENT")}>
            Silent
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>Issue Resolution Tracker</h3>
        <div className="row" style={{ marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
          <button
            className="secondary"
            onClick={() => bulkResolve(["HARD_ERROR"])}
            disabled={openHardErrorCount === 0}
          >
            Resolve All Hard Errors ({openHardErrorCount})
          </button>
          <button
            className="secondary"
            onClick={() => bulkResolve(["WARNING"])}
            disabled={openWarningCount === 0}
          >
            Resolve All Warnings ({openWarningCount})
          </button>
          <button
            className="secondary"
            onClick={() => bulkResolve(["HARD_ERROR", "WARNING"])}
            disabled={openHardErrorCount + openWarningCount === 0}
          >
            Resolve All Open Issues
          </button>
          <span style={{ borderLeft: "1px solid var(--divider)", height: 24 }} />
          <button
            className="secondary"
            onClick={() => bulkUnresolve(["HARD_ERROR"])}
            disabled={resolvedHardErrorCount === 0}
          >
            Unresolve Hard Errors ({resolvedHardErrorCount})
          </button>
          <button
            className="secondary"
            onClick={() => bulkUnresolve(["WARNING"])}
            disabled={resolvedWarningCount === 0}
          >
            Unresolve Warnings ({resolvedWarningCount})
          </button>
          <button
            className="secondary"
            onClick={() => bulkUnresolve(["HARD_ERROR", "WARNING"])}
            disabled={resolvedHardErrorCount + resolvedWarningCount === 0}
          >
            Unresolve All
          </button>
        </div>
        {bulkMessage ? <p className="muted">{bulkMessage}</p> : null}
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Issue</th>
              <th>Scope</th>
              <th>Cadet</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredIssues.map((issue) => (
              <tr key={issue.id}>
                <td>
                  <span className={`badge ${issue.severity === "HARD_ERROR" ? "error" : "warning"}`}>
                    {issue.severity}
                  </span>
                </td>
                <td>
                  <strong>{issue.code}</strong>
                  <div>{issue.message}</div>
                </td>
                <td>
                  {issue.brigadeNumber}/{issue.category}/{issue.division}
                </td>
                <td>
                  {issue.cadetIdentity
                    ? `${issue.cadetIdentity.canonicalLastName}, ${issue.cadetIdentity.canonicalFirstName}`
                    : "Unknown (inspect)"}
                </td>
                <td>{issue.status}</td>
                <td className="row">
                  <button className="secondary" onClick={() => inspectIssue(issue.id)}>
                    Inspect
                  </button>
                  <button className="secondary" onClick={() => patchIssue(issue.id, "RESOLVED")}>
                    Resolve
                  </button>
                  <button onClick={() => patchIssue(issue.id, "OVERRIDDEN")}>Override</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h3>Issue Details + Edit Context</h3>
        {inspecting ? (
          <p className="muted">Loading issue details...</p>
        ) : !selectedIssue ? (
          <p className="muted">Click Inspect on any issue to view details, edit source data, or manage identities.</p>
        ) : (
          <div className="grid">
            <div className="grid two">
              <div>
                <p>
                  <strong>Issue:</strong> {selectedIssue.code}
                </p>
                <p>{selectedIssue.message}</p>
                <p className="muted">
                  Severity: {selectedIssue.severity} | Status: {selectedIssue.status}
                </p>
              </div>
              <div>
                <p>
                  <strong>Scope:</strong> {selectedIssue.brigadeNumber}/{selectedIssue.category}/
                  {selectedIssue.division}
                </p>
                {selectedIssue.detailsJson ? (
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                    {JSON.stringify(issueDetail?.details ?? {}, null, 2)}
                  </pre>
                ) : (
                  <p className="muted">No extra details.</p>
                )}
              </div>
            </div>

            {selectedIssue.cadetIdentity ? (
              <div>
                <p>
                  <strong>Cadet Identity:</strong> {selectedIssue.cadetIdentity.canonicalLastName},{" "}
                  {selectedIssue.cadetIdentity.canonicalFirstName}
                </p>
                <p className="muted">
                  Team links:{" "}
                  {selectedIssue.cadetIdentity.memberships
                    .map(
                      (m) =>
                        `${m.team.brigadeNumber} ${m.team.category}/${m.team.division} T${m.team.teamNumber}`,
                    )
                    .join(" | ") || "None"}
                </p>
              </div>
            ) : null}

            {!selectedIssue.cadetIdentity && (issueDetail?.candidateCadets?.length ?? 0) > 0 ? (
              <div>
                <p>
                  <strong>Possible cadet matches:</strong>
                </p>
                <ul style={{ paddingLeft: 18 }}>
                  {issueDetail?.candidateCadets.map((cadet) => (
                    <li key={cadet.id}>
                      {cadet.canonicalLastName}, {cadet.canonicalFirstName} -{" "}
                      {cadet.memberships
                        .map(
                          (m) =>
                            `${m.team.brigadeNumber} ${m.team.category}/${m.team.division} T${m.team.teamNumber}`,
                        )
                        .join(" | ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {(issueDetail?.stagedRowsFromDetails?.length ?? 0) > 0 ? (
              <div>
                <p>
                  <strong>Rows referenced by issue details:</strong>
                </p>
                <p className="muted">
                  {issueDetail?.stagedRowsFromDetails
                    .map(
                      (row) =>
                        `Row ${row.rowNumber}: ${row.cadetLastName}, ${row.cadetFirstName} (${row.category}/${row.division} T${row.teamNumber})`,
                    )
                    .join(" | ")}
                </p>
              </div>
            ) : null}

            {issueDraft ? (
              <div>
                <h4>Edit source staging row</h4>
                <div className="grid two">
                  <input
                    value={issueDraft.cadetLastName}
                    onChange={(e) => patchIssueDraft({ cadetLastName: e.target.value })}
                    placeholder="Cadet last name"
                  />
                  <input
                    value={issueDraft.cadetFirstName}
                    onChange={(e) => patchIssueDraft({ cadetFirstName: e.target.value })}
                    placeholder="Cadet first name"
                  />
                  <input
                    value={issueDraft.brigadeNumber}
                    onChange={(e) => patchIssueDraft({ brigadeNumber: e.target.value })}
                    placeholder="Brigade"
                  />
                  <input
                    value={issueDraft.schoolOrUnit}
                    onChange={(e) => patchIssueDraft({ schoolOrUnit: e.target.value })}
                    placeholder="School/Unit"
                  />
                  <input
                    value={issueDraft.category}
                    onChange={(e) => patchIssueDraft({ category: e.target.value })}
                    placeholder="Category"
                  />
                  <input
                    value={issueDraft.division}
                    onChange={(e) => patchIssueDraft({ division: e.target.value })}
                    placeholder="Division"
                  />
                  <input
                    value={issueDraft.teamNumber}
                    onChange={(e) => patchIssueDraft({ teamNumber: e.target.value })}
                    placeholder="Team number"
                  />
                  <input
                    value={issueDraft.cadetRank}
                    onChange={(e) => patchIssueDraft({ cadetRank: e.target.value })}
                    placeholder="Rank"
                  />
                  <input
                    value={issueDraft.cadetGender}
                    onChange={(e) => patchIssueDraft({ cadetGender: e.target.value })}
                    placeholder="Gender"
                  />
                  <input
                    value={issueDraft.cadetGrade}
                    onChange={(e) => patchIssueDraft({ cadetGrade: e.target.value })}
                    placeholder="Grade"
                  />
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <button onClick={saveIssueContextEdits}>Save Edit + Reprocess</button>
                  {detailMessage ? <span className="muted">{detailMessage}</span> : null}
                </div>
              </div>
            ) : (
              <p className="muted">
                This issue is not row-specific, so direct field editing is unavailable for this item.
              </p>
            )}

            {isIdentityIssue && identities.length > 0 ? (
              <div style={{ borderTop: "1px solid var(--divider)", paddingTop: 12 }}>
                <h4>Identity Tools</h4>
                <div className="grid two" style={{ marginTop: 8 }}>
                  <div>
                    <p className="muted" style={{ marginBottom: 6, fontSize: 12 }}>Merge two identities into one</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <select value={mergeSource} onChange={(e) => setMergeSource(e.target.value)}>
                        <option value="">Source identity</option>
                        {identities.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.canonicalLastName}, {i.canonicalFirstName}
                          </option>
                        ))}
                      </select>
                      <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                        <option value="">Target identity</option>
                        {identities.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.canonicalLastName}, {i.canonicalFirstName}
                          </option>
                        ))}
                      </select>
                      <button className="secondary" onClick={mergeIdentities} disabled={!mergeSource || !mergeTarget}>
                        Merge
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="muted" style={{ marginBottom: 6, fontSize: 12 }}>Split rows out to a new identity</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <select value={splitIdentity} onChange={(e) => setSplitIdentity(e.target.value)}>
                        <option value="">Identity to split</option>
                        {identities.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.canonicalLastName}, {i.canonicalFirstName} ({i.memberships.length})
                          </option>
                        ))}
                      </select>
                      <input
                        value={splitRows}
                        onChange={(e) => setSplitRows(e.target.value)}
                        placeholder="stagedRowId1,stagedRowId2"
                      />
                      <input value={newFirst} onChange={(e) => setNewFirst(e.target.value)} placeholder="New first name" />
                      <input value={newLast} onChange={(e) => setNewLast(e.target.value)} placeholder="New last name" />
                      <button className="secondary" onClick={splitIdentityAction} disabled={!splitIdentity || !splitRows || !newFirst || !newLast}>
                        Split
                      </button>
                    </div>
                  </div>
                </div>
                {detailMessage ? <p className="muted" style={{ marginTop: 6 }}>{detailMessage}</p> : null}
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
