import { useEffect, useState } from "react";
import { fetchWithDiagnostics } from "../../utils/diagnostics.js";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5143";
const fields = [
  ["title", "Title"], ["completed", "Status"], ["priority", "Priority"],
  ["dueDate", "Due date"], ["category", "Category"],
  ["recurrenceRule", "Repeat"], ["reminderDaysBefore", "Reminder days"],
  ["notes", "Notes"], ["checklistJson", "Checklist"]
];

function readable(value, field) {
  if (field === "completed") return value ? "Completed" : "Active";
  if (field === "dueDate") return value?.slice(0, 10) || "Not scheduled";
  if (field === "checklistJson") {
    try {
      const entries = typeof value === "string" ? JSON.parse(value) : value;
      return Array.isArray(entries) && entries.length
        ? entries.map(entry => `${entry.completed ? "✓" : "○"} ${entry.text}`).join("\n")
        : "No checklist";
    } catch { return "Checklist unavailable"; }
  }
  return value == null || value === "" ? "—" : String(value);
}
function currentSnapshot(task) {
  return {
    ...task,
    checklistJson: JSON.stringify((task.checklist ?? []).map(({ text, completed }) => ({ text, completed })))
  };
}
export default function TaskVersionHistory({
  task, token, onUnauthorized, onRestored, disabled
}) {
  const [state, setState] = useState({ token: null, taskId: null, status: "loading", versions: [] });
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token || !task.id) return;
    const controller = new AbortController();
    setSelected(null);
    setState({ token, taskId: task.id, status: "loading", versions: [] });
    const load = async () => {
      try {
        const response = await fetchWithDiagnostics(`${API_BASE_URL}/api/tasks/${task.id}/versions`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
          cache: "no-store"
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { onUnauthorized(token); return; }
        if (!response.ok) throw new Error("Could not load task versions.");
        const versions = await response.json();
        if (!Array.isArray(versions) || versions.some(item =>
          !Number.isInteger(item.id) || !item.snapshot || typeof item.snapshot.title !== "string")) {
          throw new Error("Invalid version history");
        }
        if (!controller.signal.aborted) setState({ token, taskId: task.id, status: "loaded", versions });
      } catch (error) {
        if (!controller.signal.aborted && error?.name !== "AbortError")
          setState({ token, taskId: task.id, status: "failed", versions: [] });
      }
    };
    void load();
    return () => controller.abort();
  }, [task.id, token, retry]);

  const visible = state.token === token && state.taskId === task.id
    ? state : { status: "loading", versions: [] };
  const active = visible.versions.find(item => item.id === selected);
  const before = active?.snapshot;
  const after = currentSnapshot(task);

  async function restore() {
    if (!active || disabled || saving || !task.version) return;
    if (!window.confirm("Restore this earlier task version? The current version will remain in history.")) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetchWithDiagnostics(`${API_BASE_URL}/api/tasks/${task.id}/restore`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "If-Match": `"${task.version}"`
        },
        body: JSON.stringify({ versionId: active.id })
      });
      if (response.status === 401) { onUnauthorized(token); return; }
      if (response.status === 409) {
        setError("This task changed elsewhere. Reload the latest task before restoring.");
        return;
      }
      if (!response.ok) throw new Error("Could not restore this version. No changes were made.");
      const updated = await response.json();
      onRestored(updated);
    } catch {
      setError("Could not restore this version. No changes were made.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="task-versions" aria-label="Task version history">
      <h3>Version history</h3>
      {visible.status === "loading" && <p role="status">Loading saved versions…</p>}
      {visible.status === "failed" && <p role="alert">Could not load version history. <button type="button" onClick={() => setRetry(v => v + 1)}>Retry versions</button></p>}
      {visible.status === "loaded" && !visible.versions.length && <p>No saved versions yet. History begins with the next saved change.</p>}
      {visible.status === "loaded" && !!visible.versions.length && (
        <>
          <label>Compare an earlier version with the current task
            <select value={selected ?? ""} onChange={e => { setSelected(e.target.value ? Number(e.target.value) : null); setError(""); }}>
              <option value="">Select a saved version</option>
              {visible.versions.map(item => (
                <option key={item.id} value={item.id}>
                  {item.kind} · {new Date(item.recordedAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          {active && <div className="task-version-compare">
            <div className="task-version-compare-heading"><strong>Saved version</strong><strong>Current task</strong></div>
            {fields.filter(([key]) => readable(before[key],key) !== readable(after[key],key)).map(([key,label]) => (
              <div className="task-version-diff" key={key}>
                <strong>{label}</strong>
                <div>{readable(before[key],key)}</div>
                <div>{readable(after[key],key)}</div>
              </div>
            ))}
            {fields.every(([key]) => readable(before[key],key) === readable(after[key],key)) &&
              <p>No content differences from the current task.</p>}
          </div>}
          {active && <button type="button" className="task-version-restore" disabled={disabled || saving}
            onClick={restore}>{saving ? "Restoring…" : "Restore selected version"}</button>}
          {active && disabled && <p role="status">Save or discard your unsaved edits before restoring.</p>}
        </>
      )}
      {error && <p role="alert" className="task-version-error">{error}</p>}
    </section>
  );
}
