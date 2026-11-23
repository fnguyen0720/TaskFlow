import { useEffect, useId, useRef, useState } from "react";
import TaskActivityTimeline from "./TaskActivityTimeline.jsx";
import TaskVersionHistory from "./TaskVersionHistory.jsx";
import TaskDependencies from "./TaskDependencies.jsx";

export default function TaskDetails({ task, onSave, onClose, onDirtyChange, onReloadLatest, onRestored, token, onUnauthorized, tasks = [], projects = [], onAssignProject, assigningProject = false }) {
  const dialogRef = useRef(null);
  const headingRef = useRef(null);
  const previousFocusRef = useRef(null);
  const dueDateId = useId();
  const dueHelpId = useId();
  const nextKey = useRef((task.checklist ?? []).length);
  const pointerCleanupRef = useRef(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [initialDueDate] = useState(task.dueDate?.slice(0, 10) ?? "");
  const [initialVersion] = useState(task.version ?? null);
  const [dueDate, setDueDate] = useState(initialDueDate);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [items, setItems] = useState(() =>
    (task.checklist ?? []).map((item, key) => ({
      ...item, key, id: item.id || crypto.randomUUID(),
      parentId: item.parentId ?? null,
      priority: item.priority ?? "Medium",
      dueDate: item.dueDate ?? null,
    }))
  );
  const [saving, setSaving] = useState(false);
  const [dependenciesDirty, setDependenciesDirty] = useState(false);
  const [projectChoice, setProjectChoice] = useState(task.projectId == null ? "none" : String(task.projectId));
  const [error, setError] = useState("");

  const normalizedSteps = steps => steps.map(({ text, completed, id, parentId, priority, dueDate }) =>
    ({ text, completed, id, parentId, priority, dueDate }));
  const initialSnapshot = useRef(JSON.stringify({
    dueDate: task.dueDate?.slice(0, 10) ?? "",
    notes: task.notes ?? "",
    checklist: normalizedSteps(items),
  }));
  const detailsDirty = JSON.stringify({
    dueDate,
    notes,
    checklist: normalizedSteps(items),
  }) !== initialSnapshot.current;
  const dirty = detailsDirty || dependenciesDirty;
  const completedSteps = items.filter(item => item.completed).length;
  const progressPercent = items.length ? Math.round((completedSteps / items.length) * 100) : 0;
  const nestedSteps = items.filter(item => item.parentId).length;

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm("Discard unsaved task details and notes?")) return;
    onClose();
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    previousFocusRef.current = document.activeElement;
    dialog.showModal();
    headingRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      const previous = previousFocusRef.current;
      if (previous?.isConnected && typeof previous.focus === "function") previous.focus();
    };
  }, []);

  function updateItem(key, changes) {
    setItems(current => current.map(item => item.key === key ? { ...item, ...changes } : item));
  }

  // Only reorder siblings. Moving a parent also moves its children as one block.
  function reorderStep(sourceKey, targetKey, position = "before") {
    setItems(current => {
      const source = current.find(item => item.key === sourceKey);
      const target = current.find(item => item.key === targetKey);
      if (!source || !target || source.key === target.key || source.parentId !== target.parentId) return current;
      const siblings = current.filter(item => item.parentId === source.parentId);
      const from = siblings.findIndex(item => item.key === sourceKey);
      const to = siblings.findIndex(item => item.key === targetKey);
      const reordered = [...siblings];
      const [moving] = reordered.splice(from, 1);
      const insertion = reordered.findIndex(item => item.key === targetKey);
      reordered.splice(insertion + (position === "after" ? 1 : 0), 0, moving);
      if (reordered.every((item, index) => item.key === siblings[index].key)) return current;
      const siblingsByParent = new Map();
      for (const item of current) {
        const parent = item.parentId ?? null;
        if (!siblingsByParent.has(parent)) siblingsByParent.set(parent, []);
        siblingsByParent.get(parent).push(item);
      }
      siblingsByParent.set(source.parentId ?? null, reordered);
      const ordered = [];
      for (const root of siblingsByParent.get(null) ?? []) {
        ordered.push(root);
        ordered.push(...(siblingsByParent.get(root.id) ?? []));
      }
      return ordered.length === current.length ? ordered : current;
    });
    setError("");
  }

  function moveStepBy(key, delta) {
    const item = items.find(step => step.key === key);
    if (!item) return;
    const siblings = items.filter(step => step.parentId === item.parentId);
    const index = siblings.findIndex(step => step.key === key);
    const adjacent = siblings[index + delta];
    if (adjacent) reorderStep(key, adjacent.key, delta < 0 ? "before" : "after");
  }

  function startStepDrag(event, sourceKey) {
    if (event.button !== 0 || saving) return;
    event.preventDefault();
    event.currentTarget.focus();
    pointerCleanupRef.current?.();
    const originX = event.clientX;
    const originY = event.clientY;
    const source = items.find(item => item.key === sourceKey);
    let active = false;
    let targetKey = null;

    const onMove = move => {
      if (move.pointerId !== event.pointerId) return;
      if (!active && Math.hypot(move.clientX - originX, move.clientY - originY) < 6) return;
      active = true;
      const row = document.elementFromPoint(move.clientX, move.clientY)?.closest("[data-step-key]");
      const key = row ? Number(row.dataset.stepKey) : null;
      const target = items.find(item => item.key === key);
      targetKey = target && source && target.key !== source.key &&
        target.parentId === source.parentId ? key : null;
      setDragOverKey(targetKey);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      setDragOverKey(null);
      pointerCleanupRef.current = null;
    };
    const onUp = up => {
      if (up.pointerId !== event.pointerId) return;
      const target = targetKey;
      cleanup();
      if (active && target != null) reorderStep(sourceKey, target);
    };
    const onCancel = cancel => {
      if (cancel.pointerId !== event.pointerId) return;
      cleanup();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    pointerCleanupRef.current = cleanup;
  }

  useEffect(() => () => pointerCleanupRef.current?.(), []);

  function addItem() {
    const key = nextKey.current++;
    setItems(current => [...current, { key, id: crypto.randomUUID(), parentId: null, text: "", completed: false, priority: "Medium", dueDate: null }]);
  }

  async function submit(event) {
    event.preventDefault();
    if (saving || items.some(item => !item.text.trim())) return;
    if (dependenciesDirty) {
      setError("Save or discard your dependency changes before saving task details.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onSave(task.id, {
        notes,
        expectedVersion: initialVersion,
        updateDueDate: dueDate !== initialDueDate,
        dueDate: dueDate || null,
        checklist: normalizedSteps(items).map(item => ({ ...item, text: item.text.trim() })),
      });
      onClose();
    } catch (error) {
      setError((error?.message || "Couldn't save task details.") + " Your changes are still here. Try saving again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="task-detail-dialog" aria-labelledby="task-detail-title"
      onCancel={event => {
        event.preventDefault();
        requestClose();
      }}>
      <form onSubmit={submit}>
        <header className="task-detail-header">
          <h2 id="task-detail-title" ref={headingRef} tabIndex={-1}>{task.title}</h2>
          <button type="button" disabled={saving} onClick={requestClose} aria-label="Close task details">×</button>
        </header>
        <div className="task-project-assignment">
          <label htmlFor="task-project-choice">Project</label>
          <div className="task-project-assignment-row">
            <select id="task-project-choice" value={projectChoice} disabled={saving || assigningProject || !onAssignProject}
              onChange={event => setProjectChoice(event.target.value)}>
              <option value="none">No project</option>
              {projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}
            </select>
            <button type="button" disabled={saving || assigningProject || dirty ||
                !onAssignProject || projectChoice === (task.projectId == null ? "none" : String(task.projectId))}
              onClick={async () => {
                const choice = projectChoice === "none" ? null : Number(projectChoice);
                if (await onAssignProject(task, choice)) onClose();
              }}>{assigningProject ? "Moving…" : "Move task"}</button>
          </div>
          {dirty && <p>Save or discard unsaved details before moving this task.</p>}
        </div>
        <section className="task-detail-date">
          <div className="task-detail-date-heading">
            <label htmlFor={dueDateId}>Due date</label>
            {dueDate && <button className="task-detail-date-clear" type="button" disabled={saving}
              onClick={() => { setDueDate(""); setError(""); }}>Clear date</button>}
          </div>
          <p id={dueHelpId} className="task-detail-date-help">
            {dueDate ? "Tap the date to change it." : "Optional — tap the field to choose a date."}
          </p>
          <div className="task-detail-date-shell">
            <input id={dueDateId} type="date" value={dueDate}
              aria-describedby={dueHelpId}
              onChange={event => { setDueDate(event.target.value); setError(""); }}
              disabled={saving} />
          </div>
        </section>
        <label className="task-detail-notes">
          Notes
          <textarea value={notes} onChange={event => { setNotes(event.target.value); setError(""); }}
            maxLength={4000} rows={4} disabled={saving} />
        </label>
        <fieldset className="task-detail-checklist" disabled={saving}>
          <legend>Checklist</legend>
          <div className="task-step-progress" aria-label="Checklist progress">
            <span>{items.length ? `${completedSteps} of ${items.length} steps complete (${progressPercent}%)` : "No steps yet"}</span>
            {items.length > 0 && <progress max={items.length} value={completedSteps} aria-label="Completed checklist steps" />}
            {nestedSteps > 0 && <span>{nestedSteps} nested {nestedSteps === 1 ? "step" : "steps"}</span>}
          </div>
          <p className="task-step-order-help">Drag a step by its handle, or use Move up and Move down. Parent steps move with their children.</p>
          {items.map(({ key, text, completed }, index) => (
            <div key={key}
              data-step-key={key}
              className={`task-detail-step${items[index].parentId ? " task-detail-step-nested" : ""}${dragOverKey === key ? " task-detail-step-drop-target" : ""}`}
              >
              <input type="checkbox" checked={completed} aria-label={`Complete step ${index + 1}`}
                onChange={event => { updateItem(key, { completed: event.target.checked }); setError(""); }} />
              <input value={text} onChange={event => { updateItem(key, { text: event.target.value }); setError(""); }}
                aria-label={`Step ${index + 1}`} maxLength={160} required />
              <select aria-label={`Priority for step ${index + 1}`} value={items[index].priority}
                onChange={event => updateItem(key, { priority: event.target.value })}>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
              <input type="date" aria-label={`Subtask deadline ${index + 1}`}
                value={items[index].dueDate || ""}
                onChange={event => updateItem(key, { dueDate: event.target.value || null })} />
              <select aria-label={`Parent step for step ${index + 1}`}
                value={items[index].parentId || ""}
                onChange={event => updateItem(key, { parentId: event.target.value || null })}>
                <option value="">Top-level step</option>
                {items.filter(other => other.id !== items[index].id && !other.parentId &&
                  !items.some(child => child.parentId === other.id && child.id !== items[index].id)).map(other =>
                  <option key={other.id} value={other.id}>{other.text || "Untitled step"}</option>)}
              </select>
              <button type="button" aria-label={`Remove step ${index + 1}`}
                onClick={() => setItems(current => current.filter(item =>
                  item.key !== key && item.parentId !== items[index].id))}>×</button>
              <div className="task-step-order-controls">
                <span className="task-step-drag-handle" role="button" tabIndex={0}
                  aria-label={`Drag step ${index + 1} to reorder`} title="Drag or use arrow keys to reorder"
                  onPointerDown={event => startStepDrag(event, key)}
                  onKeyDown={event => {
                    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                      event.preventDefault();
                      moveStepBy(key, event.key === "ArrowUp" ? -1 : 1);
                    }
                  }}>⠿</span>
                <button type="button" aria-label={`Move step ${index + 1} up`}
                  disabled={!items.some((item, i) => i < index && item.parentId === items[index].parentId)}
                  onClick={() => moveStepBy(key, -1)}>↑</button>
                <button type="button" aria-label={`Move step ${index + 1} down`}
                  disabled={!items.some((item, i) => i > index && item.parentId === items[index].parentId)}
                  onClick={() => moveStepBy(key, 1)}>↓</button>
              </div>
            </div>
          ))}
          <button type="button" onClick={addItem} disabled={items.length >= 30}>Add step</button>
        </fieldset>
        {error && <p className="task-detail-save-error" role="alert" id="task-details-save-error">{error}</p>}
        {error && /changed elsewhere|no longer available/.test(error) && (
          <button className="task-conflict-reload" type="button" disabled={saving} onClick={async () => {
            if (!window.confirm("Discard this draft and reload the latest task from the server?")) return;
            if (await onReloadLatest()) onClose();
          }}>Discard draft and reload latest</button>
        )}
        {!error && (saving || dirty) && <p className="task-detail-save-status" role="status">
          {saving ? "Saving your changes…" : "Unsaved changes — review and save when ready."}
        </p>}
        <TaskDependencies task={task} tasks={tasks} token={token}
          onUnauthorized={onUnauthorized} disabled={detailsDirty || saving} onDirtyChange={setDependenciesDirty} />
        <TaskActivityTimeline taskId={task.id} token={token} onUnauthorized={onUnauthorized} />
        <TaskVersionHistory task={task} token={token} onUnauthorized={onUnauthorized}
          onRestored={onRestored} disabled={dirty || saving} />
        <footer className="task-detail-actions">
          <button type="button" disabled={saving} onClick={requestClose}>Cancel</button>
          <button type="submit" disabled={saving || items.some(item => !item.text.trim())}>
            {saving ? "Saving…" : error ? "Retry save" : "Save details"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
