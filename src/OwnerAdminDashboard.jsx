import { useEffect, useState } from "react";
import api from "./api.js";

export default function OwnerAdminDashboard() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true); setError("");
    try { setHealth(await api("/api/admin/health")); }
    catch (e) { setError(e.message || "Owner status could not be loaded."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  return <section className="content narrow">
    <div className="functionHero compact"><div><div className="eyebrow dark">RESTRICTED · OWNER ONLY</div><h2>SecureID owner console</h2><p>Operational status for the live service. Requires a server-authorized owner account and verified MFA.</p></div><div className="dashboardScore"><strong>🔐</strong><small>Restricted access</small></div></div>
    {loading && <div className="panel">Checking owner permissions and service health…</div>}
    {error && <div className="panel" role="alert"><h3>Owner check failed</h3><p>{error}</p><p>Sign in with the configured owner email, complete MFA, then retry. A hidden menu never grants access.</p><button className="primary" onClick={load}>Retry check</button></div>}
    {health && <><div className="dashboardGrid"><article className="panel"><div className="eyebrow dark">API</div><h3>{health.status === "ready" ? "Operational" : "Check required"}</h3><p>{health.service || "SecureID API"}</p></article><article className="panel"><div className="eyebrow dark">DATABASE</div><h3>{health.database === "ok" ? "Healthy" : "Check required"}</h3><p>Live readiness check</p></article><article className="panel"><div className="eyebrow dark">EMAIL VERIFICATION</div><h3>{health.emailDelivery?.configured ? (health.emailDelivery.testSender ? "Test sender" : "Configured") : "Setup required"}</h3><p>{health.emailDelivery?.provider || "Provider unavailable"} · Configuration does not guarantee inbox delivery.</p></article><article className="panel"><div className="eyebrow dark">ENCRYPTED BACKUPS</div><h3>{health.backup?.enabled ? (health.backup.lastSuccessAt ? "Backup recorded" : "Scheduled") : "Not configured"}</h3><p>{health.backup?.lastSuccessAt ? "Last success: " + new Date(health.backup.lastSuccessAt).toLocaleString() : "Confirm a recent backup before relying on recovery."}</p></article></div><div className="panel"><div className="eyebrow dark">OWNER ACCESS AUDIT</div><h3>Access controls active</h3><p>Owner status is assigned server-side using OWNER_EMAIL. This page calls an endpoint protected by authentication, MFA, and owner-role checks. Regular users must not receive owner privileges.</p><button className="primary" onClick={load}>Refresh service status</button><p><small>Checked: {health.timestamp ? new Date(health.timestamp).toLocaleString() : "just now"}</small></p></div></>}
  </section>;
}
