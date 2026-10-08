import { useEffect, useState } from "react";
import "./security-sessions.css";

function csrfToken() {
  const match = document.cookie.match(/(?:^|; )(?:__Host-secureid\\.csrf|secureid\\.csrf)=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function browserName(ua = "") {
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/Chrome\//.test(ua)) return "Google Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  return "Browser";
}
function deviceName(ua = "") {
  if (/iPhone|iPad/i.test(ua)) return "iPhone / iPad";
  if (/Android/i.test(ua)) return "Android device";
  if (/Mobile/i.test(ua)) return "Mobile device";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Macintosh|Mac OS/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux device";
  return "Desktop device";
}
function relativeTime(timestamp) {
  const diff = Date.now() - Number(timestamp || 0);
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + " min ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + " hr ago";
  return Math.floor(diff / 86400000) + " days ago";
}

export default function SecuritySessions() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/security/sessions", { credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to load active sessions.");
      setSessions(data.sessions || []);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function revoke(sessionId) {
    setBusy(sessionId);
    setMessage("");
    try {
      const response = await fetch("/api/security/sessions/revoke", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(csrfToken() ? { "X-CSRF-Token": csrfToken() } : {}) },
        body: JSON.stringify({ sessionId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to sign out this device.");
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  async function revokeOthers() {
    if (!window.confirm("Sign out all other devices? Your current device will stay signed in.")) return;
    setBusy("all");
    setMessage("");
    try {
      const response = await fetch("/api/security/sessions/revoke-others", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(csrfToken() ? { "X-CSRF-Token": csrfToken() } : {}) }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to sign out other devices.");
      setMessage(data.revoked ? `Signed out ${data.revoked} other session${data.revoked === 1 ? "" : "s"}.` : "No other active devices were signed in.");
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  useEffect(() => { load(); }, []);

  return <section className="content narrow">
    <div className="functionHero compact">
      <div>
        <div className="eyebrow dark">DEVICE SECURITY</div>
        <h2>Where you're signed in</h2>
        <p>Review active SecureID sessions and immediately sign out devices you no longer recognize.</p>
      </div>
      <div className="sessionShield" aria-hidden="true">⌁</div>
    </div>

    <section className="panel sessionsPanel">
      <div className="panelHead">
        <div>
          <div className="eyebrow dark">ACTIVE SESSIONS</div>
          <h2>Your devices</h2>
        </div>
        <button className="textButton" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      <div className="sessionActions">
        <p>Each session automatically expires after the SecureID session lifetime.</p>
        <button className="dangerButton small" onClick={revokeOthers} disabled={busy === "all" || loading}>{busy === "all" ? "Signing out…" : "Sign out all other devices"}</button>
      </div>
      {message && <div className="vaultMessage">{message}</div>}
      {loading ? <div className="activityEmpty">Loading active devices…</div> :
        sessions.length === 0 ? <div className="activityEmpty">No active sessions found.</div> :
        <div className="sessionList">
          {sessions.map((session) => <article className={`sessionItem ${session.current ? "current" : ""}`} key={session.id}>
            <div className="sessionDeviceIcon">▣</div>
            <div className="sessionInfo">
              <div className="sessionTitle"><strong>{deviceName(session.userAgent)}</strong>{session.current && <span className="currentBadge">This device</span>}{session.trustedUntil && Number(session.trustedUntil)>Date.now() && <span className="trustedBadge">Trusted</span>}</div>
              <span>{browserName(session.userAgent)}</span>
              <small>Last active: {relativeTime(session.lastSeenAt)} · Started: {new Date(session.createdAt).toLocaleString()}{session.trustedUntil && Number(session.trustedUntil)>Date.now() ? " · Trusted until "+new Date(session.trustedUntil).toLocaleDateString() : ""}</small>
            </div>
            {!session.current && <button className="textDangerButton" onClick={() => revoke(session.id)} disabled={busy === session.id}>{busy === session.id ? "Signing out…" : "Sign out"}</button>}
          </article>)}
        </div>}
    </section>
  </section>;
}
