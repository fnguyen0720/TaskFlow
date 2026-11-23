import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";

// Dependency writes are separate from editable task notes. They always send
// the last observed edge set, so another tab cannot silently overwrite it.
export default function TaskDependencies({ task, tasks, token, onUnauthorized, onDirtyChange, disabled }) {
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const [initial, setInitial] = useState(null);
  const [selected, setSelected] = useState([]);
  const [candidate, setCandidate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setInitial(null);
    setSelected([]);
    setError("");
    fetch(`${API}/api/tasks/${task.id}/dependencies`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
    }).then(async response => {
      if (response.status === 401) { onUnauthorizedRef.current(token); return null; }
      if (!response.ok) throw new Error("Unable to load task dependencies.");
      return response.json();
    }).then(list => {
      if (!controller.signal.aborted && list) {
        const ids = list.map(item => item.id);
        setInitial(ids);
        setSelected(ids);
      }
    }).catch(err => {
      if (!controller.signal.aborted) setError(err.message || "Unable to load dependencies.");
    });
    return () => controller.abort();
  }, [task.id, token, refresh]);

  const otherTasks = tasks.filter(t => Number.isInteger(t.id) && t.id !== task.id);
  const eligible = otherTasks.filter(t => !selected.includes(t.id));
  const changed = initial !== null &&
    [...initial].sort((a, b) => a - b).join(",") !==
    [...selected].sort((a, b) => a - b).join(",");
  useEffect(() => {
    onDirtyChange?.(changed);
    return () => onDirtyChange?.(false);
  }, [changed, onDirtyChange]);

  async function save() {
    if (!changed || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API}/api/tasks/${task.id}/dependencies`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ dependsOnIds: selected, expectedDependsOnIds: initial })
      });
      if (response.status === 401) { onUnauthorizedRef.current(token); return; }
      if (!response.ok) throw new Error(response.status === 409
        ? "Dependencies changed in another tab. Reload them before saving."
        : (await response.text()) || "Unable to save dependencies.");
      setInitial([...selected]);
    } catch (err) {
      setError(err.message || "Unable to save dependencies.");
    } finally { setBusy(false); }
  }
  return (
    <section className="task-dependency-panel" aria-label="Task dependencies">
      <h3>Dependencies</h3>
      <p>Finish prerequisites before this task can be completed.</p>
      {initial === null && !error && <p role="status">Loading dependencies…</p>}
      {selected.map(id => {
        const prerequisite = otherTasks.find(t => t.id === id);
        return <div className="task-dependency-row" key={id}>
          <span>{prerequisite?.completed ? "✓" : "○"} {prerequisite?.title || `Task #${id}`}</span>
          <button type="button" disabled={busy || disabled} onClick={() =>
            setSelected(current => current.filter(x => x !== id))
          } aria-label={`Remove dependency ${prerequisite?.title || id}`}>Remove</button>
        </div>;
      })}
      <div className="task-dependency-row">
        <select aria-label="Select prerequisite task" value={candidate}
          disabled={initial === null || busy || disabled || selected.length >= 50}
          onChange={e => setCandidate(e.target.value)}>
          <option value="">Choose a prerequisite…</option>
          {eligible.map(t => <option value={t.id} key={t.id}>{t.title}</option>)}
        </select>
        <button type="button" disabled={!candidate || busy || disabled}
          onClick={() => {
            setSelected(current => [...current, Number(candidate)]);
            setCandidate("");
          }}>Add</button>
      </div>
      {error && <p role="alert">{error} <button type="button" onClick={() => setRefresh(v => v + 1)}>Reload</button></p>}
      {changed && <button type="button" disabled={busy || disabled} onClick={save}>
        {busy ? "Saving…" : "Save dependencies"}
      </button>}
      {changed && <p role="status">Unsaved dependency changes.</p>}
    </section>
  );
}
