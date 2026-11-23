import { useState } from "react";
import { formatDateForInput, getMonthDays } from "../../utils/taskUtils.js";

const headingFormat = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function MonthlyCalendar({ tasks, onOpenTask, onAddTask, adding, onRescheduleTask, loadingTask }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [movingId, setMovingId] = useState(null);
  const [moveDate, setMoveDate] = useState("");
  const [draggedTask, setDraggedTask] = useState(null);
  const [dropDate, setDropDate] = useState(null);

  function finishDrag() {
    setDraggedTask(null);
    setDropDate(null);
  }

  function canDrop(date) {
    return draggedTask && !loadingTask && draggedTask.dueDate?.slice(0, 10) !== date;
  }

  function dropTask(event, date) {
    if (!canDrop(date)) return;
    event.preventDefault();
    const taskId = draggedTask.id;
    finishDrag();
    onRescheduleTask(taskId, date);
  }
  const { month, days } = getMonthDays(tasks, new Date(), monthOffset);
  const visibleCount = days.filter(day => day.inMonth).reduce((sum, day) => sum + day.tasks.length, 0);

  function moveTask(task) {
    if (!moveDate || moveDate === task.dueDate?.slice(0, 10) || loadingTask) return;
    onRescheduleTask(task.id, moveDate);
    setMovingId(null);
    setMoveDate("");
  }

  return (
    <section className="monthly-calendar" aria-label="Monthly task calendar">
      <div className="calendar-toolbar">
        <div className="calendar-heading">
          <h3 aria-live="polite">{headingFormat.format(month)}</h3>
          <span className="calendar-task-count">{visibleCount} {visibleCount === 1 ? "task" : "tasks"} scheduled this month</span>
        </div>
        <div className="calendar-controls" role="group" aria-label="Month navigation">
          <button type="button" aria-label="Previous month" onClick={() => setMonthOffset(value => value - 1)}>‹</button>
          <button type="button" disabled={monthOffset === 0} onClick={() => setMonthOffset(0)}>This month</button>
          <button type="button" aria-label="Next month" onClick={() => setMonthOffset(value => value + 1)}>›</button>
        </div>
      </div>
      <p className="calendar-guidance">Drag a task to another day, open it for details, or use Move to reschedule with a date picker.</p>
      <div className="month-grid-scroll" role="region" aria-label="Scrollable month grid" tabIndex="0">
      <div className="month-grid" role="group" aria-label="Month days">
        {weekdayLabels.map(label => <div key={label} className="month-weekday" aria-hidden="true">{label}</div>)}
        {days.map(day => {
          const key = formatDateForInput(day.date);
          return (
            <section key={key} data-month-date={key}
              className={"month-day" + (day.inMonth ? "" : " month-day-outside") + (dropDate === key ? " month-day-drop-target" : "")}
              aria-label={fullFormat.format(day.date)}
              onDragOver={event => {
                if (!canDrop(key)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropDate(key);
              }}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setDropDate(current => current === key ? null : current);
              }}
              onDrop={event => dropTask(event, key)}>
              <div className="month-day-header">
                <span aria-current={day.isToday ? "date" : undefined}>{day.date.getDate()}</span>
                <button type="button" disabled={adding}
                  aria-label={"Add task for " + fullFormat.format(day.date)}
                  onClick={() => onAddTask(day.date)}>+</button>
              </div>
              <ul>
                {day.tasks.slice(0, 3).map(task => {
                  const busy = loadingTask?.id === task.id || String(task.id).startsWith("temp-");
                  return <li key={task.id} className="month-task"
                    draggable={!busy && !loadingTask}
                    onDragStart={event => {
                      if (busy || loadingTask) { event.preventDefault(); return; }
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(task.id));
                      setDraggedTask(task);
                    }}
                    onDragEnd={finishDrag}>
                    <button type="button" disabled={busy} className={task.completed ? "month-task-title done" : "month-task-title"}
                      onClick={() => onOpenTask(task.id)} aria-haspopup="dialog"
                      aria-label={task.title + (task.completed ? ", completed" : "")}>{task.title}</button>
                    <button type="button" disabled={busy || Boolean(loadingTask)}
                      aria-label={"Move " + task.title + " to date"}
                      aria-expanded={movingId === task.id}
                      onClick={() => { setMovingId(current => current === task.id ? null : task.id); setMoveDate(""); }}>Move</button>
                    {movingId === task.id && <div className="month-move">
                      <label htmlFor={"month-move-" + task.id}>Move to</label>
                      <input id={"month-move-" + task.id} type="date" value={moveDate}
                        onChange={event => setMoveDate(event.target.value)} />
                      <button type="button" disabled={!moveDate || Boolean(loadingTask)} onClick={() => moveTask(task)}>Apply</button>
                      <button type="button" onClick={() => setMovingId(null)}>Cancel</button>
                    </div>}
                  </li>;
                })}
              </ul>
              {day.tasks.length > 3 && <p className="month-more">{day.tasks.length - 3} more scheduled</p>}
            </section>
          );
        })}
      </div>
      </div>
    </section>
  );
}
