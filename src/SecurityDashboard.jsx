import { useEffect, useState } from "react";
import "./security-dashboard.css";
import api from "./api.js";
export default function SecurityDashboard(){
  const [data,setData]=useState(null),[privacy,setPrivacy]=useState(null),[health,setHealth]=useState(null),[message,setMessage]=useState(""),[loading,setLoading]=useState(true);
  async function load(){
    setLoading(true);setMessage("");
    try{
      const [dashboard,privacyResult,healthResult]=await Promise.all([api("/api/security/dashboard"),api("/api/privacy"),api("/api/health")]);
      setData(dashboard);setPrivacy(privacyResult.settings);setHealth(healthResult);
    }catch(e){setMessage(e.message)}finally{setLoading(false)}
  }
  useEffect(()=>{load()},[]);
  async function savePrivacy(next){
    setPrivacy(next);setMessage("");
    try{const r=await api("/api/privacy",{method:"PUT",body:JSON.stringify(next)});setPrivacy(r.settings);setMessage("Privacy settings saved.");}
    catch(e){setMessage(e.message)}
  }
  if(loading)return <section className="content narrow"><div className="panel activityEmpty">Loading security dashboard…</div></section>;
  return <section className="content narrow">
    <div className="functionHero compact"><div><div className="eyebrow dark">SECURITY DASHBOARD</div><h2>Your SecureID overview</h2><p>Review your security score, active sessions, shares and privacy controls.</p></div><div className="dashboardScore"><strong>{data?.score ?? 0}</strong><span>/100</span><small>{data?.scoreLabel || "Review"}</small></div></div>
    {message&&<div className="vaultMessage">{message}</div>}
    <div className="dashboardGrid">
      <article className="panel scorePanel"><div className="eyebrow dark">SECURITY SCORE</div><h3>{data?.score ?? 0}/100</h3><p>{data?.scoreLabel}. Keep MFA enabled, recovery codes available and unused sessions under control.</p></article>
      <article className="panel"><div className="eyebrow dark">SECURITY STATUS</div><div className="securityStats"><span><b>{data?.stats?.activeSessions||0}</b> active sessions</span><span><b>{data?.stats?.activeShares||0}</b> active shares</span><span><b>{data?.stats?.documents||0}</b> protected documents</span><span><b>{data?.stats?.recoveryCodesRemaining||0}</b> recovery codes left</span></div></article>
    </div>
    <section className="panel systemHealthPanel">
      <div className="eyebrow dark">SYSTEM HEALTH</div>
      <h3>SecureID services</h3>
      <div className="systemHealthGrid">
        <div><span>API status</span><strong className="healthOk">{health?.status === "ready" ? "Operational" : "Check required"}</strong></div>
        <div><span>Database</span><strong className="healthOk">{health?.database === "ok" ? "Healthy" : "Check required"}</strong></div>
        <div><span>Email verification</span><strong>{health?.emailDelivery?.testSender ? "Test sender only" : health?.emailDelivery?.configured ? `${health.emailDelivery.provider} set · delivery unverified` : "Setup required"}</strong></div>
        <div><span>Encrypted backups</span><strong>{health?.backup?.enabled ? (health.backup.lastSuccessAt ? "Active" : "Scheduled") : "Not configured"}</strong></div>
        <div><span>Operational alerts</span><strong className={health?.operationalAlerting ? "healthOk" : ""}>{health?.operationalAlerting ? "Configured" : "Configure alert email"}</strong></div>
      </div>
      {health?.emailDelivery?.configured && <small className="healthMeta">A configured provider does not confirm inbox delivery. Verify the sender domain and check provider delivery events.</small>}
      {health?.backup?.lastSuccessAt && <small className="healthMeta">Last encrypted backup: {new Date(health.backup.lastSuccessAt).toLocaleString()}</small>}
    </section>
    <section className="panel"><div className="eyebrow dark">PRIVACY CENTER</div><h3>Control security and privacy notifications</h3><div className="privacyList">
      {privacy&&[["security_alerts","Security alerts","Show important SecureID security alerts."],["login_notifications","Login notifications","Notify you about successful sign-ins."],["share_notifications","Share notifications","Allow notifications related to secure sharing."],["analytics","Optional analytics","Allow non-essential product analytics."]].map(([key,title,desc])=><label className="privacyRow" key={key}><span><b>{title}</b><small>{desc}</small></span><input type="checkbox" checked={Boolean(privacy[key])} onChange={e=>savePrivacy({...privacy,[key]:e.target.checked?1:0})}/></label>)}
    </div></section>
  </section>;
}
