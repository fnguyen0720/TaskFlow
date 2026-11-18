import { TASK_CATEGORIES, TASK_PRIORITIES } from "./taskOptions.js";

export default function TaskEditor({ task, editing, onSave, onCancel, busy }) {
  const { title, setTitle, priority, setPriority, category, setCategory, dueDate, setDueDate } = editing;

  return (
    <div
      className="edit-container"
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <input
        className="edit-input"
        type="text"
        value={title}
        onChange={event => setTitle(event.target.value)}
        autoFocus
        aria-label={"Edit title for " + task.title}
        maxLength={100}
      />
      <div className="edit-options">
        <select
          className="edit-priority"
          value={priority}
          aria-label={"Priority for " + task.title}
          onChange={event => setPriority(event.target.value)}
        >
          {TASK_PRIORITIES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select
          className="edit-category"
          value={category}
          aria-label={"Category for " + task.title}
          onChange={event => setCategory(event.target.value)}
        >
          {TASK_CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <input
          className="edit-due-date"
          type="date"
          value={dueDate}
          aria-label={"Due date for " + task.title}
          onChange={event => setDueDate(event.target.value)}
        />
        <button type="button" className="save-button" disabled={!title.trim() || busy} aria-label={"Save changes to " + task.title} onClick={() => onSave(task.id)}>
          Save
        </button>
        <button type="button" className="cancel-button" aria-label={"Cancel editing " + task.title} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
