import { useEffect, useState } from "react";

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
  const [addingTask, setAddingTask] = useState(false);
    const fetchTasks = async () => {

      try {

        setLoading(true);

        setError("");

        const response = await fetch(
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

      } catch (error) {

        console.error("Error fetching tasks:", error);

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

  setLoadingTask({
    id,
    action: "toggle",
  });

  const previousTasks = tasks;

  // Optimistically update UI
  setTasks((currentTasks) =>
    currentTasks.map((task) =>
      task.id === id
        ? { ...task, completed: !task.completed }
        : task
    )
  );

  try {
    const response = await fetch(
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
  } catch (error) {
    console.error("Error updating task:", error);

    // Roll back UI
    setTasks(previousTasks);

    showNotification(
      "Couldn't update task. Please try again.",
      "error"
    );
  } finally {
    setLoadingTask(null);
  }
};


// Delete task
const deleteTask = async (id) => {
if (loadingTask?.id === id) return;

setLoadingTask({
  id,
  action: "delete",
});

  const previousTasks = tasks;

  // Optimistically remove task
  setTasks((currentTasks) =>
    currentTasks.filter((task) => task.id !== id)
  );

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/tasks/${id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to delete task");
    }

    showNotification("Task deleted.");
  } catch (error) {
    console.error("Error deleting task:", error);

    // Roll back UI
    setTasks(previousTasks);

    showNotification(
      "Couldn't delete task. Please try again.",
      "error"
    );
  }
  finally {
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

setLoadingTask({
  id,
  action: "edit",
});

  const previousTasks = tasks;

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
    const response = await fetch(
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

    showNotification("Task updated.");
  } catch (error) {
    console.error("Error editing task:", error);

    // Roll back UI
    setTasks(previousTasks);

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

  const previousTasks = tasks;

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
    const response = await fetch(
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
  } catch (error) {
    console.error("Error creating task:", error);

    // Roll back
    setTasks(previousTasks);

    showNotification(
      "Couldn't add task. Please try again.",
      "error"
    );
  }
finally {
  setAddingTask(false);
}
};



  return {
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
    fetchTasks, retryFetchTasks, toggleTask, deleteTask, startEditing, editTask, addTask,
  };
}
