import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("treats UTC-midnight API due dates as calendar days, not previous-day instants", () => {
  const november17 = new Date(2026, 10, 17, 12);
  const todayTask = { id: 10, title: "Today", completed: false, dueDate: "2026-11-17T00:00:00Z" };
  assert.equal(formatDueDate(todayTask.dueDate, november17), "📅 Today");
  assert.equal(getDueDateClass(todayTask.dueDate, november17), "");
  assert.equal(getTaskStats([todayTask], november17).dueTodayCount, 1);
  assert.equal(getTaskStats([todayTask], november17).overdueCount, 0);
  assert.equal(formatDueDate("2026-11-18T00:00:00Z", november17), "📅 Tomorrow");
});

test("sorts due dates by the selected calendar date regardless of timezone offset", () => {
  const datedTasks = [
    { id: 1, title: "Dec 16", dueDate: "2026-12-16T00:00:00Z" },
    { id: 2, title: "Dec 15", dueDate: "2026-12-15T23:00:00-05:00" },
    { id: 3, title: "No due date", dueDate: null },
  ];
  assert.deepEqual(selectTasks(datedTasks, { sort: "dueDate" }).map(t => t.id), [2, 1, 3]);
});

test("keeps the correct day in US Eastern time and across daylight saving transitions", () => {
  const moduleUrl = new URL("../src/utils/taskUtils.js", import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";
    import { formatDueDate, getDueDateClass, getTaskStats } from ${JSON.stringify(moduleUrl)};
    const now = new Date(2026, 10, 17, 12);
    assert.equal(formatDueDate("2026-11-17T00:00:00Z", now), "📅 Today");
    assert.equal(getDueDateClass("2026-11-17T00:00:00Z", now), "");
    assert.equal(getTaskStats([{ completed: false, dueDate: "2026-11-17T00:00:00Z" }], now).dueTodayCount, 1);
    const december = new Date(2026, 11, 10, 12);
    assert.equal(formatDueDate("2026-12-16T00:00:00Z", december), "📅 " + new Date(2026, 11, 16).toLocaleDateString());
    assert.equal(formatDueDate("2026-03-08T00:00:00Z", new Date(2026, 2, 7, 12)), "📅 Tomorrow");
    assert.equal(formatDueDate("2026-11-01T00:00:00Z", new Date(2026, 9, 31, 12)), "📅 Tomorrow");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, TZ: "America/New_York" },
  });
  assert.equal(result.status, 0, result.stderr);
});
