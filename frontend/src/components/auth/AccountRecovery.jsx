import { useEffect, useState } from "react";
import { fetchWithDiagnostics } from "../../utils/diagnostics.js";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";

function readResetFragment() {
  const fragment = window.location.hash.slice(1);
  if (!fragment.startsWith("resetPassword=")) return null;
  const parsed = new URLSearchParams(fragment);
  const code = parsed.get("resetPassword");
  const email = parsed.get("email");
  // Remove the token from browser history before any other navigation.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return code && email ? { code, email } : null;
}

export function isResetLink() {
  return window.location.hash.startsWith("#resetPassword=");
}

export default function AccountRecovery({ onBack, initialEmail = "" }) {
  const [reset] = useState(readResetFragment);
  const [email, setEmail] = useState(reset?.email || initialEmail);
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchWithDiagnostics(`${API}/api/account/capabilities`, {}, "authentication")
      .then(response => response.ok ? response.json() : Promise.reject(new Error("Unavailable")))
      .then(data => { if (active) setEnabled(data.emailDeliveryEnabled === true); })
      .catch(() => { if (active) setError("Account recovery status is unavailable."); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (!enabled || pending) return;
    setPending(true);
    setNotice("");
    setError("");
    try {
      if (reset) {
        const response = await fetchWithDiagnostics(`${API}/resetPassword`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, resetCode: reset.code, newPassword: password }),
        }, "authentication");
        if (!response.ok) throw new Error("The reset link is invalid, expired, or the new password is not accepted.");
        setPassword("");
        setNotice("Password updated. Return to sign in with your new password.");
      } else {
        const response = await fetchWithDiagnostics(`${API}/forgotPassword`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }, "authentication");
        if (!response.ok) throw new Error("We couldn't process your request. Try again later.");
        setNotice("If this address has a verified TaskFlow account, you'll receive reset instructions.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <h2>{reset ? "Set a new password" : "Reset your password"}</h2>
      {!reset && <p className="account-help">Enter your email address to request a reset link.</p>}
      {notice && <p role="status" className="auth-success">{notice}</p>}
      {error && <p role="alert" className="auth-error">{error}</p>}
      {!checking && !enabled && <p role="status" className="account-help">
        Email recovery isn't available yet. No emails are being sent.
      </p>}
      <input type="email" aria-label="Recovery email" placeholder="Email address" autoComplete="email"
        required value={email} onChange={event => setEmail(event.target.value)} />
      {reset && <input type="password" aria-label="New password" placeholder="New password"
        autoComplete="new-password" minLength={6} required value={password}
        onChange={event => setPassword(event.target.value)} />}
      <button type="submit" disabled={checking || !enabled || pending || (reset && Boolean(notice))}>
        {pending ? "Please wait…" : reset ? "Reset password" : "Send reset link"}
      </button>
      <button type="button" className="auth-switch" onClick={onBack}>Back to sign in</button>
    </form>
  );
}
