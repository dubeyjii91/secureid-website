import { useEffect, useState } from "react";
import api from "./api.js";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function eventLabel(action) {
  const labels = {
    ACCOUNT_CREATED: "New account registered",
    EMAIL_VERIFICATION_SENT: "Verification email requested",
    LOGIN_FAILED: "Failed sign-in",
    MFA_FAILED: "Failed MFA attempt",
    USER_SUSPENDED: "Account suspended by owner",
    USER_REACTIVATED: "Account reactivated by owner",
    ACCOUNT_SUSPENDED_BY_OWNER: "Account suspension recorded",
    ACCOUNT_REACTIVATED_BY_OWNER: "Account reactivation recorded"
  };
  return labels[action] || String(action || "Security activity").replaceAll("_", " ").toLowerCase();
}

export default function OwnerAdminDashboard() {
  const [health, setHealth] = useState(null);
  const [users, setUsers] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [activeUsers, setActiveUsers] = useState(0);
  const [suspendedUsers, setSuspendedUsers] = useState(0);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [usersError, setUsersError] = useState("");
  const [activityError, setActivityError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyUser, setBusyUser] = useState("");

  async function load() {
    setLoading(true); setError(""); setUsersError(""); setActivityError(""); setNotice("");
    const results = await Promise.allSettled([
      api("/api/admin/health"),
      api("/api/admin/users?limit=100"),
      api("/api/admin/activity?limit=50")
    ]);
    if (results[0].status === "fulfilled") setHealth(results[0].value);
    else setError(results[0].reason?.message || "Owner status could not be loaded.");
    if (results[1].status === "fulfilled") {
      setUsers(results[1].value.users || []);
      setTotalUsers(Number(results[1].value.total || 0));
      setActiveUsers(Number(results[1].value.active || 0));
      setSuspendedUsers(Number(results[1].value.suspended || 0));
    } else setUsersError(results[1].reason?.message || "User list could not be loaded.");
    if (results[2].status === "fulfilled") setEvents(results[2].value.events || []);
    else setActivityError(results[2].reason?.message || "Activity feed could not be loaded.");
    setLoading(false);
  }

  async function setAccountStatus(user, status) {
    if (busyUser) return;
    const confirmed = window.confirm(
      status === "suspended"
        ? "Suspend " + user.email + "? Their active sessions will be revoked and sign-in blocked until reactivated."
        : "Reactivate " + user.email + "? They will be able to sign in again."
    );
    if (!confirmed) return;
    let reason = "";
    if (status === "suspended") {
      reason = String(window.prompt("Optional reason for the audit log (do not enter sensitive data):", "") || "").trim().slice(0, 240);
    }
    setBusyUser(user.id); setNotice(""); setUsersError("");
    try {
      await api("/api/admin/users/" + encodeURIComponent(user.id) + "/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason })
      });
      await load();
      setNotice("Account " + (status === "suspended" ? "suspended" : "reactivated") + " successfully. Audit entry recorded.");
    } catch (e) {
      setUsersError(e?.message || "Could not change account status.");
    } finally {
      setBusyUser("");
    }
  }

  useEffect(() => { load(); }, []);

  return <section className="content narrow">
    <div className="functionHero compact"><div><div className="eyebrow dark">RESTRICTED · OWNER ONLY</div><h2>SecureID owner console</h2><p>Operational health, registered accounts and security activity. Owner authorization and verified MFA are enforced by the server.</p></div><div className="dashboardScore"><strong>🔐</strong><small>Restricted access</small></div></div>
    {notice && <div className="panel" role="status"><p>{notice}</p></div>}
    {loading && <div className="panel">Checking owner permissions, service health, users and activity…</div>}
    {error && <div className="panel" role="alert"><h3>Owner health check failed</h3><p>{error}</p><p>Sign in with the configured owner email and complete MFA. A hidden menu never grants access.</p></div>}
    {health && <>
      <div className="dashboardGrid">
        <article className="panel"><div className="eyebrow dark">API</div><h3>{health.status === "ready" ? "Operational" : "Check required"}</h3><p>{health.service || "SecureID API"}</p></article>
        <article className="panel"><div className="eyebrow dark">DATABASE</div><h3>{health.database === "ok" ? "Healthy" : "Check required"}</h3><p>Live readiness check</p></article>
        <article className="panel"><div className="eyebrow dark">EMAIL PROVIDER</div><h3>{health.emailDelivery?.configured ? (health.emailDelivery.testSender ? "Test sender" : "Configured") : "Setup required"}</h3><p>{health.emailDelivery?.provider || "Provider unavailable"} · Configuration does not guarantee inbox delivery.</p></article>
        <article className="panel"><div className="eyebrow dark">ENCRYPTED BACKUPS</div><h3>{health.backup?.enabled ? (health.backup.lastSuccessAt ? "Backup recorded" : "Scheduled") : "Not configured"}</h3><p>{health.backup?.lastSuccessAt ? "Last success: " + new Date(health.backup.lastSuccessAt).toLocaleString() : "Confirm a recent backup before relying on recovery."}</p></article>
      </div>
      <div className="panel"><div className="eyebrow dark">OWNER ACCESS AUDIT</div><h3>Protected administrative access</h3><p>User data and account controls require a valid session, verified MFA and server-side owner authorization. Passwords, MFA codes and verification tokens are never returned.</p><p><small>Health checked: {health.timestamp ? new Date(health.timestamp).toLocaleString() : "just now"}</small></p></div>
    </>}
    <div className="panel">
      <div className="eyebrow dark">USER MANAGEMENT</div>
      <h3>Registered accounts · {totalUsers}</h3>
      <div className="dashboardGrid">
        <article className="panel"><div className="eyebrow dark">ACTIVE</div><h3>{activeUsers}</h3></article>
        <article className="panel"><div className="eyebrow dark">SUSPENDED</div><h3>{suspendedUsers}</h3></article>
      </div>
      <p>Latest {users.length} accounts, newest first. Registration email alerts are attempted when the configured email provider accepts the message.</p>
      {usersError && <p role="alert">{usersError}</p>}
      {!loading && !usersError && users.length === 0 && <p>No registered accounts found.</p>}
      {users.length > 0 && <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}><thead><tr><th style={{padding:"10px 8px"}}>Email / ID</th><th style={{padding:"10px 8px"}}>Registered</th><th style={{padding:"10px 8px"}}>Email</th><th style={{padding:"10px 8px"}}>Account</th><th style={{padding:"10px 8px"}}>Action</th></tr></thead><tbody>{users.map((user)=><tr key={user.id}><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}><strong>{user.email}</strong><br/><small>{user.id}</small></td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{formatDate(user.createdAt)}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{user.emailVerified ? "Verified" : "Pending"}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{user.role === "owner" ? "Owner" : user.accountStatus === "suspended" ? "Suspended" : "Active"}{user.suspensionReason ? <><br/><small>Reason: {user.suspensionReason}</small></> : null}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{user.role === "owner" ? "Protected" : <button className="primary" disabled={Boolean(busyUser)} onClick={() => setAccountStatus(user, user.accountStatus === "suspended" ? "active" : "suspended")}>{busyUser === user.id ? "Saving…" : user.accountStatus === "suspended" ? "Reactivate" : "Suspend"}</button>}</td></tr>)}</tbody></table></div>}
      <button className="primary" onClick={load} disabled={loading || Boolean(busyUser)}>{loading ? "Refreshing…" : "Refresh dashboard"}</button>
      <p><small>Only account metadata is displayed. Suspending an account revokes its current sessions. Owner accounts cannot be suspended from this console.</small></p>
    </div>
    <div className="panel">
      <div className="eyebrow dark">SECURITY & REGISTRATION ACTIVITY</div>
      <h3>Recent activity</h3>
      <p>Recent registration, failed sign-in/MFA and owner account-control events.</p>
      {activityError && <p role="alert">{activityError}</p>}
      {!activityError && events.length === 0 && !loading && <p>No activity events found yet.</p>}
      {events.length > 0 && <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}><thead><tr><th style={{padding:"10px 8px"}}>Time</th><th style={{padding:"10px 8px"}}>Event</th><th style={{padding:"10px 8px"}}>Account</th><th style={{padding:"10px 8px"}}>Actor</th></tr></thead><tbody>{events.map((event)=><tr key={event.id}><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{formatDate(event.createdAt)}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{eventLabel(event.action)}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{event.targetEmail || event.targetUserId || "—"}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{event.actorEmail || "System"}</td></tr>)}</tbody></table></div>}
    </div>
  </section>;
}
