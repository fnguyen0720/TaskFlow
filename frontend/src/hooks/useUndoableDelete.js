import { useEffect, useRef, useState } from "react";

export const DELETE_UNDO_WINDOW_MS = 8000;
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5143";

// A task is hidden immediately, but DELETE is sent only after the Undo window.
// Closing the page or changing accounts during that window cancels the timer;
// it does not delete the task in the database.
export function useUndoableDelete({ token, tasks, setTasks, showNotification }) {
  const [pendingDeletes, setPendingDeletes] = useState([]);
  const pendingRef = useRef(new Map());
  const activeRequestsRef = useRef(new Set());
  const tokenRef = useRef(token);
  const tasksRef = useRef(tasks);
  tokenRef.current = token;
  tasksRef.current = tasks;

  const publish = () => {
    setPendingDeletes(
      Array.from(pendingRef.current.values(), record => ({
        id: record.id,
        title: record.title,
        status: record.status,
      }))
    );
  };

  useEffect(() => {
    // Clear any prior-account messages when the authenticated session changes.
    setPendingDeletes([]);

    return () => {
      for (const record of pendingRef.current.values()) {
        clearTimeout(record.timer);
      }
      pendingRef.current.clear();
      for (const controller of activeRequestsRef.current) {
        controller.abort();
      }
      activeRequestsRef.current.clear();
    };
  }, [token]);

  const commitDelete = async (id, authToken) => {
    const record = pendingRef.current.get(id);
    if (!record || record.status !== "pending" || authToken !== tokenRef.current) return;
    record.status = "deleting";
    publish();

    const controller = new AbortController();
    activeRequestsRef.current.add(controller);

    try {
      const response = await fetch(API_BASE_URL + "/api/tasks/" + encodeURIComponent(id), {
        method: "DELETE",
        headers: { Authorization: "Bearer " + authToken },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Failed to delete task");
      if (tokenRef.current === authToken) {
        setTasks(current => current.filter(task => task.id !== id));
        showNotification("Task deleted.");
      }
    } catch (error) {
      if (error.name !== "AbortError" && tokenRef.current === authToken) {
        console.error("Error deleting task:", error);
        showNotification("Couldn't delete task. It has been restored.", "error");
      }
    } finally {
      activeRequestsRef.current.delete(controller);
      pendingRef.current.delete(id);
      if (tokenRef.current === authToken) publish();
    }
  };

  const deleteTask = (id) => {
    if (!token || pendingRef.current.has(id)) return;
    const task = tasksRef.current.find(item => item.id === id);
    if (!task || String(id).startsWith("temp-")) return;

    const record = { id, title: task.title, status: "pending", timer: null };
    pendingRef.current.set(id, record);
    publish();

    record.timer = setTimeout(() => {
      void commitDelete(id, token);
    }, DELETE_UNDO_WINDOW_MS);
  };

  const undoDelete = (id) => {
    const record = pendingRef.current.get(id);
    if (!record || record.status !== "pending") return;
    clearTimeout(record.timer);
    pendingRef.current.delete(id);
    publish();
    showNotification("Deletion canceled.");
  };

  const pendingDeleteIds = new Set(pendingDeletes.map(record => record.id));
  return { pendingDeletes, pendingDeleteIds, deleteTask, undoDelete };
}
