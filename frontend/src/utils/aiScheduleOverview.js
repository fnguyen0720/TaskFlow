// Workload is a transparent approximation, not personal calendar availability.
// Counts combine unfinished tasks whose deadlines fall on a day with proposed
// work sessions, excluding proposed tasks from the deadline baseline.
import { formatDateForInput } from "./taskUtils.js";

export function buildScheduleOverview(start, dayLoads, slots, capacity) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || capacity < 1 || capacity > 5)
    return [];
  const [year, month, day] = start.split("-").map(Number);
  return Array.from({ length: 7 }, (_, index) => {
    const date = formatDateForInput(new Date(year, month - 1, day + index, 12));
    const existingDue = dayLoads?.find(item => item.date === date)?.existingDueCount ?? 0;
    const planned = slots.filter(item => item.suggestedDate === date);
    const count = existingDue + planned.length;
    return { date, existingDue, planned, count, capacity, excess: Math.max(0, count - capacity) };
  });
}
