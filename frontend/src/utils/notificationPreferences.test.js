import test from "node:test";
import assert from "node:assert/strict";
import { applyNotificationPreferences, defaultNotificationPreferences } from "./notificationPreferences.js";

const items = ["overdue", "due-today", "upcoming"].map((kind, i) => ({ taskId: i+1, kind }));
test("all notification categories default on", () => {
  assert.deepEqual(applyNotificationPreferences(items, defaultNotificationPreferences), items);
});
test("each user preference hides only its own notification category", () => {
  const options = {overdueEnabled:false, dueTodayEnabled:true, upcomingEnabled:false};
  assert.deepEqual(applyNotificationPreferences(items, options).map(i => i.kind), ["due-today"]);
  assert.deepEqual(applyNotificationPreferences(items, null), items);
});
test("unknown notification category is not exposed", () => {
  assert.deepEqual(applyNotificationPreferences([{kind:"untrusted"}], defaultNotificationPreferences), []);
});
