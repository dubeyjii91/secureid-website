import { registerProductionFeatures } from "./production-features.js";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import bcrypt from "bcryptjs";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { database } from "./database.js";

const envFile = path.resolve(process.cwd(), ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const isProduction = process.env.NODE_ENV === "production";
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "..", "dist");
const port = Number(process.env.PORT || 5000);
const appOrigin = process.env.APP_ORIGIN || "http://127.0.0.1:5173";
const sessionTtlMs = 8 * 60 * 60 * 1000;
const mfaVerifiedTtlMs = 30 * 60 * 1000;
const otpTtlMs = (isProduction ? 300 : Number(process.env.DEV_OTP_TTL_SECONDS || 300)) * 1000;
const maxOtpAttempts = Number(process.env.MAX_OTP_ATTEMPTS || 5);
const otpDelivery = process.env.OTP_DELIVERY || "console";
const resendApiKey = process.env.RESEND_API_KEY || "";
const otpFromEmail = process.env.OTP_FROM_EMAIL || "";
const resendCooldownMs = Math.max(15, Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60)) * 1000;
const bcryptRounds = Math.min(15, Math.max(10, Number(process.env.BCRYPT_ROUNDS || (isProduction ? 12 : 10))));
const sessionPepper = process.env.SESSION_HASH_SECRET || (!isProduction ? randomBytes(32).toString("hex") : "");
const otpPepper = process.env.OTP_HASH_SECRET || (!isProduction ? randomBytes(32).toString("hex") : "");
const sessionCookieName = isProduction ? "__Host-secureid.sid" : "secureid.sid";

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
if (sessionPepper.length < 32) throw new Error("SESSION_HASH_SECRET must be at least 32 characters.");
if (otpPepper.length < 32) throw new Error("OTP_HASH_SECRET must be at least 32 characters.");
if (!["console", "resend"].includes(otpDelivery)) throw new Error("OTP_DELIVERY must be console or resend.");

if (otpDelivery === "resend" && (!resendApiKey || !otpFromEmail)) throw new Error("RESEND_API_KEY and OTP_FROM_EMAIL are required for Resend delivery.");
if (isProduction && otpDelivery !== "resend") throw new Error("Production OTP delivery must use Resend.");
if (isProduction && !appOrigin.startsWith("https://")) throw new Error("APP_ORIGIN must use HTTPS in production.");


app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
if (isProduction) app.set("trust proxy", Math.max(0, Number(process.env.TRUST_PROXY_HOPS || 0)));

app.use((req, res, next) => {
  const requestId = randomUUID();
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
  if (isProduction) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});


function allowedOrigin(origin) {
  if (!origin) return false;
  if (!isProduction) return origin === appOrigin || origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173";
  return origin === appOrigin;
}

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && allowedOrigin(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(origin && allowedOrigin(origin) ? 204 : 403);
  next();
});

app.use(express.static(distPath));

function enforceSameOrigin(req, res, next) {
  if (!isProduction) return next();
  if (req.get("origin") !== appOrigin) return res.status(403).json({ success: false, message: "Request origin is not allowed." });
  next();
}

function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function hashSessionToken(token) { return createHmac("sha256", sessionPepper).update(token).digest("hex"); }
function hashOtpCode(code, userId, challengeId) { return createHmac("sha256", otpPepper).update(`${userId}:${challengeId}:${code}`).digest("hex"); }
function setSessionCookie(res, token, maxAgeMs = sessionTtlMs) {
  const parts = [`${sessionCookieName}=${encodeURIComponent(token)}`, "Path=/", `Max-Age=${Math.floor(maxAgeMs / 1000)}`, "HttpOnly", "SameSite=Strict"];
  if (isProduction) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}
