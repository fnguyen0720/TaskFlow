import { useEffect, useState } from "react";

export const DASHBOARD_SECTIONS = Object.freeze([
  ["overview", "Daily overview"], ["momentum", "Productivity momentum"], ["ai", "TaskFlow AI"],
  ["focus", "Up next"], ["insights", "Insights & rewards"], ["projects", "Projects"],
].map(item => Object.freeze(item)));
const SECTION_IDS = DASHBOARD_SECTIONS.map(([id]) => id);
export const DEFAULT_PREFERENCES = Object.freeze({ density: "comfortable", landingView: "all",
  dashboardOrder: Object.freeze([...SECTION_IDS]), dashboardHidden: Object.freeze([]) });
export function normalizeDashboardOrder(value) {
  const valid = Array.isArray(value) ? [...new Set(value.filter(id => SECTION_IDS.includes(id)))] : [];
  return [...valid, ...SECTION_IDS.filter(id => !valid.includes(id))];
}
export function normalizeDashboardHidden(value) {
  return Array.isArray(value) ? [...new Set(value.filter(id => SECTION_IDS.includes(id)))] : [];
}
const DENSITIES = new Set(["comfortable", "compact"]);
const VIEWS = new Set(["all", "today", "upcoming", "calendar", "unscheduled"]);

export function normalizePreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_PREFERENCES };
  return {
    density: DENSITIES.has(value.density) ? value.density : DEFAULT_PREFERENCES.density,
    landingView: VIEWS.has(value.landingView) ? value.landingView : DEFAULT_PREFERENCES.landingView,
    dashboardOrder: normalizeDashboardOrder(value.dashboardOrder),
    dashboardHidden: normalizeDashboardHidden(value.dashboardHidden),
  };
}

// Scope preferences to the verified account, without storing its email in a
// browser storage key. This does not send personal information to a server.
export async function preferencesKey(email) {
  if (typeof email !== "string" || !email.includes("@")) throw new Error("Verified account required");
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  return "taskflow:view-settings:v1:" + hex;
}

export function useViewPreferences({ token, accountIdentity }) {
  const email = accountIdentity?.status === "loaded" ? accountIdentity.email : null;
  const [loaded, setLoaded] = useState({ token: null, email: null, key: null, preferences: { ...DEFAULT_PREFERENCES }, status: "loading" });
  const current = loaded.token === token && loaded.email === email && email
    ? loaded : { key: null, preferences: { ...DEFAULT_PREFERENCES }, status: "loading" };

  useEffect(() => {
    if (!token || !email) return;
    let cancelled = false;
    const load = async () => {
      try {
        const key = await preferencesKey(email);
        if (cancelled) return;
        let saved = null;
        try { saved = window.localStorage.getItem(key); } catch { /* private mode / blocked storage */ }
        let decoded = null;
        try { decoded = saved ? JSON.parse(saved) : null; } catch { /* corrupted settings reset */ }
        if (!cancelled) setLoaded({
          token, email, key, preferences: normalizePreferences(decoded), status: "ready",
        });
      } catch {
        if (!cancelled) setLoaded({ token, email, key: null, preferences: { ...DEFAULT_PREFERENCES }, status: "unavailable" });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [token, email]);

  const update = changes => {
    if (!current.key || current.status !== "ready") return false;
    const preferences = normalizePreferences({ ...current.preferences, ...changes });
    try { window.localStorage.setItem(current.key, JSON.stringify(preferences)); }
    catch { return false; }
    setLoaded({ token, email, key: current.key, preferences, status: "ready" });
    return true;
  };

  return { ...current, update };
}
