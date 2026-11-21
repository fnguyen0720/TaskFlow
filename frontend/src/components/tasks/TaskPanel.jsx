import { useEffect, useRef, useState } from "react";
import { formatDateForInput } from "../../utils/taskUtils.js";
import TaskCreateForm from "./TaskCreateForm.jsx";
import TaskFilters from "./TaskFilters.jsx";
import TaskList from "./TaskList.jsx";
import WeeklyCalendar from "./WeeklyCalendar.jsx";
import MonthlyCalendar from "./MonthlyCalendar.jsx";
import UndoDeleteToast from "./UndoDeleteToast.jsx";

const TASK_VIEWS = [
  { id: "all", label: "All tasks" },
  { id: "today", label: "Today", description: "Open tasks due today or overdue.", empty: "You're caught up for today." },
  { id: "upcoming", label: "Upcoming", description: "Open tasks with a future due date.", empty: "No upcoming tasks." },
  { id: "calendar", label: "Calendar", description: "Drag tasks between days, or open a task to change its due date." },
  { id: "unscheduled", label: "Unscheduled", description: "Open tasks without a due date.", empty: "No unscheduled tasks." },
];

export default function TaskPanel({ data, form, filters, editing, actions, planner }) {
  const { view, setView, views, quickCreateSignal } = planner;
  const current = TASK_VIEWS.find(option => option.id === view);
  const tasksInView = views[view];
  const isCalendar = view === "calendar";
  const [calendarMode, setCalendarMode] = useState("week");
  const titleRef = useRef(null);
  useEffect(() => {
    if (!quickCreateSignal) return;
    const frame = requestAnimationFrame(() => {
      titleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      titleRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [quickCreateSignal]);

  function addOnDate(date) {
    form.setDueDate(formatDateForInput(date));
    titleRef.current?.focus();
  }
  return (
    <section className="task-panel" aria-label="Task management">
      <nav className="planner-nav" aria-label="Task views">
        {TASK_VIEWS.map(option => (
          <button key={option.id} type="button" aria-pressed={view === option.id}
            onClick={() => setView(option.id)}>
            <span>{option.label}</span>
            {!data.loading && !data.error && views[option.id] && <span className="planner-count">{views[option.id].length}</span>}
          </button>
        ))}
      </nav>
      <div className="panel-heading">
        <div>
          <h2>{current.label}</h2>
          <p className="panel-subtitle">
            {data.error || data.readStatus === "failed"
              ? "Task count unavailable — please retry the server check."
              : data.loading || data.readStatus === "pending"
                ? "Checking your task list…"
                : data.readStatus === "confirmed-empty"
                  ? "Server returned no tasks for this signed-in account."
                  : current.description ?? `${data.totalCount} ${data.totalCount === 1 ? "task" : "tasks"} in your workspace`}
          </p>
        </div>
      </div>
      {data.undoableMove && (
        <div className="calendar-move-notice" aria-label="Calendar move">
          <span role="status">Moved <strong>{data.undoableMove.title}</strong></span>
          <button type="button" onClick={actions.undoMove} disabled={!!data.loadingTask}>Undo move</button>
          <button type="button" onClick={actions.dismissMove} disabled={!!data.loadingTask}
            aria-label="Dismiss calendar move">×</button>
        </div>
      )}
      {data.activeReminders?.length > 0 && (
        <section className="task-reminder-banner" aria-label="Due reminders" role="status">
          <strong>Reminders ({data.activeReminders.length})</strong>
          <span>{data.activeReminders.slice(0, 3).map(task => task.title).join(" · ")}</span>
          {data.activeReminders.length > 3 && <span> and {data.activeReminders.length - 3} more</span>}
        </section>
      )}
      <TaskCreateForm form={form} onAdd={actions.add} titleRef={titleRef} />
      {!data.loading && !data.error && data.readStatus === "confirmed-empty" && (
        <div className="task-account-empty" role="status">
          <strong>No tasks were returned for this signed-in account.</strong>
          <p>If you expected existing tasks, verify you're signed in to the same account you used before. This result does not mean your tasks were deleted.</p>
          <button type="button" onClick={actions.retry}>Check server again</button>
        </div>
      )}
      <TaskFilters filters={filters} showStatus={view === "all" || isCalendar} defaultSortLabel={view === "upcoming" ? "Default (due date)" : "Default"} />
      {isCalendar && !data.loading && !data.error ? (
        <>
          <div className="calendar-mode-switch" role="group" aria-label="Calendar display">
            <button type="button" aria-pressed={calendarMode === "week"}
              onClick={() => setCalendarMode("week")}>Week</button>
            <button type="button" aria-pressed={calendarMode === "month"}
              onClick={() => setCalendarMode("month")}>Month</button>
          </div>
          {calendarMode === "week"
            ? <WeeklyCalendar tasks={data.filteredTasks} onOpenTask={actions.openDetails}
                onAddTask={addOnDate} adding={form.adding}
                onRescheduleTask={actions.reschedule} loadingTask={data.loadingTask} />
            : <MonthlyCalendar tasks={data.filteredTasks} onOpenTask={actions.openDetails}
                onAddTask={addOnDate} adding={form.adding}
                onRescheduleTask={actions.reschedule} loadingTask={data.loadingTask} />}
        </>
      ) : (
        <TaskList data={data} editing={editing} actions={actions}
          viewEmptyMessage={tasksInView?.length === 0 ? current.empty : undefined} />
      )}
      <UndoDeleteToast pendingDeletes={data.pendingDeletes} onUndo={actions.undoDelete} />
    </section>
  );
}
