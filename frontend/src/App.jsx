import { useEffect, useState } from "react";
import AccountRecovery, { isResetLink } from "./components/auth/AccountRecovery.jsx";
import EmailVerificationNotice from "./components/auth/EmailVerificationNotice.jsx";
import { getTaskStats, getTaskViews, selectTasks } from "./utils/taskUtils.js";
import DashboardHeader from "./components/dashboard/DashboardHeader.jsx";
import DashboardOverview from "./components/dashboard/DashboardOverview.jsx";
import DailyFocus from "./components/dashboard/DailyFocus.jsx";
import TaskDetails from "./components/tasks/TaskDetails.jsx";
import TaskPanel from "./components/tasks/TaskPanel.jsx";
import { useAuth } from "./hooks/useAuth.js";
import { useNotification } from "./hooks/useNotification.js";
import { useTasks } from "./hooks/useTasks.js";
import { useNotificationCenter } from "./hooks/useNotificationCenter.js";
import { useNotificationPreferences } from "./hooks/useNotificationPreferences.js";
import { applyNotificationPreferences } from "./utils/notificationPreferences.js";
import { buildNotifications } from "./utils/notificationCenter.js";
import { remindersDue } from "./utils/reminders.js";

function App() {
  const [recoveryScreen, setRecoveryScreen] = useState(isResetLink);
  // The browser can navigate to an emailed fragment link in the SAME tab
  // without reloading the SPA. Recognize that navigation even when signed in.
  useEffect(() => {
    const onHashChange = () => {
      if (isResetLink()) setRecoveryScreen(true);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const [detailId, setDetailId] = useState(null);
  const [view, setView] = useState("all");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sort, setSort] = useState("default");

  const {
    token, authMode, authEmail, setAuthEmail, authPassword, setAuthPassword,
    authLoading, authError, logout: clearAuth, handleAuth, switchAuthMode,
  } = useAuth();
  const { notification, setNotification, showNotification } = useNotification();
  const notificationCenter = useNotificationCenter({ token, onUnauthorized: clearAuth });
  const notificationSettings = useNotificationPreferences({ token, onUnauthorized: clearAuth });
  const {
    tasks, setTasks, loading, error, setError, newTask, setNewTask,
    newPriority, setNewPriority, newCategory, setNewCategory, newDueDate, setNewDueDate,
    newRecurrence, setNewRecurrence, newReminder, setNewReminder,
    editingId, setEditingId, editTitle, setEditTitle, editPriority, setEditPriority,
    editCategory, setEditCategory, editDueDate, setEditDueDate,
    editRecurrence, setEditRecurrence, editReminder, setEditReminder, loadingTask,
    addingTask, pendingDeletes, pendingDeleteIds, retryFetchTasks,
    toggleTask, deleteTask, undoDelete, startEditing, editTask, addTask, saveDetails, rescheduleTask, undoMove, undoableMove, dismissMove,
  } = useTasks({ token, onUnauthorized: clearAuth, showNotification });

  const logout = () => {
    clearAuth();
    setDetailId(null);
    setTasks([]);
    setError("");
    setNotification(null);
    dismissMove();
  };

  // Pending deletions are hidden from the dashboard, but not removed from
  // the server until the Undo window expires.
  const visibleTasks = tasks.filter(task => !pendingDeleteIds.has(task.id));
  const activeReminders = remindersDue(visibleTasks);
  const notifications = applyNotificationPreferences(
    buildNotifications(visibleTasks, notificationCenter.states), notificationSettings.preferences);
  const { completedCount, totalCount, activeCount, overdueCount, dueTodayCount, completionRate } = getTaskStats(visibleTasks);
  const detailTask = visibleTasks.find(task => task.id === detailId);
  const views = getTaskViews(visibleTasks);
  const filteredTasks = selectTasks(views[view] ?? visibleTasks, {
    search,
    filter: view === "all" || view === "calendar" ? filter : "all",
    categoryFilter,
    sort: view === "upcoming" && sort === "default" ? "dueDate" : sort,
  });

  const form = {
    title: newTask, setTitle: setNewTask,
    priority: newPriority, setPriority: setNewPriority,
    category: newCategory, setCategory: setNewCategory,
    dueDate: newDueDate, setDueDate: setNewDueDate, adding: addingTask,
    recurrence: newRecurrence, setRecurrence: setNewRecurrence,
    reminder: newReminder, setReminder: setNewReminder,
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
    recurrence: editRecurrence, setRecurrence: setEditRecurrence,
    reminder: editReminder, setReminder: setEditReminder,
  };
  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
    setEditPriority("Medium");
    setEditCategory("General");
    setEditDueDate("");
    setEditRecurrence("None");
    setEditReminder("");
  };
  const actions = {
    add: addTask, toggle: toggleTask, delete: deleteTask, undoDelete,
    openDetails: setDetailId, reschedule: rescheduleTask, undoMove, dismissMove, startEditing, save: editTask, cancelEditing, retry: retryFetchTasks,
  };
  const data = {
    tasks: visibleTasks, filteredTasks, totalCount, loading, error, loadingTask, pendingDeletes, undoableMove,
    activeReminders,
  };

  if (!token || recoveryScreen) {
  return (
    <div className="app auth-page">
      <h1>TaskFlow</h1>
      <p className="subtitle">
        Stay organized. Get things done.
      </p>

      {recoveryScreen ? <AccountRecovery key="recovery" initialEmail={authEmail}
        onBack={() => setRecoveryScreen(false)} backLabel={token ? "Back to TaskFlow" : "Back to sign in"} /> : <form onSubmit={handleAuth} className="auth-form">
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
        {authMode === "login" && <button type="button" className="auth-switch"
          onClick={() => setRecoveryScreen(true)}>Forgot password?</button>}
      </form>}
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
      <EmailVerificationNotice token={token} />
      <DashboardHeader logout={logout} notifications={notifications}
        notificationCenter={notificationCenter} notificationSettings={notificationSettings}
        onOpenTask={setDetailId} />
      {loading ? (
        <section className="workspace-loading" role="status" aria-live="polite" aria-label="Loading workspace">
          <div className="workspace-loading-heading" />
          <div className="workspace-loading-cards" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => <div key={index} className="workspace-loading-card" />)}
          </div>
        </section>
      ) : !error ? (
        <>
          <DashboardOverview activeCount={activeCount} completedCount={completedCount} overdueCount={overdueCount} dueTodayCount={dueTodayCount} completionRate={completionRate} />
          <DailyFocus tasks={visibleTasks} onOpenTask={setDetailId} onView={setView} />
        </>
      ) : null}
      <TaskPanel data={data} form={form} filters={filters} editing={editing} actions={actions}
        planner={{ view, setView, views }} />
      {detailTask && (
        <TaskDetails key={detailTask.id} task={detailTask} onSave={saveDetails}
          onClose={() => setDetailId(null)} />
      )}
      <footer className="app-footer"><span>TaskFlow</span><span>Make room for what matters.</span></footer>
    </div>
  );
}

export default App;
