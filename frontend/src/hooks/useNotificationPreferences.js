import { useEffect, useRef, useState } from "react";
import { fetchWithDiagnostics } from "../utils/diagnostics.js";
import { defaultNotificationPreferences } from "../utils/notificationPreferences.js";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";

export function useNotificationPreferences({ token, onUnauthorized }) {
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;
  const [owner, setOwner] = useState("");
  const [preferences, setPreferences] = useState(defaultNotificationPreferences);
  const [loading, setLoading] = useState(Boolean(token));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    async function load() {
      setLoading(true);
      setError("");
      setSaved(false);
      try {
        const response = await fetchWithDiagnostics(`${API}/api/notifications/preferences`, {
          headers: { Authorization: `Bearer ${token}` },
        }, "tasks");
        if (response.status === 401) {
          if (!cancelled) unauthorized.current(token);
          return;
        }
        if (!response.ok) throw new Error("Failed to load preferences");
        const data = await response.json();
        if (!cancelled) { setPreferences(data); setOwner(token); }
      } catch {
        if (!cancelled) setError("Couldn't load preferences. Retry after refreshing.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [token]);

  async function save(next) {
    if (saving || !token) return false;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetchWithDiagnostics(`${API}/api/notifications/preferences`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }, "tasks");
      if (response.status === 401) {
        unauthorized.current(token);
        return false;
      }
      if (!response.ok) throw new Error("Failed to save preferences");
      const data = await response.json();
      setPreferences(data);
      setOwner(token);
      setSaved(true);
      return true;
    } catch {
      setError("Couldn't save preferences. Please retry.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    preferences: owner === token ? preferences : defaultNotificationPreferences,
    loading: Boolean(token) && (owner !== token || loading),
    saving, error, saved, save,
  };
}
