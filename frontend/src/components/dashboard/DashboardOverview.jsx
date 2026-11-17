export default function DashboardOverview({ activeCount, completedCount, overdueCount, dueTodayCount, completionRate }) {
  return (
    <>
      <section className="dashboard-intro"><div><span className="section-kicker">OVERVIEW</span><h2>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}.</h2><p>Here’s what’s happening with your tasks.</p></div><span className="today-chip">{new Date().toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"})}</span></section>
      <section className="overview">
        <article className="overview-card"><span className="overview-label">In progress</span><span className="overview-value">{activeCount}</span><span className="stat-hint">Tasks to work on</span></article>
        <article className="overview-card"><span className="overview-label">Completed</span><span className="overview-value">{completedCount}</span><span className="stat-hint">Tasks finished</span></article>
        <article className="overview-card"><span className="overview-label">Overdue</span><span className="overview-value overdue-value">{overdueCount}</span><span className="stat-hint">Need your attention</span></article>
        <article className="overview-card"><span className="overview-label">Due today</span><span className="overview-value">{dueTodayCount}</span><span className="stat-hint">Keep moving forward</span></article>
        <article className="overview-card progress-card"><span className="overview-label">Completion rate</span><span className="overview-value">{completionRate}%</span><div className="progress-track"><span style={{width: completionRate + "%"}} /></div></article>
      </section>
    </>
  );
}
