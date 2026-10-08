import { useEffect, useState } from "react";
import "./security-dashboard.css";

const coverage = [
  ["1","Security activity","Audit log is available","activity"],
  ["2","Active sessions","Device sessions can be reviewed/revoked","sessions"],
  ["3","Share management","Active shares, access and revoke controls","shares"],
  ["4","Account security","Password + MFA recovery controls","account"],
  ["5","QR secure share","Share QR is available from Share ID","share"],
  ["6","Share purpose","Purpose is stored with each share","share"],
  ["7","Verification badge","Server-attested verified-share badge","share"],
  ["8","Expiry UX","Live expiry/countdown and expired state","share"],
  ["9","Document verification","Student ID + institution proof status","documents"],
  ["10","Security dashboard","Central security overview","dashboard"],
  ["11","Security score","Live score from account security state","dashboard"],
  ["12","Security notifications","Alerts + unread tracking","dashboard"],
  ["13","Privacy center","Notification/privacy controls","dashboard"],
  ["14","Rate limiting","API and sensitive-route throttling active",null],
  ["15","CSRF protection","Same-origin + CSRF token checks active",null],
  ["16","Security headers","CSP + HSTS + restrictive headers active",null],
  ["17","Session expiration","Idle + absolute session expiry active",null],
  ["18","Brute-force protection","Failed sign-ins trigger account lockout","account"],
  ["19","Login/MFA monitoring","Failed auth events are monitored","account"],
  ["20","Encrypted backups","AES-256-GCM backup procedure/schedule","dashboard"],
  ["21","Health monitoring","API/database/backup health status","dashboard"],
  ["22","Safe error logging","Privacy-safe request error metadata","dashboard"],
];

