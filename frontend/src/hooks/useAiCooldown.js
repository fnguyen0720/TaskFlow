import { useEffect, useState } from "react";

// All signed-in AI panels share the same server-side IP-partitioned allowance.
// Display only durations explicitly supplied by the backend. A 429 without a
// readable Retry-After gets a generic message, never a made-up countdown.
export function secondsFromRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const raw = value.trim();
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 && n <= 3600 ? n : null;
  }
  const when = Date.parse(raw);
  if (!Number.isFinite(when)) return null;
  const seconds = Math.ceil((when - now) / 1000);
  return seconds > 0 && seconds <= 3600 ? seconds : null;
}

export function formatCooldown(seconds) {
  if (seconds < 1) return "0:00";
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

export function useAiCooldown(token) {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // A new authenticated session must not inherit another user's UI state.
    setUntil(0);
  }, [token]);

  useEffect(() => {
    if (!until) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [until]);

  const remainingSeconds = Math.max(0, Math.ceil((until - now) / 1000));

  function onRateLimited(response) {
    const seconds = secondsFromRetryAfter(response.headers.get("Retry-After"));
    if (seconds !== null) {
      const current = Date.now();
      setNow(current);
      setUntil(previous => Math.max(previous, current + seconds * 1000));
    }
    return seconds;
  }

  return { remainingSeconds, onRateLimited };
}
