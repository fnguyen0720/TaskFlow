import { useEffect, useState } from "react";

const OPTIONS = [
  { key: "overdueEnabled", label: "Overdue tasks", description: "Tasks with a past due date" },
  { key: "dueTodayEnabled", label: "Due today", description: "Tasks due on your local calendar day" },
  { key: "upcomingEnabled", label: "Upcoming reminders", description: "Tasks with a configured reminder window" },
];

export default function NotificationSettings({ settings }) {
  const { preferences, loading, saving, error, saved, save } = settings;
  const [draft, setDraft] = useState(preferences);
  useEffect(() => { setDraft(preferences); }, [preferences]);
  const changed = OPTIONS.some(option => draft[option.key] !== preferences[option.key]);

  return (
    <section className="notification-settings" aria-label="Notification preferences">
      <div className="notification-settings-title">
        <strong>Notification preferences</strong>
        <p>Choose which alerts appear in TaskFlow.</p>
      </div>
      {OPTIONS.map(option => (
        <label className="notification-settings-option" key={option.key}>
          <span><strong>{option.label}</strong><small>{option.description}</small></span>
          <input type="checkbox" checked={Boolean(draft[option.key])}
            disabled={loading || saving}
            onChange={event => setDraft(current => ({ ...current, [option.key]: event.target.checked }))} />
        </label>
      ))}
      <p className="notification-settings-note">Email reminders are not enabled yet. No messages will be sent.</p>
      {error && <p className="notification-settings-error" role="alert">{error}</p>}
      {saved && !changed && <p className="notification-settings-saved" role="status">Preferences saved.</p>}
      <button type="button" className="notification-settings-save"
        disabled={!changed || loading || saving}
        onClick={() => { void save(draft); }}>
        {saving ? "Saving…" : "Save preferences"}
      </button>
    </section>
  );
}
