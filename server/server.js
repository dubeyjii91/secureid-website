import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
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

const isProduction = process.env.NODE_ENV === "production";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "..", "dist");
app.use(express.static(distPath));
if (isProduction) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

const port = Number(process.env.PORT || 5000);
const appOrigin = process.env.APP_ORIGIN || "http://127.0.0.1:5173";

const sessionTtlMs = 8 * 60 * 60 * 1000;
const mfaVerifiedTtlMs = 30 * 60 * 1000;
const otpTtlMs =
  (isProduction ? 300 : Number(process.env.DEV_OTP_TTL_SECONDS || 300)) *
  1000;

const maxOtpAttempts = Number(process.env.MAX_OTP_ATTEMPTS || 5);
const otpDelivery =
  process.env.OTP_DELIVERY || (isProduction ? "resend" : "console");

const resendApiKey = process.env.RESEND_API_KEY || "";
const otpFromEmail = process.env.OTP_FROM_EMAIL || "";

const bcryptRounds = Math.min(
  15,
  Math.max(10, Number(process.env.BCRYPT_ROUNDS || (isProduction ? 12 : 10))),
);

const sessionPepper =
  process.env.SESSION_HASH_SECRET ||
  (!isProduction ? randomBytes(32).toString("hex") : "");

const otpPepper =
  process.env.OTP_HASH_SECRET ||
  (!isProduction ? randomBytes(32).toString("hex") : "");

const sessionCookieName = isProduction
  ? "__Host-secureid.sid"
  : "secureid.sid";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be between 1 and 65535.");
}

if (!sessionPepper || sessionPepper.length < 32) {
  throw new Error("SESSION_HASH_SECRET must be at least 32 characters.");
}

if (!otpPepper || otpPepper.length < 32) {
  throw new Error("OTP_HASH_SECRET must be at least 32 characters.");
}

if (!isProduction && !["console", "resend"].includes(otpDelivery)) {
  throw new Error("OTP_DELIVERY must be console or resend.");
}

if (isProduction && otpDelivery !== "resend") {
  throw new Error("Production requires OTP_DELIVERY=resend.");
}

if (
  otpDelivery === "resend" &&
  (!resendApiKey || !otpFromEmail)
) {
  throw new Error(
    "RESEND_API_KEY and OTP_FROM_EMAIL are required for Resend delivery.",
  );
}

if (isProduction && !appOrigin.startsWith("https://")) {
  throw new Error("APP_ORIGIN must use HTTPS in production.");
}

app.use(express.json({ limit: "32kb" }));

app.use((req, res, next) => {
  const requestId = randomUUID();
  if (req.path === "/api/mfa/challenge") console.log("[MFA REQUEST REACHED BACKEND]", req.method, req.headers.origin);

  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Cache-Control", "no-store");

  if (isProduction) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  next();
});

function allowedOrigin(origin) {
  if (!origin) return false;

  if (!isProduction) {
    return (
      origin === appOrigin ||
      origin === "http://localhost:5173" ||
      origin === "http://127.0.0.1:5173"
    );
  }

  return origin === appOrigin;
}

app.use((req, res, next) => {
  const origin = req.get("origin");

  if (origin && allowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(
      origin && allowedOrigin(origin) ? 204 : 403,
    );
  }

  next();
});

function enforceSameOrigin(req, res, next) {
  if (!isProduction) return next();

  const origin = req.get("origin");

  if (origin !== appOrigin) {
    return res.status(403).json({
      success: false,
      message: "Request origin is not allowed.",
    });
  }

  next();
}

function getCookie(req, name) {
  const raw = req.headers.cookie || "";

  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");

    if (key === name) {
      return decodeURIComponent(value.join("="));
    }
  }

  return "";
}

function hashSessionToken(token) {
  return createHmac("sha256", sessionPepper)
    .update(token)
    .digest("hex");
}

function hashOtpCode(code, userId, challengeId) {
  return createHmac("sha256", otpPepper)
    .update(`${userId}:${challengeId}:${code}`)
    .digest("hex");
}

