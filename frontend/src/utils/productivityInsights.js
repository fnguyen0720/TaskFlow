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


/**
 * Snapshot-only planning analytics. These counts come solely from the signed-in
 * user's currently loaded tasks; no invented completion dates or AI inference.
 * UTC day arithmetic avoids daylight-saving boundary errors.
 */
export function getPlanningAnalytics(tasks, now = new Date()) {
  const start = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000;
  const week = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date((start + offset) * 86400000);
    return {
      date: date.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(date),
      count: 0,
    };
  });
  const priority = { High: 0, Medium: 0, Low: 0, Other: 0 };
  let overdue = 0;
  let overdueHigh = 0;
  let unscheduled = 0;
  let dueSoon = 0;
  for (const task of tasks) {
    if (task.completed) continue;
    const rank = ["High", "Medium", "Low"].includes(task.priority) ? task.priority : "Other";
    priority[rank]++;
    const key = dateKey(task.dueDate);
    if (!key) { unscheduled++; continue; }
    const date = new Date(key + "T00:00:00Z");
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== key) {
      unscheduled++;
      continue;
    }
    const offset = Math.round(date.getTime() / 86400000 - start);
    if (offset < 0) { overdue++; if (rank === "High") overdueHigh++; }
    else if (offset < 7) { week[offset].count++; dueSoon++; }
  }
  const recommendations = [];
  if (overdueHigh) recommendations.push({
    id: "high-overdue", title: "Prioritize overdue high-priority tasks",
    detail: `${overdueHigh} high-priority ${overdueHigh === 1 ? "task is" : "tasks are"} overdue. Review these first or choose achievable new dates.`,
  });
  if (dueSoon >= 5) recommendations.push({
    id: "busy-week", title: "Spread out your upcoming workload",
    detail: `${dueSoon} active tasks are due in the next seven days. Consider moving nonessential work before deadlines become crowded.`,
  });
  if (unscheduled >= 3) recommendations.push({
    id: "unscheduled", title: "Plan your unscheduled work",
    detail: `${unscheduled} active tasks have no due date. Assign dates to the ones you intend to tackle soon.`,
  });
  if (overdue && !overdueHigh) recommendations.push({
    id: "overdue", title: "Review overdue work",
    detail: `${overdue} active ${overdue === 1 ? "task is" : "tasks are"} overdue. Decide what to finish, reschedule, or remove from your plan.`,
  });
  if (!recommendations.length) recommendations.push({
    id: "steady", title: "No major planning alerts in this snapshot",
    detail: tasks.length ? "Keep reviewing your upcoming deadlines as work changes." : "Add tasks to see workload recommendations.",
  });
  return { week, priority, overdue, overdueHigh, unscheduled, dueSoon, recommendations };
}
