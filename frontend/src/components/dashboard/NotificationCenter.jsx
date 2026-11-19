import { useState } from "react";

const label = {
  overdue: "Overdue",
  "due-today": "Due today",
  upcoming: "Coming up",
};

export default function NotificationCenter({
  notifications, loading, error, pending, onUpdate, onMarkAllRead, onOpenTask,
}) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter(item => !item.isRead).length;

  return (
    <div className="notification-center">
      <button type="button" className="notification-bell" aria-label={`Notifications, ${unread} unread`}
        aria-expanded={open} aria-controls="notification-center-panel"
        onClick={() => setOpen(value => !value)}>
        <span aria-hidden="true">🔔</span>
        <span>Notifications</span>
        {unread > 0 && <span className="notification-count">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <section className="notification-dropdown" id="notification-center-panel"
          aria-label="Notification center">
          <header className="notification-dropdown-head">
            <div><strong>Notification center</strong><p>{unread} unread · {notifications.length} active</p></div>
            <button type="button" className="notification-dismiss" onClick={() => setOpen(false)}
              aria-label="Close notification center">×</button>
          </header>
          <div className="notification-dropdown-actions">
            <button type="button" disabled={pending || loading || unread === 0}
              onClick={() => onMarkAllRead(notifications)}>Mark all read</button>
          </div>
          {error && <p role="alert" className="notification-center-error">{error}</p>}
          {loading ? <p className="notification-center-empty">Loading notifications…</p> :
            notifications.length === 0 ?
              <p className="notification-center-empty">You're all caught up. No active reminders.</p> :
              <ul className="notification-items">
                {notifications.map(item => (
                  <li key={item.key} className={`notification-item ${item.isRead ? "is-read" : "is-unread"}`}>
                    <div className="notification-item-main">
                      <span className={`notification-kind ${item.kind}`}>{label[item.kind]}</span>
                      <button type="button" className="notification-task-link" onClick={() => {
                        onOpenTask(item.taskId);
                        setOpen(false);
                      }}>{item.title}</button>
                      <span className="notification-date">Due {item.dueDate}</span>
                    </div>
                    <div className="notification-item-actions">
                      {!item.isRead && <button type="button" disabled={pending}
                        onClick={() => onUpdate(item, "read")}>Mark read</button>}
                      <button type="button" disabled={pending}
                        onClick={() => onUpdate(item, "dismiss")}>Dismiss</button>
                    </div>
                  </li>
                ))}
              </ul>}
          <p className="notification-center-footnote">Reminders appear while TaskFlow is open.</p>
        </section>
      )}
    </div>
  );
}
