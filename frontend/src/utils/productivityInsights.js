// Snapshot-only metrics: task records do not contain completion timestamps.
// Never label these values as historical weekly trends or throughput.
const dateKey = value => {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[Tt ])/u.exec(String(value));
  return match ? match[1] : null;
};

const todayKey = date => {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
};

export function getProductivityInsights(tasks, now = new Date()) {
  const today = todayKey(now);
  const byCategory = new Map();
  const due = { overdue: 0, today: 0, upcoming: 0, unscheduled: 0 };
  let completed = 0;

  for (const task of tasks) {
    const category = String(task.category || "General").trim() || "General";
    const counts = byCategory.get(category) || { name: category, total: 0, active: 0, completed: 0 };
    counts.total++;
    if (task.completed) {
      completed++;
      counts.completed++;
    } else {
      counts.active++;
      const day = dateKey(task.dueDate);
      if (!day) due.unscheduled++;
      else if (day < today) due.overdue++;
      else if (day === today) due.today++;
      else due.upcoming++;
    }
    byCategory.set(category, counts);
  }

  const categories = [...byCategory.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const total = tasks.length;
  return {
    total, completed, active: total - completed,
    completionRate: total ? Math.round(100 * completed / total) : 0,
    categories, due,
  };
}
