import crypto from "node:crypto";

export const SHARE_RATE_WINDOW_MS = 15 * 60 * 1000;
export const SHARE_RATE_IP_MAX = 20;
export const SHARE_RATE_USER_MAX = 10;

export function enforceShareRateLimit(database, req, userId, now = Date.now()) {
  const identities = [
    { scope: "ip", value: String(req.ip || "unknown"), max: SHARE_RATE_IP_MAX },
    { scope: "user", value: String(userId), max: SHARE_RATE_USER_MAX }
  ];
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const identity of identities) {
      const digest = crypto.createHash("sha256").update(identity.value).digest("hex");
      const bucketKey = `secure-share:${identity.scope}:${digest}`;
      const current = database.prepare("SELECT hits, reset_at FROM rate_limits WHERE bucket_key = ?").get(bucketKey);
      if (!current || Number(current.reset_at) <= now) {
        database.prepare("INSERT OR REPLACE INTO rate_limits (bucket_key, hits, reset_at) VALUES (?, ?, ?)").run(bucketKey, 1, now + SHARE_RATE_WINDOW_MS);
        continue;
      }
      if (Number(current.hits) >= identity.max) {
        const error = new Error("Too many share requests. Try again later.");
        error.statusCode = 429;
        throw error;
      }
      database.prepare("UPDATE rate_limits SET hits = hits + 1 WHERE bucket_key = ? AND reset_at > ?").run(bucketKey, now);
    }
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    throw error;
  }
}
