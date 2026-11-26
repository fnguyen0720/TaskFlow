export default function DashboardOverview({ activeCount, completedCount, overdueCount, dueTodayCount, completionRate }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <>
      <section className="dashboard-intro">
        <div>
          <h2>{greeting}.</h2>
        </div>
        <span className="today-chip">{new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
      </section>
      <section className="overview" aria-label="Task summary">
        <article className="overview-card overview-card-today">
          <span className="overview-label"><span aria-hidden="true">◷</span> Due today</span>
          <span className="overview-value">{dueTodayCount}</span>
        </article>
        <article className="overview-card">
          <span className="overview-label"><span aria-hidden="true">☰</span> To do</span>
          <span className="overview-value">{activeCount}</span>
        </article>
        <article className="overview-card">
          <span className="overview-label"><span aria-hidden="true">✓</span> Completed</span>
          <span className="overview-value">{completedCount}</span>
          <div className="progress-track" role="progressbar" aria-label="Overall task completion"
            aria-valuenow={completionRate} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: completionRate + "%" }} />
          </div>
        </article>
        <article className="overview-card">
          <span className="overview-label"><span aria-hidden="true">!</span> Overdue</span>
          <span className="overview-value overdue-value">{overdueCount}</span>
        </article>
      </section>
    </>
  );
}