function csrfToken(){
  const m=document.cookie.match(/(?:^|; )(?:__Host-secureid\.csrf|secureid\.csrf)=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}
async function api(path,options={}){
  const method=String(options.method||"GET").toUpperCase();
  const r=await fetch(path,{credentials:"include",...options,headers:{...(options.body?{"Content-Type":"application/json"}:{}),...(csrfToken()?{"X-CSRF-Token":csrfToken()}:{}),...(options.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.message||"Request failed.");
  return d;
}
export default function SecurityDashboard(){
  const [data,setData]=useState(null),[notifications,setNotifications]=useState([]),[privacy,setPrivacy]=useState(null),[health,setHealth]=useState(null),[message,setMessage]=useState(""),[loading,setLoading]=useState(true);
  async function load(){
    setLoading(true);setMessage("");
    try{
      const [dashboard,n,privacyResult,healthResult]=await Promise.all([api("/api/security/dashboard"),api("/api/security/notifications"),api("/api/privacy"),api("/api/health")]);
      setData(dashboard);setNotifications(n.notifications||[]);setPrivacy(privacyResult.settings);setHealth(healthResult);
    }catch(e){setMessage(e.message)}finally{setLoading(false)}
  }
  useEffect(()=>{load()},[]);
  async function savePrivacy(next){
    setPrivacy(next);setMessage("");
    try{const r=await api("/api/privacy",{method:"PUT",body:JSON.stringify(next)});setPrivacy(r.settings);setMessage("Privacy settings saved.");}
    catch(e){setMessage(e.message)}
  }
  async function markRead(id){
    try{await api("/api/security/notifications/read",{method:"POST",body:JSON.stringify({id})});setNotifications(x=>x.map(n=>n.id===id?{...n,readAt:Date.now()}:n));}catch{}
  }
  if(loading)return <section className="content narrow"><div className="panel activityEmpty">Loading security dashboard…</div></section>;
  return <section className="content narrow">
    <div className="functionHero compact"><div><div className="eyebrow dark">SECURITY DASHBOARD</div><h2>See your SecureID security at a glance</h2><p>Security score, sessions, shares, alerts and privacy controls in one place.</p></div><div className="dashboardScore"><strong>{data?.score ?? 0}</strong><span>/100</span><small>{data?.scoreLabel || "Review"}</small></div></div>
    {message&&<div className="vaultMessage">{message}</div>}
    <div className="dashboardGrid">
      <article className="panel scorePanel"><div className="eyebrow dark">SECURITY SCORE</div><h3>{data?.score ?? 0}/100</h3><p>{data?.scoreLabel}. Keep MFA enabled, recovery codes available and unused sessions under control.</p></article>
      <article className="panel"><div className="eyebrow dark">SECURITY STATUS</div><div className="securityStats"><span><b>{data?.stats?.activeSessions||0}</b> active sessions</span><span><b>{data?.stats?.activeShares||0}</b> active shares</span><span><b>{data?.stats?.documents||0}</b> protected documents</span><span><b>{data?.stats?.recoveryCodesRemaining||0}</b> recovery codes left</span></div></article>
    </div>
    <section className="panel"><div className="panelHead"><div><div className="eyebrow dark">NOTIFICATIONS</div><h3>Security alerts {notifications.filter(n=>!n.readAt).length>0 && <span className="unreadBadge">{notifications.filter(n=>!n.readAt).length} unread</span>}</h3></div><button className="textButton" onClick={load}>Refresh</button></div>{notifications.length===0?<div className="activityEmpty">No security notifications.</div>:<div className="notificationList">{notifications.map(n=><button className={n.readAt?"notification read":"notification"} key={n.id} onClick={()=>markRead(n.id)}><span className="notificationDot"/><span><strong>{n.title}</strong><small>{n.message}</small><em>{new Date(n.createdAt).toLocaleString()}</em></span></button>)}</div>}</section>
    <section className="panel systemHealthPanel">
      <div className="eyebrow dark">SYSTEM HEALTH</div>
      <h3>SecureID services</h3>
      <div className="systemHealthGrid">
        <div><span>API status</span><strong className="healthOk">{health?.status === "ready" ? "Operational" : "Check required"}</strong></div>
        <div><span>Database</span><strong className="healthOk">{health?.database === "ok" ? "Healthy" : "Check required"}</strong></div>
        <div><span>Encrypted backups</span><strong>{health?.backup?.enabled ? (health.backup.lastSuccessAt ? "Active" : "Scheduled") : "Not configured"}</strong></div>
      </div>
      {health?.backup?.lastSuccessAt && <small className="healthMeta">Last encrypted backup: {new Date(health.backup.lastSuccessAt).toLocaleString()}</small>}
    </section>

    <section className="panel coveragePanel">
      <div className="panelHead"><div><div className="eyebrow dark">SECURITY COVERAGE</div><h3>22-point protection status</h3></div></div>
      <p className="lead">These are the production security controls currently wired into SecureID. Open a linked area to manage the controls that have user-facing actions.</p>
      <div className="coverageGrid">
        {coverage.map(([n,title,desc,target])=><button key={n} className="coverageItem" onClick={()=>target && (window.dispatchEvent(new CustomEvent("secureid:navigate",{detail:target})))}>
          <span className="coverageNumber">{n}</span><span><strong>{title}</strong><small>{desc}</small></span><b>✓</b>
        </button>)}
      </div>
    </section>

    <section className="panel"><div className="eyebrow dark">PRIVACY CENTER</div><h3>Control security and privacy notifications</h3><div className="privacyList">
      {privacy&&[["security_alerts","Security alerts","Show important SecureID security alerts."],["login_notifications","Login notifications","Notify you about successful sign-ins."],["share_notifications","Share notifications","Allow notifications related to secure sharing."],["analytics","Optional analytics","Allow non-essential product analytics."]].map(([key,title,desc])=><label className="privacyRow" key={key}><span><b>{title}</b><small>{desc}</small></span><input type="checkbox" checked={Boolean(privacy[key])} onChange={e=>savePrivacy({...privacy,[key]:e.target.checked?1:0})}/></label>)}
    </div></section>
  </section>;
}