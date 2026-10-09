import crypto from "node:crypto";

const AUTHORIZE_URL = "https://api.digitallocker.gov.in/public/oauth2/1/authorize";
const TOKEN_URL = "https://api.digitallocker.gov.in/public/oauth2/1/token";
const ISSUED_URL = "https://api.digitallocker.gov.in/public/oauth2/1/files/issued";
const STATE_COOKIE = "secureid.digilocker.state";
const STATE_TTL_MS = 10 * 60 * 1000;

function config() {
  const rawKey = process.env.DIGILOCKER_TOKEN_ENCRYPTION_KEY || "";
  let key = null;
  try {
    const parsed = Buffer.from(rawKey, "base64");
    if (parsed.length === 32) key = parsed;
  } catch {}
  return {
    clientId: process.env.DIGILOCKER_CLIENT_ID || "",
    clientSecret: process.env.DIGILOCKER_CLIENT_SECRET || "",
    redirectUri: process.env.DIGILOCKER_REDIRECT_URI || "",
    key,
    enabled: Boolean(process.env.DIGILOCKER_CLIENT_ID && process.env.DIGILOCKER_CLIENT_SECRET &&
      process.env.DIGILOCKER_REDIRECT_URI && key)
  };
}

function encrypt(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

function decrypt(payload, key) {
  const parsed = JSON.parse(payload);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const data = Buffer.concat([decipher.update(Buffer.from(parsed.data, "base64")), decipher.final()]);
  return JSON.parse(data.toString("utf8"));
}

function cookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try { return decodeURIComponent(value.join("=")); } catch { return ""; }
    }
  }
  return "";
}

