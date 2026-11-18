import { useState } from "react";
import { getTaskStats, selectTasks } from "./utils/taskUtils.js";
import DashboardHeader from "./components/dashboard/DashboardHeader.jsx";
import DashboardOverview from "./components/dashboard/DashboardOverview.jsx";
import TaskPanel from "./components/tasks/TaskPanel.jsx";
import { useAuth } from "./hooks/useAuth.js";
import { useNotification } from "./hooks/useNotification.js";
import { useTasks } from "./hooks/useTasks.js";

function App() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sort, setSort] = useState("default");

  const {
    token, authMode, authEmail, setAuthEmail, authPassword, setAuthPassword,
    authLoading, authError, logout: clearAuth, handleAuth, switchAuthMode,
  } = useAuth();
  const { notification, setNotification, showNotification } = useNotification();
  const {
    tasks, setTasks, loading, error, setError, newTask, setNewTask,
    newPriority, setNewPriority, newCategory, setNewCategory, newDueDate, setNewDueDate,
    editingId, setEditingId, editTitle, setEditTitle, editPriority, setEditPriority,
    editCategory, setEditCategory, editDueDate, setEditDueDate, loadingTask,
    addingTask, pendingDeletes, pendingDeleteIds, retryFetchTasks,
    toggleTask, deleteTask, undoDelete, startEditing, editTask, addTask,
  } = useTasks({ token, onUnauthorized: clearAuth, showNotification });

  const logout = () => {
    clearAuth();
    setTasks([]);
    setError("");
    setNotification(null);
  };

  // Pending deletions are hidden from the dashboard, but not removed from
  // the server until the Undo window expires.
  const visibleTasks = tasks.filter(task => !pendingDeleteIds.has(task.id));
  const { completedCount, totalCount, activeCount, overdueCount, dueTodayCount, completionRate } = getTaskStats(visibleTasks);
  const filteredTasks = selectTasks(visibleTasks, { search, filter, categoryFilter, sort });

  const form = {
    title: newTask, setTitle: setNewTask,
    priority: newPriority, setPriority: setNewPriority,
    category: newCategory, setCategory: setNewCategory,
    dueDate: newDueDate, setDueDate: setNewDueDate, adding: addingTask,
  };
  const filters = {
    status: filter, setStatus: setFilter,
    search, setSearch,
    category: categoryFilter, setCategory: setCategoryFilter,
    sort, setSort,
  };
  const editing = {
    id: editingId,
    title: editTitle, setTitle: setEditTitle,
    priority: editPriority, setPriority: setEditPriority,
    category: editCategory, setCategory: setEditCategory,
    dueDate: editDueDate, setDueDate: setEditDueDate,
  };
  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
    setEditPriority("Medium");
    setEditCategory("General");
    setEditDueDate("");
  };
  const actions = {
    add: addTask, toggle: toggleTask, delete: deleteTask, undoDelete,
    startEditing, save: editTask, cancelEditing, retry: retryFetchTasks,
  };
  const data = {
    tasks: visibleTasks, filteredTasks, totalCount, loading, error, loadingTask, pendingDeletes,
  };

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
          onClick={switchAuthMode}
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
      {notification && (
        <div className={"notification " + (notification.type === "error" ? "notification-error" : "notification-success")} role={notification.type === "error" ? "alert" : "status"}>
          <span>{notification.type === "error" ? "!" : "✓"}</span>
          <span>{notification.message}</span>
          <button type="button" className="notification-close" onClick={() => setNotification(null)} aria-label="Dismiss notification">×</button>
        </div>
      )}
      <DashboardHeader logout={logout} />
      <DashboardOverview activeCount={activeCount} completedCount={completedCount} overdueCount={overdueCount} dueTodayCount={dueTodayCount} completionRate={completionRate} />
      <TaskPanel data={data} form={form} filters={filters} editing={editing} actions={actions} />
      <footer className="app-footer"><span>TaskFlow</span><span>Make room for what matters.</span></footer>
    </div>
  );
}

export default App;
