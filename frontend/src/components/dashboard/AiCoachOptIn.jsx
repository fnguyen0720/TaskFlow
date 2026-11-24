import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";

// No request to an AI provider occurs until the user checks consent and clicks
// Generate. API keys never appear in frontend code or browser requests.
export default function AiCoachOptIn({ token, recommendations, onUnauthorized }) {
  const [capabilities, setCapabilities] = useState({ status: "loading" });
  const [choice, setChoice] = useState("");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState({ status: "idle" });
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;
  const requestRef = useRef(null);
  const selected = recommendations.some(item => item.id === choice)
    ? choice : recommendations[0]?.id ?? "";

  useEffect(() => {
    const controller = new AbortController();
    setCapabilities({ status: "loading" });
    setResult({ status: "idle" });
    setConsent(false);
    fetch(`${API}/api/analytics/coach/capabilities`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
    }).then(async response => {
      if (response.status === 401) { unauthorizedRef.current?.(token); return null; }
      if (!response.ok) throw new Error("AI availability could not be checked.");
      return response.json();
    }).then(data => {
      if (!controller.signal.aborted && data)
        setCapabilities({ status: "ready", available: data.available === true });
    }).catch(() => {
      if (!controller.signal.aborted) setCapabilities({ status: "error" });
    });
    return () => {
      controller.abort();
      requestRef.current?.abort();
    };
  }, [token]);

  async function explain() {
    if (!consent || !selected || result.status === "loading" || !capabilities.available) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const id = selected;
    setResult({ status: "loading" });
    try {
      const response = await fetch(`${API}/api/analytics/coach/explain`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ insightId: id }),
        signal: controller.signal
      });
      if (response.status === 401) { unauthorizedRef.current?.(token); return; }
      if (!response.ok) throw new Error(response.status === 409
        ? "Your insight changed. Click Analyze again to refresh the underlying facts."
        : response.status === 429
          ? "AI request limit reached. Try again later."
          : "AI explanation is unavailable. Your rule-based advice is still usable.");
      const data = await response.json();
      if (data.insightId !== id || data.analysis !== "ai-explanation" ||
          typeof data.explanation !== "string" || data.explanation.trim().length === 0 ||
          data.explanation.length > 1500) throw new Error("AI returned an invalid explanation.");
      if (!controller.signal.aborted) setResult({
        status: "ready", id, explanation: data.explanation.trim()
      });
    } catch (error) {
      if (!controller.signal.aborted) setResult({ status: "error", message: error.message });
    }
  }

  return (
    <section className="insights-ai" aria-label="Optional AI explanation">
      <h4>Optional AI explanation</h4>
      {capabilities.status === "loading" ? <p role="status">Checking AI availability…</p> :
        capabilities.status === "error" ? <p role="status">AI availability could not be checked. The rule-based coach still works.</p> :
        !capabilities.available ? <p>AI explanations are not configured. The rule-based recommendations above remain available.</p> :
        <>
          <p>Select one insight for a short AI explanation. Only aggregated counts and the selected insight type are sent to OpenAI; no task titles, notes, identifiers, or account details. TaskFlow makes no changes automatically.</p>
          <label htmlFor="ai-coach-insight">Insight to explain</label>
          <select id="ai-coach-insight" value={selected} onChange={event => {
            requestRef.current?.abort();
            setChoice(event.target.value);
            setResult({ status: "idle" });
          }}>
            {recommendations.map(item =>
              <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          <label className="insights-ai-consent">
            <input type="checkbox" checked={consent}
              onChange={event => setConsent(event.target.checked)} />
            <span>I agree to share these aggregate statistics with OpenAI for this explanation.</span>
          </label>
          <button type="button" onClick={explain}
            disabled={!consent || !selected || result.status === "loading"}>
            {result.status === "loading" ? "Generating explanation…" : "Generate AI explanation"}
          </button>
          {result.status === "ready" && result.id === selected &&
            <div className="insights-ai-answer" role="status">
              <strong>AI-generated suggestion · check before acting</strong>
              <p>{result.explanation}</p>
            </div>}
          {result.status === "error" && <p role="alert">{result.message}</p>}
        </>}
    </section>
  );
}
