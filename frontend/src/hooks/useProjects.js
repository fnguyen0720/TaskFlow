import { useEffect, useRef, useState } from "react";
import { fetchWithDiagnostics } from "../utils/diagnostics.js";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";

export function useProjects({ token, onUnauthorized, showNotification, setTasks }) {
  const [loaded, setLoaded] = useState({ token: null, status: "loading", projects: [] });
  const [creating, setCreating] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const session = useRef(token);
  session.current = token;
  useEffect(() => {
    if (!token) { setLoaded({ token: null, status: "loading", projects: [] }); return; }
    const controller = new AbortController();
    setLoaded({ token, status: "loading", projects: [] });
    (async () => {
      try {
        const res = await fetchWithDiagnostics(`${API}/api/projects`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store"
        });
        if (res.status === 401) { if (!controller.signal.aborted) onUnauthorized(token); return; }
        if (!res.ok) throw new Error("Project list unavailable");
        const projects = await res.json();
        if (!Array.isArray(projects) || projects.some(p =>
          !Number.isInteger(p.id) || typeof p.name !== "string")) throw new Error("Invalid project response");
        if (!controller.signal.aborted && session.current === token)
          setLoaded({ token, status: "ready", projects });
      } catch (error) {
        if (!controller.signal.aborted && session.current === token && error?.name !== "AbortError")
          setLoaded({ token, status: "failed", projects: [] });
      }
    })();
    return () => controller.abort();
  }, [token]);

  const current = loaded.token === token ? loaded : { status: "loading", projects: [] };
  async function createProject(name) {
    const trimmed = name.trim();
    if (creating || !trimmed || trimmed.length > 70 || current.status !== "ready") return false;
    setCreating(true);
    try {
      const res = await fetchWithDiagnostics(`${API}/api/projects`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed })
      });
      if (session.current !== token) return false;
      if (res.status === 401) { onUnauthorized(token); return false; }
      if (!res.ok) throw new Error("Could not create project");
      const project = await res.json();
      setLoaded(old => old.token === token ? {
        ...old, projects: [...old.projects, project].sort((a,b) => a.name.localeCompare(b.name))
      } : old);
      showNotification("Project created.");
      return true;
    } catch {
      if (session.current === token) showNotification("Could not create project. Try another name.", "error");
      return false;
    } finally { setCreating(false); }
  }

  async function assignProject(task, projectId) {
    if (!task?.version || assigningId != null || current.status !== "ready") return false;
    setAssigningId(task.id);
    try {
      const res = await fetchWithDiagnostics(`${API}/api/tasks/${task.id}/project`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
          "If-Match": `"${task.version}"` },
        body: JSON.stringify({ projectId })
      });
      if (session.current !== token) return false;
      if (res.status === 401) { onUnauthorized(token); return false; }
      if (res.status === 409) throw new Error("This task changed elsewhere. Reload it before moving.");
      if (!res.ok) throw new Error("Could not change project.");
      const updated = await res.json();
      setTasks(old => old.map(item => item.id === task.id ? updated : item));
      showNotification("Task project updated.");
      return true;
    } catch (error) {
      if (session.current === token) showNotification(error.message, "error");
      return false;
    } finally { setAssigningId(null); }
  }

  return { ...current, createProject, assignProject, creating, assigningId };
}
