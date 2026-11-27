import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";

export function useCompletionHistory({ token, tasks, enabled, onUnauthorized }) {
  const [state, setState] = useState({ token: null, status: "idle", data: null });
  const [revision, setRevision] = useState(0);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;
  // Depend on the authoritative task snapshot rather than render-created arrays.
  useEffect(() => {
    if (!token || !enabled) return;
    const controller = new AbortController();
    setState({ token, status: "loading", data: null });
    fetch(`${API}/api/analytics/completions`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
    }).then(async response => {
      if (controller.signal.aborted) return null;
      if (response.status === 401) { unauthorized.current?.(token); return null; }
      if (!response.ok) throw new Error("Could not load completion history.");
      return response.json();
    }).then(data => {
      if (controller.signal.aborted || data === null) return;
      if (data.timeZone !== "UTC" || data.windowDays !== 30 ||
          !Array.isArray(data.days) || data.days.length !== 30 ||
          data.days.some((day, i) => !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
            !Number.isSafeInteger(day.completed) || day.completed < 0 ||
            !Number.isSafeInteger(day.reopened) || day.reopened < 0 ||
            (i > 0 && day.date <= data.days[i - 1].date)) ||
          data.totalCompletions !== data.days.reduce((sum, day) => sum + day.completed, 0) ||
          data.totalReopenings !== data.days.reduce((sum, day) => sum + day.reopened, 0))
        throw new Error("Completion history response was invalid.");
      setState({ token, status: "ready", data });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ token, status: "error", data: null, message: error.message || "Could not load completion history." });
    });
    return () => controller.abort();
  }, [token, enabled, tasks, revision]);

  const history = enabled && state.token === token ? state : { token, status: "idle", data: null };
  return { history, refreshHistory: () => setRevision(value => value + 1) };
}
