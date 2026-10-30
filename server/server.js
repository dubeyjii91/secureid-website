import { registerProductionFeatures } from "./production-features.js";
import { registerSecureCloudControlPlane } from "./securecloud-control-plane.js";
import path from "node:path";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import nodemailer from "nodemailer";
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
import { startAutomaticBackup, getBackupStatus } from "./backup-manager.js";

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

// Owner controls and audit history are additive migrations; existing account data is preserved.
database.exec(`
  CREATE TABLE IF NOT EXISTS admin_account_controls (
    user_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('active','suspended')),
    reason TEXT,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target_user_id TEXT,
    target_email TEXT,
    details_json TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log(created_at DESC);
  CREATE TABLE IF NOT EXISTS owner_notifications (
    id TEXT PRIMARY KEY,
    notification_type TEXT NOT NULL,
    recipient_email TEXT,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','sent','failed')),
    error_code TEXT,
    created_at INTEGER NOT NULL,
    sent_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_owner_notifications_created_at ON owner_notifications(created_at DESC);
`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "..", "dist");
const port = Number(process.env.PORT || 5000);
const appOrigin = process.env.APP_ORIGIN || "http://127.0.0.1:5173";
const sessionTtlMs = 8 * 60 * 60 * 1000;
const sessionIdleTtlMs = 2 * 60 * 60 * 1000;
const mfaVerifiedTtlMs = 30 * 60 * 1000;
const otpTtlMs = (isProduction ? 300 : Number(process.env.DEV_OTP_TTL_SECONDS || 300)) * 1000;
const maxOtpAttempts = Number(process.env.MAX_OTP_ATTEMPTS || 5);
const configuredOtpDelivery = (process.env.OTP_DELIVERY || "console").trim().toLowerCase();
const brevoApiKey = process.env.BREVO_API_KEY || "";
const smtpConfigured = Boolean(
  process.env.SMTP_HOST &&
  Number.isInteger(Number(process.env.SMTP_PORT || 587)) &&
  Number(process.env.SMTP_PORT || 587) > 0 &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS &&
  process.env.OTP_FROM_EMAIL
);
const resendApiKey = process.env.RESEND_API_KEY || "";
const otpFromEmail = process.env.OTP_FROM_EMAIL || "";
// Provider selection is explicit so a saved key cannot silently route OTPs
// through a different provider than the one configured by the operator.
const otpDelivery = configuredOtpDelivery;
const otpSenderDomain = otpFromEmail.match(/@([^>\s]+)/)?.[1]?.toLowerCase() || "";
const otpTestSender = otpDelivery === "resend" && otpSenderDomain === "resend.dev";
const emailDeliveryConfigured = otpDelivery === "resend" ? Boolean(resendApiKey&&otpFromEmail) : otpDelivery === "brevo" ? Boolean(brevoApiKey&&otpFromEmail) : otpDelivery === "smtp" ? smtpConfigured : false;
const emailDeliveryOptions = {
  smtpConfigured,
  resendConfigured: Boolean(resendApiKey && otpFromEmail),
  brevoConfigured: Boolean(brevoApiKey && otpFromEmail),
};
const otpFromName = (process.env.OTP_FROM_NAME || "SecureID").trim() || "SecureID";
const smtpHost = process.env.SMTP_HOST || "";
const configuredSmtpPort = Number(process.env.SMTP_PORT || 587);
// Brevo SMTP on port 2525 is timing out from the current Railway runtime; prefer STARTTLS port 587.
const smtpPort = configuredSmtpPort === 2525 ? 587 : configuredSmtpPort;
const smtpSecure = String(process.env.SMTP_SECURE || (smtpPort === 465 ? "true" : "false")).toLowerCase() === "true";
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const securityAlertEmail = process.env.SECURITY_ALERT_EMAIL || "";
const resendCooldownMs = Math.max(15, Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60)) * 1000;
const bcryptRounds = Math.min(15, Math.max(10, Number(process.env.BCRYPT_ROUNDS || (isProduction ? 12 : 10))));
const sessionPepper = process.env.SESSION_HASH_SECRET || (!isProduction ? randomBytes(32).toString("hex") : "");
const otpPepper = process.env.OTP_HASH_SECRET || (!isProduction ? randomBytes(32).toString("hex") : "");
const sessionCookieName = isProduction ? "__Host-secureid.sid" : "secureid.sid";
const trustedDeviceTtlMs = 30 * 24 * 60 * 60 * 1000;
let operationalErrorAlertState = { startedAt: Date.now(), count: 0, lastAlertAt: 0 };

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
if (sessionPepper.length < 32) throw new Error("SESSION_HASH_SECRET must be at least 32 characters.");
if (otpPepper.length < 32) throw new Error("OTP_HASH_SECRET must be at least 32 characters.");
if (!["console", "resend", "smtp", "brevo"].includes(otpDelivery)) throw new Error("OTP_DELIVERY must be console, resend, smtp, or brevo.");
if (otpDelivery === "resend" && (!resendApiKey || !otpFromEmail)) throw new Error("RESEND_API_KEY and OTP_FROM_EMAIL are required for Resend delivery.");
if (otpDelivery === "brevo" && (!brevoApiKey || !otpFromEmail)) throw new Error("BREVO_API_KEY and OTP_FROM_EMAIL are required for Brevo API delivery.");
if (otpDelivery === "smtp" && (!smtpHost || !Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535 || !smtpUser || !smtpPass || !otpFromEmail)) {
  throw new Error("SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and OTP_FROM_EMAIL are required for SMTP delivery.");
}
if (isProduction && !["resend", "smtp", "brevo"].includes(otpDelivery)) throw new Error("Production OTP delivery must use a configured email provider.");
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
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'self' blob:;");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  // Keep the app shell and all API responses out of caches. Only public, fingerprinted
  // build assets may be cached long-term; public discovery metadata gets a short TTL.
  const isFingerprintedAsset =
    /^\/assets\/[A-Za-z0-9._-]+\.[A-Za-z0-9]+$/.test(req.path) &&
    /-[A-Za-z0-9_-]{8,}\./.test(req.path);
  const isPublicMetadata = ["/manifest.webmanifest", "/robots.txt", "/sitemap.xml", "/secureid-app-icon.svg"].includes(req.path);
  if (isFingerprintedAsset) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else if (isPublicMetadata && req.method === "GET") {
    res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  if (isProduction) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
  if (req.method === "OPTIONS") return res.sendStatus(origin && allowedOrigin(origin) ? 204 : 403);
  next();
});

app.use(express.static(distPath));

function enforceSameOrigin(req, res, next) {
  ensureCsrfCookie(req,res);
  const nativeClient = req.get("X-SecureID-Client") === "native";
  const bearerMatch = String(req.get("authorization") || "").match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
  const bearerToken = nativeClient && bearerMatch ? bearerMatch[1] : "";
  const nativeBearer = Boolean(bearerToken && database.prepare("SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ? AND (last_seen_at IS NULL OR last_seen_at = 0 OR last_seen_at > ?) LIMIT 1").get(hashSessionToken(bearerToken), Date.now(), Date.now() - sessionIdleTtlMs));
  const nativeBootstrap = nativeClient && !req.get("origin");
  if (isProduction && req.get("origin") !== appOrigin && !nativeBootstrap && !nativeBearer) return res.status(403).json({ success: false, message: "Request origin is not allowed." });
  if (["POST","PUT","PATCH","DELETE"].includes(req.method) && !nativeBearer) {
    const cookieToken=getCookie(req,csrfCookieName);
    const headerToken=String(req.get("X-CSRF-Token") || "");
    if(!cookieToken || !headerToken || cookieToken !== headerToken){
      return res.status(403).json({ success:false,code:"CSRF_VALIDATION_FAILED",message:"CSRF validation failed." });
    }
  }
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

const csrfCookieName = isProduction ? "__Host-secureid.csrf" : "secureid.csrf";
function ensureCsrfCookie(req,res,force=false){
  let token=getCookie(req,csrfCookieName);
  if(force || !/^[A-Za-z0-9_-]{32,}$/.test(token)){
    token=randomBytes(32).toString("base64url");
    const parts=[`${csrfCookieName}=${encodeURIComponent(token)}`,"Path=/","Max-Age=28800","SameSite=Strict"];
    if(isProduction) parts.push("Secure");
    res.append("Set-Cookie",parts.join("; "));
  }
  return token;
}

// Bootstrap the readable CSRF token before the first login/register request.
// The token cookie is SameSite=Strict and is never an authentication credential.
app.get("/api/auth/csrf", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  if (isProduction && req.get("origin") && req.get("origin") !== appOrigin) {
    return res.status(403).json({ success: false, message: "Request origin is not allowed." });
  }
  const csrfToken = ensureCsrfCookie(req, res, req.query.rotate === "1");
  return res.json({ success: true, ...(req.get("X-SecureID-Client") === "native" ? { csrfToken } : {}) });
});

