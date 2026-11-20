import test from "node:test";
import assert from "node:assert/strict";
import { getProductivityInsights } from "./productivityInsights.js";

test("empty workspace reports truthful zero totals", () => {
  assert.deepEqual(getProductivityInsights([], new Date(2026, 10, 20)), {
    total: 0, completed: 0, active: 0, completionRate: 0,
    categories: [], due: { overdue: 0, today: 0, upcoming: 0, unscheduled: 0 },
  });
});

test("category counts and due buckets exclude completed tasks from urgency", () => {
  const tasks = [
    { category: "Work", completed: false, dueDate: "2026-11-19T00:00:00Z" },
    { category: "Work", completed: false, dueDate: "2026-11-20T00:00:00Z" },
    { category: "Personal", completed: false, dueDate: "2026-11-23T00:00:00Z" },
    { category: "", completed: false, dueDate: null },
    { category: "Work", completed: true, dueDate: "2026-11-18T00:00:00Z" },
  ];
  assert.deepEqual(getProductivityInsights(tasks, new Date(2026, 10, 20)), {
    total: 5, completed: 1, active: 4, completionRate: 20,
    categories: [
      { name: "Work", total: 3, active: 2, completed: 1 },
      { name: "General", total: 1, active: 1, completed: 0 },
      { name: "Personal", total: 1, active: 1, completed: 0 },
    ],
    due: { overdue: 1, today: 1, upcoming: 1, unscheduled: 1 },
  });
});

test("a fully completed task list has no pending due-date work", () => {
  const tasks = [{ completed: true, category: "Study", dueDate: "2026-10-01" }];
  const report = getProductivityInsights(tasks, new Date(2026, 10, 20));
  assert.equal(report.completionRate, 100);
  assert.deepEqual(report.due, { overdue: 0, today: 0, upcoming: 0, unscheduled: 0 });
});
