import { useState } from "react";
import { getProductivityInsights } from "../../utils/productivityInsights.js";

const DUE_STATES = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "unscheduled", label: "Unscheduled" },
];

export default function ProductivityInsights({ tasks }) {
  const [expanded, setExpanded] = useState(false);
  const snapshot = getProductivityInsights(tasks);
  const maxCategory = Math.max(1, ...snapshot.categories.map(category => category.total));

  return (
    <section className="productivity-insights" aria-label="Productivity insights">
      <header className="insights-heading">
        <div>
          <span className="section-kicker">YOUR WORKLOAD</span>
          <h2>Productivity insights</h2>
          <p>Current task snapshot, not historical completion trends.</p>
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
