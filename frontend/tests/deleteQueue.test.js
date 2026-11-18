import test from "node:test";
import assert from "node:assert/strict";
import { createDeletionQueue, DELETE_UNDO_WINDOW_MS } from "../src/utils/deleteQueue.js";

function createFakeTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    callbacks,
    scheduleTimer(fn, delay) {
      const id = nextId++;
      callbacks.set(id, { fn, delay });
      return id;
    },
    cancelTimer(id) {
      callbacks.delete(id);
    },
    runAll() {
      const scheduled = Array.from(callbacks.values());
      callbacks.clear();
      for (const record of scheduled) record.fn();
    },
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("Undo cancels a scheduled deletion before any API operation", () => {
  const timers = createFakeTimers();
  const changes = [];
  const committed = [];
  const queue = createDeletionQueue({
    onCommit: task => { committed.push(task.id); },
    onChange: snapshot => changes.push(snapshot),
    ...timers,
  });
  assert.equal(queue.schedule({ id: 1, title: "Write report" }), true);
  assert.equal(queue.schedule({ id: 1, title: "Write report" }), false);
  assert.equal(timers.callbacks.size, 1);
  assert.equal(Array.from(timers.callbacks.values())[0].delay, DELETE_UNDO_WINDOW_MS);
  assert.deepEqual(changes.at(-1), [{ id: 1, title: "Write report", status: "pending" }]);
  assert.equal(queue.undo(1), true);
  assert.equal(queue.undo(1), false);
  timers.runAll();
  assert.deepEqual(committed, []);
  assert.deepEqual(changes.at(-1), []);
});

test("expired timer commits deletion and removes the pending toast", async () => {
  const timers = createFakeTimers();
  const changes = [];
  const committed = [];
  const queue = createDeletionQueue({
    onCommit: task => { committed.push(task.id); },
    onChange: snapshot => changes.push(snapshot),
    ...timers,
  });
  queue.schedule({ id: 21, title: "First" });
  queue.schedule({ id: 22, title: "Second" });
  timers.runAll();
  assert.equal(queue.undo(21), false, "Undo closes when the API operation begins");
  assert.deepEqual(changes.at(-1).map(item => item.status), ["deleting", "deleting"]);
  await settle();
  assert.deepEqual(committed, [21, 22]);
  assert.deepEqual(changes.at(-1), []);
});

test("failed deletes report an error and unhide the original task", async () => {
  const timers = createFakeTimers();
  const changes = [];
  const errors = [];
  const queue = createDeletionQueue({
    onCommit: async () => { throw new Error("Server unavailable"); },
    onError: error => errors.push(error.message),
    onChange: snapshot => changes.push(snapshot),
    ...timers,
  });
  queue.schedule({ id: 2, title: "Important" });
  timers.runAll();
  await settle();
  assert.deepEqual(errors, ["Server unavailable"]);
  assert.deepEqual(changes.at(-1), []);
});

test("leaving the page cancels pending timers without deleting anything", async () => {
  const timers = createFakeTimers();
  const committed = [];
  const changes = [];
  const queue = createDeletionQueue({
    onCommit: task => { committed.push(task.id); },
    onChange: snapshot => changes.push(snapshot),
    ...timers,
  });
  queue.schedule({ id: 7, title: "Keep this" });
  queue.dispose();
  timers.runAll();
  await settle();
  assert.deepEqual(committed, []);
  assert.equal(timers.callbacks.size, 0);
  assert.equal(queue.schedule({ id: 8, title: "Ignored" }), false);
  assert.equal(queue.undo(7), false);
  assert.equal(changes.length, 1, "No state updates after dispose");
});