function setStateCookie(res, state, production, clear = false) {
  const parts = [
    `${STATE_COOKIE}=${clear ? "" : encodeURIComponent(state)}`,
    "Path=/api/digilocker",
    `Max-Age=${clear ? 0 : 600}`,
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (production) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function safeError() {
  return { success: false, message: "DigiLocker could not complete the request. Please try again later." };
}

export function registerDigiLockerIntegration({ app, database, requireAuth, requireMfa, enforceSameOrigin, isProduction, logEvent }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS digilocker_oauth_states (
      state_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS digilocker_connections (
      user_id TEXT PRIMARY KEY,
      encrypted_tokens TEXT NOT NULL,
      connected_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  app.get("/api/digilocker/status", requireAuth, requireMfa, (req, res) => {
    const cfg = config();
    const row = database.prepare("SELECT connected_at FROM digilocker_connections WHERE user_id=?").get(req.user.id);
    res.json({
      success: true,
      enabled: cfg.enabled,
      connected: Boolean(row),
      connectedAt: row?.connected_at || null,
      message: cfg.enabled ? (row ? "DigiLocker is connected." : "Connect your DigiLocker account to continue.") :
        "Official partner credentials and the approved callback configuration are required before live connection can be enabled."
    });
  });

  app.get("/api/digilocker/connect", requireAuth, requireMfa, (req, res) => {
    const cfg = config();
    if (!cfg.enabled) return res.status(503).json({
      success: false,
      message: "DigiLocker integration is not configured yet. SecureID needs approved partner credentials and the exact registered callback URL."
    });

    const state = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const now = Date.now();
    database.prepare("DELETE FROM digilocker_oauth_states WHERE expires_at<=?").run(now);
    database.prepare("INSERT INTO digilocker_oauth_states(state_hash,user_id,code_verifier,expires_at,created_at) VALUES(?,?,?,?,?)")
      .run(crypto.createHash("sha256").update(state).digest("hex"), req.user.id, verifier, now + STATE_TTL_MS, now);
    setStateCookie(res, state, isProduction);

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", cfg.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    res.redirect(302, url.toString());
  });

  app.get("/api/digilocker/callback", async (req, res) => {
    setStateCookie(res, "", isProduction, true);
    const state = String(req.query?.state || "");
    const code = String(req.query?.code || "");
    if (!state || state.length > 200 || !code || code.length > 2000 || req.query?.error) {
      return res.redirect(303, "/?digilocker=error");
    }
    const stateCookie = cookie(req, STATE_COOKIE);
    if (!stateCookie || stateCookie !== state) return res.redirect(303, "/?digilocker=error");
    const stateHash = crypto.createHash("sha256").update(state).digest("hex");
    const pending = database.prepare("SELECT user_id,code_verifier,expires_at FROM digilocker_oauth_states WHERE state_hash=?").get(stateHash);
    database.prepare("DELETE FROM digilocker_oauth_states WHERE state_hash=?").run(stateHash);
    if (!pending || Number(pending.expires_at) <= Date.now()) return res.redirect(303, "/?digilocker=error");

    const cfg = config();
    if (!cfg.enabled) return res.redirect(303, "/?digilocker=not-configured");
    try {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        code_verifier: pending.code_verifier
      });
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
        signal: AbortSignal.timeout(10000),
        redirect: "error"
      });
      if (!response.ok) return res.redirect(303, "/?digilocker=error");
      const tokens = await response.json();
      if (typeof tokens.access_token !== "string" || !tokens.access_token || !Number.isFinite(Number(tokens.expires_in))) {
        return res.redirect(303, "/?digilocker=error");
      }
      const now = Date.now();
      const tokenBundle = {
        accessToken: tokens.access_token,
        refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : "",
        expiresAt: now + Math.max(60, Number(tokens.expires_in)) * 1000,
        tokenType: tokens.token_type === "Bearer" ? "Bearer" : "Bearer",
        scope: typeof tokens.scope === "string" ? tokens.scope.slice(0, 1000) : "",
        digiLockerId: typeof tokens.digilockerid === "string" ? tokens.digilockerid.slice(0, 100) : ""
      };
      database.prepare("INSERT INTO digilocker_connections(user_id,encrypted_tokens,connected_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted_tokens=excluded.encrypted_tokens,connected_at=excluded.connected_at,updated_at=excluded.updated_at")
        .run(pending.user_id, encrypt(tokenBundle, cfg.key), now, now);
      if (typeof logEvent === "function") logEvent(pending.user_id, "DIGILOCKER_CONNECTED", req);
      return res.redirect(303, "/?digilocker=connected");
    } catch {
      return res.redirect(303, "/?digilocker=error");
    }
  });

  app.get("/api/digilocker/issued-documents", requireAuth, requireMfa, async (req, res) => {
    const cfg = config();
    if (!cfg.enabled) return res.status(503).json({ success: false, message: "DigiLocker integration is not configured." });
    const row = database.prepare("SELECT encrypted_tokens FROM digilocker_connections WHERE user_id=?").get(req.user.id);
    if (!row) return res.status(404).json({ success: false, message: "Connect DigiLocker first." });
    try {
      const tokens = decrypt(row.encrypted_tokens, cfg.key);
      if (Number(tokens.expiresAt) <= Date.now()) {
        return res.status(401).json({ success: false, message: "DigiLocker access expired. Reconnect your account." });
      }
      const response = await fetch(ISSUED_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
        redirect: "error"
      });
      if (!response.ok) return res.status(response.status === 401 ? 401 : 502).json({ success: false, message: response.status === 401 ? "DigiLocker authorization expired. Reconnect your account." : "Could not retrieve issued documents from DigiLocker." });
      const payload = await response.json();
      const docs = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : Array.isArray(payload.documents) ? payload.documents : Array.isArray(payload.data) ? payload.data : [];
      const safeDocs = docs.slice(0, 100).map((doc) => ({
        name: String(doc.name || doc.doctype || doc.document_name || "Issued document").slice(0, 180),
        issuer: String(doc.issuer || doc.issuer_name || doc.issuerid || "").slice(0, 180),
        type: String(doc.type || doc.doctype || "").slice(0, 100),
        issuedOn: String(doc.issuedon || doc.issued_on || "").slice(0, 40),
        uri: String(doc.uri || "").slice(0, 300)
      }));
      res.setHeader("Cache-Control", "no-store");
      res.json({ success: true, documents: safeDocs });
    } catch {
      res.status(502).json(safeError());
    }
  });

  app.post("/api/digilocker/disconnect", requireAuth, requireMfa, enforceSameOrigin, (req, res) => {
    const result = database.prepare("DELETE FROM digilocker_connections WHERE user_id=?").run(req.user.id);
    if (typeof logEvent === "function" && result.changes) logEvent(req.user.id, "DIGILOCKER_DISCONNECTED", req);
    res.json({ success: true, disconnected: Boolean(result.changes) });
  });
}
