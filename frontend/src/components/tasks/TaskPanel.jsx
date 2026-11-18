import TaskCreateForm from "./TaskCreateForm.jsx";
import TaskFilters from "./TaskFilters.jsx";
import TaskList from "./TaskList.jsx";
import UndoDeleteToast from "./UndoDeleteToast.jsx";

export default function TaskPanel({ data, form, filters, editing, actions }) {
  return (
    <section className="task-panel" aria-label="Task management">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">STAY ON TOP OF IT</span>
          <h2>Your tasks</h2>
          <p className="panel-subtitle">
            {data.totalCount} {data.totalCount === 1 ? "task" : "tasks"} in your workspace
          </p>
        </div>
      </div>
      <TaskCreateForm form={form} onAdd={actions.add} />
      <TaskFilters filters={filters} />
      <TaskList data={data} editing={editing} actions={actions} />
      <UndoDeleteToast pendingDeletes={data.pendingDeletes} onUndo={actions.undoDelete} />
    </section>
  );
}
