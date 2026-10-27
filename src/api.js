const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function csrfToken() {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|; )(?:__Host-secureid\.csrf|secureid\.csrf)=([^;]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

async function readJson(response) {
  return (response.headers.get("content-type") || "").includes("application/json")
    ? response.json().catch(() => ({}))
    : null;
}

async function refreshCsrfToken() {
  const response = await fetch("/api/security/csrf", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const data = await readJson(response);
  if (!response.ok || !csrfToken()) {
    throw new Error(data?.message || "Could not prepare a secure request. Refresh the page and try again.");
  }
  return csrfToken();
}

function requestError(response, data) {
  const error = new Error(data?.message || "Request failed.");
  error.status = response.status;
  error.code = data?.code;
  error.retryAfter = Number(data?.retryAfter || response.headers.get("Retry-After") || 0);
  return error;
}

export async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const mutating = MUTATING_METHODS.has(method);
  const headers = new Headers(options.headers || {});
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (mutating) {
    const token = csrfToken() || await refreshCsrfToken();
    headers.set("X-CSRF-Token", token);
  }

  const send = () => fetch(path, { ...options, credentials: "include", headers });
  let response = await send();
  let data = await readJson(response);

  if (mutating && response.status === 403 && data?.code === "CSRF_VALIDATION_FAILED") {
    const isStream = typeof ReadableStream !== "undefined" && options.body instanceof ReadableStream;
    if (!isStream) {
      headers.set("X-CSRF-Token", await refreshCsrfToken());
      response = await send();
      data = await readJson(response);
    }
  }

  if (!response.ok || data?.success === false) throw requestError(response, data);
  return data === null ? response : data;
}
