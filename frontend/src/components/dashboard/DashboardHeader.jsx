import NotificationCenter from "./NotificationCenter.jsx";

export default function DashboardHeader({ logout, notifications, notificationCenter, onOpenTask }) {
  return (
    <header className="dashboard-header">
      <div>
        <div className="brand-kicker">YOUR PERSONAL WORKSPACE</div>
        <h1>TaskFlow<span className="brand-period">.</span></h1>
        <p className="subtitle">A little progress each day adds up to big results.</p>
      </div>
      <div className="dashboard-header-actions">
        <NotificationCenter notifications={notifications} loading={notificationCenter.loading}
          error={notificationCenter.error} pending={notificationCenter.pending}
          onUpdate={notificationCenter.update}
          onMarkAllRead={notificationCenter.markAllRead}
          onOpenTask={onOpenTask} />
        <button type="button" className="logout-button" onClick={logout}>Log out ↗</button>
      </div>
    </header>
  );
}
