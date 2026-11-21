import { useEffect, useState } from "react";
import { fetchWithDiagnostics } from "../../utils/diagnostics.js";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5143";
const ACTIONS = {
  created: "Task created",
  edited: "Task updated",
  completed: "Marked complete",
  reopened: "Reopened",
  rescheduled: "Due date changed",
};

// Fetch only the current token's scoped task history. Task titles and notes
// are not part of event payloads. Never render a previous session's response.
export default function TaskActivityTimeline({ taskId, token, onUnauthorized }) {
  const [state, setState] = useState({ token: null, taskId: null, status: "loading", events: [] });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!token || !taskId) return;
    const controller = new AbortController();
    setState({ token, taskId, status: "loading", events: [] });
    const load = async () => {
      try {
        const response = await fetchWithDiagnostics(`${API_BASE_URL}/api/tasks/${taskId}/activity`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
          cache: "no-store",
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { onUnauthorized(token); return; }
        if (!response.ok) throw new Error("Activity request failed");
        const events = await response.json();
        if (!Array.isArray(events) || events.some(e => !e || typeof e.kind !== "string" || typeof e.occurredAt !== "string")) {
          throw new Error("Invalid activity response");
        }
        if (!controller.signal.aborted) setState({ token, taskId, status: "loaded", events });
      } catch (error) {
        if (!controller.signal.aborted && error?.name !== "AbortError") {
          setState({ token, taskId, status: "failed", events: [] });
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [taskId, token, retry]);

  const current = state.token === token && state.taskId === taskId
    ? state : { status: "loading", events: [] };
  return (
    <section className="task-activity" aria-label="Task activity">
      <h3>Activity</h3>
      {current.status === "loading" && <p role="status">Loading activity…</p>}
      {current.status === "failed" && (
        <div role="alert">Could not load activity history.
          <button type="button" onClick={() => setRetry(value => value + 1)}>Retry activity</button>
        </div>
      )}
      {current.status === "loaded" && current.events.length === 0 && <p>No activity recorded yet.</p>}
      {current.status === "loaded" && current.events.length > 0 && (
        <ol className="task-activity-events">
          {current.events.map(event => (
            <li key={event.id}>
              <span>{ACTIONS[event.kind] ?? "Task changed"}</span>
              <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
