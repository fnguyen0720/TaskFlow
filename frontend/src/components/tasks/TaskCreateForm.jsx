import { TASK_CATEGORIES, TASK_PRIORITIES } from "./taskOptions.js";

export default function TaskCreateForm({ form, onAdd, titleRef }) {
  const { title, setTitle, priority, setPriority, category, setCategory, dueDate, setDueDate, adding } = form;

  return (
    <form onSubmit={onAdd} className="task-form" aria-label="Add a new task">
      <input
        ref={titleRef}
        type="text"
        placeholder="What would you like to get done?"
        value={title}
        onChange={event => setTitle(event.target.value)}
        aria-label="New task title"
        maxLength={100}
      />
      <select value={priority} onChange={event => setPriority(event.target.value)} aria-label="Priority">
        {TASK_PRIORITIES.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <select value={category} onChange={event => setCategory(event.target.value)} aria-label="Category">
        {TASK_CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} aria-label="Due date" />
      <button type="submit" disabled={adding || !title.trim()}>
        {adding ? "Adding…" : "＋ Add task"}
      </button>
    </form>
  );
}
