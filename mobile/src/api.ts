import * as SecureStore from "expo-secure-store";

const API_BASE_URL = "https://secureid-production-b732.up.railway.app";
const TOKEN_KEY = "secureid.native.session.v1";
const CLIENT_HEADER = "X-SecureID-Client";

type ApiError = Error & { status?: number; payload?: any };
export type SessionUser = { email: string; mfaVerified: boolean; trustedDevice?: boolean };
export type DocumentRecord = { id: string; name: string; mimeType: string; sizeBytes: number; category?: string; createdAt: number | string };
export type ShareRecord = { id: string; type: "identity" | "document"; name?: string; contextLabel?: string; createdAt: string; expiresAt: string; revokedAt?: string | null; accessCount?: number };

let csrfToken = "";

async function readPayload(response: Response) {
  const text = await response.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text || "Unexpected server response." }; }
  if (!response.ok || payload.success === false) {
    const error = new Error(payload.message || `SecureID request failed (${response.status}).`) as ApiError;
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function bootstrapCsrf() {
  const response = await fetch(`${API_BASE_URL}/api/auth/csrf`, {
    method: "GET",
    headers: { [CLIENT_HEADER]: "native", Accept: "application/json" },
  });
  const payload = await readPayload(response);
  if (typeof payload.csrfToken !== "string" || payload.csrfToken.length < 32) {
    throw new Error("Secure sign-in could not initialize. Please update SecureID and try again.");
  }
  csrfToken = payload.csrfToken;
}

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const headers = new Headers(options.headers || {});
  headers.set(CLIENT_HEADER, "native");
  headers.set("Accept", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  try {
    return await readPayload(response) as T;
  } catch (error) {
    if ((error as ApiError)?.status === 401) await SecureStore.deleteItemAsync(TOKEN_KEY);
    throw error;
  }
}

export async function signIn(email: string, password: string) {
  await bootstrapCsrf();
  const cookieName = "__Host-secureid.csrf";
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      [CLIENT_HEADER]: "native",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
      Cookie: `${cookieName}=${encodeURIComponent(csrfToken)}`,
      Accept: "application/json",
    },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  const payload = await readPayload(response);
  if (typeof payload.nativeSessionToken !== "string" || payload.nativeSessionToken.length < 40) {
    throw new Error("The server did not issue a native session. The SecureID API update must be deployed first.");
  }
  await SecureStore.setItemAsync(TOKEN_KEY, payload.nativeSessionToken, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return payload;
}

export async function requestMfaCode() {
  return request<{ success: boolean; challengeId: string; expiresIn: number; resendAvailableIn: number; message: string }>("/api/mfa/challenge", {
    method: "POST", body: JSON.stringify({}),
  });
}

export async function verifyMfa(code: string, challengeId: string, trustDevice = true) {
  return request<{ success: boolean; user: SessionUser; message: string }>("/api/mfa/verify", {
    method: "POST", body: JSON.stringify({ code: code.trim(), challengeId, trustDevice }),
  });
}

export async function getSession() {
  return request<{ success: boolean; user: SessionUser; wallet: any }>("/api/auth/session");
}

export async function signOut() {
  try { await request("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }); }
  finally { await SecureStore.deleteItemAsync(TOKEN_KEY); }
}

export async function listDocuments() {
  return request<{ success: boolean; documents: DocumentRecord[] }>("/api/documents");
}

export async function uploadDocument(file: { uri: string; name: string; mimeType?: string | null }) {
  const body = new FormData();
  body.append("documents", {
    uri: file.uri,
    name: file.name,
    type: file.mimeType || "application/octet-stream",
  } as any);
  return request<{ success: boolean; documents?: DocumentRecord[]; message?: string }>("/api/documents", {
    method: "POST", body,
  });
}

export async function createDocumentShare(documentId: string, reasonText = "") {
  return request<{ success: boolean; shareToken: string; shareExpiresAt: string; document: { id: string; name: string } }>("/api/document-share", {
    method: "POST", body: JSON.stringify({ documentId, share_reason: reasonText }),
  });
}

export async function listShares() {
  return request<{ success: boolean; shares: ShareRecord[] }>("/api/security/shares");
}

export async function revokeShare(type: "identity" | "document", id: string) {
  return request<{ success: boolean }>("/api/security/shares/revoke", {
    method: "POST", body: JSON.stringify({ type, id }),
  });
}

export async function getSecurityDashboard() {
  return request<any>("/api/security/dashboard");
}