function setSessionCookie(res, token, maxAgeMs = sessionTtlMs) {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    "HttpOnly",
    "SameSite=Strict",
  ];

  if (isProduction) {
    parts.push("Secure");
  }

  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  const parts = [
    `${sessionCookieName}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
  ];

  if (isProduction) {
    parts.push("Secure");
  }

  res.setHeader("Set-Cookie", parts.join("; "));
}

function createSession(userId, res) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();

  database
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at, mfa_verified_until) VALUES (?, ?, ?, ?, 0)",
    )
    .run(
      hashSessionToken(token),
      userId,
      now + sessionTtlMs,
      now,
    );

  setSessionCookie(res, token);

  return token;
}

function requireAuth(req, res, next) {
  const token = getCookie(req, sessionCookieName);

  if (!token || token.length < 20 || token.length > 200) {
    return res.status(401).json({
      success: false,
      message: "Sign in to continue.",
    });
  }

  const tokenHash = hashSessionToken(token);

  const row = database
    .prepare(
      `
      SELECT
        s.token_hash,
        s.expires_at,
        s.mfa_verified_until,
        u.id,
        u.email
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
      LIMIT 1
    `,
    )
    .get(tokenHash);

  if (!row || Number(row.expires_at) <= Date.now()) {
    database
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(tokenHash);

    clearSessionCookie(res);

    return res.status(401).json({
      success: false,
      message: "Session expired. Please sign in again.",
    });
  }

  req.session = row;

  req.user = {
    id: row.id,
    email: row.email,
    mfaVerified:
      Number(row.mfa_verified_until || 0) > Date.now(),
  };

  next();
}

function getClientKey(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function createRateLimit(
  name,
  maxHits,
  windowMs,
  getIdentity,
) {
  return (req, res, next) => {
    const identity = getIdentity(req);

    const key = `${name}:${createHash("sha256")
      .update(identity)
      .digest("hex")
      .slice(0, 32)}`;

    const now = Date.now();

    const current = database
      .prepare(
        "SELECT hits, reset_at FROM rate_limits WHERE bucket_key = ?",
      )
      .get(key);

    if (!current || Number(current.reset_at) <= now) {
      database
        .prepare(
          "INSERT OR REPLACE INTO rate_limits (bucket_key, hits, reset_at) VALUES (?, ?, ?)",
        )
        .run(key, 1, now + windowMs);

      return next();
    }

    if (Number(current.hits) >= maxHits) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
      });
    }

    database
      .prepare(
        "UPDATE rate_limits SET hits = hits + 1 WHERE bucket_key = ?",
      )
      .run(key);

    next();
  };
}

const window15m = 15 * 60 * 1000;

const perIpAuthLimit = createRateLimit(
  "auth-ip",
  10,
  window15m,
  getClientKey,
);

const perAccountAuthLimit = createRateLimit(
  "auth-account",
  10,
  window15m,
  (req) =>
    String(req.body?.email || "unknown").toLowerCase(),
);

const perIpOtpLimit = createRateLimit(
  "otp-ip",
  5,
  window15m,
  getClientKey,
);

const perUserOtpLimit = createRateLimit(
  "otp-user",
  5,
  window15m,
  (req) => req.user?.id || getClientKey(req),
);

const perIpOtpVerifyLimit = createRateLimit(
  "otp-verify-ip",
  20,
  window15m,
  getClientKey,
);

const perUserOtpVerifyLimit = createRateLimit(
  "otp-verify-user",
  20,
  window15m,
  (req) => req.user?.id || getClientKey(req),
);

const perIpSessionReadLimit = createRateLimit(
  "session-read-ip",
  40,
  window15m,
  getClientKey,
);

const perUserSessionReadLimit = createRateLimit(
  "session-read-user",
  20,
  window15m,
  (req) => req.user?.id || getClientKey(req),
);

const perIpSessionActionLimit = createRateLimit(
  "session-action-ip",
  40,
  window15m,
  getClientKey,
);

const perUserSessionActionLimit = createRateLimit(
  "session-action-user",
  20,
  window15m,
  (req) => req.user?.id || getClientKey(req),
);

function validateEmail(email) {
  return (
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function validatePassword(password) {
  if (typeof password !== "string") {
    return false;
  }

  const bytes = Buffer.byteLength(password, "utf8");

  return bytes >= 12 && bytes <= 72;
}

async function deliverOtp(email, code) {
  if (otpDelivery === "console" && !isProduction) {
    console.log(
      `[SecureID DEV OTP] ${email}: ${code}`,
    );

    return;
  }

  const response = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: otpFromEmail,
        to: [email],
        subject: "Your SecureID verification code",
        text: `Your SecureID verification code is ${code}. It expires in 5 minutes.`,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();

    console.error(
      JSON.stringify({
        level: "error",
        event: "otp_delivery_failed",
        status: response.status,
        response: errorText,
      }),
    );

    throw new Error(
      `Resend request failed with status ${response.status}.`,
    );
  }
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "SecureID API is running",
  });
});

app.post(
  "/api/auth/register",
  enforceSameOrigin,
  perIpAuthLimit,
  perAccountAuthLimit,
  async (req, res, next) => {
    try {
      const email = String(
        req.body?.email || "",
      )
        .trim()
        .toLowerCase();

      const password = req.body?.password;

      if (!validateEmail(email)) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid email address.",
        });
      }

      if (!validatePassword(password)) {
        return res.status(400).json({
          success: false,
          message: "Password must be 12 to 72 bytes long.",
        });
      }

      const existing = database
        .prepare(
          "SELECT id FROM users WHERE email = ? COLLATE NOCASE",
        )
        .get(email);

      if (existing) {
        return res.status(409).json({
          success: false,
          message:
            "An account with this email already exists.",
        });
      }

      const id = randomUUID();
      const passwordHash = await bcrypt.hash(
        password,
        bcryptRounds,
      );

      database
        .prepare(
          "INSERT INTO users (id, email, password_hash, created_at, otp_last_sent_at) VALUES (?, ?, ?, ?, 0)",
        )
        .run(
          id,
          email,
          passwordHash,
          Date.now(),
        );

      createSession(id, res);

      res.status(201).json({
        success: true,
        user: { email },
      });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/auth/login",
  enforceSameOrigin,
  perIpAuthLimit,
  perAccountAuthLimit,
  async (req, res, next) => {
    try {
      const email = String(
        req.body?.email || "",
      )
        .trim()
        .toLowerCase();

      const password = req.body?.password;

      if (
        !validateEmail(email) ||
        typeof password !== "string"
      ) {
        return res.status(401).json({
          success: false,
          message: "Email or password is incorrect.",
        });
      }

      const row = database
        .prepare(
          "SELECT id, email, password_hash FROM users WHERE email = ? COLLATE NOCASE",
        )
        .get(email);

        const dummyHash = bcrypt.hashSync(
  "SecureIDDummyPassword!2026",
  bcryptRounds,
      );

      const valid = await bcrypt.compare(
        password,
        row?.password_hash || dummyHash,
      );

      if (!row || !valid) {
        return res.status(401).json({
          success: false,
          message: "Email or password is incorrect.",
        });
      }

      createSession(row.id, res);

database
  .prepare(
    "INSERT INTO security_events (id, user_id, event_type, created_at) VALUES (?, ?, ?, ?)",
  )
  .run(
    randomUUID(),
    row.id,
    "LOGIN_SUCCESS",
    Date.now(),
  );
      res.json({
        success: true,
        user: { email: row.email },
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/auth/session",
  perIpSessionReadLimit,
  requireAuth,
  perUserSessionReadLimit,
  (req, res) => {
    res.json({
      success: true,
      user: req.user,
    });
  },
);

app.post(
  "/api/auth/logout",
  enforceSameOrigin,
  requireAuth,
  perIpSessionActionLimit,
  perUserSessionActionLimit,
  (req, res) => {
    database
      .prepare(
        "DELETE FROM otp_challenges WHERE user_id = ?",
      )
      .run(req.user.id);

    database
  .prepare(
    "INSERT INTO security_events (id, user_id, event_type, created_at) VALUES (?, ?, ?, ?)",
  )
  .run(
    randomUUID(),
    req.user.id,
    "LOGOUT",
    Date.now(),
  );

  database
  .prepare(
    "DELETE FROM sessions WHERE token_hash = ?",
  )
  .run(req.session.token_hash);

    clearSessionCookie(res);

    res.json({ success: true });
  },
);

app.post(
  "/api/mfa/challenge",
  enforceSameOrigin,
  requireAuth,
  perIpOtpLimit,
  perUserOtpLimit,
  async (req, res, next) => {
    console.log("[MFA CHALLENGE HIT]", req.user?.id);
    try {
      const user = database
        .prepare(
          "SELECT id, email, otp_last_sent_at FROM users WHERE id = ?",
        )
        .get(req.user.id);

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Sign in to continue.",
        });
      }

      const cooldownMs = 60 * 1000;

      if (
        Number(user.otp_last_sent_at || 0) +
          cooldownMs >
        Date.now()
      ) {
        return res.status(429).json({
          success: false,
          message:
            "Please wait before requesting another code.",
        });
      }

      database
        .prepare(
          "DELETE FROM otp_challenges WHERE user_id = ?",
        )
        .run(user.id);

      const id = randomUUID();
      const code = String(
        randomInt(0, 1000000),
      ).padStart(6, "0");

      const codeHash = hashOtpCode(
        code,
        user.id,
        id,
      );

      const now = Date.now();

      database
        .prepare(
          "INSERT INTO otp_challenges (id, user_id, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)",
        )
        .run(
          id,
          user.id,
          codeHash,
          now + otpTtlMs,
          now,
        );

      database
        .prepare(
          "UPDATE users SET otp_last_sent_at = ? WHERE id = ?",
        )
        .run(now, user.id);

      try {
        await deliverOtp(user.email, code);
      } catch (deliveryError) {
        database
          .prepare(
            "DELETE FROM otp_challenges WHERE id = ?",
          )
          .run(id);

        database
          .prepare(
            "UPDATE users SET otp_last_sent_at = 0 WHERE id = ?",
          )
          .run(user.id);

        throw deliveryError;
      }

      res.json({
        success: true,
         challengeId: id,
  resendAvailableIn: 60,
        message: "Verification code sent.",
      });
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/mfa/verify",
  enforceSameOrigin,
  requireAuth,
  perIpSessionActionLimit,
  perUserSessionActionLimit,
  (req, res, next) => {
    try {
      const code = String(
        req.body?.code || "",
      ).trim();

      if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({
          success: false,
          message:
            "Enter the 6-digit verification code.",
        });
      }

      const challenge = database
        .prepare(
          `
          SELECT id, code_hash, expires_at, attempts
          FROM otp_challenges
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `,
        )
        .get(req.user.id);

      if (
        !challenge ||
        Number(challenge.expires_at) <= Date.now()
      ) {
        database
          .prepare(
            "DELETE FROM otp_challenges WHERE user_id = ?",
          )
          .run(req.user.id);

        return res.status(400).json({
          success: false,
          message:
            "This verification code has expired. Request a new one.",
        });
      }

      if (
        Number(challenge.attempts) >=
        maxOtpAttempts
      ) {
        return res.status(429).json({
          success: false,
          message:
            "Too many incorrect attempts. Request a new code.",
        });
      }

      const supplied = Buffer.from(
        hashOtpCode(
          code,
          req.user.id,
          challenge.id,
        ),
        "hex",
      );

      const stored = Buffer.from(
        challenge.code_hash,
        "hex",
      );

      const valid =
        supplied.length === stored.length &&
        timingSafeEqual(supplied, stored);

      if (!valid) {
        database
          .prepare(
            "UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?",
          )
          .run(challenge.id);

        return res.status(400).json({
          success: false,
          message:
            "Incorrect verification code.",
        });
      }

      const verifiedUntil =
        Date.now() + mfaVerifiedTtlMs;

      database
        .prepare(
          "UPDATE sessions SET mfa_verified_until = ? WHERE token_hash = ?",
        )
        .run(
          verifiedUntil,
          req.session.token_hash,
        );

      database
        .prepare(
          "DELETE FROM otp_challenges WHERE id = ?",
        )
        .run(challenge.id);

      database
        .prepare(
          "INSERT INTO security_events (id, user_id, event_type, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          randomUUID(),
          req.user.id,
          "MFA_VERIFIED",
          Date.now(),
        );

      res.json({
        success: true,
        user: {
          email: req.user.email,
          mfaVerified: true,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/mfa/cancel",
  enforceSameOrigin,
  requireAuth,
  perIpSessionActionLimit,
  perUserSessionActionLimit,
  (req, res, next) => {
    try {
      database
        .prepare(
          "DELETE FROM otp_challenges WHERE user_id = ?",
        )
        .run(req.user.id);

      database
        .prepare(
          "UPDATE sessions SET mfa_verified_until = 0 WHERE token_hash = ?",
        )
        .run(req.session.token_hash);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

app.use((error, req, res, next) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "request_error",
      message: error?.message || String(error),
      path: req.path,
    }),
  );

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    success: false,
    message:
      "Something went wrong. Please try again shortly.",
  });
});

setInterval(() => {
  const now = Date.now();

  database
    .prepare(
      "DELETE FROM rate_limits WHERE reset_at <= ?",
    )
    .run(now);

  database
    .prepare(
      "DELETE FROM sessions WHERE expires_at <= ?",
    )
    .run(now);

  database
    .prepare(
      "DELETE FROM otp_challenges WHERE expires_at <= ?",
    )
    .run(now);
}, 60 * 60 * 1000).unref();

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});
app.listen(port, () => {
  console.log(
    JSON.stringify({
      level: "info",
      event: "server_started",
      port,
      environment: isProduction
        ? "production"
        : "development",
      storage: "sqlite",
      otpDelivery,
    }),
  );
});