function clearSessionCookie(res) {
  const parts = [`${sessionCookieName}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Strict"];
  if (isProduction) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}
function createSession(userId, req, res) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const tokenHash = hashSessionToken(token);
  const userAgent = String(req?.get?.("user-agent") || "").slice(0, 512) || null;
  const ip = String(req?.ip || req?.socket?.remoteAddress || "").trim();
  const ipHash = ip ? createHmac("sha256", sessionPepper).update(ip).digest("hex") : null;
  database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, mfa_verified_until, user_agent, ip_hash, last_seen_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)").run(tokenHash, userId, now + sessionTtlMs, now, userAgent, ipHash, now);
  setSessionCookie(res, token);
  return tokenHash;
}

function requireAuth(req, res, next) {
  const token = getCookie(req, sessionCookieName);
  if (!token || token.length < 20 || token.length > 200) return res.status(401).json({ success: false, message: "Sign in to continue." });
  const tokenHash = hashSessionToken(token);
  const row = database.prepare(`SELECT s.token_hash, s.expires_at, s.mfa_verified_until, u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? LIMIT 1`).get(tokenHash);
  if (!row || Number(row.expires_at) <= Date.now()) {
    database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    clearSessionCookie(res);
    return res.status(401).json({ success: false, message: "Session expired. Please sign in again." });
  }
  req.session = row;
  database.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(Date.now(), tokenHash);
  req.user = { id: row.id, email: row.email, mfaVerified: Number(row.mfa_verified_until || 0) > Date.now() };
  next();
}

function requireMfa(req, res, next) {
  if (!req.user?.mfaVerified) return res.status(403).json({ success: false, message: "MFA verification is required for this action." });
  next();
}

function getClientKey(req) { return req.ip || req.socket.remoteAddress || "unknown"; }
function createRateLimit(name, maxHits, windowMs, getIdentity) {
  return (req, res, next) => {
    const identity = getIdentity(req);
    const key = `${name}:${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
    const now = Date.now();
    const current = database.prepare("SELECT hits, reset_at FROM rate_limits WHERE bucket_key = ?").get(key);
    if (!current || Number(current.reset_at) <= now) {
      database.prepare("INSERT OR REPLACE INTO rate_limits (bucket_key, hits, reset_at) VALUES (?, ?, ?)").run(key, 1, now + windowMs);
      return next();
    }
    if (Number(current.hits) >= maxHits) {
      const retryAfter = Math.max(1, Math.ceil((Number(current.reset_at) - now) / 1000));
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({ success: false, message: "Too many requests. Please try again later.", retryAfter });
    }
    database.prepare("UPDATE rate_limits SET hits = hits + 1 WHERE bucket_key = ?").run(key);
    next();
  };
}

const window15m = 15 * 60 * 1000;
const perIpAuthLimit = createRateLimit("auth-ip", 10, window15m, getClientKey);
const perAccountAuthLimit = createRateLimit("auth-account", 10, window15m, (req) => String(req.body?.email || "unknown").trim().toLowerCase());
const perIpOtpLimit = createRateLimit("otp-ip", 5, window15m, getClientKey);
const perUserOtpLimit = createRateLimit("otp-user", 5, window15m, (req) => req.user?.id || getClientKey(req));
const perIpOtpVerifyLimit = createRateLimit("otp-verify-ip", 20, window15m, getClientKey);
const perUserOtpVerifyLimit = createRateLimit("otp-verify-user", 20, window15m, (req) => req.user?.id || getClientKey(req));
const perIpWalletLimit = createRateLimit("wallet-ip", 60, window15m, getClientKey);
const perUserWalletLimit = createRateLimit("wallet-user", 40, window15m, (req) => req.user?.id || getClientKey(req));



app.get("/api/security/account", requireAuth, requireMfa, (req, res, next) => {
  try {
    const user = database.prepare("SELECT email, created_at AS createdAt, password_changed_at AS passwordChangedAt FROM users WHERE id = ?").get(req.user.id);
    const recovery = database.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN used_at IS NULL THEN 1 ELSE 0 END) AS remaining, MAX(created_at) AS generatedAt FROM mfa_recovery_codes WHERE user_id = ?").get(req.user.id);
    res.json({
      success: true,
      account: {
        email: user.email,
        createdAt: user.createdAt,
        passwordChangedAt: user.passwordChangedAt || null,
        recoveryCodesGeneratedAt: recovery.generatedAt || null,
        recoveryCodesRemaining: Number(recovery.remaining || 0),
        recoveryCodesTotal: Number(recovery.total || 0)
      }
    });
  } catch (error) { next(error); }
});

