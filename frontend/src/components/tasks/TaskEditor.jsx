import { TASK_CATEGORIES, TASK_PRIORITIES } from "./taskOptions.js";

export default function TaskEditor({ task, editing, onSave, onCancel, busy }) {
  const { title, setTitle, priority, setPriority, category, setCategory, dueDate, setDueDate, recurrence, setRecurrence, reminder, setReminder } = editing;

  return (
    <div
      className="edit-container"
      onKeyDown={event => {
        if (event.key === "Escape" && !busy) {
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
        disabled={busy}
        aria-label={"Edit title for " + task.title}
        maxLength={100}
      />
      <div className="edit-options">
        <select
          className="edit-priority"
          disabled={busy}
          value={priority}
          aria-label={"Priority for " + task.title}
          onChange={event => setPriority(event.target.value)}
        >
          {TASK_PRIORITIES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select
          className="edit-category"
          disabled={busy}
          value={category}
          aria-label={"Category for " + task.title}
          onChange={event => setCategory(event.target.value)}
        >
          {TASK_CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <div className="edit-due-shell">
          <input
            className="edit-due-date"
            disabled={busy}
            type="date"
            value={dueDate}
            aria-label={"Due date for " + task.title}
            onChange={event => setDueDate(event.target.value)}
          />
        </div>
        <select className="edit-recurrence" disabled={busy} value={recurrence} onChange={event => setRecurrence(event.target.value)} aria-label={"Repeat " + task.title}>
          {["None", "Daily", "Weekly", "Monthly"].map(rule => <option key={rule} value={rule}>{rule}</option>)}
        </select>
        <select className="edit-reminder" disabled={busy} value={reminder} onChange={event => setReminder(event.target.value)} aria-label={"Reminder for " + task.title}>
          <option value="">Reminder off</option>
          <option value="0">On due date</option>
          <option value="1">1 day before</option>
          <option value="7">7 days before</option>
        </select>
        <button type="button" className="save-button" disabled={!title.trim() || busy || (!dueDate && (recurrence !== "None" || reminder !== ""))} aria-label={"Save changes to " + task.title} onClick={() => onSave(task.id)}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={busy} className="cancel-button" aria-label={"Cancel editing " + task.title} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {busy && <p role="status" className="edit-save-status">Saving changes…</p>}
      {editing.error && <p role="alert" className="edit-error">{editing.error} You can retry without retyping.</p>}
      {editing.error?.startsWith("This task changed elsewhere") && (
        <button type="button" className="task-conflict-reload" disabled={busy}
          onClick={editing.reloadLatest}>Discard draft and reload latest</button>
      )}
    </div>
  );
}
