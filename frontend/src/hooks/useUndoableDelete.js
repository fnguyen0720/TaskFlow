import { useEffect, useRef, useState } from "react";
import { createDeletionQueue } from "../utils/deleteQueue.js";
import { fetchWithDiagnostics } from "../utils/diagnostics.js";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5143";

// Hide scheduled deletions immediately, but delay the DELETE request until
// after the Undo window. Closing the page before then preserves the task.
export function useUndoableDelete({ token, tasks, setTasks, showNotification }) {
  const [pendingDeletes, setPendingDeletes] = useState([]);
  const queueRef = useRef(null);
  const tasksRef = useRef(tasks);
  const tokenRef = useRef(token);
  const notifyRef = useRef(showNotification);
  const requestsRef = useRef(new Set());
  tasksRef.current = tasks;
  tokenRef.current = token;
  notifyRef.current = showNotification;

  useEffect(() => {
    setPendingDeletes([]);
    const queue = createDeletionQueue({
      onChange: setPendingDeletes,
      onCommit: async ({ id }) => {
        const controller = new AbortController();
        requestsRef.current.add(controller);
        try {
          const response = await fetchWithDiagnostics(API_BASE_URL + "/api/tasks/" + encodeURIComponent(id), {
            method: "DELETE",
            headers: { Authorization: "Bearer " + token },
            signal: controller.signal,
          }, "deletion");
          if (!response.ok) throw new Error("Failed to delete task");
          if (tokenRef.current === token) {
            setTasks(current => current.filter(task => task.id !== id));
            notifyRef.current("Task deleted.");
          }
        } finally {
          requestsRef.current.delete(controller);
        }
      },
      onError: error => {
        if (error.name !== "AbortError" && tokenRef.current === token) {
          console.warn("Task delete request failed");
          notifyRef.current("Couldn't delete task. It has been restored.", "error");
        }
      },
    });
    queueRef.current = queue;

    return () => {
      queue.dispose();
      if (queueRef.current === queue) queueRef.current = null;
      for (const controller of requestsRef.current) controller.abort();
      requestsRef.current.clear();
    };
  }, [token, setTasks]);

  const deleteTask = (id) => {
    if (!token || String(id).startsWith("temp-")) return;
    const task = tasksRef.current.find(item => item.id === id);
    if (task) queueRef.current?.schedule(task);
  };

  const undoDelete = (id) => {
    if (queueRef.current?.undo(id)) notifyRef.current("Deletion canceled.");
  };

  const pendingDeleteIds = new Set(pendingDeletes.map(record => record.id));
  return { pendingDeletes, pendingDeleteIds, deleteTask, undoDelete };
}
