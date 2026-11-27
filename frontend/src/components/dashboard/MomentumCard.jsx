import { useEffect, useMemo, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";

export default function MomentumCard({ token, tasks, focusMinutes, onUnauthorized }) {
  const [state, setState] = useState({ status: "loading", days: [] });
  const [retry, setRetry] = useState(0);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;
  const signature = useMemo(() => tasks.map(t => `${t.id}:${t.completed}`).sort().join("|"), [tasks]);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", days: [] });
    fetch(`${API}/api/analytics/completions`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
    }).then(async response => {
      if (response.status === 401) { unauthorized.current?.(token); return null; }
      if (!response.ok) throw new Error("History unavailable");
      return response.json();
    }).then(data => {
      if (controller.signal.aborted || data === null) return;
      if (data.timeZone !== "UTC" || data.windowDays !== 30 || !Array.isArray(data.days) ||
          data.days.length !== 30 || data.days.some((day, i) => !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
          !Number.isSafeInteger(day.completed) || day.completed < 0 ||
          (i > 0 && day.date <= data.days[i - 1].date))) throw new Error("Invalid history");
      setState({ status: "ready", days: data.days.slice(-7) });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ status: "error", days: [] });
    });
    return () => controller.abort();
  }, [token, signature, retry]);
  const days = state.days;
  const max = Math.max(1, ...days.map(day => day.completed));
  const active = days.filter(day => day.completed > 0).length;
  return <section className="momentum-panel" aria-label="Productivity momentum">
    <header><div><span className="section-kicker">YOUR MOMENTUM</span><h2>Small wins add up</h2></div>
      <div className="momentum-focus"><strong>{focusMinutes} min</strong><small>Finished focus · this visit</small></div></header>
    {state.status === "loading" ? <p role="status">Loading recent progress…</p> :
      state.status === "error" ? <p>Recent progress unavailable. <button type="button" onClick={() => setRetry(n => n + 1)}>Retry progress</button></p> :
      <>
        <div className="momentum-metrics">
          <div><strong>{days.at(-1).completed}</strong><span>Completions today</span></div>
          <div><strong>{active}/7</strong><span>Active days</span></div>
        </div>
        <div className="momentum-chart" role="img" aria-label={days.map(day => `${day.date}: ${day.completed} completion events`).join("; ")}>
          {days.map(day => <div className="momentum-day" key={day.date} title={day.date}>
            <span>{day.completed}</span><div className="momentum-track"><span style={{height: `${day.completed / max * 100}%`}} /></div>
            <small>{day.date.slice(5)}</small>
          </div>)}
        </div>
        <p className="momentum-note">Last 7 days · UTC · recorded completion events, including repeat completions. Rest days are welcome.</p>
      </>}
  </section>;
}
