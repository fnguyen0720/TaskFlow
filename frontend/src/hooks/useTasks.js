import { useEffect, useRef, useState } from "react";
import { useUndoableDelete } from "./useUndoableDelete.js";
import { fetchWithDiagnostics } from "../utils/diagnostics.js";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5143";

export function useTasks({ token, onUnauthorized, showNotification }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // A zero count is meaningful only after the current account receives a valid 200 JSON array.
  const [verifiedRead, setVerifiedRead] = useState({ token: null, status: "pending" });
  const [newTask, setNewTask] = useState("");
  const [newPriority, setNewPriority] = useState("Medium");
  const [editingId, setEditingId] = useState(null);
  const [editingError, setEditingError] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editPriority, setEditPriority] = useState("Medium");
  const [newDueDate, setNewDueDate] = useState("");
  const [newRecurrence, setNewRecurrence] = useState("None");
  const [newReminder, setNewReminder] = useState("");
  const [newCategory, setNewCategory] = useState("General");
  const [editCategory, setEditCategory] = useState("General");
  const [editDueDate, setEditDueDate] = useState("");
  const [editRecurrence, setEditRecurrence] = useState("None");
  const [editReminder, setEditReminder] = useState("");
  const [loadingTask, setLoadingTask] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [addingTask, setAddingTask] = useState(false);
  const { pendingDeletes, pendingDeleteIds, deleteTask, undoDelete } = useUndoableDelete({
    token, tasks, setTasks, showNotification,
  });
  // Abort superseded requests and ignore any response from an old session.
  // A fast retry must never be overwritten by an earlier, slower response.
  const taskReadSequence = useRef(0);
  const activeTaskRead = useRef(null);
  const currentToken = useRef(token);
  currentToken.current = token;
  const readStatus = verifiedRead.token === token ? verifiedRead.status : "pending";

  const fetchTasks = async () => {
    if (!token || currentToken.current !== token) return;
    activeTaskRead.current?.abort();
    const controller = new AbortController();
    const sequence = ++taskReadSequence.current;
    activeTaskRead.current = controller;
    const isCurrent = () =>
      !controller.signal.aborted &&
      sequence === taskReadSequence.current &&
      currentToken.current === token;

    setLoading(true);
    setError("");
    setVerifiedRead({ token, status: "pending" });
    try {
      const response = await fetchWithDiagnostics(`${API_BASE_URL}/api/tasks`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      if (!response.ok) throw new Error("Failed to fetch tasks");
      const data = await response.json();
      if (!Array.isArray(data) || data.some(item => !item || typeof item !== "object" || !Number.isInteger(item.id) || typeof item.title !== "string")) {
        throw new Error("Unexpected task list response");
      }
      if (isCurrent()) {
        setTasks(data);
        setVerifiedRead({ token, status: data.length === 0 ? "confirmed-empty" : "loaded" });
      }
    } catch (error) {
      if (!isCurrent() || error?.name === "AbortError") return;
      console.warn("Task list request failed");
      setError("Could not verify your task list. No tasks have been deleted. Please retry.");
      setVerifiedRead({ token, status: "failed" });
    } finally {
      if (isCurrent()) {
        activeTaskRead.current = null;
        setLoading(false);
      }
    }
  };

  const retryFetchTasks = () => { void fetchTasks(); };

  useEffect(() => {
    // Clear the previous account's tasks when the session changes.
    setTasks([]);
    setError("");
    setVerifiedRead({ token, status: "pending" });
    if (token) {
      void fetchTasks();
    } else {
      setLoading(false);
    }
    return () => {
      ++taskReadSequence.current;
      activeTaskRead.current?.abort();
      activeTaskRead.current = null;
    };
  }, [token]);


// Toggle task

const toggleTask = async (id) => {
  if (loadingTask?.id === id) return;

  const previousTask = tasks.find(task => task.id === id);
  if (!previousTask) return;

  setLoadingTask({
    id,
    action: "toggle",
  });

  // Optimistically update UI
  setTasks((currentTasks) =>
    currentTasks.map((task) =>
      task.id === id
        ? { ...task, completed: !task.completed }
        : task
    )
  );

  try {
    const response = await fetchWithDiagnostics(
      `${API_BASE_URL}/api/tasks/${id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to update task");
    }

    await response.json();

    await fetchTasks();
    showNotification("Task updated.");
  } catch {
    console.warn("Task update request failed");

    // Roll back UI
    setTasks(current => current.map(task =>
      task.id === id ? { ...task, completed: previousTask.completed } : task
    ));

    showNotification(
      "Couldn't update task. Please try again.",
      "error"
    );
  } finally {
    setLoadingTask(null);
  }
};


  // Start editing a task

const startEditing = (task) => {

  setEditingError("");
  setEditingId(task.id);

  setEditTitle(task.title);

  setEditPriority(task.priority || "Medium");

  setEditCategory(task.category || "General");

  setEditDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "");
  setEditRecurrence(task.recurrenceRule ?? "None");
  setEditReminder(task.reminderDaysBefore == null ? "" : String(task.reminderDaysBefore));

};



// Keep the form and its values intact until the server confirms the edit.
// This allows a failed save to be retried without retyping any changes.
const editTask = async (id) => {
  if (loadingTask || editingId !== id) return;
  const previousTask = tasks.find(task => task.id === id);
  if (!previousTask) return;

  const updatedValues = {
    title: editTitle.trim(),
    priority: editPriority,
    category: editCategory,
    dueDate: editDueDate || null,
    recurrenceRule: editRecurrence,
    reminderDaysBefore: editReminder === "" ? null : Number(editReminder),
  };
  setEditingError("");
  setLoadingTask({ id, action: "edit" });

  try {
    const response = await fetchWithDiagnostics(`${API_BASE_URL}/api/tasks/${id}/title`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatedValues),
    });
    if (currentToken.current !== token) return;
    if (response.status === 401) {
      onUnauthorized();
      return;
    }
    if (!response.ok) throw new Error("Couldn't save changes. Your edits are still here. Please try again.");

    const savedTask = await response.json();
    if (currentToken.current !== token) return;
    setTasks(current => current.map(task => task.id === id ? { ...task, ...savedTask } : task));
    if ((previousTask.dueDate?.slice(0, 10) ?? null) !== updatedValues.dueDate) {
      setLastMove(current => current?.id === id ? null : current);
    }
    setEditingId(null);
    setEditTitle("");
    setEditPriority("Medium");
    setEditCategory("General");
    setEditDueDate("");
    setEditRecurrence("None");
    setEditReminder("");
    setEditingError("");
    showNotification("Task updated.");
  } catch {
    if (currentToken.current !== token) return;
    console.warn("Task edit request failed");
    setEditingError("Couldn't save changes. Your edits are still here. Please try again.");
  } finally {
    setLoadingTask(current => current?.id === id && current?.action === "edit" ? null : current);
  }
};


// Add task
const addTask = async (e) => {
  e.preventDefault();

  if (addingTask) return;
  if (!newTask.trim()) return;

  setAddingTask(true);

  const tempId = `temp-${Date.now()}`;


  const optimisticTask = {
    id: tempId,
    title: newTask.trim(),
    completed: false,
    priority: newPriority,
    category: newCategory,
    dueDate: newDueDate || null,
    recurrenceRule: newRecurrence,
    reminderDaysBefore: newReminder === "" ? null : Number(newReminder),
  };

  // Show task immediately
  setTasks((currentTasks) => [
    optimisticTask,
    ...currentTasks,
  ]);

  // Retain the complete draft until the server confirms creation.
  // Failed requests remove only the optimistic row, never form inputs.

  try {
    const response = await fetchWithDiagnostics(
      `${API_BASE_URL}/api/tasks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: optimisticTask.title,
          completed: false,
          priority: optimisticTask.priority,
          category: optimisticTask.category,
          dueDate: optimisticTask.dueDate,
          recurrenceRule: optimisticTask.recurrenceRule,
          reminderDaysBefore: optimisticTask.reminderDaysBefore,
        }),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to create task");
    }

    const createdTask = await response.json();
    // Never publish an old account's result after sign-out or account switch.
    if (currentToken.current !== token) return;

    // Replace temporary task with real database task
    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === tempId ? createdTask : task
      )
    );
    setNewTask("");
    setNewDueDate("");
    setNewPriority("Medium");
    setNewCategory("General");
    setNewRecurrence("None");
    setNewReminder("");
    showNotification("Task added.");
  } catch {
    if (currentToken.current !== token) return;
    console.warn("Task creation request failed");

    // Roll back
    setTasks(current => current.filter(task => task.id !== tempId));

    showNotification(
      "Couldn't add task. Please try again.",
      "error"
    );
  }
