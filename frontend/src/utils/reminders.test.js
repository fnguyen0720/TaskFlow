import test from "node:test";
import assert from "node:assert/strict";
import { remindersDue } from "./reminders.js";

const due = "2026-11-20T00:00:00Z";
test("shows due and overdue reminder dates, ignoring completed tasks", () => {
  const items = [
    { id: 1, dueDate: due, reminderDaysBefore: 1, completed: false },
    { id: 2, dueDate: due, reminderDaysBefore: 0, completed: false },
    { id: 3, dueDate: due, reminderDaysBefore: 7, completed: true },
    { id: 4, dueDate: due, reminderDaysBefore: null, completed: false },
  ];
  assert.deepEqual(remindersDue(items, new Date(2026, 10, 19, 10)).map(x => x.id), [1]);
  assert.deepEqual(remindersDue(items, new Date(2026, 10, 21, 10)).map(x => x.id), [1, 2]);
});
