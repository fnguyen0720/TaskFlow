// Pure task selectors keep filtering and dashboard calculations independent of React.
const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

export function formatDueDate(dueDate, now = new Date()) {
  if (!dueDate) return "";
  const today = startOfDay(now);
  const due = startOfDay(dueDate);
  const difference = Math.round((due - today) / 86400000);
  if (difference < 0) return "⚠️ Overdue";
  if (difference === 0) return "📅 Today";
  if (difference === 1) return "📅 Tomorrow";
  return `📅 ${due.toLocaleDateString()}`;
}

export function getDueDateClass(dueDate, now = new Date()) {
  return dueDate && startOfDay(dueDate) < startOfDay(now) ? "overdue" : "";
}

export function getTaskStats(tasks, now = new Date()) {
  const today = startOfDay(now).getTime();
  const completedCount = tasks.filter(task => task.completed).length;
  const totalCount = tasks.length;
  const activeCount = totalCount - completedCount;
  const overdueCount = tasks.filter(task => !task.completed && task.dueDate && startOfDay(task.dueDate).getTime() < today).length;
  const dueTodayCount = tasks.filter(task => !task.completed && task.dueDate && startOfDay(task.dueDate).getTime() === today).length;
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
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    }
    if (sort === "newest") return Number(b.id) - Number(a.id);
    if (sort === "oldest") return Number(a.id) - Number(b.id);
    return 0;
  });
}