app.post("/api/security/password/change", enforceSameOrigin, requireAuth, requireMfa, perIpAuthLimit, perAccountAuthLimit, async (req, res, next) => {
  try {
    const currentPassword = req.body?.currentPassword;
    const newPassword = req.body?.newPassword;
    if (!validatePassword(currentPassword) || !validatePassword(newPassword)) {
      return res.status(400).json({ success: false, message: "Passwords must be 12 to 72 bytes long." });
    }
    if (currentPassword === newPassword || !(await bcrypt.compare(currentPassword, await Promise.resolve(database.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id)?.password_hash || "")))) {
      return res.status(400).json({ success: false, message: "Current password is incorrect or the new password must be different." });
    }
    if (!validatePasswordStrength(newPassword)) {
      return res.status(400).json({ success: false, message: "Choose a stronger password with upper/lowercase letters, a number and a symbol." });
    }
    const passwordHash = await bcrypt.hash(newPassword, bcryptRounds);
    const now = Date.now();
    database.prepare("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(passwordHash, now, req.user.id);
    database.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(req.user.id, req.session.token_hash);
    database.prepare("DELETE FROM otp_challenges WHERE user_id = ?").run(req.user.id);
    logEvent(req.user.id, "PASSWORD_CHANGED", req);
    res.json({ success: true, passwordChangedAt: now, message: "Password changed successfully. Other sessions were signed out." });
  } catch (error) { next(error); }
});

app.post("/api/security/mfa/recovery/regenerate", enforceSameOrigin, requireAuth, requireMfa, perIpWalletLimit, perUserWalletLimit, async (req, res, next) => {
  try {
    const codes = await replaceRecoveryCodes(req.user.id);
    logEvent(req.user.id, "MFA_RECOVERY_CODES_REGENERATED", req, { count: codes.length });
    res.json({ success: true, codes, generatedAt: Date.now() });
  } catch (error) { next(error); }
});

