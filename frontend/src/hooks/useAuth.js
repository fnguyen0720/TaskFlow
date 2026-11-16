import { useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5143";

export function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem("taskflow_token") || "");
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const logout = () => {
    localStorage.removeItem("taskflow_token");
    setToken("");
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const isRegistering = authMode === "register";
      const endpoint = isRegistering ? "register" : "login?useCookies=false";
      const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Authentication failed. Please try again.");
      }
      if (isRegistering) {
        setAuthMode("login");
        setAuthPassword("");
        setAuthError("Account created! Please sign in.");
        return;
      }
      const data = await response.json();
      if (!data.accessToken) throw new Error("Login succeeded, but no access token was returned.");
      localStorage.setItem("taskflow_token", data.accessToken);
      setToken(data.accessToken);
      setAuthPassword("");
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const switchAuthMode = () => {
    setAuthMode(mode => mode === "login" ? "register" : "login");
    setAuthError("");
  };

  return { token, authMode, authEmail, setAuthEmail, authPassword, setAuthPassword,
    authLoading, authError, logout, handleAuth, switchAuthMode };
}
