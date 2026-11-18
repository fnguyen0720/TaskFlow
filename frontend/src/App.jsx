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
  const { token, authMode, authEmail, setAuthEmail, authPassword, setAuthPassword,
    authLoading, authError, logout: clearAuth, handleAuth, switchAuthMode } = useAuth();
  const { notification, setNotification, showNotification } = useNotification();
  const { tasks, setTasks, loading, setLoading, error, setError, newTask, setNewTask, newPriority, setNewPriority, editingId, setEditingId, editTitle, setEditTitle, editPriority, setEditPriority, newDueDate, setNewDueDate, newCategory, setNewCategory, editCategory, setEditCategory, editDueDate, setEditDueDate, loadingTask, setLoadingTask, addingTask, setAddingTask,
    retryFetchTasks, toggleTask, deleteTask, startEditing, editTask, addTask } =
    useTasks({ token, onUnauthorized: clearAuth, showNotification });
  const logout = () => {
    clearAuth();
    setTasks([]);
    setError("");
    setNotification(null);
  };

  const { completedCount, totalCount, activeCount, overdueCount, dueTodayCount, completionRate } = getTaskStats(tasks);
  const filteredTasks = selectTasks(tasks, { search, filter, categoryFilter, sort });

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
      {notification && <div className={"notification " + (notification.type === "error" ? "notification-error" : "notification-success")} role={notification.type === "error" ? "alert" : "status"}>
        <span>{notification.type === "error" ? "!" : "✓"}</span><span>{notification.message}</span>
        <button className="notification-close" onClick={() => setNotification(null)} aria-label="Dismiss notification">×</button>
      </div>}
      <DashboardHeader logout={logout} />
      <DashboardOverview activeCount={activeCount} completedCount={completedCount} overdueCount={overdueCount} dueTodayCount={dueTodayCount} completionRate={completionRate} />
      <TaskPanel totalCount={totalCount} addTask={addTask} newTask={newTask} setNewTask={setNewTask} newPriority={newPriority} setNewPriority={setNewPriority} newCategory={newCategory} setNewCategory={setNewCategory} newDueDate={newDueDate} setNewDueDate={setNewDueDate} addingTask={addingTask} filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} sort={sort} setSort={setSort} loading={loading} error={error} filteredTasks={filteredTasks} tasks={tasks} editingId={editingId} loadingTask={loadingTask} toggleTask={toggleTask} editTitle={editTitle} setEditTitle={setEditTitle} editPriority={editPriority} setEditPriority={setEditPriority} editCategory={editCategory} setEditCategory={setEditCategory} editDueDate={editDueDate} setEditDueDate={setEditDueDate} editTask={editTask} setEditingId={setEditingId} startEditing={startEditing} deleteTask={deleteTask} retryFetchTasks={retryFetchTasks} />
      <footer className="app-footer"><span>TaskFlow</span><span>Make room for what matters.</span></footer>
    </div>
  );
}

export default App;