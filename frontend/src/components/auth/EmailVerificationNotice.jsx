import { useEffect, useState } from "react";
import { fetchWithDiagnostics } from "../../utils/diagnostics.js";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";

// Email verification is optional during migration: legacy unverified users
// must not be locked out before an operator configures a verified sender.
export default function EmailVerificationNotice({ token }) {
  const [state, setState] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      fetchWithDiagnostics(`${API}/api/account/capabilities`, {}, "authentication"),
      fetchWithDiagnostics(`${API}/manage/info`, { headers: { Authorization: `Bearer ${token}` } }, "authentication"),
    ]).then(async ([capabilities, profile]) => {
      if (!capabilities.ok || !profile.ok) return;
      const [cap, info] = await Promise.all([capabilities.json(), profile.json()]);
      if (active) setState({ enabled: cap.emailDeliveryEnabled === true,
        confirmed: info.isEmailConfirmed === true, email: info.email });
    }).catch(() => {}).finally(() => {});
    return () => { active = false; };
  }, [token]);

  if (!state?.enabled || state.confirmed) return null;
  async function resend() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetchWithDiagnostics(`${API}/resendConfirmationEmail`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: state.email }),
      }, "authentication");
      setMessage(response.ok ? "If the address needs verification, an email has been sent." :
        "Couldn't send the verification email. Please retry.");
    } catch {
      setMessage("Couldn't send the verification email. Please retry.");
    } finally { setBusy(false); }
  }
  return <section className="verification-banner" aria-label="Email verification">
    <div><strong>Verify your email</strong>
      <p>Confirm your address to enable account recovery. Your existing tasks remain available.</p>
      {message && <p role="status">{message}</p>}
    </div>
    <button type="button" disabled={busy} onClick={resend}>
      {busy ? "Sending…" : "Resend verification"}
    </button>
  </section>;
}
