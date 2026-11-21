import { useEffect, useRef, useState } from "react";
import { getAuthErrorMessage } from "../utils/authErrors.js";
import { fetchWithDiagnostics } from "../utils/diagnostics.js";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5143";
const SESSION_KEY = "taskflow_token";

export function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem(SESSION_KEY) || "");
  const tokenRef = useRef(token);
  tokenRef.current = token;
  // Any logout, account change, or new auth submission invalidates older responses.
  const attempt = useRef(0);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [sessionNotice, setSessionNotice] = useState("");

  const logout = (reason = "manual", expectedToken) => {
    // A delayed 401 from the old account must never log out the new account.
    if (expectedToken !== undefined && tokenRef.current !== expectedToken) return;
    ++attempt.current;
    localStorage.removeItem(SESSION_KEY);
    tokenRef.current = "";
    setToken("");
    setAuthLoading(false);
    setAuthPassword("");
    setAuthError("");
    setSessionNotice(reason === "expired"
      ? "Your session expired. Sign in again to securely load your tasks. Your tasks have not been deleted."
      : "");
  };

  useEffect(() => {
    const onStorage = event => {
      if (event.key !== SESSION_KEY && event.key !== null) return;
      const nextToken = localStorage.getItem(SESSION_KEY) || "";
      if (nextToken === tokenRef.current) return;
      ++attempt.current;
      tokenRef.current = nextToken;
      setToken(nextToken);
      setAuthLoading(false);
      setAuthPassword("");
      setAuthError("");
      setSessionNotice(nextToken ? "" : "You signed out in another tab. Sign in to continue.");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    const requestId = ++attempt.current;
    setAuthLoading(true);
    setAuthError("");
    setSessionNotice("");
    try {
      const isRegistering = authMode === "register";
      const endpoint = isRegistering ? "register" : "login?useCookies=false";
      const response = await fetchWithDiagnostics(`${API_BASE_URL}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      }, "authentication");
      if (requestId !== attempt.current) return;
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          throw new Error("Sign-in service is temporarily unavailable. Please try again; your tasks are safe.");
        }
        throw new Error(await getAuthErrorMessage(response, { registering: isRegistering }));
      }
      if (requestId !== attempt.current) return;
      if (isRegistering) {
        setAuthMode("login");
        setAuthPassword("");
        setAuthError("Account created! Please sign in.");
        return;
      }
      const data = await response.json();
      if (requestId !== attempt.current) return;
      if (!data.accessToken || typeof data.accessToken !== "string") throw new Error("Login succeeded, but no access token was returned.");
      localStorage.setItem(SESSION_KEY, data.accessToken);
      tokenRef.current = data.accessToken;
      setToken(data.accessToken);
      setAuthPassword("");
    } catch (error) {
      if (requestId !== attempt.current) return;
      setAuthError(error instanceof TypeError
        ? "Cannot reach the sign-in service. Check your connection and try again; your tasks are safe."
        : error.message || "Unable to sign in. Please retry.");
    } finally {
      if (requestId === attempt.current) setAuthLoading(false);
    }
  };

  const switchAuthMode = () => {
    ++attempt.current;
    setAuthLoading(false);
    setAuthMode(mode => mode === "login" ? "register" : "login");
    setAuthError("");
    setSessionNotice("");
  };

  return { token, authMode, authEmail, setAuthEmail, authPassword, setAuthPassword,
    authLoading, authError, sessionNotice, logout, handleAuth, switchAuthMode };
}
