import { useEffect, useRef, useState } from "react";
import { formatCooldown } from "../../hooks/useAiCooldown.js";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";

export default function AiCopilot({ token, tasks, active, onUnauthorized, aiCooldown }) {
  const [availability, setAvailability] = useState("idle");
  const [consent, setConsent] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(null);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setAvailability("loading");
    fetch(API + "/api/ai/plans/capabilities", { headers: { Authorization: "Bearer " + token }, signal: controller.signal })
      .then(async response => {
        if (controller.signal.aborted) return null;
        if (response.status === 401) { unauthorized.current?.(token); return null; }
        if (!response.ok) throw new Error();
        return response.json();
      }).then(data => { if (!controller.signal.aborted && data) setAvailability(data.available ? "ready" : "disabled"); })
      .catch(() => { if (!controller.signal.aborted) setAvailability("error"); });
    return () => controller.abort();
  }, [active, token]);
  useEffect(() => () => request.current?.abort(), []);
  const open = tasks.filter(task => !task.completed);
  const prompts = open.length ? ["What should I work on next?", "Help me prioritize my deadlines.", "Is my workload manageable?"] : ["Help me plan a productive day.", "How can I build a consistent routine?"];
  const allowed = consent && availability === "ready" && !busy && aiCooldown.remainingSeconds === 0;
  async function send(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!allowed || !text || text.length > 600 || request.current) return;
    const outgoing = [...messages.slice(-8), { role: "user", text }];
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(API + "/api/ai/copilot", {
        method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, messages: outgoing }), signal: controller.signal
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) { unauthorized.current?.(token); return; }
      if (response.status === 429) { aiCooldown.onRateLimited(response); throw new Error("AI requests are temporarily limited. Your draft is preserved."); }
      if (!response.ok) throw new Error("Copilot is temporarily unavailable. Your draft is preserved.");
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (typeof data.reply !== "string" || !data.reply.trim() || data.reply.length > 1600) throw new Error("Invalid Copilot reply. Please try again.");
      setMessages([...outgoing, { role: "assistant", text: data.reply }]);
      setDraft("");
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message || "Copilot unavailable.");
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }
  function clear() {
    request.current?.abort(); request.current = null;
    setBusy(false); setMessages([]); setDraft(""); setError(""); setConsent(false);
  }
  if (!active) return null;
  return <section className="copilot" aria-label="AI Productivity Copilot">
    <header className="copilot-header"><div><h3>Ask Copilot</h3><p>Read-only advice for your workspace.</p></div>
      <button type="button" onClick={clear}>Clear chat</button></header>
    {availability === "loading" && <p role="status">Checking AI availability…</p>}
    {availability === "disabled" && <p role="status">Copilot is not configured.</p>}
    {availability === "error" && <p role="alert">Copilot unavailable. Reopen to retry.</p>}
    {availability === "ready" && <>
      <label className="copilot-consent"><input type="checkbox" checked={consent} onChange={e => e.target.checked ? setConsent(true) : clear()} />
        <span>I agree to send my question, recent chat and up to 15 unfinished task titles, priorities and due dates to OpenAI. No task notes or account details are included.</span></label>
      <div className="copilot-prompts" aria-label="Suggested questions">{prompts.map(prompt => <button key={prompt} type="button" disabled={busy} onClick={() => setDraft(prompt)}>{prompt}</button>)}</div>
      <div className="copilot-transcript" role="log" aria-label="Copilot conversation" aria-live="polite">
        {messages.map((message, index) => <div key={index} className={"copilot-turn " + message.role}><strong>{message.role === "user" ? "You" : "Copilot"}</strong><p>{message.text}</p></div>)}
        {busy && <p role="status">Thinking…</p>}
      </div>
      <form onSubmit={send} className="copilot-form"><label htmlFor="copilot-question">Ask a question</label>
        <textarea id="copilot-question" value={draft} onChange={e => setDraft(e.target.value)} maxLength={600} disabled={busy} rows={3} placeholder="What should I focus on?" />
        <button type="submit" disabled={!allowed || !draft.trim()}>{busy ? "Thinking…" : "Send question"}</button></form>
      {aiCooldown.remainingSeconds > 0 && <p role="status">AI cooldown: {formatCooldown(aiCooldown.remainingSeconds)}</p>}
      {error && <p role="alert">{error}</p>}
      <small>Chat stays in this visit. Recent turns are sent with each question. Copilot cannot change your tasks.</small>
    </>}
  </section>;
}
