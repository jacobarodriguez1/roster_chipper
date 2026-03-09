"use client";

import { useEffect, useMemo, useState } from "react";

type Upload = { id: string; filename: string };
type StagedRow = {
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
};

type SortKey = keyof StagedRow | null;
type SortDir = "asc" | "desc";

type ColumnFilters = Partial<Record<keyof StagedRow, string>>;
type CustomView = {
  brigades: string[];
  schools: string[];
  categories: string[];
  divisions: string[];
};

export default function StagingPage() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploadId, setUploadId] = useState("");
  const [rows, setRows] = useState<StagedRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, StagedRow>>({});
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
  const [customView, setCustomView] = useState<CustomView>({
    brigades: [],
    schools: [],
    categories: [],
    divisions: [],
  });
  const [customViewOpen, setCustomViewOpen] = useState(false);

  async function loadUploads() {
    const res = await fetch("/api/uploads");
    const json = await res.json();
    setUploads(json.uploads ?? []);
    if (!uploadId && json.uploads?.length) {
      setUploadId(json.uploads[0].id);
    }
  }

  async function loadRows() {
    if (!uploadId) return;
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    const res = await fetch(`/api/uploads/${uploadId}/staged-rows?${params.toString()}`);
    const json = await res.json();
    const stagedRows = (json.stagedRows ?? []) as StagedRow[];
    setRows(stagedRows);
    const nextDrafts: Record<string, StagedRow> = {};
    stagedRows.forEach((row) => {
      nextDrafts[row.id] = { ...row };
    });
    setDrafts(nextDrafts);
  }

  useEffect(() => {
    loadUploads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const dirtyIds = useMemo(
    () =>
      rows
        .filter((row) => JSON.stringify(row) !== JSON.stringify(drafts[row.id]))
        .map((row) => row.id),
    [rows, drafts],
  );

  const uniqueValues = useMemo(() => {
    const brigades = [...new Set(rows.map((r) => r.brigadeNumber).filter(Boolean))].sort();
    const schools = [...new Set(rows.map((r) => r.schoolOrUnit).filter(Boolean))].sort();
    const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
    const divisions = [...new Set(rows.map((r) => r.division).filter(Boolean))].sort();
    return { brigades, schools, categories, divisions };
  }, [rows]);

  const filteredAndSortedRows = useMemo(() => {
    let result = rows;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.brigadeNumber.toLowerCase().includes(q) ||
          r.schoolOrUnit.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.division.toLowerCase().includes(q) ||
          r.teamNumber.toLowerCase().includes(q) ||
          r.cadetLastName.toLowerCase().includes(q) ||
          r.cadetFirstName.toLowerCase().includes(q) ||
          r.cadetRank.toLowerCase().includes(q) ||
          r.cadetGender.toLowerCase().includes(q) ||
          r.cadetGrade.toLowerCase().includes(q),
      );
    }

    if (customView.brigades.length > 0) {
      result = result.filter((r) => customView.brigades.includes(r.brigadeNumber));
    }
    if (customView.schools.length > 0) {
      result = result.filter((r) => customView.schools.includes(r.schoolOrUnit));
    }
    if (customView.categories.length > 0) {
      result = result.filter((r) => customView.categories.includes(r.category));
    }
    if (customView.divisions.length > 0) {
      result = result.filter((r) => customView.divisions.includes(r.division));
    }

    for (const [key, val] of Object.entries(columnFilters)) {
      if (!val?.trim()) continue;
      const k = key as keyof StagedRow;
      const v = val.trim().toLowerCase();
      result = result.filter((r) => String(r[k] ?? "").toLowerCase().includes(v));
    }

    if (sortKey) {
      result = [...result].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const aStr = String(av ?? "");
        const bStr = String(bv ?? "");
        const numA = Number(av);
        const numB = Number(bv);
        const isNumeric = !Number.isNaN(numA) && !Number.isNaN(numB) && sortKey === "rowNumber";
        let cmp: number;
        if (isNumeric) {
          cmp = numA - numB;
        } else {
          cmp = aStr.localeCompare(bStr, undefined, { numeric: true });
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [rows, search, customView, columnFilters, sortKey, sortDir]);

  function toggleSort(key: keyof StagedRow) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function setColumnFilter(key: keyof StagedRow, value: string) {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
  }

  function toggleCustomViewBrigade(brigade: string) {
    setCustomView((prev) => ({
      ...prev,
      brigades: prev.brigades.includes(brigade)
        ? prev.brigades.filter((b) => b !== brigade)
        : [...prev.brigades, brigade],
    }));
  }
  function toggleCustomViewSchool(school: string) {
    setCustomView((prev) => ({
      ...prev,
      schools: prev.schools.includes(school)
        ? prev.schools.filter((s) => s !== school)
        : [...prev.schools, school],
    }));
  }
  function toggleCustomViewCategory(cat: string) {
    setCustomView((prev) => ({
      ...prev,
      categories: prev.categories.includes(cat)
        ? prev.categories.filter((c) => c !== cat)
        : [...prev.categories, cat],
    }));
  }
  function toggleCustomViewDivision(div: string) {
    setCustomView((prev) => ({
      ...prev,
      divisions: prev.divisions.includes(div)
        ? prev.divisions.filter((d) => d !== div)
        : [...prev.divisions, div],
    }));
  }
  function clearCustomView() {
    setCustomView({ brigades: [], schools: [], categories: [], divisions: [] });
  }
  const hasCustomView =
    customView.brigades.length > 0 ||
    customView.schools.length > 0 ||
    customView.categories.length > 0 ||
    customView.divisions.length > 0;

  function patchDraft(rowId: string, patch: Partial<StagedRow>) {
    setDrafts((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] ?? ({} as StagedRow)), ...patch },
    }));
  }

  async function saveRow(rowId: string) {
    const draft = drafts[rowId];
    if (!draft) return;
    const res = await fetch(`/api/staged-rows/${rowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brigadeNumber: draft.brigadeNumber,
        schoolOrUnit: draft.schoolOrUnit,
        category: draft.category,
        division: draft.division,
        teamNumber: draft.teamNumber,
        cadetLastName: draft.cadetLastName,
        cadetFirstName: draft.cadetFirstName,
        cadetRank: draft.cadetRank,
        cadetGender: draft.cadetGender,
        cadetGrade: draft.cadetGrade,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error ?? "Failed to save row");
      return;
    }
    setMessage("Saved. Reprocessed.");
    await loadRows();
  }

  async function saveAll() {
    if (dirtyIds.length === 0) return;
    setSaving(true);
    setMessage("");
    for (const rowId of dirtyIds) {
      const res = await fetch(`/api/staged-rows/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brigadeNumber: drafts[rowId].brigadeNumber,
          schoolOrUnit: drafts[rowId].schoolOrUnit,
          category: drafts[rowId].category,
          division: drafts[rowId].division,
          teamNumber: drafts[rowId].teamNumber,
          cadetLastName: drafts[rowId].cadetLastName,
          cadetFirstName: drafts[rowId].cadetFirstName,
          cadetRank: drafts[rowId].cadetRank,
          cadetGender: drafts[rowId].cadetGender,
          cadetGrade: drafts[rowId].cadetGrade,
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        setSaving(false);
        setMessage(json.error ?? "Failed while saving all rows");
        return;
      }
    }
    setSaving(false);
    setMessage(`Saved ${dirtyIds.length} row(s). Reprocessed.`);
    await loadRows();
  }

  const sortArrow = (key: keyof StagedRow) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div className="staging-page">
      {/* Toolbar */}
      <div className="staging-toolbar">
        <h2>Staging</h2>
        <select value={uploadId} onChange={(e) => setUploadId(e.target.value)}>
          <option value="">Dataset</option>
          {uploads.map((u) => (
            <option key={u.id} value={u.id}>{u.filename}</option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search"
          onKeyDown={(e) => e.key === "Enter" && loadRows()}
        />
        <button className="secondary" onClick={loadRows}>Go</button>
        <button
          className="secondary"
          onClick={() => setCustomViewOpen((o) => !o)}
          style={hasCustomView ? { borderColor: "var(--cacc-gold)", color: "var(--cacc-gold)" } : undefined}
        >
          View{hasCustomView ? ` (${customView.brigades.length + customView.schools.length + customView.categories.length + customView.divisions.length})` : ""}
        </button>
        {hasCustomView && (
          <button className="secondary" onClick={clearCustomView}>Clear</button>
        )}
        <button onClick={saveAll} disabled={saving || dirtyIds.length === 0}>
          {saving ? "Saving..." : `Save (${dirtyIds.length})`}
        </button>
        <span className="staging-status">
          {filteredAndSortedRows.length}/{rows.length} rows
          {message && <> · {message}</>}
        </span>
      </div>

      {/* Custom view panel */}
      {customViewOpen && (
        <div className="staging-custom-view">
          <h3>Custom View</h3>
          <div className="staging-custom-view-grid">
            <div>
              <label>Brigades</label>
              <div className="cv-list">
                {uniqueValues.brigades.map((b) => (
                  <label key={b}>
                    <input type="checkbox" checked={customView.brigades.includes(b)} onChange={() => toggleCustomViewBrigade(b)} />
                    {b}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label>Schools / Units</label>
              <div className="cv-list">
                {uniqueValues.schools.map((s) => (
                  <label key={s}>
                    <input type="checkbox" checked={customView.schools.includes(s)} onChange={() => toggleCustomViewSchool(s)} />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label>Categories</label>
              <div className="cv-list">
                {uniqueValues.categories.map((c) => (
                  <label key={c}>
                    <input type="checkbox" checked={customView.categories.includes(c)} onChange={() => toggleCustomViewCategory(c)} />
                    {c}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label>Divisions</label>
              <div className="cv-list">
                {uniqueValues.divisions.map((d) => (
                  <label key={d}>
                    <input type="checkbox" checked={customView.divisions.includes(d)} onChange={() => toggleCustomViewDivision(d)} />
                    {d}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Data grid */}
      <div className="staging-grid-wrap">
        <table className="staging-grid">
          <colgroup>
            <col className="col-bde" />
            <col className="col-unit" />
            <col className="col-category" />
            <col className="col-division" />
            <col className="col-team" />
            <col className="col-last" />
            <col className="col-first" />
            <col className="col-rank" />
            <col className="col-gender" />
            <col className="col-grade" />
            <col className="col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th><button type="button" className="link" onClick={() => toggleSort("brigadeNumber")}>BDE{sortArrow("brigadeNumber")}</button></th>
              <th><button type="button" className="link" onClick={() => toggleSort("schoolOrUnit")}>Unit{sortArrow("schoolOrUnit")}</button></th>
              <th><button type="button" className="link" onClick={() => toggleSort("category")}>Category{sortArrow("category")}</button></th>
              <th><button type="button" className="link" onClick={() => toggleSort("division")}>Div{sortArrow("division")}</button></th>
              <th><button type="button" className="link" onClick={() => toggleSort("teamNumber")}>T#{sortArrow("teamNumber")}</button></th>
              <th><button type="button" className="link" onClick={() => toggleSort("cadetLastName")}>Last{sortArrow("cadetLastName")}</button></th>
              <th><button type="button" className="link" onClick={() => toggleSort("cadetFirstName")}>First{sortArrow("cadetFirstName")}</button></th>
              <th><button type="button" className="link" onClick={() => toggleSort("cadetRank")}>Rank{sortArrow("cadetRank")}</button></th>
              <th><button type="button" className="link" onClick={() => toggleSort("cadetGender")}>G{sortArrow("cadetGender")}</button></th>
              <th><button type="button" className="link" onClick={() => toggleSort("cadetGrade")}>Gr{sortArrow("cadetGrade")}</button></th>
              <th></th>
            </tr>
            <tr className="staging-filter-row">
              <th><input value={columnFilters.brigadeNumber ?? ""} onChange={(e) => setColumnFilter("brigadeNumber", e.target.value)} placeholder="…" /></th>
              <th><input value={columnFilters.schoolOrUnit ?? ""} onChange={(e) => setColumnFilter("schoolOrUnit", e.target.value)} placeholder="…" /></th>
              <th><input value={columnFilters.category ?? ""} onChange={(e) => setColumnFilter("category", e.target.value)} placeholder="…" /></th>
              <th><input value={columnFilters.division ?? ""} onChange={(e) => setColumnFilter("division", e.target.value)} placeholder="…" /></th>
              <th><input value={columnFilters.teamNumber ?? ""} onChange={(e) => setColumnFilter("teamNumber", e.target.value)} placeholder="…" /></th>
              <th><input value={columnFilters.cadetLastName ?? ""} onChange={(e) => setColumnFilter("cadetLastName", e.target.value)} placeholder="…" /></th>
              <th><input value={columnFilters.cadetFirstName ?? ""} onChange={(e) => setColumnFilter("cadetFirstName", e.target.value)} placeholder="…" /></th>
              <th><input value={columnFilters.cadetRank ?? ""} onChange={(e) => setColumnFilter("cadetRank", e.target.value)} placeholder="…" /></th>
              <th><input value={columnFilters.cadetGender ?? ""} onChange={(e) => setColumnFilter("cadetGender", e.target.value)} placeholder="…" /></th>
              <th><input value={columnFilters.cadetGrade ?? ""} onChange={(e) => setColumnFilter("cadetGrade", e.target.value)} placeholder="…" /></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedRows.map((row) => (
              <tr key={row.id} className={dirtyIds.includes(row.id) ? "staging-dirty" : undefined}>
                <td><input value={drafts[row.id]?.brigadeNumber ?? ""} onChange={(e) => patchDraft(row.id, { brigadeNumber: e.target.value })} /></td>
                <td><input value={drafts[row.id]?.schoolOrUnit ?? ""} onChange={(e) => patchDraft(row.id, { schoolOrUnit: e.target.value })} /></td>
                <td><input value={drafts[row.id]?.category ?? ""} onChange={(e) => patchDraft(row.id, { category: e.target.value })} /></td>
                <td><input value={drafts[row.id]?.division ?? ""} onChange={(e) => patchDraft(row.id, { division: e.target.value })} /></td>
                <td><input value={drafts[row.id]?.teamNumber ?? ""} onChange={(e) => patchDraft(row.id, { teamNumber: e.target.value })} /></td>
                <td><input value={drafts[row.id]?.cadetLastName ?? ""} onChange={(e) => patchDraft(row.id, { cadetLastName: e.target.value })} /></td>
                <td><input value={drafts[row.id]?.cadetFirstName ?? ""} onChange={(e) => patchDraft(row.id, { cadetFirstName: e.target.value })} /></td>
                <td><input value={drafts[row.id]?.cadetRank ?? ""} onChange={(e) => patchDraft(row.id, { cadetRank: e.target.value })} /></td>
                <td><input value={drafts[row.id]?.cadetGender ?? ""} onChange={(e) => patchDraft(row.id, { cadetGender: e.target.value })} /></td>
                <td><input value={drafts[row.id]?.cadetGrade ?? ""} onChange={(e) => patchDraft(row.id, { cadetGrade: e.target.value })} /></td>
                <td><button className="secondary staging-save-btn" onClick={() => saveRow(row.id)}>✓</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
