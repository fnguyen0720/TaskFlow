import { useMemo, useState } from "react";
import { getPlanningAnalytics, getProductivityInsights } from "../../utils/productivityInsights.js";

const DUE_STATES = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "unscheduled", label: "Unscheduled" },
];

export default function ProductivityInsights({ tasks }) {
  const [expanded, setExpanded] = useState(false);
  // Avoid grouping and sorting the entire workspace while insights are collapsed.
  // useMemo retains the snapshot until tasks change and expanded views need it.
  const snapshot = useMemo(() => expanded ? getProductivityInsights(tasks) : null, [expanded, tasks]);
  const maxCategory = snapshot ? Math.max(1, ...snapshot.categories.map(category => category.total)) : 1;
  const plan = useMemo(() => expanded ? getPlanningAnalytics(tasks) : null, [expanded, tasks]);
  const maxDue = plan ? Math.max(1, ...plan.week.map(day => day.count)) : 1;
  const maxPriority = plan ? Math.max(1, ...Object.values(plan.priority)) : 1;

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
