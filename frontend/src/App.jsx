import { useCallback, useEffect, useState } from "react";
import AccountRecovery, { isResetLink } from "./components/auth/AccountRecovery.jsx";
import EmailVerificationNotice from "./components/auth/EmailVerificationNotice.jsx";
import { getTaskStats, getTaskViews, selectTasks } from "./utils/taskUtils.js";
import DashboardHeader from "./components/dashboard/DashboardHeader.jsx";
import ViewPreferencesDialog from "./components/dashboard/ViewPreferencesDialog.jsx";
import MobileBottomNav from "./components/dashboard/MobileBottomNav.jsx";
import CommandPalette from "./components/dashboard/CommandPalette.jsx";
import DashboardOverview from "./components/dashboard/DashboardOverview.jsx";
import ProductivityInsights from "./components/dashboard/ProductivityInsights.jsx";
import DailyFocus from "./components/dashboard/DailyFocus.jsx";
import TaskDetails from "./components/tasks/TaskDetails.jsx";
import TaskPanel from "./components/tasks/TaskPanel.jsx";
import ProjectShelf from "./components/dashboard/ProjectShelf.jsx";
import { useProjects } from "./hooks/useProjects.js";
import { useAuth } from "./hooks/useAuth.js";
import { useAccountIdentity } from "./hooks/useAccountIdentity.js";
import { useViewPreferences } from "./hooks/useViewPreferences.js";
import { useNotification } from "./hooks/useNotification.js";
import { useTasks } from "./hooks/useTasks.js";
import { useNotificationCenter } from "./hooks/useNotificationCenter.js";
import { useNotificationPreferences } from "./hooks/useNotificationPreferences.js";
import { applyNotificationPreferences } from "./utils/notificationPreferences.js";
import { buildNotifications } from "./utils/notificationCenter.js";
import { remindersDue } from "./utils/reminders.js";

