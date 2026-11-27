import { useEffect, useRef, useState } from "react";
import { formatDateForInput } from "../../utils/taskUtils.js";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";

function localToday() { return formatDateForInput(new Date()); }
function seventhDay(start) {
  const [year, month, day] = start.split("-").map(Number);
  const date = new Date(year, month - 1, day + 6, 12);
  return formatDateForInput(date);
}

// Purely advisory. Editing a suggested date changes only ephemeral React state.
export default function AiSmartScheduler({ token, tasks, onUnauthorized, onOpenTask }) {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState("idle");
  const [consent, setConsent] = useState(false);
  const [capacity, setCapacity] = useState(2);
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const running = useRef(null);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;
  const today = localToday();
  const end = seventhDay(today);

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setAvailable("loading");
    fetch(API + "/api/ai/plans/capabilities", {
      headers: { Authorization: "Bearer " + token }, signal: abort.signal
    }).then(async response => {
      if (response.status === 401) { unauthorized.current(token); return null; }
      if (!response.ok) throw new Error("Availability check failed");
      return response.json();
    }).then(value => {
      if (!abort.signal.aborted && value)
        setAvailable(value.available ? "ready" : "disabled");
    }).catch(() => { if (!abort.signal.aborted) setAvailable("error"); });
    return () => abort.abort();
  }, [open, token]);

  useEffect(() => () => running.current?.abort(), []);

  const openTasks = tasks.filter(task => !task.completed);
  const visibleSlots = slots?.filter(slot => openTasks.some(task => task.id === slot.taskId)) ?? [];
  // Recompute capacity warnings after local edits; these are work-date load
  // estimates, not calendar free/busy or hour-level availability.
  const selectedIds = new Set(visibleSlots.map(slot => slot.taskId));
  const booked = new Map();
  for (const task of openTasks) {
    if (selectedIds.has(task.id) || !task.dueDate) continue;
    const date = task.dueDate.slice(0, 10);
    booked.set(date, (booked.get(date) || 0) + 1);
  }
  const slotLoads = new Map(booked);
  const warnings = new Map();
  for (const slot of visibleSlots) {
    const load = slotLoads.get(slot.suggestedDate) || 0;
    warnings.set(slot.taskId, {
      crowded: load >= capacity,
      pastDeadline: Boolean(slot.dueDate && slot.suggestedDate > slot.dueDate),
      overdue: Boolean(slot.dueDate && slot.dueDate < today)
    });
    slotLoads.set(slot.suggestedDate, load + 1);
  }

  async function suggest() {
    if (loading || !consent || available !== "ready" || openTasks.length === 0) return;
    running.current?.abort();
    const abort = new AbortController();
    running.current = abort;
    setLoading(true);
    setSlots(null);
    setError("");
    try {
      const response = await fetch(API + "/api/ai/smart-schedule", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, today, dailyCapacity: capacity }),
        signal: abort.signal
      });
      if (response.status === 401) { unauthorized.current(token); return; }
      if (!response.ok) throw new Error(response.status === 429
        ? "AI rate limit reached. Try again later."
        : "Couldn't build a schedule. Your tasks were not changed.");
      const data = await response.json();
      if (!Array.isArray(data.slots) || data.slots.length > 5 ||
        data.slots.some(slot => !Number.isInteger(slot.taskId) ||
          typeof slot.title !== "string" || typeof slot.reason !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(slot.suggestedDate) ||
          slot.suggestedDate < today || slot.suggestedDate > end))
        throw new Error("Invalid scheduling preview. No tasks were changed.");
      if (!abort.signal.aborted) setSlots(data.slots);
    } catch (problem) {
      if (!abort.signal.aborted) setError(problem.message || "Scheduling unavailable.");
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }

  function adjust(taskId, date) {
    if (date < today || date > end) return;
    setSlots(current => current.map(slot => slot.taskId === taskId
      ? { ...slot, suggestedDate: date } : slot));
  }

  return <section className="ai-smart-schedule" aria-label="AI smart scheduling">
    <button type="button" className="ai-smart-toggle" aria-expanded={open}
      aria-controls="ai-smart-content" onClick={() => setOpen(value => !value)}>
      <span aria-hidden="true">✦</span>
      <span>Smart scheduling<small>Preview a realistic week</small></span>
      <span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div className="ai-smart-content" id="ai-smart-content">
      {available === "loading" && <p role="status">Checking AI availability…</p>}
      {available === "error" && <p role="alert">AI scheduling is temporarily unavailable.</p>}
      {available === "disabled" && <p role="status">AI scheduling is not configured.</p>}
      {available === "ready" && <>
        <p>Get suggested <strong>work dates</strong> for up to five tasks over the next seven days. Existing deadlines stay unchanged.</p>
        <label className="ai-smart-capacity">How many tasks can you handle per day?
          <select value={capacity} disabled={loading}
            onChange={event => {
              setCapacity(Number(event.target.value));
              setSlots(null); setError(""); setConsent(false);
            }}>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} {n === 1 ? "task" : "tasks"}</option>)}
          </select>
        </label>
        <label className="ai-smart-consent">
          <input type="checkbox" checked={consent} disabled={loading}
            onChange={event => { setConsent(event.target.checked); setSlots(null); setError(""); }} />
          <span>Send up to 15 unfinished task titles, priorities and due dates to OpenAI. No notes, account details or availability data are shared.</span>
        </label>
        <button type="button" className="ai-smart-generate" disabled={!consent || loading || openTasks.length === 0}
          onClick={suggest}>{loading ? "Planning…" : "Preview schedule"}</button>
        {loading && <p role="status">Reviewing priorities. No tasks are being changed.</p>}
        {error && <p role="alert">{error}</p>}
        {slots && <div className="ai-smart-results" aria-label="Suggested work dates">
          <div className="ai-smart-results-heading">
            <h3>Suggested week</h3>
            <span>{visibleSlots.length} tasks · Preview only</span>
          </div>
          {visibleSlots.length === 0
            ? <p role="status">No open tasks in this preview.</p>
            : <div className="ai-smart-slots">{visibleSlots.map(slot => {
              const warning = warnings.get(slot.taskId);
              return <div className="ai-smart-slot" key={slot.taskId}>
                <button type="button" className="ai-smart-task" onClick={() => onOpenTask(slot.taskId)}>
                  {slot.title}
                </button>
                <p>{slot.reason}</p>
                <label>Suggested work date
                  <span className="ai-smart-date-shell">
                    <span className="ai-smart-date-display" aria-hidden="true">
                      {new Date(slot.suggestedDate + "T12:00:00").toLocaleDateString(undefined,
                        { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <input type="date" aria-label={"Work date for " + slot.title}
                      value={slot.suggestedDate} min={today} max={end}
                      onChange={event => adjust(slot.taskId, event.target.value)} />
                  </span>
                </label>
                {slot.dueDate && <span className="ai-smart-deadline">Existing deadline: {slot.dueDate}</span>}
                {(warning?.crowded || warning?.pastDeadline || warning?.overdue) && <div className="ai-smart-warning" role="status">
                  {warning.overdue ? "Deadline already passed. " : ""}
                  {warning.pastDeadline ? "Suggested work date is after the deadline. " : ""}
                  {warning.crowded ? "This day may exceed your task limit." : ""}
                </div>}
              </div>;
            })}</div>}
          <p className="ai-smart-disclaimer">Work dates are estimates, not due-date changes or calendar reservations. TaskFlow has not saved or rescheduled anything.</p>
          <button type="button" className="ai-smart-clear"
            onClick={() => { setSlots(null); setConsent(false); }}>Discard preview</button>
        </div>}
      </>}
    </div>}
  </section>;
}
