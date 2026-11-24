import { useEffect, useMemo, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";
import AiCoachOptIn from "./AiCoachOptIn.jsx";
import { getPlanningAnalytics, getProductivityInsights } from "../../utils/productivityInsights.js";

const DUE_STATES = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "unscheduled", label: "Unscheduled" },
];

export default function ProductivityInsights({ tasks, token, onUnauthorized, onOpenTask }) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState({ status: "idle", token: null, data: null });
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;
  const [refreshHistory, setRefreshHistory] = useState(0);
  const [bottlenecks, setBottlenecks] = useState({ status: "idle", token: null, data: null });
  const [refreshBottlenecks, setRefreshBottlenecks] = useState(0);
  // Avoid grouping and sorting the entire workspace while insights are collapsed.
  // useMemo retains the snapshot until tasks change and expanded views need it.
  const snapshot = useMemo(() => expanded ? getProductivityInsights(tasks) : null, [expanded, tasks]);
  const maxCategory = snapshot ? Math.max(1, ...snapshot.categories.map(category => category.total)) : 1;
  const plan = useMemo(() => expanded ? getPlanningAnalytics(tasks) : null, [expanded, tasks]);
  const maxDue = plan ? Math.max(1, ...plan.week.map(day => day.count)) : 1;
  const maxPriority = plan ? Math.max(1, ...Object.values(plan.priority)) : 1;

  useEffect(() => {
    if (!expanded || !token) return;
    const controller = new AbortController();
    setHistory({ status: "loading", token, data: null });
    fetch(`${API}/api/analytics/completions`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
    }).then(async response => {
      if (response.status === 401) { unauthorizedRef.current?.(token); return null; }
      if (!response.ok) throw new Error("Could not load completion history.");
      return response.json();
    }).then(data => {
      if (controller.signal.aborted || data === null) return;
      if (data.timeZone !== "UTC" || data.windowDays !== 30 ||
          !Array.isArray(data.days) || data.days.length !== 30 ||
          data.days.some(day => !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day.date) ||
            !Number.isSafeInteger(day.completed) || day.completed < 0 ||
            !Number.isSafeInteger(day.reopened) || day.reopened < 0)) {
        throw new Error("Completion history response was invalid.");
      }
      setHistory({ status: "ready", token, data });
    }).catch(error => {
      if (!controller.signal.aborted) setHistory({
        status: "error", token, data: null,
        message: error.message || "Could not load completion history."
      });
    });
    return () => controller.abort();
  }, [expanded, token, refreshHistory, tasks]);


  useEffect(() => {
    if (!expanded || !token) return;
    const controller = new AbortController();
    setBottlenecks({ status: "loading", token, data: null });
    fetch(`${API}/api/analytics/bottlenecks`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
    }).then(async response => {
      if (response.status === 401) { unauthorizedRef.current?.(token); return null; }
      if (!response.ok) throw new Error("Could not load bottleneck recommendations.");
      return response.json();
    }).then(data => {
      if (controller.signal.aborted || data === null) return;
      if (data.analysis !== "rules" || data.timeZone !== "UTC" ||
          !data.metrics || !Number.isSafeInteger(data.metrics.blockedTasks) ||
          !Array.isArray(data.recommendations) || data.recommendations.length > 4 ||
          data.recommendations.some(item =>
            typeof item.id !== "string" || typeof item.title !== "string" ||
            typeof item.detail !== "string" ||
            (item.taskId != null && !Number.isSafeInteger(item.taskId)))) {
        throw new Error("Bottleneck analysis response was invalid.");
      }
      setBottlenecks({ status: "ready", token, data });
    }).catch(error => {
      if (!controller.signal.aborted) setBottlenecks({
        status: "error", token, data: null,
        message: error.message || "Could not load bottleneck recommendations."
      });
    });
    return () => controller.abort();
  }, [expanded, token, refreshBottlenecks, tasks]);

  const coach = bottlenecks.token === token && bottlenecks.status === "ready" ? bottlenecks.data : null;

  const historyData = history.token === token && history.status === "ready" ? history.data : null;
  const historyMax = historyData ? Math.max(1, ...historyData.days.map(day => day.completed)) : 1;


  return (
    <section className="productivity-insights" aria-label="Productivity insights">
      <header className="insights-heading">
        <div>
          <span className="section-kicker">YOUR WORKLOAD</span>
          <h2>Productivity insights</h2>
          <p>Charts and planning suggestions from your current task snapshot.</p>
        </div>
        <button type="button" aria-expanded={expanded} aria-controls="insights-content"
          onClick={() => setExpanded(value => !value)}>
          {expanded ? "Hide insights" : "Show insights"}
        </button>
      </header>
      {expanded && <div id="insights-content" className="insights-content">
        <div className="insights-summary" aria-label="Current task totals">
          <div><strong>{snapshot.total}</strong><span>Total tasks</span></div>
          <div><strong>{snapshot.active}</strong><span>Active</span></div>
          <div><strong>{snapshot.completed}</strong><span>Completed</span></div>
          <div><strong>{snapshot.completionRate}%</strong><span>Completed share</span></div>
        </div>
        <section className="insights-history" aria-label="Completion history">
          <header>
            <div><h3>Completion history · last 30 days</h3>
              <p className="insights-note">Recorded completion events by UTC date (not unique tasks). Reopened tasks may be completed again.</p>
            </div>
            <button type="button" onClick={() => setRefreshHistory(count => count + 1)}
              disabled={history.status === "loading" && history.token === token}>Refresh trend</button>
          </header>
          {history.token !== token || history.status === "loading" || history.status === "idle"
            ? <p role="status">Loading recorded completion history…</p>
            : history.status === "error"
              ? <p role="alert">{history.message} <button type="button" onClick={() => setRefreshHistory(count => count + 1)}>Retry</button></p>
              : historyData && <>
                <p className="insights-history-total">
                  <strong>{historyData.totalCompletions}</strong> completion events · {historyData.totalReopenings} reopenings
                </p>
                <div className="insights-history-scroll" role="region" tabIndex={0}
                  aria-label="Scrollable 30-day completion chart">
                  <div className="insights-history-bars" role="img"
                    aria-label={historyData.days.map(day => `${day.date}: ${day.completed} completions`).join("; ")}>
                    {historyData.days.map((day, index) => <div key={day.date} className="insights-history-bar"
                      title={`${day.date}: ${day.completed} completion events, ${day.reopened} reopenings`}>
                      <span className="insights-history-column">
                        <span style={{ height: (day.completed / historyMax * 100) + "%" }} />
                      </span>
                      <span className="insights-history-date">{index % 5 === 0 || index === 29 ? day.date.slice(5) : ""}</span>
                    </div>)}
                  </div>
                </div>
                <p className="insights-note">History begins when TaskFlow started recording activity. Earlier completions cannot be reconstructed from current task status.</p>
              </>}
        </section>
        <div className="insights-charts" aria-label="Workload charts">
          <section aria-label="Tasks due in the next seven days">
            <h3>Upcoming deadlines</h3>
            <p className="insights-note">Active tasks due each day, not historical completions.</p>
            <div className="insights-week-chart" role="img"
              aria-label={plan.week.map(day => `${day.label}: ${day.count} due`).join("; ")}>
              {plan.week.map(day => (
                <div key={day.date} className="insights-week-column">
                  <span className="insights-week-count">{day.count}</span>
                  <div className="insights-week-track">
                    <span style={{ height: (day.count / maxDue * 100) + "%" }} />
                  </div>
                  <span>{day.label}</span>
                </div>
              ))}
            </div>
          </section>
          <section aria-label="Active task priorities">
            <h3>Active workload by priority</h3>
            <p className="insights-note">A distribution of unfinished tasks.</p>
            <ul className="insights-priorities">
              {Object.entries(plan.priority).map(([label, count]) => (
                <li key={label}>
                  <div><span>{label}</span><strong>{count}</strong></div>
                  <div className="insights-bar-track" aria-hidden="true">
                    <span style={{ width: (count / maxPriority * 100) + "%" }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <section className="insights-coach" aria-label="Bottleneck coach">
          <header>
            <div>
              <h3>Bottleneck coach</h3>
              <p className="insights-note">Dependency-aware priorities using recorded task activity and deadlines.</p>
            </div>
            <button type="button" disabled={bottlenecks.token === token && bottlenecks.status === "loading"}
              onClick={() => setRefreshBottlenecks(count => count + 1)}>Analyze again</button>
          </header>
          {bottlenecks.token !== token || bottlenecks.status === "loading" || bottlenecks.status === "idle"
            ? <p role="status">Checking dependencies and recent activity…</p>
            : bottlenecks.status === "error"
              ? <p role="alert">{bottlenecks.message} <button type="button"
                  onClick={() => setRefreshBottlenecks(count => count + 1)}>Retry analysis</button></p>
              : coach && <>
                <div className="insights-coach-metrics" role="group" aria-label="Bottleneck metrics">
                  <div><strong>{coach.metrics.blockedTasks}</strong><span>Blocked tasks</span></div>
                  <div><strong>{coach.metrics.overdueReadyTasks}</strong><span>Unblocked overdue</span></div>
                  <div><strong>{coach.metrics.completionsLast7Days}</strong><span>Recorded completions · 7 days</span></div>
                </div>
                <ol className="insights-coach-list">
                  {coach.recommendations.map(item => <li key={item.id} className={`insights-coach-item insights-coach-${item.severity}`}>
                    <div><strong>{item.title}</strong><p>{item.detail}</p></div>
                    {item.taskId != null && tasks.some(task => task.id === item.taskId) && (
                      <button type="button" onClick={() => onOpenTask?.(item.taskId)}
                        aria-label={`Open task for ${item.title}`}>Open task</button>
                    )}
                  </li>)}
                </ol>
                <p className="insights-note">Explainable rule-based analysis, not an AI model. Suggestions never modify tasks automatically.</p>
                <AiCoachOptIn key={token} token={token} recommendations={coach.recommendations} onUnauthorized={onUnauthorized} />
              </>}
        </section>
        <section className="insights-advice" aria-label="Planning recommendations">
          <header><h3>Planning recommendations</h3><span>Rule-based · Private to this dashboard</span></header>
          <ul>
            {plan.recommendations.map(item => <li key={item.id}>
              <strong>{item.title}</strong><p>{item.detail}</p>
            </li>)}
          </ul>
          <p className="insights-note">These recommendations use deadlines and priorities, not AI or observed productivity history.</p>
        </section>
        <div className="insights-grids">
          <section aria-label="Tasks by category">
            <h3>Tasks by category</h3>
            {snapshot.categories.length ? (
              <ul className="insights-categories">
                {snapshot.categories.map(category => (
                  <li key={category.name}>
                    <div className="insights-category-label">
                      <span>{category.name}</span><span>{category.total} total · {category.active} active</span>
                    </div>
                    <div className="insights-bar-track" aria-hidden="true">
                      <span style={{ width: (category.total / maxCategory * 100) + "%" }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="insights-empty">Add a task to see the category breakdown.</p>}
          </section>
          <section aria-label="Active task schedule">
            <h3>Active task schedule</h3>
            <ul className="insights-schedule">
              {DUE_STATES.map(({ key, label }) => (
                <li key={key}><span>{label}</span><strong>{snapshot.due[key]}</strong></li>
              ))}
            </ul>
            <p className="insights-note">Completed tasks are excluded from due-date counts.</p>
          </section>
        </div>
      </div>}
    </section>
  );
}
