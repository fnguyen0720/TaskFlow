// ASP.NET Core Identity sends registration errors as ValidationProblem JSON.
// Convert those responses into messages people can read instead of showing raw JSON.
export async function getAuthErrorMessage(response, { registering = false } = {}) {
  const fallback = registering
    ? "Unable to create an account. Please check your details and try again."
    : "Unable to sign in. Please try again.";

  let raw;
  try {
    raw = (await response.text()).trim();
  } catch {
    return fallback;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const errors = payload.errors;
    if (errors && typeof errors === "object") {
      const values = Array.isArray(errors) ? errors : Object.values(errors);
      const messages = values.flatMap(value => Array.isArray(value) ? value : [value])
        .map(value => typeof value === "string" ? value : value?.description)
        .filter(value => typeof value === "string" && value.trim())
        .map(value => value.trim());

      if (messages.length) return [...new Set(messages)].join(" ");
    }

    for (const key of ["detail", "message", "error_description"]) {
      if (typeof payload[key] === "string" && payload[key].trim()) {
        return payload[key].trim();
      }
    }
  }

  if (!registering && (response.status === 400 || response.status === 401 || response.status === 403)) {
    return "Invalid email or password.";
  }

  // Ignore generic RFC 7807 titles (and JSON/HTML), which are not actionable.
  if (payload && typeof payload === "object") return fallback;
  // ASP.NET Core Identity can return the literal "Failed" for rejected credentials.\n  // Never expose this unhelpful framework response as the user-facing error.\n  if (!registering && [400, 401, 403].includes(response.status)) return "Invalid email or password.";\n  if (raw && raw.length <= 300 && !/^[{\[<]/u.test(raw)) return raw;
  return fallback;
}
