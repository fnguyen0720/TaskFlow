export default function UndoDeleteToast({ pendingDeletes, onUndo }) {
  if (pendingDeletes.length === 0) return null;

  return (
    <div className="undo-delete-tray" role="status" aria-live="polite" aria-label="Pending task deletions">
      {pendingDeletes.map(record => (
        <div className="undo-delete-item" key={record.id}>
          <span className="undo-delete-message" title={record.title}>
            {record.status === "pending" ? "Deleting in 8 seconds: " : "Deleting task: "}
            <strong>{record.title}</strong>
          </span>
          {record.status === "pending" ? (
            <button type="button" className="undo-delete-button" onClick={() => onUndo(record.id)} aria-label={"Undo deleting " + record.title}>
              Undo
            </button>
          ) : (
            <span className="undo-delete-progress">Deleting…</span>
          )}
        </div>
      ))}
    </div>
  );
}
