import { useEffect, useState } from "react";
import { TASK_CATEGORIES, TASK_PRIORITIES } from "./taskOptions.js";

export default function TaskCreateForm({ form, onAdd, titleRef }) {
  const { title, setTitle, priority, setPriority, category, setCategory,
    dueDate, setDueDate, adding, recurrence, setRecurrence, reminder, setReminder } = form;
  const [showOptions, setShowOptions] = useState(Boolean(dueDate));

  // Calendar-day quick-add can assign a date after this form has mounted.
  // Reveal that date so the user can confirm or change it before saving.
  useEffect(() => {
    if (dueDate) setShowOptions(true);
  }, [dueDate]);

  const dateText = dueDate
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
      .format(new Date(`${dueDate}T12:00:00`))
    : "Choose a date";
  const hasExtras = Boolean(dueDate) || priority !== "Medium" || category !== "General" ||
    recurrence !== "None" || reminder !== "";

  return (
    <form onSubmit={onAdd} className="task-form task-form-quick" aria-label="Add a new task">
      <div className="task-create-fields task-create-layout">
        <div className="task-quick-row">
          <input className="create-title" ref={titleRef} disabled={adding} type="text"
            placeholder="Add a task…" value={title} onChange={event => setTitle(event.target.value)}
            aria-label="New task title" maxLength={100} />
          <button className="create-submit" type="submit"
            disabled={adding || !title.trim() || (!dueDate && (recurrence !== "None" || reminder !== ""))}>
            {adding ? "Adding…" : "＋ Add task"}
          </button>
        </div>

        <div className="task-quick-options-line">
          <button type="button" className="task-options-toggle"
            aria-expanded={showOptions} aria-controls="task-create-options"
            onClick={() => setShowOptions(open => !open)}>
            <span aria-hidden="true">{showOptions ? "−" : "+"}</span>
            {showOptions ? "Fewer options" : "More options"}
          </button>
          {!showOptions && hasExtras && (
            <span className="task-quick-summary" aria-label="Selected task options">
              {[dueDate && dateText, priority !== "Medium" && priority,
                category !== "General" && category, recurrence !== "None" && recurrence,
                reminder !== "" && "Reminder"].filter(Boolean).join(" · ")}
            </span>
          )}
          {form.dirty && <button type="button" className="draft-discard-button"
            disabled={adding} onClick={form.discard}>Discard draft</button>}
        </div>

        {showOptions && <div id="task-create-options" className="task-advanced-fields">
          <div className="task-advanced-basic">
            <label>Priority
              <select className="create-priority" disabled={adding} value={priority}
                onChange={event => setPriority(event.target.value)}>
                {TASK_PRIORITIES.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>Category
              <select className="create-category" disabled={adding} value={category}
                onChange={event => setCategory(event.target.value)}>
                {TASK_CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <div className="create-date-group">
              <label htmlFor="task-create-due-date" className="create-date-label">Due date</label>
              <div className="create-date-shell">
                <span className="create-date-display" aria-hidden="true">{dateText}</span>
                <input id="task-create-due-date" className="create-due-date"
                  disabled={adding} type="date" value={dueDate}
                  onChange={event => setDueDate(event.target.value)} aria-label="Due date" />
              </div>
            </div>
          </div>
          <div className="task-advanced-schedule">
            <label className="task-schedule-control create-repeat">Repeat
              <select disabled={adding} value={recurrence}
                onChange={event => setRecurrence(event.target.value)} aria-label="Repeat task">
                {["None", "Daily", "Weekly", "Monthly"].map(rule =>
                  <option key={rule} value={rule}>{rule}</option>)}
              </select>
            </label>
            <label className="task-schedule-control create-reminder">Remind me
              <select disabled={adding} value={reminder}
                onChange={event => setReminder(event.target.value)} aria-label="Task reminder">
                <option value="">Off</option>
                <option value="0">On due date</option>
                <option value="1">1 day before</option>
                <option value="7">7 days before</option>
              </select>
            </label>
          </div>
        </div>}
      </div>
    </form>
  );
}
