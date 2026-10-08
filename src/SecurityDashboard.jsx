import { useEffect, useState } from "react";
import "./security-dashboard.css";

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
  const [data,setData]=useState(null),[notifications,setNotifications]=useState([]),[privacy,setPrivacy]=useState(null),[message,setMessage]=useState(""),[loading,setLoading]=useState(true);
  async function load(){
    setLoading(true);setMessage("");
    try{
      const [dashboard,n,privacyResult]=await Promise.all([api("/api/security/dashboard"),api("/api/security/notifications"),api("/api/privacy")]);
      setData(dashboard);setNotifications(n.notifications||[]);setPrivacy(privacyResult.settings);
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
    <section className="panel"><div className="panelHead"><div><div className="eyebrow dark">NOTIFICATIONS</div><h3>Security alerts</h3></div><button className="textButton" onClick={load}>Refresh</button></div>{notifications.length===0?<div className="activityEmpty">No security notifications.</div>:<div className="notificationList">{notifications.map(n=><button className={n.readAt?"notification read":"notification"} key={n.id} onClick={()=>markRead(n.id)}><span className="notificationDot"/><span><strong>{n.title}</strong><small>{n.message}</small><em>{new Date(n.createdAt).toLocaleString()}</em></span></button>)}</div>}</section>
    <section className="panel"><div className="eyebrow dark">PRIVACY CENTER</div><h3>Control security and privacy notifications</h3><div className="privacyList">
      {privacy&&[["security_alerts","Security alerts","Show important SecureID security alerts."],["login_notifications","Login notifications","Notify you about successful sign-ins."],["share_notifications","Share notifications","Allow notifications related to secure sharing."],["analytics","Optional analytics","Allow non-essential product analytics."]].map(([key,title,desc])=><label className="privacyRow" key={key}><span><b>{title}</b><small>{desc}</small></span><input type="checkbox" checked={Boolean(privacy[key])} onChange={e=>savePrivacy({...privacy,[key]:e.target.checked?1:0})}/></label>)}
    </div></section>
  </section>;
}