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
      const result = new Date(0);
      result.setHours(0, 0, 0, 0);
      result.setFullYear(year, month - 1, day);
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

export function formatDateForInput(date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// UTC day numbers are used only for arithmetic, avoiding DST-length days.
const dayNumber = (date) => {
  const midnight = new Date(0);
  midnight.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return midnight.getTime() / 86400000;
};
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

export function getTaskViews(tasks, now = new Date()) {
  const today = dueDayNumber(now);
  const views = { all: tasks, today: [], upcoming: [], unscheduled: [] };

  for (const task of tasks) {
    if (task.completed) continue;
    const due = dueDayNumber(task.dueDate);
    if (due === null) {
      views.unscheduled.push(task);
    } else if (today !== null && due <= today) {
      views.today.push(task);
    } else if (today !== null) {
      views.upcoming.push(task);
    }
  }

  return views;
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

export function getWeekDays(tasks, reference = new Date(), weekOffset = 0) {
  const today = calendarDate(reference);
  const monday = new Date(today);
  const daysSinceMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - daysSinceMonday + 7 * weekOffset);
  const start = dayNumber(monday);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    return { date, isToday: start + index === dayNumber(today), tasks: [] };
  });

  for (const task of tasks) {
    const due = dueDayNumber(task.dueDate);
    if (due !== null && due >= start && due < start + days.length) {
      days[due - start].tasks.push(task);
    }
  }
  return days;
}

/** The Monday-based week offset of a date, including DST and year changes. */
export function getWeekOffsetForDate(value, reference = new Date()) {
  const target = calendarDate(value);
  const today = calendarDate(reference);
  if (!target || !today) return null;
  const mondayNumber = dayNumber(today) - (today.getDay() + 6) % 7;
  return Math.floor((dayNumber(target) - mondayNumber) / 7);
}

/** A 35/42-cell month grid, Monday first, retaining neighboring-month dates. */
export function getMonthDays(tasks, reference = new Date(), monthOffset = 0) {
  const first = new Date(reference.getFullYear(), reference.getMonth() + monthOffset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const start = new Date(first);
  start.setDate(1 - (first.getDay() + 6) % 7);
  const endPadding = (7 - (last.getDay() + 6) % 7 - 1 + 7) % 7;
  const total = Math.ceil((last.getDate() + (first.getDay() + 6) % 7 + endPadding) / 7) * 7;
  const today = dayNumber(reference);
  const buckets = new Map();
  for (const task of tasks) {
    const day = calendarDate(task.dueDate);
    if (!day) continue;
    const key = dayNumber(day);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(task);
  }
  const days = Array.from({ length: total }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const number = dayNumber(date);
    return { date, isToday: number === today,
      inMonth: date.getMonth() === first.getMonth() && date.getFullYear() === first.getFullYear(),
      tasks: buckets.get(number) || [] };
  });
  return { month: first, days };
}
