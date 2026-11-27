const weekdays = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" });

export default function MomentumCard({ history, refreshHistory, focusMinutes }) {
  const days = history.status === "ready" ? history.data.days.slice(-7) : [];
  const today = days.at(-1);
  const max = Math.max(1, ...days.map(day => day.completed));
  const active = days.filter(day => day.completed > 0).length;
  const total = days.reduce((sum, day) => sum + day.completed, 0);
  const best = today && today.completed > 0 && today.completed === max;
  return <section className="momentum-panel momentum-v2" aria-label="Productivity momentum">
    <header><div><span className="section-kicker">YOUR MOMENTUM</span><h2>Small wins add up</h2></div>
      <span className="momentum-period">Last 7 days · UTC</span></header>
    <div className="momentum-body">
      <div className="momentum-metrics">
        <div><span className="momentum-symbol" aria-hidden="true">✓</span><strong>{today ? today.completed : "—"}</strong><span>Completions today</span></div>
        <div><span className="momentum-symbol" aria-hidden="true">◈</span><strong>{today ? active + "/7" : "—"}</strong><span>Active days</span></div>
        <div><span className="momentum-symbol" aria-hidden="true">◷</span><strong>{focusMinutes} min</strong><span>Focus this visit</span></div>
      </div>
      <div className="momentum-week">
        {history.status === "loading" || history.status === "idle" ? <p role="status">Loading recent progress…</p> :
          history.status === "error" ? <p>Recent progress unavailable. <button type="button" onClick={refreshHistory}>Retry progress</button></p> :
          <>
            <div className="momentum-chart-heading"><strong>Weekly activity</strong><span>{total} completions</span></div>
            <div className="momentum-chart" role="img" aria-label={days.map(day => `${day.date}: ${day.completed} completion events`).join("; ")}>
              {days.map((day, index) => <div className={`momentum-day ${index === 6 ? "momentum-today" : ""}`} key={day.date} title={`${day.date}: ${day.completed} completion events`}>
                <span>{day.completed}</span><div className="momentum-track"><span style={{height: `${day.completed / max * 100}%`}} /></div>
                <small>{weekdays.format(new Date(day.date + "T12:00:00Z"))}</small>
              </div>)}
            </div>
            {best && <p className="momentum-encouragement">✦ {days.filter(day => day.completed === max).length > 1 ? "Tied for your busiest day this week." : "Your busiest day this week!"}</p>}
          </>}
      </div>
    </div>
    <p className="momentum-note">Recorded completion events, including repeat completions. Rest days are welcome.</p>
  </section>;
}
