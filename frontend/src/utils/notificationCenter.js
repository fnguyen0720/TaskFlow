import { formatDateForInput } from "./taskUtils.js";

const ONE_DAY = 86400000;
function dayOrdinal(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(isoDate)) return null;
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  const ordinal = Date.UTC(year, month - 1, day) / ONE_DAY;
  const parsed = new Date(ordinal * ONE_DAY);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day ? ordinal : null;
}
export const notificationKey = (taskId, kind) => `${taskId}:${kind}`;

// Tasks are already owner-scoped by the authenticated API. Nothing in this
// derivation is sent to third-party analytics or stored in browser storage.
export function buildNotifications(tasks, states = [], now = new Date()) {
  const today = dayOrdinal(formatDateForInput(now));
  const stateByKey = new Map(states.map(state => [
    notificationKey(state.taskId, state.kind), state,
  ]));
  const notifications = [];
  for (const task of tasks) {
    if (task.completed || !Number.isInteger(task.id)) continue;
    const due = dayOrdinal(task.dueDate);
    if (due === null) continue;
    const daysUntil = due - today;
    let kind = null;
    if (daysUntil < 0) kind = "overdue";
    else if (daysUntil === 0) kind = "due-today";
    else if (task.reminderDaysBefore != null && daysUntil <= task.reminderDaysBefore) kind = "upcoming";
    if (!kind) continue;
    const state = stateByKey.get(notificationKey(task.id, kind));
    if (state?.isDismissed) continue;
    notifications.push({
      key: notificationKey(task.id, kind), taskId: task.id, kind,
      title: task.title, priority: task.priority,
      dueDate: task.dueDate.slice(0, 10), daysUntil,
      isRead: Boolean(state?.isRead),
    });
  }
  const weight = { overdue: 0, "due-today": 1, upcoming: 2 };
  return notifications.sort((a, b) =>
    (weight[a.kind] - weight[b.kind]) ||
    (a.daysUntil - b.daysUntil) ||
    ((a.priority === "High" ? 0 : 1) - (b.priority === "High" ? 0 : 1)) ||
    a.taskId - b.taskId);
}

export function getDailyFocus(tasks, now = new Date()) {
  const today = dayOrdinal(formatDateForInput(now));
  const open = tasks.filter(task => !task.completed && dayOrdinal(task.dueDate) !== null);
  const overdue = open.filter(task => dayOrdinal(task.dueDate) < today);
  const dueToday = open.filter(task => dayOrdinal(task.dueDate) === today);
  const upcoming = open.filter(task => {
    const diff = dayOrdinal(task.dueDate) - today;
    return diff >= 1 && diff <= 7;
  });
  const recurring = open.filter(task => task.recurrenceRule && task.recurrenceRule !== "None");
  const rank = task => task.priority === "High" ? 0 : task.priority === "Medium" ? 1 : 2;
  const sorted = [...overdue, ...dueToday, ...upcoming].sort((a,b) =>
    (dayOrdinal(a.dueDate) - dayOrdinal(b.dueDate)) || (rank(a) - rank(b)) || a.id - b.id);
  return { overdue: overdue.length, dueToday: dueToday.length, upcoming: upcoming.length,
    recurring: recurring.length, priorityTasks: sorted.slice(0, 4) };
}
