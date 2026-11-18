// Timer and state transitions are kept separate from React so undo behavior
// can be regression-tested without a browser or backend.
export const DELETE_UNDO_WINDOW_MS = 8000;

export function createDeletionQueue({
  onCommit,
  onChange,
  onError = () => {},
  delayMs = DELETE_UNDO_WINDOW_MS,
  scheduleTimer = setTimeout,
  cancelTimer = clearTimeout,
}) {
  const items = new Map();
  let disposed = false;

  const snapshot = () => Array.from(items.values(), record => ({
    id: record.id,
    title: record.title,
    status: record.status,
  }));

  const publish = () => {
    if (!disposed) onChange(snapshot());
  };

  const schedule = (task) => {
    if (disposed || !task || items.has(task.id)) return false;
    const record = { id: task.id, title: task.title, status: "pending", timer: null };
    items.set(record.id, record);
    record.timer = scheduleTimer(() => {
      if (disposed || items.get(record.id) !== record) return;
      record.status = "deleting";
      publish();
      Promise.resolve()
        .then(() => onCommit(record))
        .catch(error => onError(error, record))
        .finally(() => {
          if (items.get(record.id) === record) {
            items.delete(record.id);
            publish();
          }
        });
    }, delayMs);
    publish();
    return true;
  };

  const undo = (id) => {
    const record = items.get(id);
    if (disposed || !record || record.status !== "pending") return false;
    cancelTimer(record.timer);
    items.delete(id);
    publish();
    return true;
  };

  const dispose = () => {
    disposed = true;
    for (const record of items.values()) cancelTimer(record.timer);
    items.clear();
  };

  return { schedule, undo, dispose };
}