function hashSessionToken(token) { return createHmac("sha256", sessionPepper).update(token).digest("hex"); }
function hashOtpCode(code, userId, challengeId) { return createHmac("sha256", otpPepper).update(`${userId}:${challengeId}:${code}`).digest("hex"); }
function setSessionCookie(res, token, maxAgeMs = sessionTtlMs) {
  const parts = [`${sessionCookieName}=${encodeURIComponent(token)}`, "Path=/", `Max-Age=${Math.floor(maxAgeMs / 1000)}`, "HttpOnly", "SameSite=Strict"];
  if (isProduction) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}
function clearSessionCookie(res) {
  const parts = [`${sessionCookieName}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Strict"];
  if (isProduction) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}
function createSession(userId, req, res) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const tokenHash = hashSessionToken(token);
  const userAgent = String(req?.get?.("user-agent") || "").slice(0, 512) || null;
  const ip = String(req?.ip || req?.socket?.remoteAddress || "").trim();
  const ipHash = ip ? createHmac("sha256", sessionPepper).update(ip).digest("hex") : null;
  database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, mfa_verified_until, trusted_until, user_agent, ip_hash, last_seen_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)").run(tokenHash, userId, now + sessionTtlMs, now, userAgent, ipHash, now);
  setSessionCookie(res, token);
  return token;
}

function requireAuth(req, res, next) {
  const authorization = String(req.get("authorization") || "");
  const nativeToken = req.get("X-SecureID-Client") === "native" && /^Bearer [A-Za-z0-9_-]{40,}$/.test(authorization)
    ? authorization.slice(7)
    : "";
  const token = nativeToken || getCookie(req, sessionCookieName);
  if (!token || token.length < 20 || token.length > 200) return res.status(401).json({ success: false, message: "Sign in to continue." });
  const tokenHash = hashSessionToken(token);
  const row = database.prepare(`SELECT s.token_hash, s.expires_at, s.mfa_verified_until, s.trusted_until, s.last_seen_at, u.id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? LIMIT 1`).get(tokenHash);
  if (!row || Number(row.expires_at) <= Date.now() || (Number(row.last_seen_at || 0) > 0 && Date.now() - Number(row.last_seen_at) > sessionIdleTtlMs)) {
    database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    clearSessionCookie(res);
    return res.status(401).json({ success: false, message: "Session expired. Please sign in again." });
  }
  const accountControl = database.prepare("SELECT status FROM admin_account_controls WHERE user_id = ?").get(row.id);
  if (accountControl?.status === "suspended") {
    database.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
    clearSessionCookie(res);
    return res.status(403).json({ success: false, code: "ACCOUNT_SUSPENDED", message: "This SecureID account is suspended. Contact support for assistance." });
  }
  req.session = row;
  database.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(Date.now(), tokenHash);
  const configuredOwnerEmail = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
  const effectiveRole = configuredOwnerEmail && row.email.toLowerCase() === configuredOwnerEmail ? "owner" : "user";
  if (row.role !== effectiveRole) database.prepare("UPDATE users SET role = ? WHERE id = ?").run(effectiveRole, row.id);
  req.user = { id: row.id, email: row.email, role: effectiveRole, mfaVerified: Number(row.mfa_verified_until || 0) > Date.now() || Number(row.trusted_until || 0) > Date.now(), trustedDevice: Number(row.trusted_until || 0) > Date.now() };
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
const perIpOtpVerifyLimit = createRateLimit("otp-verify-ip", 5, window15m, getClientKey);
const perUserOtpVerifyLimit = createRateLimit("otp-verify-user", 5, window15m, (req) => req.user?.id || getClientKey(req));
const perIpWalletLimit = createRateLimit("wallet-ip", 60, window15m, getClientKey);
const perUserWalletLimit = createRateLimit("wallet-user", 40, window15m, (req) => req.user?.id || getClientKey(req));
const perIpApiLimit = createRateLimit("api-ip", 180, 60 * 1000, getClientKey);
const perIpUrlReputationLimit = createRateLimit("url-reputation-ip", 20, 15 * 60 * 1000, getClientKey);
app.use("/api", perIpApiLimit);



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

function ensureSecurityNotification(userId,type,title,message){
  const preference = type.startsWith("LOGIN") || type.startsWith("MFA") || type === "LOGIN_FAILED"
    ? "login_notifications"
    : type.startsWith("SHARE") || type.startsWith("DOCUMENT_SHARE")
      ? "share_notifications"
      : "security_alerts";
  const settings = database.prepare("SELECT security_alerts,login_notifications,share_notifications FROM privacy_settings WHERE user_id=?").get(userId);
  if(settings && Number(settings[preference] ?? 1) !== 1) return;
  const exists=database.prepare("SELECT id FROM security_notifications WHERE user_id=? AND type=? AND title=? AND created_at>? LIMIT 1").get(userId,type,title,Date.now()-24*60*60*1000);
  if(exists) return;
  database.prepare("INSERT INTO security_notifications (id,user_id,type,title,message,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(),userId,type,title,message,Date.now());
  const emailTypes=new Set(["LOGIN_SUCCESS","LOGIN_FAILED","MFA_FAILED","PASSWORD_CHANGED","PASSWORD_RESET_COMPLETED","SHARE_CREATED","DOCUMENT_SHARE_CREATED","SESSION_REVOKED","ALL_OTHER_SESSIONS_REVOKED"]);
  if(emailTypes.has(type) && ["resend", "smtp", "brevo"].includes(otpDelivery)){
    const user=database.prepare("SELECT email FROM users WHERE id=?").get(userId);
    if(user?.email) void sendSecurityEmail({to:user.email,subject:"SecureID security alert",text:title+"\n\n"+message+"\n\nIf you did not perform this action, sign in to SecureID and review Active sessions and Security activity."}).catch(()=>{});
  }
}

app.get("/api/security/dashboard", requireAuth, requireMfa, (req,res,next)=>{
  try{
    const user=database.prepare("SELECT created_at AS createdAt,password_changed_at AS passwordChangedAt FROM users WHERE id=?").get(req.user.id);
    const sessionCount=Number(database.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND expires_at>?").get(req.user.id,Date.now()).n||0);
    const recovery=database.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN used_at IS NULL THEN 1 ELSE 0 END) AS remaining FROM mfa_recovery_codes WHERE user_id=?").get(req.user.id);
    const shareRows=database.prepare("SELECT expires_at FROM secure_shares WHERE user_id=? AND revoked_at IS NULL").all(req.user.id);
    const shares={n:shareRows.filter(s=>Date.parse(s.expires_at)>Date.now()).length};
    const docs=database.prepare("SELECT COUNT(*) AS n FROM secure_documents WHERE user_id=? AND deleted_at IS NULL").get(req.user.id);
    const privacy=database.prepare("SELECT security_alerts,login_notifications,share_notifications,analytics FROM privacy_settings WHERE user_id=?").get(req.user.id);
    let score=100;
    const passwordAge=Number(user?.passwordChangedAt||user?.createdAt||Date.now());
    if(Date.now()-passwordAge>180*24*60*60*1000) score-=20;
    if(sessionCount>3) score-=10;
    if(Number(recovery.remaining||0)<3) score-=10;
    const wallet=database.prepare("SELECT locked FROM wallet_settings WHERE user_id=?").get(req.user.id);
    if(wallet?.locked) score-=15;
    score=Math.max(0,Math.min(100,score));
    ensureSecurityNotification(req.user.id,"SECURITY_REVIEW","Security dashboard ready","Review your sessions, recovery codes and active shares regularly.");
    res.json({success:true,score,scoreLabel:score>=80?"Strong":score>=60?"Good":"Needs attention",stats:{activeSessions:sessionCount,activeShares:Number(shares?.n||0),documents:Number(docs?.n||0),recoveryCodesRemaining:Number(recovery.remaining||0)},privacy:privacy||{security_alerts:1,login_notifications:1,share_notifications:1,analytics:0}});
  }catch(error){next(error);}
});

app.get("/api/security/notifications", requireAuth, requireMfa, (req,res,next)=>{
  try{
    const rows=database.prepare("SELECT id,type,title,message,created_at AS createdAt,read_at AS readAt FROM security_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50").all(req.user.id);
    res.json({success:true,notifications:rows});
  }catch(error){next(error);}
});

app.post("/api/security/notifications/read", enforceSameOrigin, requireAuth, requireMfa, (req,res,next)=>{
  try{
    const id=String(req.body?.id||"").trim();
    database.prepare("UPDATE security_notifications SET read_at=? WHERE id=? AND user_id=?").run(Date.now(),id,req.user.id);
    res.json({success:true});
  }catch(error){next(error);}
});

app.get("/api/security/auth-monitoring", requireAuth, requireMfa, (req,res,next)=>{
  try{
    const emailHash=authEmailHash(req.user.email);
    const since=Date.now()-24*60*60*1000;
    const failures=database.prepare("SELECT reason,COUNT(*) AS count FROM failed_auth_attempts WHERE email_hash=? AND created_at>? GROUP BY reason").all(emailHash,since);
    const failedLogins=Number(failures.find(x=>x.reason==="invalid_credentials")?.count||0);
    const failedMfa=Number(failures.find(x=>x.reason==="mfa_invalid")?.count||0);
    const events=database.prepare("SELECT event_type AS eventType,created_at AS createdAt,user_agent AS userAgent FROM security_events WHERE user_id=? AND event_type IN ('LOGIN_SUCCESS','LOGIN_FAILED','MFA_FAILED') ORDER BY created_at DESC LIMIT 20").all(req.user.id);
    const lock=getAuthLock(req.user.email);
    res.json({success:true,windowHours:24,failedLogins,failedMfa,recent:events,lockout:lock&&Number(lock.locked_until||0)>Date.now()?{active:true,until:lock.locked_until}: {active:false}});
  }catch(error){next(error);}
});

app.get("/api/privacy", requireAuth, requireMfa, (req,res,next)=>{
  try{
    const row=database.prepare("SELECT security_alerts,login_notifications,share_notifications,analytics,updated_at AS updatedAt FROM privacy_settings WHERE user_id=?").get(req.user.id);
    res.json({success:true,settings:row||{security_alerts:1,login_notifications:1,share_notifications:1,analytics:0,updatedAt:0}});
  }catch(error){next(error);}
});

app.put("/api/privacy", enforceSameOrigin, requireAuth, requireMfa, (req,res,next)=>{
  try{
    const allowed=["security_alerts","login_notifications","share_notifications","analytics"];
    const values=allowed.map(k=>req.body?.[k]?1:0);
    const now=Date.now();
    database.prepare("INSERT INTO privacy_settings (user_id,security_alerts,login_notifications,share_notifications,analytics,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET security_alerts=excluded.security_alerts,login_notifications=excluded.login_notifications,share_notifications=excluded.share_notifications,analytics=excluded.analytics,updated_at=excluded.updated_at").run(req.user.id,...values,now);
    logEvent(req.user.id,"PRIVACY_SETTINGS_UPDATED",req);
    res.json({success:true,settings:{security_alerts:values[0],login_notifications:values[1],share_notifications:values[2],analytics:values[3],updatedAt:now}});
  }catch(error){next(error);}
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
    database.exec("BEGIN IMMEDIATE");
    try {
      const updated = database.prepare("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(passwordHash, now, req.user.id);
      if (Number(updated.changes) !== 1) throw new Error("Password change user record could not be updated.");
      // A previously emailed reset link must not override a newly chosen password.
      database.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(req.user.id);
      database.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(req.user.id, req.session.token_hash);
      database.prepare("DELETE FROM otp_challenges WHERE user_id = ?").run(req.user.id);
      database.exec("COMMIT");
    } catch (transactionError) {
      try { database.exec("ROLLBACK"); } catch {}
      throw transactionError;
    }
    logEvent(req.user.id, "PASSWORD_CHANGED", req);
    ensureSecurityNotification(req.user.id,"PASSWORD_CHANGED","Password changed","Your SecureID password was changed and other sessions were signed out.");
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
    const sessions = database.prepare("SELECT token_hash AS tokenHash, created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt, trusted_until AS trustedUntil, user_agent AS userAgent FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC, created_at DESC").all(req.user.id);
    const currentHash = req.session.token_hash;
    res.json({
      success: true,
      sessions: sessions.map((session) => ({
        id: session.tokenHash.slice(0, 16),
        current: session.tokenHash === currentHash,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt || session.createdAt,
        expiresAt: session.expiresAt,
        userAgent: session.userAgent || "", trustedUntil: Number(session.trustedUntil || 0) || null
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
    const matches = sessions.filter((session) => session.token_hash.startsWith(sessionId));
    if (matches.length === 0) return res.status(404).json({ success: false, message: "Session not found." });
    // The UI sends a short prefix, so fail closed if a prefix ever matches more than one session.
    if (matches.length > 1) return res.status(409).json({ success: false, message: "Session identifier is ambiguous. Refresh the session list and try again." });
    const target = matches[0];
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

app.get("/api/account/export", requireAuth, requireMfa, (req,res,next)=>{
  try{
    const user=database.prepare("SELECT id,email,created_at AS createdAt,password_changed_at AS passwordChangedAt FROM users WHERE id=?").get(req.user.id);
    const wallet=database.prepare("SELECT risk,locked,share_name,share_age,share_date_of_birth,share_address,share_email,share_phone,share_identity_id,share_college,share_student_id,share_government_id,share_verification_status FROM wallet_settings WHERE user_id=?").get(req.user.id);
    const privacy=database.prepare("SELECT security_alerts,login_notifications,share_notifications,analytics,updated_at AS updatedAt FROM privacy_settings WHERE user_id=?").get(req.user.id);
    const documents=database.prepare("SELECT id,original_name AS originalName,mime_type AS mimeType,size_bytes AS sizeBytes,document_category AS category,created_at AS createdAt,deleted_at AS deletedAt FROM secure_documents WHERE user_id=?").all(req.user.id);
    const identityShares=database.prepare("SELECT id,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt,accessed_at AS accessedAt,access_count AS accessCount,share_reason AS purpose FROM secure_shares WHERE user_id=? ORDER BY created_at DESC").all(req.user.id);
    const documentShares=database.prepare("SELECT id,document_id AS documentId,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt,accessed_at AS accessedAt,access_count AS accessCount,share_reason AS purpose FROM secure_document_shares WHERE user_id=? ORDER BY created_at DESC").all(req.user.id);
    const events=database.prepare("SELECT event_type AS eventType,created_at AS createdAt,metadata_json AS metadata FROM security_events WHERE user_id=? ORDER BY created_at DESC LIMIT 1000").all(req.user.id).map(e=>({...e,metadata:e.metadata?JSON.parse(e.metadata):null}));
    const payload={exportVersion:1,exportedAt:new Date().toISOString(),account:{email:user.email,createdAt:user.createdAt,passwordChangedAt:user.passwordChangedAt||null},wallet,privacy,documents,identityShares,documentShares,securityActivity:events};
    res.setHeader("Content-Type","application/json");
    res.setHeader("Content-Disposition",'attachment; filename="secureid-data-export.json"');
    res.json(payload);
  }catch(error){next(error);}
});

app.delete("/api/account", enforceSameOrigin, requireAuth, requireMfa, async (req,res,next)=>{
  try{
    const password=String(req.body?.password||"");
    const row=database.prepare("SELECT password_hash FROM users WHERE id=?").get(req.user.id);
    if(!row || !(await bcrypt.compare(password,row.password_hash))) return res.status(400).json({success:false,message:"Password confirmation is incorrect."});
    const storagePath=process.env.DOCUMENT_STORAGE_PATH || (isProduction ? "/data/secureid-documents" : path.join(process.cwd(),"data","secureid-documents"));
    const docs=database.prepare("SELECT encrypted_path FROM secure_documents WHERE user_id=?").all(req.user.id);
    database.exec("BEGIN");
    try{
      database.prepare("DELETE FROM secure_document_shares WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM secure_shares WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM secure_documents WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM identity_profiles WHERE user_id=?").run(req.user.id);
      // These tables intentionally lack cascading user foreign keys for migration
      // compatibility, so explicitly erase them before deleting the account.
      database.prepare("DELETE FROM identity_document_checks WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM college_pilot_requests WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM institution_memberships WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM security_events WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM security_notifications WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM privacy_settings WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM failed_auth_attempts WHERE email_hash=?").run(authEmailHash(req.user.email));
      database.prepare("DELETE FROM auth_lockouts WHERE email_hash=?").run(authEmailHash(req.user.email));
      database.prepare("DELETE FROM wallet_settings WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM mfa_recovery_codes WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM otp_challenges WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM password_reset_tokens WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM email_verification_tokens WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM email_verification_state WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM sessions WHERE user_id=?").run(req.user.id);
      database.prepare("DELETE FROM users WHERE id=?").run(req.user.id);
      database.exec("COMMIT");
    }catch(error){database.exec("ROLLBACK");throw error;}
    for(const doc of docs){
      const p=String(doc.encrypted_path||"");
      const root=path.resolve(storagePath); const relative=path.relative(root,path.resolve(p)); const isInsideStorage=relative!=="" && relative!==".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); if(p && isInsideStorage) try{unlinkSync(path.resolve(p));}catch{}
    }
    clearSessionCookie(res);
    res.json({success:true,message:"Your SecureID account and stored account data were deleted."});
  }catch(error){next(error);}
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

function safeProviderCode(value) {
  const code=String(value || "").toLowerCase();
  return /^[a-z0-9_.-]{1,80}$/.test(code) ? code : "provider_rejected";
}

function createEmailDeliveryError(providerStatus=null,providerCode="provider_rejected") {
  const error=new Error("The email provider did not accept the message.");
  error.statusCode=503;
  error.code="EMAIL_DELIVERY_FAILED";
  error.providerStatus=Number(providerStatus) || null;
  error.providerCode=safeProviderCode(providerCode);
  return error;
}

async function sendApiEmail({ to, subject, text, requestId, purpose="transactional" }) {
  const isResend=otpDelivery === "resend";
  const provider=isResend ? "resend" : "brevo";
  const url=isResend ? "https://api.resend.com/emails" : "https://api.brevo.com/v3/smtp/email";
  const headers=isResend
    ? { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json", ...(requestId ? { "Idempotency-Key": requestId } : {}) }
    : { "api-key": brevoApiKey, "Content-Type": "application/json", accept: "application/json" };
  const body=isResend
    ? { from: `${otpFromName} <${otpFromEmail}>`, to: [to], subject, text }
    : { sender: { name: otpFromName, email: otpFromEmail }, to: [{ email: to }], subject, textContent: text };
  let providerStatus=null;
  let providerCode="provider_rejected";

  for(let attempt=1;attempt<=3;attempt++){
    try{
      const response=await fetch(url,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
      providerStatus=response.status;
      const result=await response.json().catch(()=>({}));
      if(response.ok){
        console.info(JSON.stringify({level:"info",event:"email_delivery_accepted",requestId,provider,purpose,attempt,providerStatus,providerMessageId:result?.id||result?.messageId||null}));
        return;
      }
      const providerMessage=String(result?.message||result?.error?.message||"").toLowerCase();
      providerCode=isResend && providerMessage.includes("domain") && /(not verified|unverified|verify your domain|verified domain)/.test(providerMessage)
        ? "sender_domain_unverified"
        : safeProviderCode(result?.name||result?.code||result?.error?.code||result?.error?.name);
      console.warn(JSON.stringify({level:"warn",event:"email_delivery_attempt_failed",requestId,provider,purpose,attempt,providerStatus,providerCode}));
      if(attempt<3 && (providerStatus===429 || providerStatus>=500)){
        await new Promise(resolve=>setTimeout(resolve,attempt*400));
        continue;
      }
      break;
    }catch(error){
      providerStatus=null;
      providerCode=safeProviderCode(error?.name||error?.code||"network_error");
      console.warn(JSON.stringify({level:"warn",event:"email_delivery_attempt_failed",requestId,provider,purpose,attempt,errorType:providerCode}));
      if(attempt<3){
        await new Promise(resolve=>setTimeout(resolve,attempt*400));
        continue;
      }
    }
  }
  console.error(JSON.stringify({level:"error",event:"email_delivery_rejected",requestId,provider,purpose,providerStatus,providerCode}));
  throw createEmailDeliveryError(providerStatus,providerCode);
}

async function sendConfiguredEmail({ to, subject, text, requestId, purpose="transactional" }) {
  if(isProduction && otpTestSender){
    console.error(JSON.stringify({level:"error",event:"email_delivery_rejected",requestId,provider:"resend",purpose,providerCode:"test_sender_restricted"}));
    throw createEmailDeliveryError(null,"test_sender_restricted");
  }
  if (otpDelivery === "brevo" || otpDelivery === "resend") {
    return sendApiEmail({to,subject,text,requestId,purpose});
  }
  if (otpDelivery === "smtp") {
    const transporter = nodemailer.createTransport({
      host: smtpHost, port: smtpPort, secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
    try {
      const result=await transporter.sendMail({ from: `${otpFromName} <${otpFromEmail}>`, to, subject, text });
      console.info(JSON.stringify({level:"info",event:"email_delivery_accepted",requestId,provider:"smtp",purpose,providerMessageId:result?.messageId||null}));
      return;
    } catch(error) {
      const providerCode=safeProviderCode(error?.code||error?.name||"smtp_error");
      console.error(JSON.stringify({level:"error",event:"email_delivery_rejected",requestId,provider:"smtp",purpose,providerStatus:Number(error?.responseCode)||null,providerCode}));
      throw createEmailDeliveryError(error?.responseCode,providerCode);
    } finally { transporter.close(); }
  }
  throw createEmailDeliveryError(null,"provider_not_configured");
}

async function deliverOtp(email, code, requestId="") {
  if (otpDelivery === "console") {
    console.log(`[SecureID DEV OTP] ${email}: ${code}`);
    return;
  }
  await sendConfiguredEmail({
    to: email, subject: "Your SecureID verification code",
    text: `Your SecureID verification code is ${code}. It expires in 5 minutes.`,
    requestId,
    purpose:"mfa"
  });
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
  logEvent,
  ensureSecurityNotification
});
registerSecureCloudControlPlane({ app, database, requireAuth, requireMfa, requireOwner, enforceSameOrigin });
startAutomaticBackup();
// Optional live URL reputation lookup. Keep the API key server-side only.
const googleSafeBrowsingApiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY || "";
const safeBrowsingTimeoutMs = Math.min(8000, Math.max(1500, Number(process.env.SAFE_BROWSING_TIMEOUT_MS || 5000)));

app.get("/api/security/url-reputation", perIpUrlReputationLimit, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  let target;
  try {
    const raw = String(req.query.url || "");
    if (!raw || raw.length > 2048) return res.status(400).json({ success: false, status: "invalid_url", message: "Provide a valid website address." });
    target = new URL(raw);
    if (!["http:", "https:"].includes(target.protocol) || !target.hostname || target.username || target.password) {
      return res.status(400).json({ success: false, status: "invalid_url", message: "Only normal HTTP or HTTPS website addresses are supported." });
    }
    if (target.hostname.length > 253 || !target.hostname.includes(".")) return res.status(400).json({ success: false, status: "invalid_url", message: "Provide a public domain name." });
  } catch {
    return res.status(400).json({ success: false, status: "invalid_url", message: "The website address is not valid." });
  }

  if (!googleSafeBrowsingApiKey) {
    // Keyless fallback: download OpenPhish's community feed and compare locally.
    // Cache the feed briefly to avoid requesting it for every scan; the submitted URL is not sent to OpenPhish.
    void (async () => {
      try {
        const now = Date.now();
        if (!globalThis.__secureIdOpenPhishCache || now - globalThis.__secureIdOpenPhishCache.fetchedAt > 10 * 60 * 1000) {
          const feedController = new AbortController();
          const feedTimeout = setTimeout(() => feedController.abort(), safeBrowsingTimeoutMs);
          try {
            const feedResponse = await fetch("https://openphish.com/feed.txt", {
              headers: { Accept: "text/plain" },
              signal: feedController.signal
            });
            if (!feedResponse.ok) throw new Error("Threat feed unavailable");
            const feedText = await feedResponse.text();
            if (feedText.length > 5_000_000) throw new Error("Threat feed too large");
            const urls = new Set();
            for (const line of feedText.split(/\r?\n/)) {
              const item = line.trim();
              if (!item || item.length > 2048) continue;
              try {
                const parsed = new URL(item);
                if (["http:", "https:"].includes(parsed.protocol)) urls.add(parsed.href.toLowerCase());
              } catch { /* Ignore malformed feed entries. */ }
            }
            globalThis.__secureIdOpenPhishCache = { fetchedAt: now, urls };
          } finally {
            clearTimeout(feedTimeout);
          }
        }
        const normalized = new URL(target.href);
        normalized.hash = "";
        const canonical = normalized.href.toLowerCase();
        const canonicalNoSlash = canonical.endsWith("/") ? canonical.slice(0, -1) : canonical;
        const found = globalThis.__secureIdOpenPhishCache.urls.has(canonical) ||
          globalThis.__secureIdOpenPhishCache.urls.has(canonicalNoSlash) ||
          globalThis.__secureIdOpenPhishCache.urls.has(canonicalNoSlash + "/");
        return res.json({
          success: true,
          status: found ? "threat_found" : "no_match",
          provider: "OpenPhish community feed",
          checkedAt: new Date().toISOString(),
          threats: found ? [{ type: "SOCIAL_ENGINEERING", platform: "ANY_PLATFORM" }] : [],
          message: found
            ? "The OpenPhish community feed lists this URL as a suspected phishing URL. Do not open it or enter information."
            : "No exact URL match was found in the OpenPhish community feed. This does not prove the website is safe."
        });
      } catch {
        if (!res.headersSent) return res.status(502).json({
          success: false,
          status: "provider_error",
          provider: "OpenPhish community feed",
          message: "The live phishing feed could not be reached. URL pattern checks are still available, but this is not a clean bill of health."
        });
      }
    })();
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), safeBrowsingTimeoutMs);
  void fetch("https://safebrowsing.googleapis.com/v4/threatMatches:find?key=" + encodeURIComponent(googleSafeBrowsingApiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      client: { clientId: "secureid-wallet", clientVersion: "1.0.0" },
      threatInfo: {
        threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
        platformTypes: ["ANY_PLATFORM"],
        threatEntryTypes: ["URL"],
        threatEntries: [{ url: target.href }]
      }
    })
  }).then(async (response) => {
    if (!response.ok) {
      return res.status(502).json({
        success: false,
        status: "provider_error",
        provider: "Google Safe Browsing",
        message: "The live reputation provider could not complete this check. Do not treat the URL as safe."
      });
    }
    const data = await response.json();
    const matches = Array.isArray(data.matches) ? data.matches : [];
    const threats = matches.map((item) => ({
      type: String(item.threatType || "UNKNOWN").slice(0, 80),
      platform: String(item.platformType || "ANY_PLATFORM").slice(0, 80)
    }));
    return res.json({
      success: true,
      status: threats.length ? "threat_found" : "no_match",
      provider: "Google Safe Browsing",
      checkedAt: new Date().toISOString(),
      threats,
      message: threats.length
        ? "The live threat-intelligence provider flagged this URL. Do not open it or enter any information."
        : "The provider returned no known threat match for this URL. This is not a guarantee that the site is safe."
    });
  }).catch(() => {
    if (!res.headersSent) res.status(502).json({
      success: false,
      status: "provider_error",
      provider: "Google Safe Browsing",
      message: "The live reputation check timed out or was unavailable. Do not treat the URL as safe."
    });
  }).finally(() => clearTimeout(timeout));
});

// Public health response intentionally exposes only minimal liveness information.
app.get("/api/health", (req, res) => {
  try {
    database.prepare("SELECT 1 AS ok").get();
    res.json({success:true,service:"SecureID API",status:"ready",database:"ok",timestamp:new Date().toISOString()});
  } catch {
    res.status(503).json({success:false,service:"SecureID API",status:"not_ready",database:"error",timestamp:new Date().toISOString()});
  }
});

function requireOwner(req, res, next) {
  if (req.user?.role !== "owner") {
    return res.status(403).json({success:false,message:"Owner permissions are required for this action."});
  }
  next();
}

app.get("/api/admin/users", requireAuth, requireMfa, requireOwner, (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 100)));
    const rows = database.prepare(`
      SELECT u.id, u.email, u.created_at AS createdAt, u.role,
             CASE WHEN ev.verified_at IS NULL THEN 0 ELSE 1 END AS emailVerified,
             COALESCE(ac.status, 'active') AS accountStatus,
             ac.reason AS suspensionReason,
             ac.updated_at AS statusUpdatedAt
      FROM users u
      LEFT JOIN email_verification_state ev ON ev.user_id = u.id
      LEFT JOIN admin_account_controls ac ON ac.user_id = u.id
      ORDER BY u.created_at DESC
      LIMIT ?
    `).all(limit);
    const total = Number(database.prepare("SELECT COUNT(*) AS total FROM users").get().total || 0);
    const active = Number(database.prepare("SELECT COUNT(*) AS total FROM users u LEFT JOIN admin_account_controls ac ON ac.user_id=u.id WHERE COALESCE(ac.status,'active')='active'").get().total || 0);
    const suspended = total - active;
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ success: true, total, active, suspended, users: rows.map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
      role: u.role === "owner" ? "owner" : "user",
      emailVerified: Boolean(u.emailVerified),
      accountStatus: u.accountStatus,
      suspensionReason: u.suspensionReason || null,
      statusUpdatedAt: u.statusUpdatedAt || null
    }))});
  } catch (error) { next(error); }
});

app.patch("/api/admin/users/:userId/status", enforceSameOrigin, requireAuth, requireMfa, requireOwner, (req, res, next) => {
  try {
    const targetId = String(req.params.userId || "").trim();
    const status = String(req.body?.status || "").trim().toLowerCase();
    const reason = String(req.body?.reason || "").trim().slice(0, 240);
    if (!targetId || !["active", "suspended"].includes(status)) {
      return res.status(400).json({ success: false, message: "Choose a valid account status." });
    }
    const target = database.prepare("SELECT id, email, role FROM users WHERE id = ?").get(targetId);
    if (!target) return res.status(404).json({ success: false, message: "User account was not found." });
    if (target.role === "owner" || target.email.toLowerCase() === req.user.email.toLowerCase()) {
      return res.status(403).json({ success: false, message: "The owner account cannot be suspended or changed here." });
    }
    const now = Date.now();
    if (status === "active") {
      database.prepare("DELETE FROM admin_account_controls WHERE user_id = ?").run(targetId);
    } else {
      database.prepare("INSERT INTO admin_account_controls (user_id, status, reason, updated_at, updated_by) VALUES (?, 'suspended', ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET status='suspended', reason=excluded.reason, updated_at=excluded.updated_at, updated_by=excluded.updated_by")
        .run(targetId, reason || null, now, req.user.id);
      database.prepare("DELETE FROM sessions WHERE user_id = ?").run(targetId);
    }
    database.prepare("INSERT INTO admin_audit_log (id, actor_user_id, actor_email, action, target_user_id, target_email, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), req.user.id, req.user.email, status === "suspended" ? "USER_SUSPENDED" : "USER_REACTIVATED", targetId, target.email, JSON.stringify({ reason: reason || null }), now);
    logEvent(targetId, status === "suspended" ? "ACCOUNT_SUSPENDED_BY_OWNER" : "ACCOUNT_REACTIVATED_BY_OWNER", req, { reason: reason || null });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ success: true, userId: targetId, accountStatus: status, message: status === "suspended" ? "Account suspended and active sessions revoked." : "Account reactivated." });
  } catch (error) { next(error); }
});

app.get("/api/admin/activity", requireAuth, requireMfa, requireOwner, (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));
    const registrations = database.prepare(`
      SELECT e.id, e.event_type AS action, e.created_at AS createdAt,
             e.user_id AS targetUserId, u.email AS targetEmail, NULL AS actorEmail,
             e.metadata_json AS details
      FROM security_events e LEFT JOIN users u ON u.id=e.user_id
      WHERE e.event_type IN ('ACCOUNT_CREATED','EMAIL_VERIFICATION_SENT','EMAIL_VERIFIED','LOGIN_FAILED','MFA_FAILED','LOGIN_BLOCKED_ACCOUNT_SUSPENDED','ACCOUNT_SUSPENDED_BY_OWNER','ACCOUNT_REACTIVATED_BY_OWNER')
      ORDER BY e.created_at DESC LIMIT ?
    `).all(limit);
    const adminActions = database.prepare(`
      SELECT id, action, created_at AS createdAt, target_user_id AS targetUserId,
             target_email AS targetEmail, actor_email AS actorEmail, details_json AS details
      FROM admin_audit_log ORDER BY created_at DESC LIMIT ?
    `).all(limit);
    const events = [...registrations, ...adminActions]
      .map((event) => ({ ...event, details: event.details ? (() => { try { return JSON.parse(event.details); } catch { return null; } })() : null }))
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
      .slice(0, limit);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ success: true, events });
  } catch (error) { next(error); }
});

app.get("/api/admin/notifications", requireAuth, requireMfa, requireOwner, (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));
    const notifications = database.prepare("SELECT id, notification_type AS type, recipient_email AS recipientEmail, user_id AS userId, user_email AS userEmail, status, error_code AS errorCode, created_at AS createdAt, sent_at AS sentAt FROM owner_notifications ORDER BY created_at DESC LIMIT ?").all(limit);
    const totals = database.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM owner_notifications").get();
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ success: true, totals: { total: Number(totals.total || 0), pending: Number(totals.pending || 0), sent: Number(totals.sent || 0), failed: Number(totals.failed || 0) }, notifications });
  } catch (error) { next(error); }
});

app.post("/api/admin/notifications/:notificationId/retry", enforceSameOrigin, requireAuth, requireMfa, requireOwner, async (req, res, next) => {
  try {
    const notificationId = String(req.params.notificationId || "").trim();
    const row = database.prepare("SELECT id, notification_type AS type, recipient_email AS recipientEmail, user_id AS userId, user_email AS userEmail, status, created_at AS createdAt FROM owner_notifications WHERE id=?").get(notificationId);
    if (!row) return res.status(404).json({ success: false, message: "Notification record was not found." });
    if (row.status !== "failed") return res.status(409).json({ success: false, message: "Only failed notifications can be retried." });
    if (!row.recipientEmail || !["resend", "smtp", "brevo"].includes(otpDelivery) || !emailDeliveryConfigured) {
      return res.status(503).json({ success: false, message: "The owner email recipient or delivery provider is not configured." });
    }
    const claimed = database.prepare("UPDATE owner_notifications SET status='pending', error_code=NULL WHERE id=? AND status='failed'").run(notificationId);
    if (!claimed.changes) return res.status(409).json({ success: false, message: "This notification is already being processed." });
    try {
      await sendConfiguredEmail({
        to: row.recipientEmail,
        subject: "SecureID: new user registration",
        text: [
          "A SecureID registration notification is being retried by the owner.",
          "",
          "User ID: " + row.userId,
          "Email: " + row.userEmail,
          "Registered at: " + new Date(Number(row.createdAt)).toISOString(),
          "",
          "This alert intentionally excludes passwords, verification tokens, and other secrets."
        ].join("\n"),
        purpose: "owner_new_registration_retry"
      });
      const now = Date.now();
      database.prepare("UPDATE owner_notifications SET status='sent', error_code=NULL, sent_at=? WHERE id=?").run(now, notificationId);
      database.prepare("INSERT INTO admin_audit_log (id, actor_user_id, actor_email, action, target_user_id, target_email, details_json, created_at) VALUES (?, ?, ?, 'OWNER_NOTIFICATION_RETRIED', ?, ?, ?, ?)")
        .run(randomUUID(), req.user.id, req.user.email, row.userId, row.userEmail, JSON.stringify({ notificationId, result: "sent" }), now);
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ success: true, notificationId, status: "sent", message: "Email provider accepted the retry. This does not guarantee inbox delivery." });
    } catch (deliveryError) {
      const code = safeProviderCode(deliveryError?.providerCode || deliveryError?.code || "provider_rejected");
      database.prepare("UPDATE owner_notifications SET status='failed', error_code=? WHERE id=?").run(code, notificationId);
      const now = Date.now();
      database.prepare("INSERT INTO admin_audit_log (id, actor_user_id, actor_email, action, target_user_id, target_email, details_json, created_at) VALUES (?, ?, ?, 'OWNER_NOTIFICATION_RETRY_FAILED', ?, ?, ?, ?)")
        .run(randomUUID(), req.user.id, req.user.email, row.userId, row.userEmail, JSON.stringify({ notificationId, errorCode: code }), now);
      return res.status(502).json({ success: false, message: "Email provider rejected the retry. Review the notification error code and provider configuration." });
    }
  } catch (error) { next(error); }
});

app.get("/api/admin/health", requireAuth, requireMfa, requireOwner, (req, res) => {
  const backup = getBackupStatus();
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    success:true,
    service:"SecureID API",
    status:"ready",
    database:"ok",
    emailDelivery:{provider:otpDelivery,configured:emailDeliveryConfigured,testSender:otpTestSender,options:emailDeliveryOptions},
    backup:{enabled:backup.enabled,lastSuccessAt:backup.lastSuccessAt,alertingConfigured:backup.alertingConfigured},
    operationalAlerting:Boolean((securityAlertEmail || process.env.OWNER_EMAIL) && ["resend","smtp","brevo"].includes(otpDelivery)),
    timestamp:new Date().toISOString()
  });
});

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

    // Persist an owner notification record even if email delivery is unavailable.
    const registrationAlertRecipient = String(securityAlertEmail || process.env.OWNER_EMAIL || "").trim();
    const notificationId = randomUUID();
    const canSendOwnerAlert = Boolean(registrationAlertRecipient && ["resend", "smtp", "brevo"].includes(otpDelivery) && emailDeliveryConfigured);
    database.prepare("INSERT INTO owner_notifications (id, notification_type, recipient_email, user_id, user_email, status, error_code, created_at, sent_at) VALUES (?, 'new_registration', ?, ?, ?, ?, ?, ?, NULL)")
      .run(notificationId, registrationAlertRecipient || null, id, email, canSendOwnerAlert ? "pending" : "failed", canSendOwnerAlert ? null : (registrationAlertRecipient ? "provider_not_configured" : "recipient_not_configured"), now);

    if (canSendOwnerAlert) {
      void sendConfiguredEmail({
        to: registrationAlertRecipient,
        subject: "SecureID: new user registration",
        text: [
          "A new SecureID account has been registered.",
          "",
          "User ID: " + id,
          "Email: " + email,
          "Registered at: " + new Date(now).toISOString(),
          "Email verification: pending",
          "",
          "Review registered users in the authenticated Owner / Admin dashboard.",
          "This alert intentionally excludes passwords, verification tokens, and other secrets."
        ].join("\n"),
        purpose: "owner_new_registration"
      }).then(() => {
        database.prepare("UPDATE owner_notifications SET status='sent', error_code=NULL, sent_at=? WHERE id=?").run(Date.now(), notificationId);
      }).catch((error) => {
        const code = safeProviderCode(error?.providerCode || error?.code || "provider_rejected");
        try { database.prepare("UPDATE owner_notifications SET status='failed', error_code=? WHERE id=?").run(code, notificationId); } catch {}
        console.error(JSON.stringify({ level: "error", event: "owner_registration_alert_failed", userId: id, notificationId, errorCode: code }));
      });
    }

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

  await sendConfiguredEmail({ to, subject, text });
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
const AUTH_LOCK_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LOCK_THRESHOLD = 6;
const AUTH_LOCK_DURATION_MS = 15 * 60 * 1000;
function authEmailHash(email){ return createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex"); }
function authIpHash(req){ return createHmac("sha256",sessionPepper).update(String(req.ip||req.socket?.remoteAddress||"unknown")).digest("hex"); }
function getAuthLock(email){
  return database.prepare("SELECT failed_count,first_failed_at,last_failed_at,locked_until FROM auth_lockouts WHERE email_hash=?").get(authEmailHash(email));
}
function registerAuthFailure(email, req, reason){
  const now=Date.now();
  const emailHash=authEmailHash(email);
  const ipHash=authIpHash(req);
  database.prepare("INSERT INTO failed_auth_attempts (id,email_hash,ip_hash,created_at,reason) VALUES (?,?,?,?,?)").run(randomUUID(),emailHash,ipHash,now,reason);
  const existing=getAuthLock(email);
  let count=Number(existing?.failed_count||0);
  const first=Number(existing?.first_failed_at||0);
  if(!first || now-first>AUTH_LOCK_WINDOW_MS) count=0;
  count+=1;
  const lockedUntil=count>=AUTH_LOCK_THRESHOLD ? now+AUTH_LOCK_DURATION_MS : Number(existing?.locked_until||0);
  database.prepare("INSERT INTO auth_lockouts(email_hash,failed_count,first_failed_at,last_failed_at,locked_until) VALUES(?,?,?,?,?) ON CONFLICT(email_hash) DO UPDATE SET failed_count=excluded.failed_count,first_failed_at=excluded.first_failed_at,last_failed_at=excluded.last_failed_at,locked_until=excluded.locked_until").run(emailHash,count,first&&now-first<=AUTH_LOCK_WINDOW_MS?first:now,now,lockedUntil);
  return {count,lockedUntil};
}
function clearAuthFailureState(email){
  database.prepare("DELETE FROM auth_lockouts WHERE email_hash=?").run(authEmailHash(email));
}
app.post("/api/auth/login", enforceSameOrigin, perIpAuthLimit, perAccountAuthLimit, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password;
    if (!validateEmail(email) || typeof password !== "string") return res.status(401).json({ success: false, message: "Email or password is incorrect." });
    const lock=getAuthLock(email);
    if(lock && Number(lock.locked_until||0)>Date.now()){
      const retryAfter=Math.max(1,Math.ceil((Number(lock.locked_until)-Date.now())/1000));
      res.setHeader("Retry-After",retryAfter);
      return res.status(429).json({success:false,message:"Too many failed sign-in attempts. Please try again later.",retryAfter});
    }
    const row = database.prepare("SELECT id, email, password_hash FROM users WHERE email = ? COLLATE NOCASE").get(email);
    const valid = await bcrypt.compare(password, row?.password_hash || dummyPasswordHash);
    if (!row || !valid) {
      const failure=registerAuthFailure(email,req,"invalid_credentials");
      if(row){
        logEvent(row.id,"LOGIN_FAILED",req,{failedCount:failure.count});
        if(failure.count>=3) ensureSecurityNotification(row.id,"LOGIN_FAILED","Sign-in attempt blocked","Several unsuccessful sign-in attempts were detected on your SecureID account.");
      }
      const retryAfter=failure.lockedUntil>Date.now()?Math.ceil((failure.lockedUntil-Date.now())/1000):0;
      if(retryAfter){res.setHeader("Retry-After",retryAfter);return res.status(429).json({success:false,message:"Too many failed sign-in attempts. Please try again later.",retryAfter});}
      return res.status(401).json({ success: false, message: "Email or password is incorrect." });
    }
    const accountControl = database.prepare("SELECT status FROM admin_account_controls WHERE user_id = ?").get(row.id);
    if (accountControl?.status === "suspended") {
      logEvent(row.id, "LOGIN_BLOCKED_ACCOUNT_SUSPENDED", req);
      return res.status(403).json({ success: false, code: "ACCOUNT_SUSPENDED", message: "This SecureID account is suspended. Contact support for assistance." });
    }

    clearAuthFailureState(email);

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

    const nativeSessionToken = createSession(row.id, req, res);
    logEvent(row.id, "LOGIN_SUCCESS", req);
    ensureSecurityNotification(row.id,"LOGIN_SUCCESS","New sign-in","A new SecureID sign-in was completed. Review Active sessions if this was not you.");
    res.json({ success: true, mfaRequired: true, user: { email: row.email, mfaVerified: false }, ...(req.get("X-SecureID-Client") === "native" ? { nativeSessionToken } : {}) });
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

    // Consume the reset token and update credentials in one write transaction.
    // BEGIN IMMEDIATE serializes competing reset requests; the conditional token
    // update ensures a token can succeed only once, even under concurrent requests.
    database.exec("BEGIN IMMEDIATE");
    try {
      const consumed = database.prepare(
        "UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?"
      ).run(now, record.id, record.user_id, now);

      if (Number(consumed.changes) !== 1) {
        database.exec("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "This password reset link is invalid or expired."
        });
      }

      const updated = database.prepare(
        "UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?"
      ).run(passwordHash, now, record.user_id);
      if (Number(updated.changes) !== 1) {
        throw new Error("Password reset user record could not be updated.");
      }

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

      database.exec("COMMIT");
    } catch (transactionError) {
      try { database.exec("ROLLBACK"); } catch {}
      throw transactionError;
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

app.get("/api/health/ready",(req,res)=>{
  try{
    database.prepare("SELECT 1 AS ok").get();
    const storagePath=process.env.DOCUMENT_STORAGE_PATH || (isProduction ? "/data/secureid-documents" : path.join(process.cwd(),"data","secureid-documents"));
    const storageOk=existsSync(storagePath);
    if(!storageOk) return res.status(503).json({success:false,status:"degraded",database:true,storage:false});
    res.json({success:true,status:"ready",database:true,storage:true,timestamp:new Date().toISOString()});
  }catch(error){res.status(503).json({success:false,status:"unavailable",database:false,storage:false});}
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
    try { await deliverOtp(user.email, code, String(res.getHeader("X-Request-Id") || "")); } catch (deliveryError) {
      database.prepare("DELETE FROM otp_challenges WHERE id = ?").run(id);
      database.prepare("UPDATE users SET otp_last_sent_at = 0 WHERE id = ?").run(user.id);
      throw deliveryError;
    }
    res.json({ success: true, challengeId: id, resendAvailableIn: Math.ceil(resendCooldownMs / 1000), message: "Your email provider accepted the verification request.", ...(otpDelivery === "console" ? { demoOtp: code } : {}) });
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
      database.exec("BEGIN IMMEDIATE");
      try {
        const consumed = database.prepare("UPDATE mfa_recovery_codes SET used_at = ? WHERE id = ? AND user_id = ? AND used_at IS NULL").run(now, record.id, req.user.id);
        if (Number(consumed.changes) !== 1) {
          database.exec("ROLLBACK");
          return res.status(400).json({ success: false, message: "Recovery code is invalid or has already been used." });
        }
        database.prepare("UPDATE sessions SET mfa_verified_until = ? WHERE token_hash = ?").run(now + mfaVerifiedTtlMs, req.session.token_hash);
        database.prepare("DELETE FROM otp_challenges WHERE user_id = ?").run(req.user.id);
        database.exec("COMMIT");
      } catch (transactionError) {
        try { database.exec("ROLLBACK"); } catch {}
        throw transactionError;
      }
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
      const failure=registerAuthFailure(req.user.email,req,"mfa_invalid");
      logEvent(req.user.id,"MFA_FAILED",req,{failedCount:failure.count});
      if(failure.count>=3) ensureSecurityNotification(req.user.id,"MFA_FAILED","MFA verification warning","Several unsuccessful MFA verification attempts were detected on your SecureID account.");
      return res.status(400).json({ success: false, message: "Incorrect verification code." });
    }
    const trustDevice = req.body?.trustDevice === true;
    const verifiedNow = Date.now();
    database.exec("BEGIN IMMEDIATE");
    try {
      const consumed = database.prepare(
        "DELETE FROM otp_challenges WHERE id = ? AND user_id = ? AND code_hash = ? AND expires_at > ? AND attempts < ?"
      ).run(challenge.id, req.user.id, challenge.code_hash, verifiedNow, maxOtpAttempts);
      if (Number(consumed.changes) !== 1) {
        database.exec("ROLLBACK");
        return res.status(400).json({ success: false, message: "This verification code has already been used or is no longer valid." });
      }
      const sessionUpdate = database.prepare(
        "UPDATE sessions SET mfa_verified_until = ?, trusted_until = ?, expires_at = ? WHERE token_hash = ?"
      ).run(verifiedNow + mfaVerifiedTtlMs, trustDevice ? verifiedNow + trustedDeviceTtlMs : 0, trustDevice ? verifiedNow + trustedDeviceTtlMs : Number(req.session.expires_at), req.session.token_hash);
      if (Number(sessionUpdate.changes) !== 1) throw new Error("MFA session could not be updated.");
      database.prepare("DELETE FROM otp_challenges WHERE user_id = ?").run(req.user.id);
      database.exec("COMMIT");
    } catch (transactionError) {
      try { database.exec("ROLLBACK"); } catch {}
      throw transactionError;
    }
    if (trustDevice) setSessionCookie(res, getCookie(req, sessionCookieName), trustedDeviceTtlMs);
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
  const statusCode = Number(error?.statusCode) || 500;
  const errorType=error?.name || "Error";
  console.error(JSON.stringify({ level:"error", event:"request_error", requestId:res.getHeader("X-Request-Id"), method:req.method, path:req.path, statusCode, errorType, errorCode: String(error?.code || "").slice(0, 80) || undefined, errorMessage: String(error?.message || "Unknown error").replace(/(?:password|pass|authorization|token|secret)\s*[:=]\s*\S+/ig, "[redacted]").slice(0, 240) }));
  try{
    database.prepare("INSERT INTO application_errors (id,request_id,method,path,status_code,error_type,created_at) VALUES (?,?,?,?,?,?,?)").run(randomUUID(),String(res.getHeader("X-Request-Id")||""),req.method,req.path,statusCode,errorType,Date.now());
  }catch{}
  const now=Date.now();
  if(now-operationalErrorAlertState.startedAt>5*60*1000) operationalErrorAlertState={startedAt:now,count:1,lastAlertAt:operationalErrorAlertState.lastAlertAt};
  else operationalErrorAlertState.count+=1;
  if(securityAlertEmail && otpDelivery==="resend" && operationalErrorAlertState.count>=5 && now-operationalErrorAlertState.lastAlertAt>15*60*1000){
    operationalErrorAlertState.lastAlertAt=now;
    void sendSecurityEmail({to:securityAlertEmail,subject:"SecureID operational error alert",text:"SecureID recorded "+operationalErrorAlertState.count+" server errors within a five-minute window. Check the production logs and health endpoint."}).catch(()=>{});
  }
  if (res.headersSent) return next(error);
  if(error?.code==="EMAIL_DELIVERY_FAILED"){
    const message=otpTestSender
      ? "SecureID is using Resend's test sender. To send codes to account holders, verify a sending domain and configure OTP_FROM_EMAIL with that domain. No active code was created."
      : error.providerCode==="sender_domain_unverified"
        ? "Resend has not verified the OTP sender domain. Finish the DNS verification in Resend, then request a new code. No active code was created."
      : "The email service could not accept your verification message. No active code was created. Check the sender configuration or try again shortly.";
    return res.status(statusCode).json({success:false,code:error.code,requestId:res.getHeader("X-Request-Id"),message});
  }
  res.status(statusCode).json({ success: false, message: statusCode === 423 ? "Wallet is locked." : "Something went wrong. Please try again shortly." });
});

setInterval(() => {
  const now = Date.now();
  database.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").run(now);
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  database.prepare("DELETE FROM otp_challenges WHERE expires_at <= ?").run(now);
}, 60 * 60 * 1000).unref();

app.use("/api", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(404).json({ success: false, code: "API_ROUTE_NOT_FOUND", message: "API endpoint not found." });
});

app.get("/{*splat}", (req, res) => res.sendFile(path.join(distPath, "index.html")));
app.listen(port, () => console.log(JSON.stringify({ level: "info", event: "server_started", port, environment: isProduction ? "production" : "development", storage: "sqlite", emailDelivery:{provider:otpDelivery,configured:emailDeliveryConfigured,testSender:otpTestSender,options:emailDeliveryOptions} })));



