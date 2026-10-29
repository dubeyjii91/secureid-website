import { useEffect, useState } from "react";
import api from "./api.js";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function OwnerAdminDashboard() {
  const [health, setHealth] = useState(null);
  const [users, setUsers] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [usersError, setUsersError] = useState("");
  async function load() {
    setLoading(true); setError(""); setUsersError("");
    const results = await Promise.allSettled([
      api("/api/admin/health"),
      api("/api/admin/users?limit=100")
    ]);
    if (results[0].status === "fulfilled") setHealth(results[0].value);
    else setError(results[0].reason?.message || "Owner status could not be loaded.");
    if (results[1].status === "fulfilled") {
      setUsers(results[1].value.users || []);
      setTotalUsers(Number(results[1].value.total || 0));
    } else setUsersError(results[1].reason?.message || "User list could not be loaded.");
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  return <section className="content narrow">
    <div className="functionHero compact"><div><div className="eyebrow dark">RESTRICTED · OWNER ONLY</div><h2>SecureID owner console</h2><p>Operational status and registered accounts. Requires a server-authorized owner account and verified MFA.</p></div><div className="dashboardScore"><strong>🔐</strong><small>Restricted access</small></div></div>
    {loading && <div className="panel">Checking owner permissions, service health and registrations…</div>}
    {error && <div className="panel" role="alert"><h3>Owner health check failed</h3><p>{error}</p><p>Sign in with the configured owner email, complete MFA, then retry. A hidden menu never grants access.</p></div>}
    {health && <><div className="dashboardGrid"><article className="panel"><div className="eyebrow dark">API</div><h3>{health.status === "ready" ? "Operational" : "Check required"}</h3><p>{health.service || "SecureID API"}</p></article><article className="panel"><div className="eyebrow dark">DATABASE</div><h3>{health.database === "ok" ? "Healthy" : "Check required"}</h3><p>Live readiness check</p></article><article className="panel"><div className="eyebrow dark">EMAIL PROVIDER</div><h3>{health.emailDelivery?.configured ? (health.emailDelivery.testSender ? "Test sender" : "Configured") : "Setup required"}</h3><p>{health.emailDelivery?.provider || "Provider unavailable"} · Provider configuration does not guarantee inbox delivery.</p></article><article className="panel"><div className="eyebrow dark">ENCRYPTED BACKUPS</div><h3>{health.backup?.enabled ? (health.backup.lastSuccessAt ? "Backup recorded" : "Scheduled") : "Not configured"}</h3><p>{health.backup?.lastSuccessAt ? "Last success: " + new Date(health.backup.lastSuccessAt).toLocaleString() : "Confirm a recent backup before relying on recovery."}</p></article></div><div className="panel"><div className="eyebrow dark">OWNER ACCESS AUDIT</div><h3>Owner-only access</h3><p>Registered user data is served by an endpoint protected by authentication, verified MFA and server-side owner authorization. Passwords and verification tokens are never returned.</p><p><small>Health checked: {health.timestamp ? new Date(health.timestamp).toLocaleString() : "just now"}</small></p></div></>}
    <div className="panel">
      <div className="eyebrow dark">USER MANAGEMENT</div>
      <h3>Registered users · {totalUsers}</h3>
      <p>Latest {users.length} accounts, newest first. New registrations trigger an owner email alert when the configured email provider is available.</p>
      {usersError && <p role="alert">{usersError}</p>}
      {!loading && !usersError && users.length === 0 && <p>No registered accounts found.</p>}
      {users.length > 0 && <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}><thead><tr><th style={{padding:"10px 8px"}}>Email</th><th style={{padding:"10px 8px"}}>Registered</th><th style={{padding:"10px 8px"}}>Email status</th><th style={{padding:"10px 8px"}}>Role</th></tr></thead><tbody>{users.map((user)=><tr key={user.id}><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{user.email}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{formatDate(user.createdAt)}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{user.emailVerified ? "Verified" : "Pending"}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{user.role === "owner" ? "Owner" : "User"}</td></tr>)}</tbody></table></div>}
      <button className="primary" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh users and service status"}</button>
      <p><small>Only account metadata is displayed. Passwords, MFA codes and verification tokens are excluded.</small></p>
    </div>
  </section>;
}
