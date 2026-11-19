import { useState } from "react";
import { formatDateForInput, getWeekDays } from "../../utils/taskUtils.js";

const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const fullDayFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });

export default function WeeklyCalendar({ tasks, onOpenTask, onAddTask, adding, onRescheduleTask, loadingTask }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [draggedTask, setDraggedTask] = useState(null);
  const [dropDate, setDropDate] = useState(null);

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

  const days = getWeekDays(tasks, new Date(), weekOffset);
  const range = dateFormatter.formatRange(days[0].date, days[6].date);

  return (
    <section className="weekly-calendar" aria-label="Weekly task calendar">
      <div className="calendar-toolbar">
        <h3 aria-live="polite">{range}</h3>
        <div className="calendar-controls" role="group" aria-label="Calendar navigation">
          <button type="button" aria-label="Previous week" onClick={() => setWeekOffset(offset => offset - 1)}>‹</button>
          <button type="button" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>This week</button>
          <button type="button" aria-label="Next week" onClick={() => setWeekOffset(offset => offset + 1)}>›</button>
        </div>
      </div>
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
              <h4 aria-current={isToday ? "date" : undefined}>{dayFormatter.format(date)}</h4>
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
                      <li key={task.id}>
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
