import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";
const PRIORITIES = ["Low", "Medium", "High"];
const CATEGORIES = ["General", "Work", "Study", "Personal"];

// Mounted only for signed-in accounts. No inference until explicit consent.
export default function AiTaskPlanner({ token, projects, onUnauthorized, onTasksCreated }) {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState("idle");
  const [goal, setGoal] = useState("");
  const [consent, setConsent] = useState(false);
  const [items, setItems] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const controller = useRef(null);
  const session = useRef(token);
  session.current = token;

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setAvailable("loading");
    fetch(API + "/api/ai/plans/capabilities", {
      headers: { Authorization: "Bearer " + token }, signal: abort.signal
    }).then(async response => {
      if (response.status === 401) { onUnauthorized(token); return null; }
      if (!response.ok) throw new Error("AI availability unavailable.");
      return response.json();
    }).then(value => {
      if (!abort.signal.aborted && value && session.current === token)
        setAvailable(value.available ? "ready" : "disabled");
    }).catch(() => {
      if (!abort.signal.aborted && session.current === token) setAvailable("error");
    });
    return () => abort.abort();
  }, [open, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => controller.current?.abort(), []);

  const selected = items.filter(item => item.selected);
  const validSelection = selected.length > 0 && selected.length <= 8 &&
    selected.every(item => item.title.trim().length > 0 && item.title.trim().length <= 100 &&
      PRIORITIES.includes(item.priority) && CATEGORIES.includes(item.category)) &&
    new Set(selected.map(item => item.title.trim().toLowerCase())).size === selected.length;

  function changeItem(index, change) {
    setMessage("");
    setItems(current => current.map((item, i) => i === index ? { ...item, ...change } : item));
  }

  async function generate() {
    if (available !== "ready" || busy || !consent ||
      goal.trim().length < 12 || goal.trim().length > 600) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setItems([]);
    setMessage("");
    setBusy("generate");
    try {
      const response = await fetch(API + "/api/ai/plans/generate", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        signal: abort.signal, body: JSON.stringify({ goal: goal.trim(), consent: true })
      });
      if (response.status === 401) { onUnauthorized(token); return; }
      if (!response.ok) throw new Error(response.status === 429
        ? "AI request limit reached. Try again later."
        : "Could not generate a plan. No tasks were changed.");
      const data = await response.json();
      if (!Array.isArray(data.tasks) || data.tasks.length < 3 || data.tasks.length > 8 ||
          data.tasks.some(item => typeof item.title !== "string" ||
            item.title.trim().length < 1 || item.title.length > 100 ||
            !PRIORITIES.includes(item.priority) || !CATEGORIES.includes(item.category)))
        throw new Error("AI returned an invalid plan. Please try again.");
      if (!abort.signal.aborted && session.current === token)
        setItems(data.tasks.map(item => ({ ...item, selected: true })));
    } catch (error) {
      if (!abort.signal.aborted && session.current === token)
        setMessage(error.message || "Unable to generate a plan.");
    } finally {
      if (!abort.signal.aborted && session.current === token) setBusy("");
    }
  }

  async function createSelected() {
    if (!validSelection || busy) return;
    if (!window.confirm("Create " + selected.length + " selected tasks? This will save them to your private workspace.")) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy("commit");
    setMessage("");
    try {
      const response = await fetch(API + "/api/ai/plans/commit", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          confirm: true, projectId: projectId ? Number(projectId) : null,
          tasks: selected.map(item => ({
            title: item.title.trim(), priority: item.priority, category: item.category
          }))
        })
      });
      if (response.status === 401) { onUnauthorized(token); return; }
      if (!response.ok) throw new Error(response.status === 404
        ? "Selected project is unavailable. Choose another."
        : "Could not save the plan. Review your workspace before retrying.");
      const data = await response.json();
      if (!Array.isArray(data.tasks) || data.tasks.length !== selected.length)
        throw new Error("Tasks may have been saved. Refresh your workspace before retrying.");
      if (abort.signal.aborted || session.current !== token) return;
      // The backend commits the entire selection in one transaction.
      setItems([]);
      setGoal("");
      setConsent(false);
      setMessage(data.tasks.length + " tasks created.");
      await onTasksCreated();
    } catch (error) {
      if (!abort.signal.aborted && session.current === token)
        setMessage(error.message || "Could not save the plan. Check your tasks before retrying.");
    } finally {
      if (!abort.signal.aborted && session.current === token) setBusy("");
    }
  }

  return <section className="ai-plan" aria-label="AI task breakdown">
    <button type="button" className="ai-plan-toggle" aria-expanded={open}
      aria-controls="ai-plan-content" onClick={() => setOpen(value => !value)}>
      <span aria-hidden="true">✦</span> AI task breakdown <span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div id="ai-plan-content" className="ai-plan-content">
      <p>Turn a goal into editable task suggestions. Nothing is saved until you approve.</p>
      {available === "loading" && <p role="status">Checking AI availability…</p>}
      {available === "error" && <p role="alert">AI availability unavailable.</p>}
      {available === "disabled" && <p role="status">AI planning is not configured.</p>}
      {available === "ready" && <>
        <label htmlFor="ai-plan-goal">What would you like to accomplish?</label>
        <textarea id="ai-plan-goal" rows={2} maxLength={600} value={goal}
          disabled={!!busy} placeholder="E.g., Launch my portfolio website"
          onChange={event => {
            setGoal(event.target.value); setConsent(false); setItems([]); setMessage("");
          }} />
        <label className="ai-plan-consent">
          <input type="checkbox" checked={consent} disabled={!!busy}
            onChange={event => setConsent(event.target.checked)} />
          <span>Send only the goal I typed to OpenAI. No existing tasks or account details are shared.</span>
        </label>
        <button type="button" className="ai-plan-action" disabled={!!busy || !consent ||
          goal.trim().length < 12 || goal.trim().length > 600} onClick={generate}>
          {busy === "generate" ? "Generating…" : "Generate suggestions"}
        </button>
        {items.length > 0 && <div className="ai-plan-review" aria-label="Review AI task suggestions">
          <h3>Review your plan</h3>
          <p>Edit or deselect anything before creating tasks.</p>
          {items.map((item, index) => <div className="ai-plan-item" key={index}>
            <label className="ai-plan-select">
              <input type="checkbox" checked={item.selected} disabled={!!busy}
                onChange={event => changeItem(index, { selected: event.target.checked })} />
              <span>Include task {index + 1}</span>
            </label>
            <label>Task title
              <input type="text" maxLength={100} value={item.title} disabled={!!busy}
                onChange={event => changeItem(index, { title: event.target.value })} />
            </label>
            <div className="ai-plan-fields">
              <label>Priority
                <select value={item.priority} disabled={!!busy}
                  onChange={event => changeItem(index, { priority: event.target.value })}>
                  {PRIORITIES.map(value => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label>Category
                <select value={item.category} disabled={!!busy}
                  onChange={event => changeItem(index, { category: event.target.value })}>
                  {CATEGORIES.map(value => <option key={value}>{value}</option>)}
                </select>
              </label>
            </div>
          </div>)}
          <label>Save into project (optional)
            <select disabled={!!busy} value={projectId}
              onChange={event => setProjectId(event.target.value)}>
              <option value="">No project</option>
              {projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}
            </select>
          </label>
          {!validSelection && <p role="alert">Select at least one task with unique, valid titles.</p>}
          <div className="ai-plan-actions">
            <button type="button" onClick={() => setItems([])} disabled={!!busy}>Discard suggestions</button>
            <button type="button" className="ai-plan-action" disabled={!validSelection || !!busy}
              onClick={createSelected}>{busy === "commit" ? "Creating…" : "Create " + selected.length + " selected tasks"}</button>
          </div>
        </div>}
        {message && <p role={message.endsWith("tasks created.") ? "status" : "alert"}>{message}</p>}
      </>}
    </div>}
  </section>;
}
