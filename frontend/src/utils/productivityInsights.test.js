import test from "node:test";
import assert from "node:assert/strict";
import { getPlanningAnalytics, getProductivityInsights } from "./productivityInsights.js";

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

test("planning snapshot counts upcoming deadlines, priorities, and overdue tasks without inventing history", () => {
  const tasks = [
    { completed: false, priority: "High", dueDate: "2026-11-23T00:00:00Z" },
    { completed: false, priority: "Medium", dueDate: "2026-11-24T00:00:00Z" },
    { completed: false, priority: "Low", dueDate: "2026-11-27" },
    { completed: false, priority: "High", dueDate: null },
    { completed: true, priority: "High", dueDate: "2026-11-25" },
  ];
  const plan = getPlanningAnalytics(tasks, new Date(2026, 10, 24));
  assert.deepEqual(plan.week.map(day => day.count), [1, 0, 0, 1, 0, 0, 0]);
  assert.deepEqual(plan.priority, { High: 2, Medium: 1, Low: 1, Other: 0 });
  assert.equal(plan.overdue, 1);
  assert.equal(plan.overdueHigh, 1);
  assert.equal(plan.unscheduled, 1);
  assert.equal(plan.dueSoon, 2);
  assert.equal(plan.recommendations[0].id, "high-overdue");
});

test("planning alerts distinguish busy weeks, unscheduled work, and calm workspaces", () => {
  const due = Array.from({ length: 5 }, () => ({ completed: false, dueDate: "2026-11-25", priority: "Low" }));
  const tasks = [...due, ...Array.from({ length: 3 }, () => ({ completed: false, dueDate: null }))];
  const report = getPlanningAnalytics(tasks, new Date(2026, 10, 24));
  assert.deepEqual(report.recommendations.map(item => item.id), ["busy-week", "unscheduled"]);
  assert.equal(getPlanningAnalytics([], new Date(2026, 10, 24)).recommendations[0].id, "steady");
  assert.equal(getPlanningAnalytics([{ completed: true, dueDate: "2026-11-20" }], new Date(2026, 10, 24)).dueSoon, 0);
});

test("planning date buckets remain stable across daylight saving transitions", () => {
  const report = getPlanningAnalytics([{ completed: false, dueDate: "2026-03-08T00:00:00Z" }], new Date(2026, 2, 7));
  assert.equal(report.week[1].date, "2026-03-08");
  assert.equal(report.week[1].count, 1);
});
