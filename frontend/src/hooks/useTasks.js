import { useEffect, useState } from "react";
import { useUndoableDelete } from "./useUndoableDelete.js";
import { fetchWithDiagnostics } from "../utils/diagnostics.js";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5143";

export function useTasks({ token, onUnauthorized, showNotification }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newTask, setNewTask] = useState("");
  const [newPriority, setNewPriority] = useState("Medium");
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPriority, setEditPriority] = useState("Medium");
  const [newDueDate, setNewDueDate] = useState("");
  const [newCategory, setNewCategory] = useState("General");
  const [editCategory, setEditCategory] = useState("General");
  const [editDueDate, setEditDueDate] = useState("");
  const [loadingTask, setLoadingTask] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [addingTask, setAddingTask] = useState(false);
  const { pendingDeletes, pendingDeleteIds, deleteTask, undoDelete } = useUndoableDelete({
    token, tasks, setTasks, showNotification,
  });
    const fetchTasks = async () => {

      try {

        setLoading(true);

        setError("");

        const response = await fetchWithDiagnostics(
          `${API_BASE_URL}/api/tasks`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (response.status === 401) {
          onUnauthorized();
          return;
        }

        if (!response.ok) {
          throw new Error("Failed to fetch tasks");
        }

        const data = await response.json();



        setTasks(data);

      } catch {

        console.warn("Task list request failed");

        setError("Unable to load your tasks. Please try again.");

      } finally {

        setLoading(false);

      }

    };





    const retryFetchTasks = () => {

      fetchTasks();

    };

  // Get tasks from backend

    useEffect(() => {
      if (token) {
        fetchTasks();
      } else {
        setLoading(false);
        setTasks([]);
      }
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

  setEditingId(task.id);

  setEditTitle(task.title);

  setEditPriority(task.priority || "Medium");

  setEditCategory(task.category || "General");

  setEditDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "");

};



// Edit task
const editTask = async (id) => {
if (loadingTask?.id === id) return;

const previousTask = tasks.find(task => task.id === id);
if (!previousTask) return;

setLoadingTask({
  id,
  action: "edit",
});

  const updatedValues = {
    title: editTitle.trim(),
    priority: editPriority,
    category: editCategory,
    dueDate: editDueDate || null,
  };


  // Optimistically update UI
  setTasks((currentTasks) =>
    currentTasks.map((task) =>
      task.id === id
        ? {
            ...task,
            ...updatedValues,
          }
        : task
    )
  );


  // Exit edit mode immediately
  setEditingId(null);
  setEditTitle("");
  setEditPriority("Medium");
  setEditCategory("General");
  setEditDueDate("");

  try {
    const response = await fetchWithDiagnostics(
      `${API_BASE_URL}/api/tasks/${id}/title`,
      {
        method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
        body: JSON.stringify(updatedValues),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to edit task");
    }

    await response.json();

    if ((previousTask.dueDate?.slice(0, 10) ?? null) !== updatedValues.dueDate) {
      setLastMove(current => current?.id === id ? null : current);
    }
    showNotification("Task updated.");
  } catch {
    console.warn("Task edit request failed");

    // Roll back UI
    setTasks(current => current.map(task => task.id === id ? {
      ...task,
      title: previousTask.title,
      priority: previousTask.priority,
      category: previousTask.category,
      dueDate: previousTask.dueDate,
    } : task));

    showNotification(
      "Couldn't update task. Please try again.",
      "error"
    );
  }
  finally {
    setLoadingTask(null);
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
  };

  // Show task immediately
  setTasks((currentTasks) => [
    optimisticTask,
    ...currentTasks,
  ]);

  // Clear form immediately
  setNewTask("");
  setNewDueDate("");
  setNewPriority("Medium");
  setNewCategory("General");

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
        }),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to create task");
    }

    const createdTask = await response.json();

    // Replace temporary task with real database task
    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === tempId ? createdTask : task
      )
    );

    showNotification("Task added.");
  } catch {
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
    tasks, setTasks,
    loading, setLoading,
    error, setError,
    newTask, setNewTask,
    newPriority, setNewPriority,
    editingId, setEditingId,
    editTitle, setEditTitle,
    editPriority, setEditPriority,
    newDueDate, setNewDueDate,
    newCategory, setNewCategory,
    editCategory, setEditCategory,
    editDueDate, setEditDueDate,
    loadingTask, setLoadingTask,
    addingTask, setAddingTask,
    fetchTasks, retryFetchTasks, toggleTask, deleteTask, undoDelete,
    pendingDeletes, pendingDeleteIds, startEditing, editTask, addTask,
  };
}
