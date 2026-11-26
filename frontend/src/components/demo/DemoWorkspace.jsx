import { useEffect, useRef, useState } from "react";
import DashboardOverview from "../dashboard/DashboardOverview.jsx";
import DailyFocus from "../dashboard/DailyFocus.jsx";
import MobileBottomNav from "../dashboard/MobileBottomNav.jsx";
import WeeklyCalendar from "../tasks/WeeklyCalendar.jsx";
import MonthlyCalendar from "../tasks/MonthlyCalendar.jsx";
import {
  formatDateForInput, formatDueDate, getDueDateClass,
  getTaskStats, getTaskViews, selectTasks,
} from "../../utils/taskUtils.js";

// No token, API hook, localStorage, cookie, or production record is used here.
// Reloading/leaving the demo discards all changes.
function offsetDate(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return formatDateForInput(date);
}

function sampleTasks() {
  return [
    { id: 1, title: "Plan the week", priority: "High", category: "Work", dueDate: offsetDate(0), completed: false },
    { id: 2, title: "Review project notes", priority: "Medium", category: "Work", dueDate: offsetDate(1), completed: false },
    { id: 3, title: "Make time for a break", priority: "Low", category: "Personal", dueDate: offsetDate(3), completed: false },
    { id: 4, title: "Explore TaskFlow", priority: "Low", category: "General", dueDate: offsetDate(-1), completed: true },
  ];
}

const emptyDraft = () => ({ title: "", priority: "Medium", dueDate: "" });
const labels = { all: "All tasks", today: "Today", upcoming: "Upcoming", calendar: "Calendar" };
const navItems = Object.entries(labels);

function DemoDetails({ task, onClose, onEdit }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialog.current?.querySelector("button")?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const buttons = [...dialog.current.querySelectorAll("button:not([disabled])")];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="demo-dialog-backdrop">
      <section className="demo-dialog" role="dialog" aria-modal="true"
        aria-labelledby="demo-dialog-title" ref={dialog}>
        <button className="demo-dialog-close" type="button" onClick={onClose} aria-label="Close task details">×</button>
        <span className="demo-pill">Sample task</span>
        <h2 id="demo-dialog-title">{task.title}</h2>
        <p>{task.completed ? "Completed" : "To do"} · {task.priority} priority</p>
        <p>{task.dueDate ? (task.completed ? `Due date: ${task.dueDate}` : formatDueDate(task.dueDate)) : "No due date"}</p>
        <button className="demo-primary" type="button" onClick={onEdit}>Edit task</button>
      </section>
    </div>
  );
}