app.get("/api/security/sessions", requireAuth, requireMfa, (req, res, next) => {
  try {
    const now = Date.now();
    database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    const sessions = database.prepare("SELECT token_hash AS tokenHash, created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt, user_agent AS userAgent FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC, created_at DESC").all(req.user.id);
    const currentHash = req.session.token_hash;
    res.json({
      success: true,
      sessions: sessions.map((session) => ({
        id: session.tokenHash.slice(0, 16),
        current: session.tokenHash === currentHash,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt || session.createdAt,
        expiresAt: session.expiresAt,
        userAgent: session.userAgent || ""
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/security/sessions/revoke", enforceSameOrigin, requireAuth, requireMfa, (req, res, next) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId || sessionId.length !== 16) return res.status(400).json({ success: false, message: "Invalid session." });
    const sessions = database.prepare("SELECT token_hash FROM sessions WHERE user_id = ?").all(req.user.id);
    const target = sessions.find((session) => session.token_hash.startsWith(sessionId));
    if (!target) return res.status(404).json({ success: false, message: "Session not found." });
    if (target.token_hash === req.session.token_hash) return res.status(400).json({ success: false, message: "Use Sign out to end your current session." });
    database.prepare("DELETE FROM sessions WHERE token_hash = ? AND user_id = ?").run(target.token_hash, req.user.id);
    logEvent(req.user.id, "SESSION_REVOKED", req, { sessionId });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/security/sessions/revoke-others", enforceSameOrigin, requireAuth, requireMfa, (req, res, next) => {
  try {
    const result = database.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(req.user.id, req.session.token_hash);
    logEvent(req.user.id, "ALL_OTHER_SESSIONS_REVOKED", req, { count: Number(result.changes || 0) });
    res.json({ success: true, revoked: Number(result.changes || 0) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/security/activity", requireAuth, requireMfa, (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));
    const events = database.prepare(`SELECT id, event_type AS eventType, created_at AS createdAt, user_agent AS userAgent, metadata_json AS metadata FROM security_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(req.user.id, limit).map((event) => ({ ...event, metadata: event.metadata ? JSON.parse(event.metadata) : null }));
    res.json({ success: true, events });
  } catch (error) {
    next(error);
  }
});
function validateEmail(email) { return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validatePassword(password) { return typeof password === "string" && Buffer.byteLength(password, "utf8") >= 12 && Buffer.byteLength(password, "utf8") <= 72; }
function validatePasswordStrength(password) {
  if (!validatePassword(password)) return false;
  let score = 0;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score >= 4;
}
function normalizeRecoveryCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function hashRecoveryCode(code, userId) {
  return createHmac("sha256", otpPepper).update(`${userId}:${normalizeRecoveryCode(code)}`).digest("hex");
}
function createRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(8).toString("hex").toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
  });
}
async function replaceRecoveryCodes(userId) {
  const codes = createRecoveryCodes(10);
  const now = Date.now();
  const insert = database.prepare("INSERT INTO mfa_recovery_codes (id, user_id, code_hash, created_at, used_at) VALUES (?, ?, ?, ?, NULL)");
  database.prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?").run(userId);
  for (const code of codes) insert.run(randomUUID(), userId, hashRecoveryCode(code, userId), now);
  return codes;
}
function getWallet(userId) {
  let wallet = database.prepare("SELECT risk, locked, share_name, share_age, share_address, share_identity_id, share_date_of_birth, share_email, share_phone, share_college, share_student_id, share_government_id, share_verification_status FROM wallet_settings WHERE user_id = ?").get(userId);
  if (!wallet) {
    database.prepare("INSERT INTO wallet_settings (user_id) VALUES (?)").run(userId);
    wallet = database.prepare("SELECT risk, locked, share_name, share_age, share_address, share_identity_id, share_date_of_birth, share_email, share_phone, share_college, share_student_id, share_government_id, share_verification_status FROM wallet_settings WHERE user_id = ?").get(userId);
  }
  return {
    risk: Number(wallet.risk),
    locked: Boolean(wallet.locked),
    shareData: {
      name: Boolean(wallet.share_name),
      age: Boolean(wallet.share_age),
      address: Boolean(wallet.share_address),
      identityId: Boolean(wallet.share_identity_id),
        dateOfBirth: Boolean(wallet.share_date_of_birth),
        email: Boolean(wallet.share_email),
        phone: Boolean(wallet.share_phone),
        college: Boolean(wallet.share_college),
        studentId: Boolean(wallet.share_student_id),
        governmentId: Boolean(wallet.share_government_id),
        verificationStatus: Boolean(wallet.share_verification_status),
    },
  };
}
function logEvent(userId, eventType, req = null, metadata = null) {
  const userAgent = String(req?.get?.("user-agent") || "").slice(0, 512) || null;
  const ip = String(req?.ip || req?.socket?.remoteAddress || "").trim();
  const ipHash = ip ? createHmac("sha256", sessionPepper).update(ip).digest("hex") : null;
  database.prepare("INSERT INTO security_events (id, user_id, event_type, created_at, user_agent, ip_hash, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), userId, eventType, Date.now(), userAgent, ipHash, metadata ? JSON.stringify(metadata).slice(0, 4000) : null);
}

async function deliverOtp(email, code) {
  if (otpDelivery === "console") {
    console.log(`[SecureID DEV OTP] ${email}: ${code}`);
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: otpFromEmail, to: [email], subject: "Your SecureID verification code", text: `Your SecureID verification code is ${code}. It expires in 5 minutes.` }),
  });
  if (!response.ok) throw new Error(`Resend request failed with status ${response.status}.`);
}



try {
  const walletColumns = database.prepare("PRAGMA table_info(wallet_settings)").all().map((r) => r.name);
  const shareColumns = [
    "share_date_of_birth",
    "share_email",
    "share_phone",
    "share_college",
    "share_student_id",
    "share_government_id",
    "share_verification_status"
  ];
  for (const column of shareColumns) {
    if (!walletColumns.includes(column)) {
      database.exec("ALTER TABLE wallet_settings ADD COLUMN " + column + " INTEGER NOT NULL DEFAULT 0");
    }
  }
} catch (migrationError) {
  console.error(JSON.stringify({
    level: "error",
    event: "wallet_share_migration_failed",
    message: migrationError?.message || String(migrationError)
  }));
}

registerProductionFeatures({
  app,
  database,
  requireAuth,
  enforceSameOrigin,
  isProduction,
  logEvent
});
app.get("/api/health", (req, res) => res.json({ success: true, service: "SecureID API", timestamp: new Date().toISOString() }));

app.post("/api/auth/register", enforceSameOrigin, perIpAuthLimit, perAccountAuthLimit, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password;

    if (!validateEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ success: false, message: "Password must be 12 to 72 bytes long." });
    }

    if (database.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email)) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }

    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, bcryptRounds);
    const now = Date.now();

    database.prepare(
      "INSERT INTO users (id, email, password_hash, created_at, otp_last_sent_at) VALUES (?, ?, ?, ?, 0)"
    ).run(id, email, passwordHash, now);

    database.prepare("INSERT INTO wallet_settings (user_id) VALUES (?)").run(id);

    database.prepare(
      "INSERT INTO email_verification_state (user_id, verified_at, created_at, updated_at) VALUES (?, NULL, ?, ?)"
    ).run(id, now, now);

    try {
      await issueEmailVerification(id, email);
    } catch (deliveryError) {
      database.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(id);
      database.prepare("DELETE FROM email_verification_state WHERE user_id = ?").run(id);
      database.prepare("DELETE FROM wallet_settings WHERE user_id = ?").run(id);
      database.prepare("DELETE FROM users WHERE id = ?").run(id);
      throw deliveryError;
    }

    logEvent(id, "ACCOUNT_CREATED", req);
    logEvent(id, "EMAIL_VERIFICATION_SENT", req);

    res.status(201).json({
      success: true,
      emailVerificationRequired: true,
      user: { email, mfaVerified: false }
    });
  } catch (error) {
    next(error);
  }
});


/* SECUREID_EMAIL_RECOVERY_V1 */
const emailVerificationTtlMs = 30 * 60 * 1000;
const passwordResetTtlMs = 30 * 60 * 1000;

function hashSecurityToken(token) {
  return createHmac("sha256", otpPepper).update(String(token)).digest("hex");
}

function createSecurityToken() {
  return randomBytes(32).toString("base64url");
}

async function sendSecurityEmail({ to, subject, text }) {
  if (otpDelivery === "console") {
    console.log(JSON.stringify({
      level: "info",
      event: "security_email_console",
      to,
      subject,
      text
    }));
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: otpFromEmail,
      to: [to],
      subject,
      text
    })
  });

  if (!response.ok) {
    throw new Error(`Security email delivery failed with status ${response.status}.`);
  }
}

async function issueEmailVerification(userId, email) {
  database.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(userId);

  const token = createSecurityToken();
  const now = Date.now();

  database.prepare(
    "INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)"
  ).run(
    randomUUID(),
    userId,
    hashSecurityToken(token),
    now + emailVerificationTtlMs,
    now
  );

  const url = `${appOrigin}/?verify_email=${encodeURIComponent(token)}`;

  await sendSecurityEmail({
    to: email,
    subject: "Verify your SecureID email address",
    text: `Verify your SecureID email address by opening this link:\n\n${url}\n\nThis link expires in 30 minutes. If you did not create this account, you can ignore this email.`
  });
}

async function issuePasswordReset(userId, email) {
  database.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(userId);

  const token = createSecurityToken();
  const now = Date.now();

  database.prepare(
    "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)"
  ).run(
    randomUUID(),
    userId,
    hashSecurityToken(token),
    now + passwordResetTtlMs,
    now
  );

  const url = `${appOrigin}/?reset_password=${encodeURIComponent(token)}`;

  await sendSecurityEmail({
    to: email,
    subject: "Reset your SecureID password",
    text: `Reset your SecureID password by opening this link:\n\n${url}\n\nThis link expires in 30 minutes. If you did not request a password reset, you can ignore this email.`
  });
}

const dummyPasswordHash = bcrypt.hashSync("SecureID-dummy-password-2026", bcryptRounds);
app.post("/api/auth/login", enforceSameOrigin, perIpAuthLimit, perAccountAuthLimit, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password;
    if (!validateEmail(email) || typeof password !== "string") return res.status(401).json({ success: false, message: "Email or password is incorrect." });
    const row = database.prepare("SELECT id, email, password_hash FROM users WHERE email = ? COLLATE NOCASE").get(email);
    const valid = await bcrypt.compare(password, row?.password_hash || dummyPasswordHash);
    if (!row || !valid) return res.status(401).json({ success: false, message: "Email or password is incorrect." });

    const emailState = database.prepare(
      "SELECT verified_at FROM email_verification_state WHERE user_id = ?"
    ).get(row.id);

    // Existing accounts created before email verification was introduced remain usable.
    // New accounts must verify their email before login.
    if (emailState && !emailState.verified_at) {
      return res.status(403).json({
        success: false,
        emailVerificationRequired: true,
        message: "Please verify your email address before signing in."
      });
    }

    if (!emailState) {
      const now = Date.now();
      database.prepare(
        "INSERT INTO email_verification_state (user_id, verified_at, created_at, updated_at) VALUES (?, ?, ?, ?)"
      ).run(row.id, now, now, now);
    }

    createSession(row.id, req, res);
    logEvent(row.id, "LOGIN_SUCCESS", req);
    res.json({ success: true, mfaRequired: true, user: { email: row.email, mfaVerified: false } });
  } catch (error) { next(error); }
});


app.get("/api/auth/verify-email", async (req, res, next) => {
  try {
    const token = String(req.query?.token || "");

    if (!token || token.length < 20) {
      return res.status(400).json({ success: false, message: "Invalid verification link." });
    }

    const tokenHash = hashSecurityToken(token);
    const record = database.prepare(
      "SELECT id, user_id, expires_at, used_at FROM email_verification_tokens WHERE token_hash = ? LIMIT 1"
    ).get(tokenHash);

    if (!record || record.used_at || Number(record.expires_at) <= Date.now()) {
      return res.status(400).json({ success: false, message: "This verification link is invalid or expired." });
    }

    const now = Date.now();

    database.prepare(
      "UPDATE email_verification_tokens SET used_at = ? WHERE id = ?"
    ).run(now, record.id);

    database.prepare(
      "UPDATE email_verification_state SET verified_at = ?, updated_at = ? WHERE user_id = ?"
    ).run(now, now, record.user_id);

    logEvent(record.user_id, "EMAIL_VERIFIED", req);

    res.json({
      success: true,
      emailVerified: true,
      message: "Email verified successfully. You can now sign in."
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/resend-verification", enforceSameOrigin, perIpAuthLimit, perAccountAuthLimit, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!validateEmail(email)) {
      return res.json({ success: true, message: "If an account exists, a verification email has been sent." });
    }

    const user = database.prepare(
      "SELECT id, email FROM users WHERE email = ? COLLATE NOCASE LIMIT 1"
    ).get(email);

    if (!user) {
      return res.json({ success: true, message: "If an account exists, a verification email has been sent." });
    }

    const state = database.prepare(
      "SELECT verified_at FROM email_verification_state WHERE user_id = ?"
    ).get(user.id);

    if (state?.verified_at) {
      return res.json({ success: true, message: "Email is already verified." });
    }

    await issueEmailVerification(user.id, user.email);
    logEvent(user.id, "EMAIL_VERIFICATION_SENT", req);

    res.json({
      success: true,
      message: "If the account exists and is not verified, a verification email has been sent."
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/forgot-password", enforceSameOrigin, perIpAuthLimit, perAccountAuthLimit, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!validateEmail(email)) {
      return res.json({ success: true, message: "If an account exists, a password reset email has been sent." });
    }

    const user = database.prepare(
      "SELECT id, email FROM users WHERE email = ? COLLATE NOCASE LIMIT 1"
    ).get(email);

    if (!user) {
      return res.json({ success: true, message: "If an account exists, a password reset email has been sent." });
    }

    await issuePasswordReset(user.id, user.email);
    logEvent(user.id, "PASSWORD_RESET_REQUESTED", req);

    res.json({
      success: true,
      message: "If the account exists, a password reset email has been sent."
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/reset-password", enforceSameOrigin, perIpAuthLimit, async (req, res, next) => {
  try {
    const token = String(req.body?.token || "");
    const password = req.body?.password;

    if (!token || !validatePassword(password)) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset request or password must be 12 to 72 bytes long."
      });
    }

    const record = database.prepare(
      "SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ? LIMIT 1"
    ).get(hashSecurityToken(token));

    if (!record || record.used_at || Number(record.expires_at) <= Date.now()) {
      return res.status(400).json({
        success: false,
        message: "This password reset link is invalid or expired."
      });
    }

    const passwordHash = await bcrypt.hash(password, bcryptRounds);
    const now = Date.now();

    database.prepare("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(passwordHash, now, record.user_id);

    database.prepare(
      "UPDATE password_reset_tokens SET used_at = ? WHERE id = ?"
    ).run(now, record.id);

    database.prepare("DELETE FROM password_reset_tokens WHERE user_id = ? AND id != ?").run(record.user_id, record.id);
    database.prepare("DELETE FROM sessions WHERE user_id = ?").run(record.user_id);
    database.prepare("DELETE FROM otp_challenges WHERE user_id = ?").run(record.user_id);

    const state = database.prepare(
      "SELECT user_id FROM email_verification_state WHERE user_id = ?"
    ).get(record.user_id);

    if (state) {
      database.prepare(
        "UPDATE email_verification_state SET verified_at = COALESCE(verified_at, ?), updated_at = ? WHERE user_id = ?"
      ).run(now, now, record.user_id);
    } else {
      database.prepare(
        "INSERT INTO email_verification_state (user_id, verified_at, created_at, updated_at) VALUES (?, ?, ?, ?)"
      ).run(record.user_id, now, now, now);
    }

    logEvent(record.user_id, "PASSWORD_RESET_COMPLETED", req);

    res.json({
      success: true,
      message: "Password reset successfully. Please sign in again."
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/session", requireAuth, (req, res) => res.json({ success: true, user: req.user, wallet: getWallet(req.user.id) }));
app.post("/api/auth/logout", enforceSameOrigin, requireAuth, perIpWalletLimit, perUserWalletLimit, (req, res) => {
  database.prepare("DELETE FROM otp_challenges WHERE user_id = ?").run(req.user.id);
  database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(req.session.token_hash);
  logEvent(req.user.id, "LOGOUT", req);
  clearSessionCookie(res);
  res.json({ success: true });
});

app.post("/api/mfa/challenge", enforceSameOrigin, requireAuth, perIpOtpLimit, perUserOtpLimit, async (req, res, next) => {
  if (req.user.mfaVerified) return res.status(400).json({ success: false, message: "MFA is already verified for this session." });
  try {
    const user = database.prepare("SELECT id, email, otp_last_sent_at FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(401).json({ success: false, message: "Sign in to continue." });
    const remainingMs = Number(user.otp_last_sent_at || 0) + resendCooldownMs - Date.now();
    if (remainingMs > 0) {
      const retryAfter = Math.ceil(remainingMs / 1000);
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({ success: false, message: `Please wait ${retryAfter}s before requesting another code.`, retryAfter });
    }
    database.prepare("DELETE FROM otp_challenges WHERE user_id = ?").run(user.id);
    const id = randomUUID();
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const now = Date.now();
    database.prepare("INSERT INTO otp_challenges (id, user_id, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)").run(id, user.id, hashOtpCode(code, user.id, id), now + otpTtlMs, now);
    database.prepare("UPDATE users SET otp_last_sent_at = ? WHERE id = ?").run(now, user.id);
    try { await deliverOtp(user.email, code); } catch (deliveryError) {
      database.prepare("DELETE FROM otp_challenges WHERE id = ?").run(id);
      database.prepare("UPDATE users SET otp_last_sent_at = 0 WHERE id = ?").run(user.id);
      throw deliveryError;
    }
    res.json({ success: true, challengeId: id, resendAvailableIn: Math.ceil(resendCooldownMs / 1000), message: "Verification code generated.", ...(otpDelivery === "console" ? { demoOtp: code } : {}) });
  } catch (error) { next(error); }
});

app.post("/api/mfa/verify", enforceSameOrigin, requireAuth, perIpOtpVerifyLimit, perUserOtpVerifyLimit, (req, res, next) => {
  try {
    const code = String(req.body?.code || "").trim();
    const challengeId = String(req.body?.challengeId || "");
    const recoveryCode = normalizeRecoveryCode(code);
    if (recoveryCode.length >= 16 && recoveryCode.length <= 20) {
      const record = database.prepare("SELECT id FROM mfa_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL LIMIT 1").get(req.user.id, hashRecoveryCode(recoveryCode, req.user.id));
      if (!record) return res.status(400).json({ success: false, message: "Recovery code is invalid or has already been used." });
      const now = Date.now();
      database.prepare("UPDATE mfa_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL").run(now, record.id);
      database.prepare("UPDATE sessions SET mfa_verified_until = ? WHERE token_hash = ?").run(now + mfaVerifiedTtlMs, req.session.token_hash);
      database.prepare("DELETE FROM otp_challenges WHERE user_id = ?").run(req.user.id);
      logEvent(req.user.id, "MFA_RECOVERY_CODE_USED", req);
      return res.json({ success: true, message: "Recovery code accepted.", user: { email: req.user.email, mfaVerified: true } });
    }
    if (!/^\d{6}$/.test(code) || !challengeId) return res.status(400).json({ success: false, message: "Enter the 6-digit verification code or a recovery code." });
    const challenge = database.prepare("SELECT id, code_hash, expires_at, attempts FROM otp_challenges WHERE id = ? AND user_id = ? LIMIT 1").get(challengeId, req.user.id);
    if (!challenge || Number(challenge.expires_at) <= Date.now()) {
      database.prepare("DELETE FROM otp_challenges WHERE user_id = ?").run(req.user.id);
      return res.status(410).json({ success: false, message: "This verification code has expired. Request a new one." });
    }
    if (Number(challenge.attempts) >= maxOtpAttempts) return res.status(429).json({ success: false, message: "Too many incorrect attempts. Request a new code." });
    const supplied = Buffer.from(hashOtpCode(code, req.user.id, challenge.id), "hex");
    const stored = Buffer.from(challenge.code_hash, "hex");
    const valid = supplied.length === stored.length && timingSafeEqual(supplied, stored);
    if (!valid) {
      database.prepare("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ? AND attempts < ?").run(challenge.id, maxOtpAttempts);
      return res.status(400).json({ success: false, message: "Incorrect verification code." });
    }
    database.prepare("UPDATE sessions SET mfa_verified_until = ? WHERE token_hash = ?").run(Date.now() + mfaVerifiedTtlMs, req.session.token_hash);
    database.prepare("DELETE FROM otp_challenges WHERE id = ?").run(challenge.id);
    logEvent(req.user.id, "MFA_VERIFIED", req);
    res.json({ success: true, message: "MFA verification successful.", user: { email: req.user.email, mfaVerified: true } });
  } catch (error) { next(error); }
});

app.post("/api/mfa/cancel", enforceSameOrigin, requireAuth, perIpWalletLimit, perUserWalletLimit, (req, res, next) => {
  try {
    database.prepare("DELETE FROM otp_challenges WHERE user_id = ?").run(req.user.id);
    database.prepare("UPDATE sessions SET mfa_verified_until = 0 WHERE token_hash = ?").run(req.session.token_hash);
    res.json({ success: true });
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  console.error(JSON.stringify({ level: "error", event: "request_error", message: error?.message || String(error), path: req.path }));
  if (res.headersSent) return next(error);
  const statusCode = Number(error?.statusCode) || 500; res.status(statusCode).json({ success: false, message: statusCode === 423 ? "Wallet is locked." : "Something went wrong. Please try again shortly." });
});

setInterval(() => {
  const now = Date.now();
  database.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").run(now);
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  database.prepare("DELETE FROM otp_challenges WHERE expires_at <= ?").run(now);
}, 60 * 60 * 1000).unref();

app.get("/{*splat}", (req, res) => res.sendFile(path.join(distPath, "index.html")));
app.listen(port, () => console.log(JSON.stringify({ level: "info", event: "server_started", port, environment: isProduction ? "production" : "development", storage: "sqlite", otpDelivery })));