finally {
  setAddingTask(false);
}
};



  async function updateTaskFields(id, endpoint, changes, errorMessage, method = "PUT") {
    const response = await fetchWithDiagnostics(`${API_BASE_URL}/api/tasks/${id}/${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(changes),
    });

    if (response.status === 401) {
      onUnauthorized();
      return;
    }
    if (!response.ok) throw new Error(errorMessage, { cause: response.status });
    return response.json();
  }

  async function saveDetails(id, details) {
    const result = await updateTaskFields(id, "details", details, "Couldn't save task details. Please try again.");
    if (!result) return;
    const { notes, checklist, dueDate } = result;
    setTasks(current => current.map(task => task.id === id ? {
      ...task, notes, checklist,
      ...(details.updateDueDate ? { dueDate } : {}),
    } : task));
    if (details.updateDueDate) setLastMove(current => current?.id === id ? null : current);
    showNotification("Task details saved.");
  }

  const movedTask = lastMove?.session === token && tasks.find(task =>
    task.id === lastMove.id && !pendingDeleteIds.has(task.id) && task.dueDate?.slice(0, 10) === lastMove.date
  );
  const undoableMove = movedTask ? { ...lastMove, title: movedTask.title } : null;

  async function saveMove(id, date, expectedDueDate, undoing = false) {
    if (loadingTask) return;
    setLoadingTask({ id, action: "reschedule" });
    const failureMessage = undoing ? "Couldn't undo the move. Please try again." : "Couldn't move the task. Please try again.";
    try {
      const result = await updateTaskFields(id, "due-date", { dueDate: date, expectedDueDate }, failureMessage, "PATCH");
      if (!result) return;
      setTasks(current => current.map(task =>
        task.id === id ? { ...task, dueDate: result.dueDate } : task
      ));
      if (undoing) {
        setLastMove(null);
        showNotification("Original due date restored.");
      } else {
        setLastMove({ id, date, previousDate: expectedDueDate, session: token });
      }
    } catch (error) {
      if (error.cause === 409 || error.cause === 404) {
        if (undoing) setLastMove(null);
        showNotification("This task changed elsewhere. Refreshing your tasks.", "error");
        await fetchTasks();
      } else {
        showNotification(failureMessage, "error");
      }
    } finally {
      setLoadingTask(current => current?.action === "reschedule" && current.id === id ? null : current);
    }
  }

  function rescheduleTask(id, date) {
    const previousDate = tasks.find(task => task.id === id)?.dueDate?.slice(0, 10);
    if (previousDate && previousDate !== date) return saveMove(id, date, previousDate);
  }

  function undoMove() {
    if (undoableMove) return saveMove(undoableMove.id, undoableMove.previousDate, undoableMove.date, true);
  }

  return {
    saveDetails, rescheduleTask, undoMove, undoableMove,
    dismissMove: () => setLastMove(null),
    tasks: readStatus === "pending" && verifiedRead.token !== token ? [] : tasks, setTasks,
    readStatus, loading, setLoading,
    error, setError,
    newTask, setNewTask,
    newPriority, setNewPriority,
    editingId, setEditingId, editingError, setEditingError,
    editTitle, setEditTitle,
    editPriority, setEditPriority,
    newDueDate, setNewDueDate,
    newCategory, setNewCategory,
    newRecurrence, setNewRecurrence, newReminder, setNewReminder,
    editCategory, setEditCategory,
    editRecurrence, setEditRecurrence, editReminder, setEditReminder,
    editDueDate, setEditDueDate,
    loadingTask, setLoadingTask,
    addingTask, setAddingTask,
    fetchTasks, retryFetchTasks, toggleTask, deleteTask, undoDelete,
    pendingDeletes, pendingDeleteIds, startEditing, editTask, addTask,
  };
}
