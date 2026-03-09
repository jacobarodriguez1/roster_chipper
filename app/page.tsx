"use client";

import { useEffect, useState } from "react";

type UploadHistory = {
  id: string;
  filename: string;
  createdAt: string;
  status: string;
  rowCount: number;
  _count: {
    issues: number;
    teams: number;
    scheduleVersions: number;
  };
};

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [history, setHistory] = useState<UploadHistory[]>([]);

  async function loadHistory() {
    const res = await fetch("/api/uploads");
    const json = await res.json();
    setHistory(json.uploads ?? []);
  }

  useEffect(() => {
    fetch("/api/uploads")
      .then((res) => res.json())
      .then((json) => setHistory(json.uploads ?? []));
  }, []);

  async function startValidation() {
    if (!file) return;
    setUploading(true);
    setMessage("");

    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/uploads", {
      method: "POST",
      body: formData,
    });
    const json = await res.json();
    setUploading(false);

    if (!res.ok) {
      setMessage(json.error ?? "Upload failed");
      return;
    }
    setMessage(`Upload created: ${json.upload.id}`);
    await loadHistory();
  }

  return (
    <div className="grid">
      <section className="panel">
        <h2>Upload Page</h2>
        <p className="muted">Upload master staging CSV and begin validation.</p>
        <div className="row" style={{ marginTop: 10 }}>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setMessage("");
            }}
          />
          <button onClick={startValidation} disabled={!file || uploading}>
            {uploading ? "Validating..." : "Validation Start"}
          </button>
        </div>
        {message ? <p style={{ marginTop: 10 }}>{message}</p> : null}
      </section>

      <section className="panel">
        <h3>Upload History</h3>
        <table>
          <thead>
            <tr>
              <th>Uploaded</th>
              <th>File</th>
              <th>Status</th>
              <th>Rows</th>
              <th>Issues</th>
              <th>Teams</th>
              <th>Schedules</th>
            </tr>
          </thead>
          <tbody>
            {history.map((u) => (
              <tr key={u.id}>
                <td>{new Date(u.createdAt).toLocaleString()}</td>
                <td>{u.filename}</td>
                <td>{u.status}</td>
                <td>{u.rowCount}</td>
                <td>{u._count.issues}</td>
                <td>{u._count.teams}</td>
                <td>{u._count.scheduleVersions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
