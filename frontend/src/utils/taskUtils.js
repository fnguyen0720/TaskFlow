// Treat task due dates as calendar dates, not instants in a particular time zone.
// The API may return midnight UTC; converting that instant to local time can
// display the previous day in time zones west of UTC.
const calendarDate = (value) => {
  if (!value) return null;

  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[Tt ])/u.exec(value);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const result = new Date(year, month - 1, day);
      // Reject invalid dates rather than silently rolling them into another month.
      if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) {
        return null;
      }
      return result;
    }
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

// UTC day numbers are used only for arithmetic, avoiding DST-length days.
const dayNumber = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
const dueDayNumber = (value) => {
  const date = calendarDate(value);
  return date ? dayNumber(date) : null;
};

export function formatDueDate(dueDate, now = new Date()) {
  const due = calendarDate(dueDate);
  const today = calendarDate(now);
  if (!due || !today) return "";

  const difference = dayNumber(due) - dayNumber(today);
  if (difference < 0) return "⚠️ Overdue";
  if (difference === 0) return "📅 Today";
  if (difference === 1) return "📅 Tomorrow";
  return `📅 ${due.toLocaleDateString()}`;
}

export function getDueDateClass(dueDate, now = new Date()) {
  const due = dueDayNumber(dueDate);
  const today = dueDayNumber(now);
  return due !== null && today !== null && due < today ? "overdue" : "";
}

export function getTaskStats(tasks, now = new Date()) {
  const today = dueDayNumber(now);
  const completedCount = tasks.filter(task => task.completed).length;
  const totalCount = tasks.length;
  const activeCount = totalCount - completedCount;
  const overdueCount = tasks.filter(task => !task.completed && task.dueDate && (
    today !== null && dueDayNumber(task.dueDate) !== null && dueDayNumber(task.dueDate) < today
  )).length;
  const dueTodayCount = tasks.filter(task => !task.completed && task.dueDate && (
    today !== null && dueDayNumber(task.dueDate) === today
  )).length;
  const completionRate = totalCount ? Math.round(completedCount / totalCount * 100) : 0;
  return { completedCount, totalCount, activeCount, overdueCount, dueTodayCount, completionRate };
}

export function selectTasks(tasks, { search = "", filter = "all", categoryFilter = "all", sort = "default" } = {}) {
  const term = search.trim().toLowerCase();
  const priorityOrder = { High: 1, Medium: 2, Low: 3 };
  return tasks.filter(task =>
    (task.title || "").toLowerCase().includes(term) &&
    (filter !== "active" || !task.completed) &&
    (filter !== "completed" || task.completed) &&
    (categoryFilter === "all" || task.category === categoryFilter)
  ).sort((a, b) => {
    if (sort === "priority") return (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4);
    if (sort === "dueDate") {
      const aDay = dueDayNumber(a.dueDate);
      const bDay = dueDayNumber(b.dueDate);
      if (aDay === null && bDay === null) return 0;
      if (aDay === null) return 1;
      if (bDay === null) return -1;
      return aDay - bDay;
    }
    if (sort === "newest") return Number(b.id) - Number(a.id);
    if (sort === "oldest") return Number(a.id) - Number(b.id);
    return 0;
  });
}
