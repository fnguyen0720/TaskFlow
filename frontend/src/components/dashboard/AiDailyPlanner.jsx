import { useEffect, useRef, useState } from "react";
import { formatCooldown } from "../../hooks/useAiCooldown.js";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";

// Separate, opt-in, read-only workflow. Never writes task records or sends
// task details until the user confirms the exact scope in the checkbox.
export default function AiDailyPlanner({ token, tasks, onUnauthorized, onOpenTask, aiCooldown, embedded = false, active = false }) {
  const [locallyOpen, setOpen] = useState(false);
  const open = embedded ? active : locallyOpen;
  const [availability, setAvailability] = useState("idle");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picks, setPicks] = useState(null);
  const [message, setMessage] = useState("");
  const activeRequest = useRef(null);
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setAvailability("loading");
    fetch(API + "/api/ai/plans/capabilities", {
      headers: { Authorization: "Bearer " + token },
      signal: abort.signal
    }).then(async response => {
      if (response.status === 401) { unauthorizedRef.current(token); return null; }
      if (!response.ok) throw new Error("Unavailable");
      return response.json();
    }).then(data => {
      if (!abort.signal.aborted && data)
        setAvailability(data.available ? "ready" : "disabled");
    }).catch(() => {
      if (!abort.signal.aborted) setAvailability("error");
    });
    return () => abort.abort();
  }, [open, token]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const count = tasks.filter(task => !task.completed).length;
  const visiblePicks = picks?.filter(item => tasks.some(task =>
    task.id === item.taskId && !task.completed)) ?? null;

  async function generate() {
    if (!consent || availability !== "ready" || loading || count === 0 || aiCooldown.remainingSeconds > 0) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    // Preserve the last recommended tasks if a refresh fails or is limited.
    setMessage("");
    try {
      const response = await fetch(API + "/api/ai/daily-focus", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
        signal: controller.signal
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) { unauthorizedRef.current(token); return; }
      if (response.status === 429) {
        const retry = aiCooldown.onRateLimited(response);
        throw new Error(retry === null
          ? "AI requests are temporarily limited. Please try again later."
          : "AI requests are temporarily limited. Your current priorities are unchanged.");
      }
      if (!response.ok) throw new Error("A daily plan couldn't be generated. Your tasks are unchanged.");
      const data = await response.json();
      if (!Array.isArray(data.picks) || data.picks.length > 5 ||
        data.picks.some(item => !Number.isInteger(item.taskId) ||
          typeof item.reason !== "string" || item.reason.length > 120 ||
          typeof item.title !== "string"))
        throw new Error("Invalid AI response. No tasks were changed.");
      setPicks(data.picks);
      if (data.picks.length === 0) setMessage("No unfinished tasks to plan right now.");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error.message || "Daily plan unavailable.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return <section className="ai-daily-plan" aria-label="AI daily planner">
    {!embedded && <button type="button" className="ai-daily-toggle" aria-expanded={open}
      aria-controls="ai-daily-content" onClick={() => setOpen(value => !value)}>
      <span className="ai-daily-symbol" aria-hidden="true">✦</span>
      <span className="ai-daily-title">Plan my day<small>Prioritize what matters next</small></span>
      <span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>}

    {open && <div className="ai-daily-content" id="ai-daily-content">
      {availability === "loading" && <p role="status">Checking AI availability…</p>}
      {availability === "error" && <p role="alert">AI planning is temporarily unavailable.</p>}
      {availability === "disabled" && <p role="status">AI planning is not configured.</p>}
      {availability === "ready" && <>
        <p>Get up to five suggested priorities from your unfinished tasks. Your task list will not be changed.</p>
        <label className="ai-daily-consent">
          <input type="checkbox" checked={consent} disabled={loading}
            onChange={event => { setConsent(event.target.checked); setPicks(null); setMessage(""); }} />
          <span>I agree to send up to 15 unfinished task titles, priorities and due dates to OpenAI. No notes or account details are sent.</span>
        </label>
        <button className="ai-daily-generate" type="button"
          disabled={!consent || loading || count === 0 || aiCooldown.remainingSeconds > 0} onClick={generate}>
          {loading ? "Finding your focus…" :
            aiCooldown.remainingSeconds > 0 ? "AI cooldown active" : "Suggest today's priorities"}
        </button>
        {aiCooldown.remainingSeconds > 0 && <p className="ai-cooldown-notice" role="status">
          AI requests are paused. Estimated retry in <strong>{formatCooldown(aiCooldown.remainingSeconds)}</strong>.
        </p>}
        {loading && <p role="status">Generating suggestions. No tasks are being changed.</p>}
        {message && !loading && <p role={picks !== null ? "status" : "alert"}>{message}</p>}
        {visiblePicks && visiblePicks.length > 0 && <div className="ai-daily-results">
          <h3>Your suggested focus</h3>
          <p>Advisory only · Choose what to tackle first</p>
          <ol>
            {visiblePicks.map(item => <li key={item.taskId}>
              <button type="button" onClick={() => onOpenTask(item.taskId)}>
                <span className="ai-daily-result-title">{item.title}</span>
                <span className="ai-daily-result-reason">{item.reason}</span>
                <span className="ai-daily-result-meta">{item.priority}{item.dueDate ? " · Due " + item.dueDate : ""}</span>
              </button>
            </li>)}
          </ol>
          <button type="button" className="ai-daily-reset"
            onClick={() => { setPicks(null); setMessage(""); setConsent(false); }}>
            Start over
          </button>
        </div>}
        {picks && picks.length > 0 && visiblePicks?.length === 0 &&
          <p role="status">These tasks are no longer open. Generate a new plan if needed.</p>}
      </>}
    </div>}
  </section>;
}
