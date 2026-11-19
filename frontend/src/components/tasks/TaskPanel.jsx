import { useRef } from "react";
import TaskCreateForm from "./TaskCreateForm.jsx";
import TaskFilters from "./TaskFilters.jsx";
import TaskList from "./TaskList.jsx";
import WeeklyCalendar from "./WeeklyCalendar.jsx";
import UndoDeleteToast from "./UndoDeleteToast.jsx";

const TASK_VIEWS = [
  { id: "all", label: "All tasks" },
  { id: "today", label: "Today", description: "Open tasks due today or overdue.", empty: "You're caught up for today." },
  { id: "upcoming", label: "Upcoming", description: "Open tasks with a future due date.", empty: "No upcoming tasks." },
  { id: "calendar", label: "Calendar", description: "See your deadlines across the week." },
  { id: "unscheduled", label: "Unscheduled", description: "Open tasks without a due date.", empty: "No unscheduled tasks." },
];

export default function TaskPanel({ data, form, filters, editing, actions, planner }) {
  const { view, setView, views } = planner;
  const current = TASK_VIEWS.find(option => option.id === view);
  const tasksInView = views[view];
  const isCalendar = view === "calendar";
  const titleRef = useRef(null);

  function addOnDate(date) {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    form.setDueDate(`${year}-${month}-${day}`);
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
            {current.description ?? `${data.totalCount} ${data.totalCount === 1 ? "task" : "tasks"} in your workspace`}
          </p>
        </div>
      </div>
      <TaskCreateForm form={form} onAdd={actions.add} titleRef={titleRef} />
      <TaskFilters filters={filters} showStatus={view === "all" || isCalendar} defaultSortLabel={view === "upcoming" ? "Default (due date)" : "Default"} />
      {isCalendar && !data.loading && !data.error ? (
        <WeeklyCalendar tasks={data.filteredTasks} onOpenTask={actions.openDetails}
          onAddTask={addOnDate} adding={form.adding} />
      ) : (
        <TaskList data={data} editing={editing} actions={actions}
          viewEmptyMessage={tasksInView?.length === 0 ? current.empty : undefined} />
      )}
      <UndoDeleteToast pendingDeletes={data.pendingDeletes} onUndo={actions.undoDelete} />
    </section>
  );
}
