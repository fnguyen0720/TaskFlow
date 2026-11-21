import { TASK_CATEGORIES, TASK_PRIORITIES } from "./taskOptions.js";

export default function TaskCreateForm({ form, onAdd, titleRef }) {
  const { title, setTitle, priority, setPriority, category, setCategory, dueDate, setDueDate, adding, recurrence, setRecurrence, reminder, setReminder } = form;

  return (
    <form onSubmit={onAdd} className="task-form" aria-label="Add a new task">
      <div className="task-create-fields">
      <input
        className="create-title"
        ref={titleRef}
        disabled={adding}
        type="text"
        placeholder="What would you like to get done?"
        value={title}
        onChange={event => setTitle(event.target.value)}
        aria-label="New task title"
        maxLength={100}
      />
      <select className="create-priority" disabled={adding} value={priority} onChange={event => setPriority(event.target.value)} aria-label="Priority">
        {TASK_PRIORITIES.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <select className="create-category" disabled={adding} value={category} onChange={event => setCategory(event.target.value)} aria-label="Category">
        {TASK_CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <input className="create-due-date" disabled={adding} type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} aria-label="Due date" />
      <label className="task-schedule-control create-repeat">Repeat
        <select disabled={adding} value={recurrence} onChange={event => setRecurrence(event.target.value)} aria-label="Repeat task">
          {["None", "Daily", "Weekly", "Monthly"].map(rule => <option key={rule} value={rule}>{rule}</option>)}
        </select>
      </label>
      <label className="task-schedule-control create-reminder">Remind me
        <select disabled={adding} value={reminder} onChange={event => setReminder(event.target.value)} aria-label="Task reminder">
          <option value="">Off</option>
          <option value="0">On due date</option>
          <option value="1">1 day before</option>
          <option value="7">7 days before</option>
        </select>
      </label>
      <button className="create-submit" type="submit" disabled={adding || !title.trim() || (!dueDate && (recurrence !== "None" || reminder !== ""))}>
        {adding ? "Adding…" : "＋ Add task"}
      </button>
      {form.dirty && <button type="button" className="draft-discard-button" disabled={adding} onClick={form.discard}>Discard draft</button>}
      </div>
    </form>
  );
}