export default function DemoWorkspace({ onExit }) {
  const [tasks, setTasks] = useState(sampleTasks);
  const nextId = useRef(5);
  const [draft, setDraft] = useState(emptyDraft);
  const [showOptions, setShowOptions] = useState(false);
  const [view, setView] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [calendarMode, setCalendarMode] = useState("week");
  const [lastMove, setLastMove] = useState(null);
  const titleRef = useRef(null);
  const stats = getTaskStats(tasks);
  const views = getTaskViews(tasks);
  const source = view === "calendar" || view === "all" ? tasks : views[view] || tasks;
  const filtered = selectTasks(source, {
    search, filter: view === "all" || view === "calendar" ? status : "all",
    sort: "dueDate",
  });
  const detailTask = tasks.find(task => task.id === detailId);

  function changeView(next) {
    const currentTask = tasks.find(task => task.id === editing?.id);
    const unsaved = currentTask && (editing.title !== currentTask.title ||
      editing.priority !== currentTask.priority || (editing.dueDate || null) !== currentTask.dueDate);
    if (unsaved && !window.confirm("Discard your demo task edits?")) return false;
    setEditing(null);
    setStatus("all");
    setView(next);
    return true;
  }

  function addTask(event) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) return;
    setTasks(current => [...current, {
      id: nextId.current++, title, priority: draft.priority,
      category: "General", dueDate: draft.dueDate || null, completed: false,
    }]);
    setDraft(emptyDraft());
    setShowOptions(false);
  }

  function startEditing(task) {
    setEditing({ id: task.id, title: task.title, priority: task.priority, dueDate: task.dueDate || "" });
  }

  function saveEditing() {
    if (!editing?.title.trim()) return;
    const { id, title, priority, dueDate } = editing;
    setTasks(current => current.map(task => task.id === id
      ? { ...task, title: title.trim(), priority, dueDate: dueDate || null } : task));
    setEditing(null);
  }

  function resetDemo() {
    setTasks(sampleTasks());
    nextId.current = 5;
    setDraft(emptyDraft());
    setShowOptions(false);
    setView("all");
    setStatus("all");
    setSearch("");
    setEditing(null);
    setDetailId(null);
    setLastMove(null);
    setCalendarMode("week");
  }

  function addOnDate(date) {
    setDraft(current => ({ ...current, dueDate: formatDateForInput(date) }));
    setShowOptions(true);
    titleRef.current?.focus();
    titleRef.current?.scrollIntoView({ block: "center" });
  }

  function moveTask(id, newDate) {
    const task = tasks.find(item => item.id === id);
    if (!task || task.dueDate === newDate) return;
    setLastMove({ id, oldDate: task.dueDate, title: task.title });
    setTasks(current => current.map(item => item.id === id ? { ...item, dueDate: newDate } : item));
  }

  function undoMove() {
    if (!lastMove) return;
    setTasks(current => current.map(item => item.id === lastMove.id
      ? { ...item, dueDate: lastMove.oldDate } : item));
    setLastMove(null);
  }

  function quickAdd() {
    titleRef.current?.focus();
    titleRef.current?.scrollIntoView({ block: "center" });
  }

  return (
    <div className="app demo-workspace" aria-label="Interactive demo workspace">
      <header className="dashboard-header demo-header">
        <div>
          <h1>TaskFlow<span className="brand-period">.</span></h1>
          <span className="demo-pill">Interactive demo</span>
        </div>
        <div className="demo-header-actions">
          <button className="demo-reset" type="button" onClick={resetDemo}>Reset demo</button>
          <button className="demo-primary" type="button" onClick={onExit}>Sign in / Register</button>
        </div>
      </header>
      <p className="demo-explainer">Try it freely. These are sample tasks, and your changes disappear when you leave or refresh. No account or server needed.</p>
      <DashboardOverview {...stats} />
      <DailyFocus tasks={tasks} onOpenTask={setDetailId} onView={changeView} />
      <section className="task-panel" aria-label="Task management">
        <nav className="planner-nav" aria-label="Task views">
          {navItems.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={view === id}
              onClick={() => changeView(id)}>
              {label}
              {id !== "calendar" && <span className="planner-count">{id === "all" ? tasks.length : views[id]?.length || 0}</span>}
            </button>
          ))}
        </nav>
        <div className="panel-heading"><h2>{labels[view]}</h2></div>
        {lastMove && <div className="demo-move-notice" role="status">
          Moved {lastMove.title} <button type="button" onClick={undoMove}>Undo move</button>
          <button type="button" onClick={() => setLastMove(null)} aria-label="Dismiss move">×</button>
        </div>}
        <form className="demo-create-form" onSubmit={addTask} aria-label="Add a new task">
          <div className="demo-add-row">
            <input ref={titleRef} type="text" maxLength={100} className="demo-title-input"
              aria-label="New task title" placeholder="Add a task…" value={draft.title}
              onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} />
            <button type="submit" className="demo-add-submit" disabled={!draft.title.trim()}>＋ Add task</button>
          </div>
          <div className="demo-options-row">
            <button className="demo-options-toggle" type="button" aria-expanded={showOptions}
              aria-controls="demo-create-options" onClick={() => setShowOptions(current => !current)}>
              {showOptions ? "Fewer options" : "More options"}
            </button>
            {!showOptions && (draft.priority !== "Medium" || draft.dueDate) &&
              <span className="demo-options-summary"> {draft.priority !== "Medium" ? draft.priority : ""}
                {draft.dueDate ? " · " + draft.dueDate : ""}</span>}
          </div>
          {showOptions && <div id="demo-create-options" className="demo-form-options">
            <label>Priority
              <select value={draft.priority} onChange={event => setDraft(current => ({ ...current, priority: event.target.value }))}>
                {["Low", "Medium", "High"].map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label>Due date
              <input type="date" aria-label="Demo due date" value={draft.dueDate}
                onChange={event => setDraft(current => ({ ...current, dueDate: event.target.value }))} />
            </label>
          </div>}
        </form>
        <div className="demo-filters">
          {(view === "all" || view === "calendar") && <div className="status-filters" role="group" aria-label="Task status">
            {[["all", "All"], ["active", "To do"], ["completed", "Done"]].map(([id, label]) =>
              <button className={status === id ? "filter active" : "filter"} aria-pressed={status === id}
                key={id} type="button" onClick={() => setStatus(id)}>{label}</button>)}
          </div>}
          <input type="search" className="search-input" value={search} aria-label="Search demo tasks"
            placeholder="Search tasks…" onChange={event => setSearch(event.target.value)} />
        </div>
        {view === "calendar" ? <>
          <div className="calendar-mode-switch" role="group" aria-label="Calendar display">
            <button type="button" aria-pressed={calendarMode === "week"} onClick={() => setCalendarMode("week")}>Week</button>
            <button type="button" aria-pressed={calendarMode === "month"} onClick={() => setCalendarMode("month")}>Month</button>
          </div>
          {calendarMode === "week"
            ? <WeeklyCalendar tasks={filtered} onOpenTask={setDetailId} onAddTask={addOnDate}
                adding={false} onRescheduleTask={moveTask} loadingTask={null} />
            : <MonthlyCalendar tasks={filtered} onOpenTask={setDetailId} onAddTask={addOnDate}
                adding={false} onRescheduleTask={moveTask} loadingTask={null} />}
        </> : <>
          {filtered.length === 0 && <div className="empty-state"><p>No matching tasks.</p><span>Try another view or search.</span></div>}
          <div className="task-list" role="list" aria-label="Tasks">
            {filtered.map(task => <div key={task.id} role="listitem"
              className={"task" + (task.completed ? " completed" : "")}>
              <button type="button" className="complete-button"
                aria-label={(task.completed ? "Mark incomplete: " : "Mark complete: ") + task.title}
                onClick={() => setTasks(current => current.map(item => item.id === task.id
                  ? { ...item, completed: !item.completed } : item))}>
                {task.completed ? "✓" : ""}
              </button>
              {editing?.id === task.id ? <div className="demo-edit-container">
                <input type="text" autoFocus maxLength={100} className="edit-input"
                  aria-label={"Edit title for " + task.title} value={editing.title}
                  onChange={event => setEditing(current => ({ ...current, title: event.target.value }))} />
                <select className="edit-priority" aria-label={"Priority for " + task.title} value={editing.priority}
                  onChange={event => setEditing(current => ({ ...current, priority: event.target.value }))}>
                  {["Low", "Medium", "High"].map(value => <option key={value}>{value}</option>)}
                </select>
                <input type="date" className="edit-due-date" aria-label={"Due date for " + task.title}
                  value={editing.dueDate} onChange={event => setEditing(current => ({ ...current, dueDate: event.target.value }))} />
                <button type="button" className="save-button" disabled={!editing.title.trim()} onClick={saveEditing}>Save</button>
                <button type="button" className="cancel-button" onClick={() => setEditing(null)}>Cancel</button>
              </div> : <>
                <div className="task-title"><button type="button" className="task-detail-trigger"
                  aria-haspopup="dialog" onClick={() => setDetailId(task.id)}>{task.title}</button></div>
                {!task.completed && task.dueDate && <span className={"task-due-date " + getDueDateClass(task.dueDate)}>{formatDueDate(task.dueDate)}</span>}
                <span className={"priority priority-" + task.priority.toLowerCase()}>{task.priority}</span>
                <span className="category">{task.category}</span>
                <button type="button" className="edit-button" aria-label={"Edit " + task.title} onClick={() => startEditing(task)}>Edit</button>
                <button type="button" className="delete-button" aria-label={"Delete " + task.title}
                  onClick={() => {
                    setTasks(current => current.filter(item => item.id !== task.id));
                    if (editing?.id === task.id) setEditing(null);
                  }}>Delete</button>
              </>}
            </div>)}
          </div>
        </>}
      </section>
      {detailTask && <DemoDetails task={detailTask} onClose={() => setDetailId(null)}
        onEdit={() => { setDetailId(null); setView("all"); setStatus("all"); startEditing(detailTask); }} />}
      {!detailTask && <MobileBottomNav view={view} onChangeView={changeView} onQuickCreate={quickAdd} />}
      <footer className="app-footer"><span>TaskFlow</span><span>Demo data only • Never saved</span></footer>
    </div>
  );
}
