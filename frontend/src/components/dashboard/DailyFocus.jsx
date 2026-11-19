import { getDailyFocus } from "../../utils/notificationCenter.js";

export default function DailyFocus({ tasks, onOpenTask, onView }) {
  const focus = getDailyFocus(tasks);
  return (
    <section className="daily-focus" aria-label="Daily focus">
      <div className="daily-focus-heading">
        <div><span className="section-kicker">YOUR DAY</span><h2>Daily focus</h2>
          <p>Start with what matters most.</p></div>
        <button type="button" onClick={() => onView("today")}>See today's tasks</button>
      </div>
      <div className="daily-focus-stats">
        <span><strong>{focus.overdue}</strong> overdue</span>
        <span><strong>{focus.dueToday}</strong> due today</span>
        <span><strong>{focus.upcoming}</strong> next 7 days</span>
        <span><strong>{focus.recurring}</strong> recurring</span>
      </div>
      {focus.priorityTasks.length > 0 ?
        <ul className="daily-focus-list">
          {focus.priorityTasks.map(task => (
            <li key={task.id}>
              <button type="button" onClick={() => onOpenTask(task.id)}>
                <span className="daily-focus-title">{task.title}</span>
                <span className="daily-focus-date">{task.dueDate?.slice(0, 10)}</span>
                <span className={`daily-focus-priority priority-${(task.priority || "medium").toLowerCase()}`}>
                  {task.priority || "Medium"}</span>
              </button>
            </li>
          ))}
        </ul> :
        <p className="daily-focus-empty">Nothing urgent. Add a due date to plan your day.</p>}
    </section>
  );
}
