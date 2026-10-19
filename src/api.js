const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)(?:__Host-secureid\.csrf|secureid\.csrf)=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function canReplayBody(body) {
  if (body == null || typeof body === "string") return true;
  return ["FormData", "URLSearchParams", "Blob", "ArrayBuffer"].some((type) =>
    typeof globalThis[type] === "function" && body instanceof globalThis[type]
  );
}

async function refreshCsrf(force = false) {
  const endpoint = force ? "/api/auth/csrf?rotate=1" : "/api/auth/csrf";
  const response = await fetch(endpoint, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("Could not initialize secure request protection. Please refresh and try again.");
  const token = csrfToken();
  if (!token) throw new Error("Secure request token was not received. Please refresh and try again.");
  return token;
}

function hasBodyContentType(body) {
  return typeof body === "string";
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json().catch(() => ({}));
  return null;
}

export async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const mutating = MUTATING_METHODS.has(method);
  const replayable = canReplayBody(options.body);
  let token = csrfToken();
  if (mutating && !token) token = await refreshCsrf();

  const send = (csrf) => {
    const headers = new Headers(options.headers || {});
    if (hasBodyContentType(options.body) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (mutating && csrf) headers.set("X-CSRF-Token", csrf);
    return fetch(path, { credentials: "include", ...options, headers });
  };

  let response = await send(token);
  let data = await parseResponse(response);
  if (mutating && replayable && response.status === 403 && data?.code === "CSRF_VALIDATION_FAILED") {
    token = await refreshCsrf(true);
    response = await send(token);
    data = await parseResponse(response);
  }

  if (!response.ok || data?.success === false) {
    const error = new Error(data?.message || "Request failed.");
    error.status = response.status;
    error.code = data?.code;
    error.retryAfter = Number(data?.retryAfter || response.headers.get("Retry-After") || 0);
    error.requestId = data?.requestId || response.headers.get("X-Request-Id") || "";
    throw error;
  }
  return data === null ? response : data;
}

export default api;
