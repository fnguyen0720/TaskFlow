import test from "node:test";
import assert from "node:assert/strict";
import { formatDueDate, getDueDateClass, getTaskStats, selectTasks } from "../src/utils/taskUtils.js";

const now = new Date(2026, 10, 16, 12);
const date = (day) => new Date(2026, 10, day, 12).toISOString();
const tasks = [
  { id: 1, title: "Write code", priority: "High", category: "Work", completed: false, dueDate: date(16) },
  { id: 2, title: "Read book", priority: "Low", category: "Study", completed: true, dueDate: date(15) },
  { id: 3, title: "Review code", priority: "Medium", category: "Work", completed: false, dueDate: date(15) },
  { id: 4, title: "Exercise", priority: "Low", category: "Personal", completed: false, dueDate: null },
];

test("calculates dashboard stats excluding completed overdue tasks", () => {
  assert.deepEqual(getTaskStats(tasks, now), { completedCount: 1, totalCount: 4, activeCount: 3, overdueCount: 1, dueTodayCount: 1, completionRate: 25 });
  assert.equal(getTaskStats([], now).completionRate, 0);
});

test("filters by status, search and category without mutating source", () => {
  const original = tasks.map(task => task.id);
  assert.deepEqual(selectTasks(tasks, { search: "CODE", filter: "active", categoryFilter: "Work" }).map(t => t.id), [1, 3]);
  assert.deepEqual(selectTasks(tasks, { filter: "completed" }).map(t => t.id), [2]);
  assert.deepEqual(tasks.map(task => task.id), original);
});

test("sorts priority, due dates and creation order", () => {
  assert.deepEqual(selectTasks(tasks, { sort: "priority" }).map(t => t.id), [1, 3, 2, 4]);
  assert.equal(selectTasks(tasks, { sort: "dueDate" }).at(-1).id, 4);
  assert.deepEqual(selectTasks(tasks, { sort: "newest" }).map(t => t.id), [4, 3, 2, 1]);
});

test("formats due dates and highlights overdue tasks", () => {
  assert.equal(formatDueDate(null, now), "");
  assert.equal(formatDueDate(date(16), now), "📅 Today");
  assert.equal(formatDueDate(date(17), now), "📅 Tomorrow");
  assert.equal(getDueDateClass(date(15), now), "overdue");
  assert.equal(getDueDateClass(date(17), now), "");
});
