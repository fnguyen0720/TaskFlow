// Browser-local, date-only reminders. No push permissions or background polling.
export function remindersDue(tasks, now = new Date()) {
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")].join("-");
  return tasks.filter(task => {
    if (task.completed || task.reminderDaysBefore == null || !task.dueDate) return false;
    const due = task.dueDate.slice(0, 10);
    const date = new Date(`${due}T12:00:00`);
    date.setDate(date.getDate() - task.reminderDaysBefore);
    const reminder = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")].join("-");
    return today >= reminder;
  });
}
