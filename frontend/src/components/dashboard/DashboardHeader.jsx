import NotificationCenter from "./NotificationCenter.jsx";

export default function DashboardHeader({ logout, notifications, notificationCenter, notificationSettings, accountIdentity, onOpenTask, onOpenCommand, onOpenPreferences, preferencesReady }) {
  return (
    <header className="dashboard-header">
      <div>
        <h1>TaskFlow<span className="brand-period">.</span></h1>
      </div>
      <div className="dashboard-header-actions">
        <div className="account-identity" aria-live="polite">
          {accountIdentity.status === "loaded" ? (
            <span className="account-identity-email" title={accountIdentity.email}>
              Signed in as <strong>{accountIdentity.email}</strong>
            </span>
          ) : accountIdentity.status === "failed" ? (
            <span className="account-identity-unavailable">Account unavailable <button type="button" onClick={accountIdentity.retry}>Retry</button></span>
          ) : <span className="account-identity-pending">Checking account…</span>}
        </div>
        <button type="button" className="workspace-settings-button" onClick={onOpenPreferences}
          disabled={!preferencesReady} aria-label="Workspace settings">Settings</button>
        <button type="button" className="command-launcher" onClick={onOpenCommand} aria-label="Open search and commands">Search <kbd>⌘K</kbd></button>
        <NotificationCenter notifications={notifications} loading={notificationCenter.loading}
          error={notificationCenter.error} pending={notificationCenter.pending}
          onUpdate={notificationCenter.update}
          onMarkAllRead={notificationCenter.markAllRead}
          settings={notificationSettings}
          onOpenTask={onOpenTask} />
        <button type="button" className="logout-button" onClick={logout}>Log out ↗</button>
      </div>
    </header>
  );
}
