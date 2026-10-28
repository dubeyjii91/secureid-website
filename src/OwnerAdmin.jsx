import { useEffect, useState } from "react";
import api from "./api.js";

function Metric({ label, value, detail }) {
  return <article className="panel" style={{minWidth:0}}>
    <div className="eyebrow dark">{label}</div>
    <h2 style={{fontSize:"2rem",margin:"12px 0 4px",overflowWrap:"anywhere"}}>{value ?? "—"}</h2>
    <p style={{margin:0,opacity:.8}}>{detail}</p>
  </article>;
}

export default function OwnerAdmin() {
  const [overview,setOverview] = useState(null);
  const [health,setHealth] = useState(null);
  const [message,setMessage] = useState("");
  const [loading,setLoading] = useState(true);

  async function load() {
    setLoading(true); setMessage("");
    try {
      const [stats,service] = await Promise.all([
        api("/api/admin/overview"),
        api("/api/admin/health")
      ]);
      setOverview(stats); setHealth(service);
    } catch (error) {
      setMessage(error.message || "Owner information could not be loaded.");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const backupStatus = !health?.backup?.enabled ? "Not configured" : health.backup.lastSuccessAt ? "Backup completed" : "Scheduled; no success recorded yet";
  const emailStatus = !health?.emailDelivery?.configured ? "Setup required" : health.emailDelivery.testSender ? "Test sender only" : "Configured; delivery not independently verified";

  return <section className="content">
    <div className="functionHero compact">
      <div><div className="eyebrow dark">OWNER CONSOLE</div><h2>SecureID operations</h2><p>Private operational overview. Owner access requires a signed-in account and verified MFA.</p></div>
      <div className="functionVisual" aria-hidden="true"><span className="functionEmoji">🛡️</span></div>
    </div>
    {message && <div className="vaultMessage" role="alert">{message}</div>}
    {loading ? <div className="panel" role="status">Loading owner overview…</div> : <>
      <div className="dashboardGrid">
        <Metric label="REGISTERED ACCOUNTS" value={overview?.stats?.users} detail="Total registered accounts, including owner accounts." />
        <Metric label="ACTIVE SESSIONS" value={overview?.stats?.activeSessions} detail="Sessions that have not expired." />
        <Metric label="ERRORS · 24 HOURS" value={overview?.stats?.recentErrors} detail="Recorded application errors; review logs for details." />
        <Metric label="SECURITY EVENTS · 24 HOURS" value={overview?.stats?.recentSecurityEvents} detail="Sign-in and account security events." />
      </div>
      <section className="panel systemHealthPanel">
        <div className="eyebrow dark">PRODUCTION HEALTH</div><h3>Service checks</h3>
        <div className="systemHealthGrid">
          <div><span>API</span><strong>{health?.status === "ready" ? "Operational" : "Check required"}</strong></div>
          <div><span>Database</span><strong>{health?.database === "ok" ? "Healthy" : "Check required"}</strong></div>
          <div><span>Email OTP</span><strong>{emailStatus}</strong></div>
          <div><span>Encrypted backups</span><strong>{backupStatus}</strong></div>
          <div><span>Operational alerts</span><strong>{health?.operationalAlerting ? "Configured" : "Not configured"}</strong></div>
        </div>
        {health?.backup?.lastSuccessAt && <p className="healthMeta">Last successful backup: {new Date(health.backup.lastSuccessAt).toLocaleString()}</p>}
        {health?.timestamp && <p className="healthMeta">Health check: {new Date(health.timestamp).toLocaleString()}</p>}
      </section>
      <section className="panel">
        <div className="eyebrow dark">OWNER ACCESS PROTECTION</div><h3>Access controls</h3>
        <p>Owner endpoints require the server-verified OWNER_EMAIL role, an authenticated session, and recently verified MFA. Ordinary accounts cannot grant themselves owner access.</p>
        <button type="button" className="secondary" onClick={load}>Refresh status</button>
      </section>
    </>}
  </section>;
}
