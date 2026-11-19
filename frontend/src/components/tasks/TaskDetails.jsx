import { useEffect, useRef, useState } from "react";

export default function TaskDetails({ task, onSave, onClose }) {
  const dialogRef = useRef(null);
  const nextKey = useRef((task.checklist ?? []).length);
  const [initialDueDate] = useState(task.dueDate?.slice(0, 10) ?? "");
  const [dueDate, setDueDate] = useState(initialDueDate);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [items, setItems] = useState(() =>
    (task.checklist ?? []).map((item, key) => ({ ...item, key }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  function updateItem(key, changes) {
    setItems(current => current.map(item => item.key === key ? { ...item, ...changes } : item));
  }

  function addItem() {
    const key = nextKey.current++;
    setItems(current => [...current, { key, text: "", completed: false }]);
  }

  async function submit(event) {
    event.preventDefault();
    if (saving || items.some(item => !item.text.trim())) return;

    setSaving(true);
    setError("");
    try {
      await onSave(task.id, {
        notes,
        updateDueDate: dueDate !== initialDueDate,
        dueDate: dueDate || null,
        checklist: items.map(({ text, completed }) => ({ text: text.trim(), completed })),
      });
      onClose();
    } catch (error) {
      setError(error.message || "Couldn't save task details. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="task-detail-dialog" aria-labelledby="task-detail-title"
      onCancel={event => {
        event.preventDefault();
        if (!saving) onClose();
      }}>
      <form onSubmit={submit}>
        <header className="task-detail-header">
          <h2 id="task-detail-title">{task.title}</h2>
          <button type="button" disabled={saving} onClick={onClose} aria-label="Close task details">×</button>
        </header>
        <label className="task-detail-date">
          Due date
          <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)}
            disabled={saving} />
        </label>
        <label className="task-detail-notes">
          Notes
          <textarea value={notes} onChange={event => setNotes(event.target.value)}
            maxLength={4000} rows={4} disabled={saving} />
        </label>
        <fieldset className="task-detail-checklist" disabled={saving}>
          <legend>Checklist</legend>
          {items.map(({ key, text, completed }, index) => (
            <div key={key} className="task-detail-step">
              <input type="checkbox" checked={completed} aria-label={`Complete step ${index + 1}`}
                onChange={event => updateItem(key, { completed: event.target.checked })} />
              <input value={text} onChange={event => updateItem(key, { text: event.target.value })}
                aria-label={`Step ${index + 1}`} maxLength={160} required />
              <button type="button" aria-label={`Remove step ${index + 1}`}
                onClick={() => setItems(current => current.filter(item => item.key !== key))}>×</button>
            </div>
          ))}
          <button type="button" onClick={addItem} disabled={items.length >= 30}>Add step</button>
        </fieldset>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <footer className="task-detail-actions">
          <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || items.some(item => !item.text.trim())}>
            {saving ? "Saving…" : "Save details"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
