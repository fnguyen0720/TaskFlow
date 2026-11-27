import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";
const PRIORITIES = ["Low", "Medium", "High"];
const CATEGORIES = ["General", "Work", "Study", "Personal"];

// Mounted only for signed-in accounts. No inference until explicit consent.
export default function AiTaskPlanner({ token, projects, onUnauthorized, onTasksCreated, onViewCreatedTasks }) {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState("idle");
  const [goal, setGoal] = useState("");
  const [consent, setConsent] = useState(false);
  const [items, setItems] = useState([]);
  const [phase, setPhase] = useState("compose");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [lastCreatedIds, setLastCreatedIds] = useState([]);
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
  const selectionCount = selected.length;
  const anySelected = selectionCount > 0;
  const validSelection = selected.length > 0 && selected.length <= 8 &&
    selected.every(item => item.title.trim().length > 0 && item.title.trim().length <= 100 &&
      PRIORITIES.includes(item.priority) && CATEGORIES.includes(item.category)) &&
    new Set(selected.map(item => item.title.trim().toLowerCase())).size === selected.length;

  function chooseExample(example) {
    if (busy) return;
    setGoal(example);
    setConsent(false);
    setItems([]);
    setPhase("compose");
    setMessage("");
  }

  function editGoal() {
    if (busy || !window.confirm("Discard these suggestions and edit your goal?")) return;
    setItems([]);
    setConsent(false);
    setPhase("compose");
    setMessage("");
  }

  function selectAll(checked) {
    if (busy) return;
    setItems(current => current.map(item => ({ ...item, selected: checked })));
    setMessage("");
  }

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
        { setItems(data.tasks.map(item => ({ ...item, selected: true }))); setPhase("review"); }
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
      setPhase("done");
      setLastCreatedIds(data.tasks.map(task => task.id).filter(Number.isInteger));
      setMessage(data.tasks.length + " tasks created.");
      try {
        await onTasksCreated();
      } catch {
        // The transaction already succeeded. Never imply that the user should
        // resubmit an acknowledged batch, which would create duplicates.
        setMessage(data.tasks.length + " tasks created. Refresh your task list to see them.");
      }
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
      <span className="ai-plan-symbol" aria-hidden="true">✦</span>
      <span className="ai-plan-toggle-title">AI task breakdown<small>Turn a goal into a plan</small></span>
      <span className="ai-plan-chevron" aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div id="ai-plan-content" className="ai-plan-content">
      {available === "loading" && <p role="status">Checking AI availability…</p>}
      {available === "error" && <p role="alert">AI availability unavailable. Reopen this panel to retry.</p>}
      {available === "disabled" && <p role="status">AI planning is not configured for this workspace.</p>}
      {available === "ready" && <>
        <div className="ai-plan-steps" aria-label="AI plan steps">
          <span className={phase === "compose" ? "current" : ""} aria-current={phase === "compose" ? "step" : undefined}>
            <span aria-hidden="true">1</span> Goal
          </span>
          <span className={phase === "review" ? "current" : ""} aria-current={phase === "review" ? "step" : undefined}>
            <span aria-hidden="true">2</span> Review
          </span>
          <span className={phase === "done" ? "current" : ""} aria-current={phase === "done" ? "step" : undefined}>
            <span aria-hidden="true">3</span> Created
          </span>
        </div>
        {phase === "compose" && <>
          <label htmlFor="ai-plan-goal">What's your goal?</label>
          <textarea id="ai-plan-goal" rows={3} maxLength={600} value={goal}
            disabled={!!busy} placeholder="E.g., Launch my portfolio website"
            onChange={event => {
              setGoal(event.target.value); setConsent(false); setItems([]); setMessage("");
            }} />
          <div className="ai-plan-examples" aria-label="Try an example goal">
            <span>Try:</span>
            <button type="button" disabled={!!busy}
              onClick={() => chooseExample("Launch a personal portfolio website")}>Portfolio website</button>
            <button type="button" disabled={!!busy}
              onClick={() => chooseExample("Prepare for an upcoming programming interview")}>Interview prep</button>
          </div>
          <label className="ai-plan-consent">
            <input type="checkbox" checked={consent} disabled={!!busy}
              onChange={event => setConsent(event.target.checked)} />
            <span>Send only the goal I typed to OpenAI. No existing tasks or account details are shared.</span>
          </label>
          <button type="button" className="ai-plan-action ai-plan-generate" disabled={!!busy || !consent ||
            goal.trim().length < 12 || goal.trim().length > 600} onClick={generate}>
            <span aria-hidden="true">✦</span> {busy === "generate" ? "Building your plan…" : "Generate plan"}
          </button>
          {busy === "generate" && <p role="status" aria-live="polite">Creating task suggestions for your review. Nothing has been saved.</p>}
        </>}
        {phase === "review" && <div className="ai-plan-review" aria-label="Review AI task suggestions">
          <div className="ai-plan-review-heading">
            <div>
              <h3>Your suggested plan</h3>
              <p>{selectionCount} of {items.length} selected · Nothing saved yet</p>
            </div>
            <button type="button" className="ai-plan-link" disabled={!!busy} onClick={editGoal}>Edit goal</button>
          </div>
          <p className="ai-plan-goal-preview">{goal}</p>
          <div className="ai-plan-selection-tools">
            <button type="button" disabled={!!busy || selectionCount === items.length}
              onClick={() => selectAll(true)}>Select all</button>
            <button type="button" disabled={!!busy || !anySelected}
              onClick={() => selectAll(false)}>Clear selection</button>
          </div>
          <div className="ai-plan-items">
            {items.map((item, index) => <div className={"ai-plan-item" + (item.selected ? "" : " is-excluded")} key={index}>
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
          </div>
          <label>Save into project (optional)
            <select disabled={!!busy} value={projectId}
              onChange={event => setProjectId(event.target.value)}>
              <option value="">No project</option>
              {projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}
            </select>
          </label>
          {!validSelection && <p role="alert">Select at least one task with unique, valid titles.</p>}
          <div className="ai-plan-actions">
            <button type="button" onClick={() => { setItems([]); setPhase("compose"); }}
              disabled={!!busy}>Discard suggestions</button>
            <button type="button" className="ai-plan-action" disabled={!validSelection || !!busy}
              onClick={createSelected}>{busy === "commit" ? "Saving your tasks…" : "Create " + selectionCount + " selected tasks"}</button>
          </div>
          {busy === "commit" && <p role="status" aria-live="polite">Saving your approved selection…</p>}
        </div>}
        {phase === "done" && <div className="ai-plan-finished">
          <span className="ai-plan-finished-icon" aria-hidden="true">✓</span>
          <h3>Plan created!</h3>
          <p role="status">{message}</p>
          <div className="ai-plan-finished-actions">
            <button type="button" className="ai-plan-action"
              disabled={lastCreatedIds.length === 0}
              onClick={() => onViewCreatedTasks(lastCreatedIds)}>
              View created tasks
            </button>
            <button type="button" className="ai-plan-finished-secondary"
              onClick={() => { setPhase("compose"); setMessage(""); setProjectId(""); setLastCreatedIds([]); }}>
              Plan another goal
            </button>
          </div>
        </div>}
        {phase !== "done" && message && <p role="alert">{message}</p>}
      </>}
    </div>}
  </section>;
}
