import { useEffect, useState } from "react";
import { fetchWithDiagnostics } from "../utils/diagnostics.js";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";

export function useNotificationCenter({ token, onUnauthorized }) {
  const [states, setStates] = useState([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetchWithDiagnostics(`${API}/api/notifications/state`, {
          headers: { Authorization: `Bearer ${token}` },
        }, "tasks");
        if (response.status === 401) { if (!cancelled) onUnauthorized(); return; }
        if (!response.ok) throw new Error("Unable to load notification preferences.");
        const data = await response.json();
        if (!cancelled) setStates(data);
      } catch {
        if (!cancelled) setError("Notifications couldn't load. Please retry.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [token, onUnauthorized]);

  async function perform(item, action) {
    const response = await fetchWithDiagnostics(
      `${API}/api/notifications/state/${item.taskId}/${item.kind}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }, "tasks");
    if (response.status === 401) { onUnauthorized(); throw new Error("Session expired."); }
    if (!response.ok) throw new Error("Notification update failed.");
    const updated = await response.json();
    setStates(current => [...current.filter(
      state => state.taskId !== updated.taskId || state.kind !== updated.kind
    ), updated]);
  }

  async function update(item, action) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await perform(item, action);
    } catch {
      setError("Couldn't update the notification. Please retry.");
    } finally {
      setPending(false);
    }
  }

  async function markAllRead(notifications) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      // Each write is checked against its owning task on the server.
      await Promise.all(notifications.filter(item => !item.isRead)
        .map(item => perform(item, "read")));
    } catch {
      setError("Some notifications couldn't be marked read. Please retry.");
    } finally {
      setPending(false);
    }
  }

  return { states, loading, error, pending, update, markAllRead };
}
