import test from "node:test";
import assert from "node:assert/strict";
import { buildNotifications, getDailyFocus } from "./notificationCenter.js";

const now = new Date(2026, 10, 19, 12);
const task = (id, dueDate, extra={}) => ({ id, title: `Task ${id}`, priority:"Medium",
  dueDate: dueDate + "T00:00:00Z", completed:false, ...extra });

test("derives overdue, due today and opted-in upcoming reminders without duplicates", () => {
  const tasks = [
    task(1,"2026-11-18"), task(2,"2026-11-19"),
    task(3,"2026-11-20",{reminderDaysBefore:1}),
    task(4,"2026-11-20"), task(5,"2026-11-19",{completed:true}),
    task(6,"2026-11-25",{reminderDaysBefore:7}),
  ];
  assert.deepEqual(buildNotifications(tasks,[],now).map(n=>n.key),
    ["1:overdue","2:due-today","3:upcoming","6:upcoming"]);
});
test("read and dismissed flags apply only to exact task and kind", () => {
  const tasks = [task(7,"2026-11-18"),task(8,"2026-11-19")];
  const states = [{taskId:7,kind:"overdue",isRead:true,isDismissed:false},
    {taskId:8,kind:"due-today",isRead:true,isDismissed:true}];
  assert.deepEqual(buildNotifications(tasks,states,now).map(n=>[n.key,n.isRead]),
    [["7:overdue",true]]);
  assert.equal(buildNotifications([task(7,"2026-11-19")],states,now)[0].isRead,false);
});
test("daily focus is prioritized and omits completed tasks", () => {
  const focus=getDailyFocus([task(1,"2026-11-18"), task(2,"2026-11-19"),
    task(3,"2026-11-22",{recurrenceRule:"Weekly"}),
    task(4,"2026-11-19",{completed:true})],now);
  assert.deepEqual([focus.overdue,focus.dueToday,focus.upcoming,focus.recurring],[1,1,1,1]);
  assert.deepEqual(focus.priorityTasks.map(t=>t.id),[1,2,3]);
});

test("dismissed upcoming notice does not hide a newly due task", () => {
  const taskDue = task(21,"2026-11-20",{reminderDaysBefore:7});
  const dismissed = [{taskId:21,kind:"upcoming",isRead:true,isDismissed:true}];
  assert.deepEqual(buildNotifications([taskDue], dismissed, new Date(2026,10,19,12)), []);
  assert.deepEqual(buildNotifications([taskDue], dismissed, new Date(2026,10,20,12))
    .map(x => [x.kind, x.isRead]), [["due-today", false]]);
  assert.deepEqual(buildNotifications([taskDue], dismissed, new Date(2026,10,21,12))
    .map(x => x.kind), ["overdue"]);
});
