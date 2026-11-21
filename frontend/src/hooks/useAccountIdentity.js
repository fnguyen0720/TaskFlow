import { useEffect, useRef, useState } from "react";
import { fetchWithDiagnostics } from "../utils/diagnostics.js";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5143";

// Never display another session's account email during account switching.
// A failed lookup does not imply that the user's tasks are missing.
export function useAccountIdentity({ token, onUnauthorized }) {
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;
  const [identity, setIdentity] = useState({ owner: null, email: "", status: "loading" });
  const [retrySignal, setRetrySignal] = useState(0);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setIdentity({ owner: token, email: "", status: "loading" });

    const load = async () => {
      try {
        const response = await fetchWithDiagnostics(`${API_BASE_URL}/api/account/me`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
          cache: "no-store",
        }, "authentication");
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          unauthorizedRef.current(token);
          return;
        }
        if (!response.ok) throw new Error("Unable to verify account");
        const data = await response.json();
        if (typeof data?.email !== "string" || !data.email.trim()) {
          throw new Error("Invalid account identity response");
        }
        if (!controller.signal.aborted) {
          setIdentity({ owner: token, email: data.email.trim(), status: "loaded" });
        }
      } catch (error) {
        if (!controller.signal.aborted && error?.name !== "AbortError") {
          setIdentity({ owner: token, email: "", status: "failed" });
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [token, retrySignal]);

  return {
    email: identity.owner === token ? identity.email : "",
    status: identity.owner === token ? identity.status : "loading",
    retry: () => setRetrySignal(current => current + 1),
  };
}
