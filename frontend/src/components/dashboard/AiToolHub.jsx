import { useState } from "react";
import AiCopilot from "./AiCopilot.jsx";
import AiSmartScheduler from "./AiSmartScheduler.jsx";
import AiDailyPlanner from "./AiDailyPlanner.jsx";
import AiTaskPlanner from "./AiTaskPlanner.jsx";

const TOOLS = [
  { id: "copilot", symbol: "✦", title: "Ask Copilot", subtitle: "Chat about your workspace" },
  { id: "breakdown", symbol: "✧", title: "Break down a goal", subtitle: "Turn an idea into tasks" },
  { id: "daily", symbol: "◷", title: "Plan my day", subtitle: "Pick what matters next" },
  { id: "schedule", symbol: "▦", title: "Smart schedule", subtitle: "Preview your week" }
];

// Keep all four workflows mounted while switching tools, so a user can
// inspect another capability without losing a generated preview or edits.
// Inactive tools remain hidden and do not automatically call OpenAI.
export default function AiToolHub({
  token, tasks, projects, onUnauthorized, onOpenTask, onTasksCreated,
  onViewCreatedTasks, aiCooldown
}) {
  const [selected, setSelected] = useState(null);
  const activeTool = TOOLS.find(tool => tool.id === selected);

  return <section className="ai-tool-hub" aria-label="TaskFlow AI">
    <header className="ai-hub-heading">
      <div className="ai-hub-symbol" aria-hidden="true">✦</div>
      <div className="ai-hub-title">
        <h2>TaskFlow AI</h2>
        <p>What would you like help with?</p>
      </div>
      {selected && <button type="button" className="ai-hub-dismiss"
        onClick={() => setSelected(null)}>Close</button>}
    </header>
    <nav className="ai-hub-choices" aria-label="AI tools">
      {TOOLS.map(tool => <button key={tool.id} type="button"
        className="ai-hub-choice" aria-pressed={selected === tool.id}
        aria-controls={"ai-hub-panel-" + tool.id}
        onClick={() => setSelected(current => current === tool.id ? null : tool.id)}>
        <span className="ai-hub-choice-symbol" aria-hidden="true">{tool.symbol}</span>
        <span className="ai-hub-choice-name">{tool.title}</span>
        <span className="ai-hub-choice-description">{tool.subtitle}</span>
      </button>)}
    </nav>
    {activeTool && <div className="ai-hub-current-title">
      <strong>{activeTool.title}</strong>
      <span>{activeTool.subtitle}</span>
    </div>}
    <div id="ai-hub-panel-copilot" className="ai-hub-panel" hidden={selected !== "copilot"}>
      <AiCopilot token={token} tasks={tasks} active={selected === "copilot"} onUnauthorized={onUnauthorized} aiCooldown={aiCooldown} />
    </div>
    <div id="ai-hub-panel-breakdown" className="ai-hub-panel" hidden={selected !== "breakdown"}>
      <AiTaskPlanner token={token} projects={projects} onUnauthorized={onUnauthorized}
        onTasksCreated={onTasksCreated} onViewCreatedTasks={onViewCreatedTasks}
        aiCooldown={aiCooldown} embedded active={selected === "breakdown"} />
    </div>
    <div id="ai-hub-panel-daily" className="ai-hub-panel" hidden={selected !== "daily"}>
      <AiDailyPlanner token={token} tasks={tasks} onUnauthorized={onUnauthorized}
        onOpenTask={onOpenTask} aiCooldown={aiCooldown}
        embedded active={selected === "daily"} />
    </div>
    <div id="ai-hub-panel-schedule" className="ai-hub-panel" hidden={selected !== "schedule"}>
      <AiSmartScheduler token={token} tasks={tasks} onUnauthorized={onUnauthorized}
        onOpenTask={onOpenTask} aiCooldown={aiCooldown}
        embedded active={selected === "schedule"} />
    </div>
  </section>;
}