function App() {
  const [recoveryScreen, setRecoveryScreen] = useState(isResetLink);
  const [detailId, setDetailId] = useState(null);
  const [detailDirty, setDetailDirty] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [quickCreateSignal, setQuickCreateSignal] = useState(0);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [view, setView] = useState("all");
  const [selectedProject, setSelectedProject] = useState("all");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sort, setSort] = useState("default");

  const {
    token, authMode, authEmail, setAuthEmail, authPassword, setAuthPassword,
    authLoading, authError, sessionNotice, logout: clearAuth, handleAuth, switchAuthMode,
  } = useAuth();
  const handleUnauthorized = (requestToken) => clearAuth("expired", requestToken);
  const { notification, setNotification, showNotification } = useNotification();
  const accountIdentity = useAccountIdentity({ token, onUnauthorized: handleUnauthorized });
  const viewPreferences = useViewPreferences({ token, accountIdentity });
  const notificationCenter = useNotificationCenter({ token, onUnauthorized: handleUnauthorized });
  const notificationSettings = useNotificationPreferences({ token, onUnauthorized: handleUnauthorized });
  const {
    tasks, setTasks, loading, readStatus, error, setError, newTask, setNewTask,
    newPriority, setNewPriority, newCategory, setNewCategory, newDueDate, setNewDueDate,
    newRecurrence, setNewRecurrence, newReminder, setNewReminder,
    editingId, setEditingId, editingError, setEditingError, editVersion, setEditVersion,
    reloadLatestTask, editTitle, setEditTitle, editPriority, setEditPriority,
    editCategory, setEditCategory, editDueDate, setEditDueDate,
    editRecurrence, setEditRecurrence, editReminder, setEditReminder, loadingTask,
    addingTask, pendingDeletes, pendingDeleteIds, retryFetchTasks,
    toggleTask, deleteTask, undoDelete, startEditing, editTask, addTask, saveDetails, rescheduleTask, undoMove, undoableMove, dismissMove,
  } = useTasks({ token, onUnauthorized: handleUnauthorized, showNotification });

  const projects = useProjects({ token, onUnauthorized: handleUnauthorized, showNotification, setTasks });

  useEffect(() => {
    if (!token || viewPreferences.status !== "ready") return;
    setView(viewPreferences.preferences.landingView);
  }, [token, viewPreferences.status]);

  useEffect(() => {
    if (!token || recoveryScreen || detailId != null) return;
    const onShortcut = event => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [token, recoveryScreen, detailId]);

  useEffect(() => {
    if (!token || recoveryScreen || detailId != null) setCommandOpen(false);
  }, [token, recoveryScreen, detailId]);

  const createDirty = Boolean(
    newTask.trim() || newPriority !== "Medium" || newCategory !== "General" ||
    newDueDate || newRecurrence !== "None" || newReminder !== ""
  );
  const editingTask = tasks.find(task => task.id === editingId);
  const editDirty = Boolean(editingTask && (
    editTitle !== editingTask.title ||
    editPriority !== (editingTask.priority || "Medium") ||
    editCategory !== (editingTask.category || "General") ||
    editDueDate !== (editingTask.dueDate?.slice(0, 10) || "") ||
    editRecurrence !== (editingTask.recurrenceRule ?? "None") ||
    editReminder !== (editingTask.reminderDaysBefore == null ? "" : String(editingTask.reminderDaysBefore))
  ));
  const hasUnsavedWork = createDirty || editDirty || detailDirty;

  useEffect(() => {
    if (!hasUnsavedWork) return;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedWork]);

  const clearDrafts = useCallback(() => {
    setNewTask("");
    setNewPriority("Medium");
    setNewCategory("General");
    setNewDueDate("");
    setNewRecurrence("None");
    setNewReminder("");
    setEditingId(null);
    setEditingError("");
    setEditVersion(null);
    setEditTitle("");
    setEditPriority("Medium");
    setEditCategory("General");
    setEditDueDate("");
    setEditRecurrence("None");
    setEditReminder("");
    setDetailId(null);
    setDetailDirty(false);
    setCommandOpen(false);
  }, [setNewTask, setNewPriority, setNewCategory, setNewDueDate, setNewRecurrence,
    setNewReminder, setEditingId, setEditingError, setEditTitle, setEditPriority,
    setEditCategory, setEditDueDate, setEditRecurrence, setEditReminder]);

  // Clear account-specific drafts, filters, and transient UI on a session change.
  useEffect(() => {
    clearDrafts();
    setNotification(null);
    setPreferencesOpen(false);
    setView("all");
    setFilter("all");
    setSearch("");
    setSort("default");
    setCategoryFilter("all");
    setSelectedProject("all");
  }, [token]);

  // Password reset links can arrive via same-tab hash navigation.
  useEffect(() => {
    const onHashChange = () => {
      if (!isResetLink()) return;
      if (hasUnsavedWork && !window.confirm("Discard unsaved TaskFlow changes?")) {
        // Never leave a rejected reset token visible in the address-bar fragment.
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        return;
      }
      clearDrafts();
      setRecoveryScreen(true);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [hasUnsavedWork, clearDrafts]);

  const closePreferences = useCallback(() => setPreferencesOpen(false), []);
  const logout = () => {
    if (hasUnsavedWork && !window.confirm("Discard unsaved changes and log out?")) return;
    clearDrafts();
    clearAuth();
    setTasks([]);
    setError("");
    setNotification(null);
    dismissMove();
  };
  const discardCreateDraft = () => {
    if (addingTask) return;
    if (createDirty && !window.confirm("Discard your new task draft?")) return;
    setNewTask("");
    setNewPriority("Medium");
    setNewCategory("General");
    setNewDueDate("");
    setNewRecurrence("None");
    setNewReminder("");
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
  const projectTasks = selectedProject === "all" ? (views[view] ?? visibleTasks) :
    (views[view] ?? visibleTasks).filter(task => selectedProject === "none" ?
      task.projectId == null : String(task.projectId) === selectedProject);
  const filteredTasks = selectTasks(projectTasks, {
    search,
    filter: view === "all" || view === "calendar" ? filter : "all",
    categoryFilter,
    sort: view === "upcoming" && sort === "default" ? "dueDate" : sort,
  });

  const createProject = projects.status === "ready" && projects.projects.some(project =>
    String(project.id) === selectedProject)
    ? projects.projects.find(project => String(project.id) === selectedProject) : null;
  const form = {
    title: newTask, setTitle: setNewTask,
    priority: newPriority, setPriority: setNewPriority,
    category: newCategory, setCategory: setNewCategory,
    dueDate: newDueDate, setDueDate: setNewDueDate, adding: addingTask,
    recurrence: newRecurrence, setRecurrence: setNewRecurrence,
    reminder: newReminder, setReminder: setNewReminder,
    dirty: createDirty, discard: discardCreateDraft,
  };
  const filters = {
    status: filter, setStatus: setFilter,
    search, setSearch,
    category: categoryFilter, setCategory: setCategoryFilter,
    sort, setSort,
  };
  const editing = {
    id: editingId, error: editingError,
    reloadLatest: async () => {
      if (!window.confirm("Discard this draft and reload the latest task from the server?")) return;
      if (await reloadLatestTask()) cancelEditingWithoutPrompt();
    },
    title: editTitle, setTitle: setEditTitle,
    priority: editPriority, setPriority: setEditPriority,
    category: editCategory, setCategory: setEditCategory,
    dueDate: editDueDate, setDueDate: setEditDueDate,
    recurrence: editRecurrence, setRecurrence: setEditRecurrence,
    reminder: editReminder, setReminder: setEditReminder,
  };
  const cancelEditing = () => {
    if (editDirty && !window.confirm("Discard changes to this task?")) return;
    setEditingId(null);
    setEditingError("");
    setEditVersion(null);
    setEditTitle("");
    setEditPriority("Medium");
    setEditCategory("General");
    setEditDueDate("");
    setEditRecurrence("None");
    setEditReminder("");
  };
  const changeView = nextView => {
    if (nextView === view) return true;
    if (editDirty && !window.confirm("Discard task edits and switch views?")) return false;
    if (editingId !== null) cancelEditingWithoutPrompt();
    setView(nextView);
    return true;
  };
  const openTaskFromPalette = id => {
    if (editDirty && !window.confirm("Discard task edits and open another task?")) return false;
    if (editingId !== null) cancelEditingWithoutPrompt();
    setDetailId(id);
    return true;
  };
  const quickCreateFromPalette = () => {
    setQuickCreateSignal(count => count + 1);
    return true;
  };
  const cancelEditingWithoutPrompt = () => {
    setEditingId(null);
    setEditingError("");
    setEditVersion(null);
  };
  const actions = {
    add: event => addTask(event, createProject?.id ?? null), toggle: toggleTask, delete: deleteTask, undoDelete,
    openDetails: setDetailId, reschedule: rescheduleTask, undoMove, dismissMove, startEditing, save: editTask, cancelEditing, retry: retryFetchTasks,
  };
  const data = {
    tasks: visibleTasks, filteredTasks, totalCount, loading, readStatus, error, loadingTask, pendingDeletes, undoableMove,
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

        {sessionNotice && <p role="status" className="auth-success">{sessionNotice}</p>}
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
    <div className={`app ${viewPreferences.preferences.density === "compact" ? "density-compact" : ""}`}>
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
        accountIdentity={accountIdentity} onOpenTask={setDetailId} onOpenCommand={() => setCommandOpen(true)}
        onOpenPreferences={() => setPreferencesOpen(true)} preferencesReady={viewPreferences.status === "ready"} />
      {(loading || readStatus === "pending") && !error ? (
        <section className="workspace-loading" role="status" aria-live="polite" aria-label="Loading workspace">
          <div className="workspace-loading-heading" />
          <div className="workspace-loading-cards" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => <div key={index} className="workspace-loading-card" />)}
          </div>
        </section>
      ) : !error && (readStatus === "loaded" || readStatus === "confirmed-empty") ? (
        <>
          <DashboardOverview activeCount={activeCount} completedCount={completedCount} overdueCount={overdueCount} dueTodayCount={dueTodayCount} completionRate={completionRate} />
          <DailyFocus tasks={visibleTasks} onOpenTask={setDetailId} onView={changeView} />
          <ProductivityInsights tasks={visibleTasks} />
        </>
      ) : null}
      {projects.status === "ready" && <ProjectShelf projects={projects.projects} tasks={visibleTasks}
        selection={selectedProject} onSelect={setSelectedProject}
        onCreate={projects.createProject} creating={projects.creating} />}
      {projects.status === "failed" && <p className="project-load-error" role="alert">Projects could not load. Your tasks are still available.</p>}
      <TaskPanel data={data} form={form} filters={filters} editing={editing} actions={actions}
        planner={{ view, setView: changeView, views, quickCreateSignal }} />
      {commandOpen && !detailTask && <CommandPalette tasks={visibleTasks}
        onClose={() => setCommandOpen(false)} onOpenTask={openTaskFromPalette}
        onChangeView={changeView} onQuickCreate={quickCreateFromPalette} />}
      {preferencesOpen && viewPreferences.status === "ready" && (
        <ViewPreferencesDialog preferences={viewPreferences.preferences} onSave={viewPreferences.update}
          onClose={closePreferences} />
      )}
      {detailTask && (
        <TaskDetails key={detailTask.id} task={detailTask} onSave={saveDetails}
          token={token} onUnauthorized={handleUnauthorized}
          projects={projects.status === "ready" ? projects.projects : []}
          onAssignProject={projects.assignProject} assigningProject={projects.assigningId === detailTask.id}
          onReloadLatest={reloadLatestTask} onDirtyChange={setDetailDirty}
          onRestored={restored => {
            setTasks(current => current.map(task => task.id === restored.id ? restored : task));
            setDetailId(null);
            setDetailDirty(false);
            showNotification("Earlier task version restored.");
          }}
          onClose={() => { setDetailId(null); setDetailDirty(false); }} />
      )}
      {!detailTask && !commandOpen && <MobileBottomNav view={view} onChangeView={changeView}
        onQuickCreate={quickCreateFromPalette} />}
      <footer className="app-footer"><span>TaskFlow</span><span>Make room for what matters.</span></footer>
    </div>
  );
}

export default App;
