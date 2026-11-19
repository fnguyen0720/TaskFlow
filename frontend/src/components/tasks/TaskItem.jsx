import { formatDueDate, getDueDateClass } from "../../utils/taskUtils.js";
import TaskEditor from "./TaskEditor.jsx";

export default function TaskItem({ task, editing, loadingTask, actions }) {
  const checklist = task.checklist ?? [];
  const checkedCount = checklist.filter(item => item.completed).length;
  const editingThis = editing.id === task.id;
  const busy = loadingTask?.id === task.id || String(task.id).startsWith("temp-");

  return (
    <div role="listitem" className={"task " + (task.completed ? "completed " : "") + (editingThis ? "editing" : "")}>
      <button
        type="button"
        className="complete-button"
        disabled={busy}
        onClick={() => actions.toggle(task.id)}
        aria-label={(task.completed ? "Mark incomplete: " : "Mark complete: ") + task.title}
      >
        {loadingTask?.id === task.id && loadingTask?.action === "toggle" ? "…" : task.completed ? "✓" : ""}
      </button>
      {editingThis ? (
        <TaskEditor
          task={task}
          editing={editing}
          busy={busy}
          onSave={actions.save}
          onCancel={actions.cancelEditing}
        />
      ) : (
        <>
          <div className="task-title">
            <button type="button" className="task-detail-trigger" disabled={busy}
              onClick={() => actions.openDetails(task.id)} aria-haspopup="dialog">
              {task.title}
            </button>
            {checklist.length > 0 && <span className="task-checklist-progress">
              {checkedCount}/{checklist.length} steps
            </span>}
          </div>
          {task.dueDate && (
            <span className={"task-due-date " + getDueDateClass(task.dueDate)}>
              {formatDueDate(task.dueDate)}
            </span>
          )}
          <span className={"priority priority-" + (task.priority || "medium").toLowerCase()}>{task.priority || "Medium"}</span>
          <span className="category">{task.category || "General"}</span>
          <button type="button" className="edit-button" aria-label={"Edit " + task.title} disabled={busy} onClick={() => actions.startEditing(task)}>Edit</button>
          <button type="button" className="delete-button" aria-label={"Delete " + task.title} disabled={busy} onClick={() => actions.delete(task.id)}>Delete</button>
        </>
      )}
    </div>
  );
}
