import { useEffect, useRef, useState } from "react";
import NotificationSettings from "./NotificationSettings.jsx";

const label = {
  overdue: "Overdue",
  "due-today": "Due today",
  upcoming: "Coming up",
};

export default function NotificationCenter({
  notifications, loading, error, pending, onUpdate, onMarkAllRead, onOpenTask, settings,
}) {
  const [open, setOpen] = useState(false);
  const bellRef = useRef(null);
  const panelRef = useRef(null);
  const previousOpen = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const unread = notifications.filter(item => !item.isRead).length;

  useEffect(() => {
    if (!open) {
      if (previousOpen.current && panelRef.current?.contains(document.activeElement)) {
        bellRef.current?.focus();
      }
      previousOpen.current = false;
      return;
    }
    previousOpen.current = true;
    const onKeyDown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        bellRef.current?.focus();
      }
    };
    const onPointerDown = event => {
      if (!panelRef.current?.contains(event.target) && !bellRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="notification-center">
      <button ref={bellRef} type="button" className="notification-bell" aria-label={`Notifications, ${unread} unread`}
        aria-expanded={open} aria-controls="notification-center-panel"
        onClick={() => setOpen(value => !value)}>
        <span aria-hidden="true">🔔</span>
        <span>Notifications</span>
        {unread > 0 && <span className="notification-count">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <section ref={panelRef} className="notification-dropdown" id="notification-center-panel"
          aria-label="Notification center">
          <header className="notification-dropdown-head">
            <div><strong>Notification center</strong><p>{unread} unread · {notifications.length} active</p></div>
            <button type="button" className="notification-dismiss" onClick={() => { setOpen(false); bellRef.current?.focus(); }}
              aria-label="Close notification center">×</button>
          </header>
          <div className="notification-dropdown-actions">
            <button type="button" disabled={pending || loading || unread === 0}
              onClick={() => onMarkAllRead(notifications)}>Mark all read</button>
            <button type="button" aria-expanded={showSettings} onClick={() => setShowSettings(value => !value)}>
              {showSettings ? "Back to alerts" : "Preferences"}
            </button>
          </div>
          {showSettings && <NotificationSettings settings={settings} />}
          {!showSettings && error && <p role="alert" className="notification-center-error">{error}</p>}
          {!showSettings && (loading ? <p className="notification-center-empty">Loading notifications…</p> :
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
              </ul>)}
          <p className="notification-center-footnote">Reminders appear while TaskFlow is open.</p>
        </section>
      )}
    </div>
  );
}
