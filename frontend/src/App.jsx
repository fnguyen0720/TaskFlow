import { useEffect, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5143";

function App() {

  const [tasks, setTasks] = useState([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");
  const [notification, setNotification] = useState(null);

  const [newTask, setNewTask] = useState("");

  const [newPriority, setNewPriority] = useState("Medium");

  const [editingId, setEditingId] = useState(null);

  const [editTitle, setEditTitle] = useState("");

  const [editPriority, setEditPriority] = useState("Medium");

  const [filter, setFilter] = useState("all");

  const [newDueDate, setNewDueDate] = useState("");

  const [search, setSearch] = useState("");

  const [newCategory, setNewCategory] = useState("General");

  const [editCategory, setEditCategory] = useState("General");

  const [editDueDate, setEditDueDate] = useState("");

  const [categoryFilter, setCategoryFilter] = useState("all");

  const [sort, setSort] = useState("default");

  const [loadingTask, setLoadingTask] = useState(null);

  const [addingTask, setAddingTask] = useState(false);

  const [token, setToken] = useState(
    () => localStorage.getItem("taskflow_token") || ""
  );

  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

    // Smart due date

    const formatDueDate = (dueDate) => {

      if (!dueDate) return "";



      const today = new Date();

      const due = new Date(dueDate);



      today.setHours(0, 0, 0, 0);

      due.setHours(0, 0, 0, 0);



      const difference =

        (due - today) / (1000 * 60 * 60 * 24);



      if (difference < 0) {

        return "⚠️ Overdue";

      }



      if (difference === 0) {

        return "📅 Today";

      }



      if (difference === 1) {

        return "📅 Tomorrow";

      }



      return `📅 ${due.toLocaleDateString()}`;

    };



    const getDueDateClass = (dueDate) => {

      if (!dueDate) return "";



      const today = new Date();

      const due = new Date(dueDate);



      today.setHours(0, 0, 0, 0);

      due.setHours(0, 0, 0, 0);



      if (due < today) {

        return "overdue";

      }



      return "";

    };



const logout = () => {
  localStorage.removeItem("taskflow_token");
  setToken("");
  setTasks([]);
  setError("");
  setNotification(null);
};

const handleAuth = async (e) => {
  e.preventDefault();
  setAuthLoading(true);
  setAuthError("");

  try {
    const isRegistering = authMode === "register";

    const endpoint = isRegistering
      ? "register"
      : "login?useCookies=false";

    const response = await fetch(
      `${API_BASE_URL}/${endpoint}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
        }),
      }
    );

    if (!response.ok) {
      const message = await response.text();

      throw new Error(
        message || "Authentication failed. Please try again."
      );
    }

    if (isRegistering) {
      setAuthMode("login");
      setAuthPassword("");
      setAuthError(
        "Account created! Please sign in."
      );
      return;
    }

    const data = await response.json();

    if (!data.accessToken) {
      throw new Error(
        "Login succeeded, but no access token was returned."
      );
    }

    localStorage.setItem(
      "taskflow_token",
      data.accessToken
    );

    setToken(data.accessToken);
    setAuthPassword("");
  } catch (error) {
    setAuthError(error.message);
  } finally {
    setAuthLoading(false);
  }
};

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
          logout();
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

    const showNotification = (message, type = "success") => {
      setNotification({ message, type });
    };

    useEffect(() => {
      if (!notification) return;

      const timer = setTimeout(() => {
        setNotification(null);
      }, 3000);

      return () => clearTimeout(timer);
    }, [notification]);

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


  // Task statistics

  const completedCount = tasks.filter(

    (task) => task.completed

  ).length;



  const totalCount = tasks.length;



  const activeCount = tasks.filter(

    (task) => !task.completed

  ).length;



  const overdueCount = tasks.filter((task) => {

    if (!task.dueDate || task.completed) return false;



    const today = new Date();

    const due = new Date(task.dueDate);



    today.setHours(0, 0, 0, 0);

    due.setHours(0, 0, 0, 0);



    return due < today;

  }).length;



  const dueTodayCount = tasks.filter((task) => {

    if (!task.dueDate || task.completed) return false;



    const today = new Date();

    const due = new Date(task.dueDate);



    today.setHours(0, 0, 0, 0);

    due.setHours(0, 0, 0, 0);



    return due.getTime() === today.getTime();

  }).length;



  const completionRate =

    totalCount === 0

      ? 0

      : Math.round((completedCount / totalCount) * 100);



const filteredTasks = tasks

  .filter((task) => {

    const matchesSearch = task.title

      .toLowerCase()

      .includes(search.toLowerCase());



    if (!matchesSearch) {

      return false;

    }



    if (filter === "active" && task.completed) {

      return false;

    }



    if (filter === "completed" && !task.completed) {

      return false;

    }



    if (

      categoryFilter !== "all" &&

      task.category !== categoryFilter

    ) {

      return false;

    }



    return true;

  })

  .sort((a, b) => {

    if (sort === "priority") {

      const priorityOrder = {

        High: 1,

        Medium: 2,

        Low: 3,

      };



      return (

        (priorityOrder[a.priority] || 4) -

        (priorityOrder[b.priority] || 4)

      );

    }



    if (sort === "dueDate") {

      if (!a.dueDate) return 1;

      if (!b.dueDate) return -1;



      return new Date(a.dueDate) - new Date(b.dueDate);

    }



    if (sort === "newest") {

      return b.id - a.id;

    }



    if (sort === "oldest") {

      return a.id - b.id;

    }



    return 0;

  });

if (!token) {
  return (
    <div className="app auth-page">
      <h1>TaskFlow</h1>
      <p className="subtitle">
        Stay organized. Get things done.
      </p>

      <form onSubmit={handleAuth} className="auth-form">
        <h2>
          {authMode === "login"
            ? "Welcome back"
            : "Create your account"}
        </h2>

        {authError && (
          <p
            role="alert"
            className={
              authError.startsWith("Account created!")
                ? "auth-success"
                : "auth-error"
            }
          >
            {authError}
          </p>
        )}

        <input
          type="email"
          placeholder="Email address"
          autoComplete="email"
          value={authEmail}
          onChange={(e) => setAuthEmail(e.target.value)}
          required
        />

        <input
          type="password"
          placeholder="Password"
          autoComplete={
            authMode === "login"
              ? "current-password"
              : "new-password"
          }
          value={authPassword}
          onChange={(e) => setAuthPassword(e.target.value)}
          required
        />

        <button type="submit" disabled={authLoading}>
          {authLoading
            ? "Please wait..."
            : authMode === "login"
              ? "Sign In"
              : "Create Account"}
        </button>

        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setAuthMode(
              authMode === "login" ? "register" : "login"
            );
            setAuthError("");
          }}
        >
          {authMode === "login"
            ? "Need an account? Register"
            : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}

  return (
    <div className="app">
      {notification && <div className={"notification " + (notification.type === "error" ? "notification-error" : "notification-success")} role="status">
        <span>{notification.type === "error" ? "!" : "✓"}</span><span>{notification.message}</span>
        <button className="notification-close" onClick={() => setNotification(null)} aria-label="Dismiss notification">×</button>
      </div>}
      <header className="dashboard-header">
        <div><div className="brand-kicker">YOUR PERSONAL WORKSPACE</div><h1>TaskFlow<span className="brand-period">.</span></h1><p className="subtitle">A little progress each day adds up to big results.</p></div>
        <button className="logout-button" onClick={logout}>Log out ↗</button>
      </header>
      <section className="dashboard-intro"><div><span className="section-kicker">OVERVIEW</span><h2>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}.</h2><p>Here’s what’s happening with your tasks.</p></div><span className="today-chip">{new Date().toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"})}</span></section>
      <section className="overview">
        <article className="overview-card"><span className="overview-label">In progress</span><span className="overview-value">{activeCount}</span><span className="stat-hint">Tasks to work on</span></article>
        <article className="overview-card"><span className="overview-label">Completed</span><span className="overview-value">{completedCount}</span><span className="stat-hint">Tasks finished</span></article>
        <article className="overview-card"><span className="overview-label">Overdue</span><span className="overview-value overdue-value">{overdueCount}</span><span className="stat-hint">Need your attention</span></article>
        <article className="overview-card"><span className="overview-label">Due today</span><span className="overview-value">{dueTodayCount}</span><span className="stat-hint">Keep moving forward</span></article>
        <article className="overview-card progress-card"><span className="overview-label">Completion rate</span><span className="overview-value">{completionRate}%</span><div className="progress-track"><span style={{width: completionRate + "%"}} /></div></article>
      </section>
      <section className="task-panel">
        <div className="panel-heading"><div><span className="section-kicker">STAY ON TOP OF IT</span><h2>Your tasks</h2><p className="panel-subtitle">{totalCount} {totalCount === 1 ? "task" : "tasks"} in your workspace</p></div></div>
        <form onSubmit={addTask} className="task-form">
          <input type="text" placeholder="What would you like to get done?" value={newTask} onChange={(e) => setNewTask(e.target.value)} aria-label="New task title" />
          <select value={newPriority} onChange={(e) => setNewPriority(e.target.value)} aria-label="Priority"><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select>
          <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} aria-label="Category"><option value="General">General</option><option value="Work">Work</option><option value="Study">Study</option><option value="Personal">Personal</option></select>
          <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} aria-label="Due date" />
          <button type="submit" disabled={addingTask || !newTask.trim()}>{addingTask ? "Adding…" : "＋ Add task"}</button>
        </form>
        <div className="filters">
          <div className="status-filters">{["all","active","completed"].map((value) => <button key={value} className={filter === value ? "filter active" : "filter"} onClick={() => setFilter(value)}>{value === "all" ? "All tasks" : value === "active" ? "In progress" : "Completed"}</button>)}</div>
          <div className="filter-options">
            <input className="search-input" type="search" placeholder="Search tasks…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search tasks" />
            <select className="filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter category"><option value="all">All categories</option><option value="General">General</option><option value="Work">Work</option><option value="Study">Study</option><option value="Personal">Personal</option></select>
            <select className="filter-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort tasks"><option value="default">Default</option><option value="priority">Priority</option><option value="dueDate">Due date</option><option value="newest">Newest</option><option value="oldest">Oldest</option></select>
          </div>
        </div>
        {loading && <div className="status-message"><div className="spinner" /><p>Loading tasks…</p></div>}
        {!loading && !error && filteredTasks.length === 0 && <div className="empty-state"><p>{tasks.length === 0 ? "Your space is ready." : "No tasks found."}</p><span>{tasks.length === 0 ? "Add your first task above to get started." : "Try adjusting your filters or search."}</span></div>}
        {!loading && !error && <div className="task-list">{filteredTasks.map((task) => <div key={task.id} className={"task " + (task.completed ? "completed " : "") + (editingId === task.id ? "editing" : "")}>
          <button className="complete-button" disabled={loadingTask?.id === task.id} onClick={() => toggleTask(task.id)} aria-label={task.completed ? "Mark incomplete" : "Mark complete"}>{loadingTask?.id === task.id && loadingTask?.action === "toggle" ? "…" : task.completed ? "✓" : ""}</button>
          {editingId === task.id ? <div className="edit-container">
            <input className="edit-input" type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} autoFocus aria-label="Edit task title" />
            <div className="edit-options"><select className="edit-priority" value={editPriority} onChange={(e) => setEditPriority(e.target.value)}><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select>
              <select className="edit-category" value={editCategory} onChange={(e) => setEditCategory(e.target.value)}><option value="General">General</option><option value="Work">Work</option><option value="Study">Study</option><option value="Personal">Personal</option></select>
              <input className="edit-due-date" type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} />
              <button className="save-button" onClick={() => editTask(task.id)}>Save</button>
              <button className="cancel-button" onClick={() => {setEditingId(null);setEditTitle("");setEditPriority("Medium");setEditCategory("General");setEditDueDate("");}}>Cancel</button></div>
          </div> : <>
            <span className="task-title">{task.title}</span>
            {task.dueDate && <span className={"task-due-date " + getDueDateClass(task.dueDate)}>{formatDueDate(task.dueDate)}</span>}
            <span className={"priority priority-" + (task.priority || "medium").toLowerCase()}>{task.priority || "Medium"}</span>
            <span className="category">{task.category || "General"}</span>
            <button className="edit-button" disabled={loadingTask?.id === task.id} onClick={() => startEditing(task)}>Edit</button>
            <button className="delete-button" disabled={loadingTask?.id === task.id} onClick={() => deleteTask(task.id)}>{loadingTask?.id === task.id && loadingTask?.action === "delete" ? "Deleting…" : "Delete"}</button>
          </>}
        </div>)}</div>}
        {error && <div className="status-message error-message"><p>{error}</p><button className="retry-button" onClick={retryFetchTasks}>Try again</button></div>}
      </section>
      <footer className="app-footer"><span>TaskFlow</span><span>Make room for what matters.</span></footer>
    </div>
  );
}

export default App;