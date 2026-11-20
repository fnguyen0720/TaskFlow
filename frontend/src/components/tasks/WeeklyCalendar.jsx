import { useState } from "react";
import { formatDateForInput, getWeekDays, getWeekOffsetForDate } from "../../utils/taskUtils.js";

const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const fullDayFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });

export default function WeeklyCalendar({ tasks, onOpenTask, onAddTask, adding, onRescheduleTask, loadingTask }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [jumpDate, setJumpDate] = useState("");
  const [draggedTask, setDraggedTask] = useState(null);
  const [dropDate, setDropDate] = useState(null);
  const [movingTaskId, setMovingTaskId] = useState(null);

  function finishDrag() {
    setDraggedTask(null);
    setDropDate(null);
  }

  function canDropOn(date) {
    return draggedTask && !loadingTask && draggedTask.dueDate?.slice(0, 10) !== date;
  }

  function dropTask(event, date) {
    if (!canDropOn(date)) return;
    event.preventDefault();
    finishDrag();
    onRescheduleTask(draggedTask.id, date);
  }

  const today = new Date();
  const days = getWeekDays(tasks, today, weekOffset);
  const jumpOffset = getWeekOffsetForDate(jumpDate, today);
  function jumpToDate(event) {
    event.preventDefault();
    if (jumpOffset !== null) setWeekOffset(jumpOffset);
  }
  const range = dateFormatter.formatRange(days[0].date, days[6].date);
  const totalTasks = days.reduce((sum, day) => sum + day.tasks.length, 0);

  return (
    <section className="weekly-calendar" aria-label="Weekly task calendar">
      <div className="calendar-toolbar">
        <div className="calendar-heading"><h3 aria-live="polite">{range}</h3><span className="calendar-task-count">{totalTasks} {totalTasks === 1 ? "task" : "tasks"} scheduled</span></div>
        <div className="calendar-controls" role="group" aria-label="Calendar navigation">
          <button type="button" aria-label="Previous week" onClick={() => setWeekOffset(offset => offset - 1)}>‹</button>
          <button type="button" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>This week</button>
          <button type="button" aria-label="Next week" onClick={() => setWeekOffset(offset => offset + 1)}>›</button>
        </div>
        <form className="calendar-jump calendar-controls" onSubmit={jumpToDate}>
          <label htmlFor="calendar-jump-date">Jump to date</label>
          <input id="calendar-jump-date" type="date" value={jumpDate}
            onChange={event => setJumpDate(event.target.value)} required />
          <button type="submit" disabled={jumpOffset === null}>Go</button>
        </form>
      </div>
      <p className="calendar-guidance">Select a task to view details, drag it to another day, or use its Move button for keyboard and touch access.</p>
      <div className="calendar-days">
        {days.map(({ date, isToday, tasks: dailyTasks }) => {
          const dateValue = formatDateForInput(date);
          return (
            <section key={dateValue} className={dropDate === dateValue ? "calendar-day calendar-drop-target" : "calendar-day"}
              aria-label={fullDayFormatter.format(date)}
              onDragOver={event => {
                if (!canDropOn(dateValue)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropDate(dateValue);
              }}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setDropDate(current => current === dateValue ? null : current);
                }
              }}
              onDrop={event => dropTask(event, dateValue)}>
              <h4 aria-current={isToday ? "date" : undefined}>{dayFormatter.format(date)} <span className="calendar-day-count">({dailyTasks.length})</span></h4>
              <button type="button" className="calendar-quick-add"
                aria-label={`Add task for ${fullDayFormatter.format(date)}`}
                disabled={adding} onClick={() => onAddTask(date)}>
                <span aria-hidden="true">+</span>
              </button>
              {dailyTasks.length === 0 ? <p className="calendar-empty">No tasks</p> : (
                <ul>
                  {dailyTasks.map(task => {
                    const busy = loadingTask?.id === task.id || String(task.id).startsWith("temp-");
                    return (
                      <li key={task.id} className="calendar-task-item">
                        <button type="button" className={task.completed ? "calendar-task is-complete" : "calendar-task"}
                          aria-haspopup="dialog"
                          aria-label={task.completed ? task.title + ", completed" : task.title}
                          disabled={busy} draggable={!busy && !loadingTask}
                          onDragStart={event => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", task.title);
                            setDraggedTask(task);
                          }}
                          onDragEnd={finishDrag}
                          onClick={() => onOpenTask(task.id)}>
                          {task.completed && <span aria-hidden="true">✓ </span>}
                          {task.title}
                        </button>
                        <button type="button" className="calendar-move-toggle"
                          aria-label={`Move ${task.title} to another day`}
                          aria-expanded={movingTaskId === task.id}
                          disabled={busy || Boolean(loadingTask)}
                          onClick={() => setMovingTaskId(current => current === task.id ? null : task.id)}>
                          Move
                        </button>
                        {movingTaskId === task.id && (
                          <div className="calendar-move-picker">
                            <label htmlFor={`calendar-move-${task.id}`}>Move to</label>
                            <select id={`calendar-move-${task.id}`} value="" disabled={busy || Boolean(loadingTask)}
                              onChange={event => {
                                const nextDate = event.target.value;
                                if (!nextDate) return;
                                setMovingTaskId(null);
                                if (nextDate !== task.dueDate?.slice(0, 10)) {
                                  onRescheduleTask(task.id, nextDate);
                                }
                              }}>
                              <option value="">Choose day...</option>
                              {days.map(day => {
                                const dayValue = formatDateForInput(day.date);
                                return <option key={dayValue} value={dayValue}
                                  disabled={dayValue === task.dueDate?.slice(0, 10)}>
                                  {fullDayFormatter.format(day.date)}{dayValue === task.dueDate?.slice(0, 10) ? " (current)" : ""}
                                </option>;
                              })}
                            </select>
                            <button type="button" onClick={() => setMovingTaskId(null)}>Cancel</button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
