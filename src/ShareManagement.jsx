import { useEffect, useState } from "react";
import "./share-management.css";

function csrfToken(){
  const m=document.cookie.match(/(?:^|; )(?:__Host-secureid\.csrf|secureid\.csrf)=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}
function remaining(expiresAt) {
  const ms = Date.parse(expiresAt) - Date.now();
  if (ms <= 0) return "Expired";
  const total = Math.floor(ms / 1000);
  return `Expires in ${Math.floor(total / 60)}:${String(total % 60).padStart(2,"0")}`;
}
function ShareCard({share,onRevoke,busy}) {
  const [time,setTime]=useState(remaining(share.expiresAt));
  useEffect(()=>{const id=setInterval(()=>setTime(remaining(share.expiresAt)),1000);return()=>clearInterval(id)},[share.expiresAt]);
  const inactive=Boolean(share.revokedAt)||time==="Expired";
  const purpose=share.shareReason||share.contextLabel;
  const urgent=!inactive && /^Expires in 0:([0-5]\d)$/.test(time);
  return <article className={`managedShare ${inactive?"inactive":""} ${urgent?"urgent":""}`}>
    <div className="shareTypeIcon">{share.type==="identity"?"ID":"DOC"}</div>
    <div className="managedShareBody">
      <div className="managedShareTitle"><strong>{share.type==="identity"?"Identity share":"Document share"}</strong>{share.type==="identity"&&share.verificationBadge?.verified&&<span className="miniVerifiedBadge">✓ Verified</span>}{share.type==="document"&&<span>{share.name}</span>}<em className={inactive?"statusOff":"statusLive"}>{share.revokedAt?"Revoked":time==="Expired"?"Expired":"Active"}</em></div>
      {purpose&&<div className="sharePurposeLine"><strong>Purpose:</strong> {purpose}</div>}
      <div className="shareClaims">{share.type==="identity" ? `Shared: ${share.claims?.length ? share.claims.map(x=>x.replaceAll(/([A-Z])/g," $1").trim()).join(", ") : "Selected identity claims"}` : "Secure document access"}</div>
      <small>Created {new Date(share.createdAt).toLocaleString()} · {time}</small>
      <small>{share.accessCount ? `Opened ${share.accessCount} time${share.accessCount===1?"":"s"} · Last opened ${new Date(share.accessedAt).toLocaleString()}` : "Not opened yet"}</small>
    </div>
    {!inactive&&<button className="textDangerButton" onClick={()=>onRevoke(share)} disabled={busy}>{busy?"Revoking…":"Revoke"}</button>}
  </article>
}

const PROFILE_FIELDS = [
  ["name","Full name"],["age","Age"],["dateOfBirth","Date of birth"],["address","Address"],["email","Email"],["phone","Phone number"],["identityId","Identity ID"],["college","College / institution"],["studentId","Student ID"],["governmentId","Government ID"]
];
function IdentityProfileEditor(){
  const [profile,setProfile]=useState({});
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  useEffect(()=>{let active=true;fetch("/api/identity/profile",{credentials:"include",cache:"no-store"}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||"Unable to load identity profile.");if(active)setProfile(Object.fromEntries(PROFILE_FIELDS.map(([key])=>[key,String(d.profile?.[key]??"")])))}).catch(e=>{if(active)setMessage(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
  async function save(e){e.preventDefault();setSaving(true);setMessage("");try{const csrf=csrfToken();const r=await fetch("/api/identity/profile",{method:"PUT",credentials:"include",headers:{"Content-Type":"application/json",...(csrf?{"X-CSRF-Token":csrf}:{})},body:JSON.stringify(profile)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||"Unable to save identity profile.");setProfile(Object.fromEntries(PROFILE_FIELDS.map(([key])=>[key,String(d.profile?.[key]??"")])));setMessage("Identity profile saved securely. Return to Share ID and create a new share to include these values.")}catch(e){setMessage(e.message)}finally{setSaving(false)}}
  return <section className="panel identityProfileEditor"><div className="eyebrow dark">IDENTITY DETAILS FOR SHARING</div><h2>Manage your identity profile</h2><p>Save only the details you need. These values are encrypted by SecureID and are included in a share only when you select the matching claim.</p>{message&&<div className="vaultMessage" role="status">{message}</div>}{loading?<div className="activityEmpty">Loading your identity profile…</div>:<form onSubmit={save}><div className="identityProfileFields">{PROFILE_FIELDS.map(([key,label])=><label key={key}>{label}<input value={profile[key]||""} maxLength={500} autoComplete="off" onChange={e=>setProfile(p=>({...p,[key]:e.target.value}))} /></label>)}</div><button className="primary" type="submit" disabled={saving}>{saving?"Saving securely…":"Save identity profile"}</button></form>}</section>
}

export default function ShareManagement(){
  const [shares,setShares]=useState([]),[loading,setLoading]=useState(true),[message,setMessage]=useState(""),[busy,setBusy]=useState("");
  async function load(){setLoading(true);setMessage("");try{const r=await fetch("/api/security/shares",{credentials:"include"});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||"Unable to load shares.");setShares(d.shares||[])}catch(e){setMessage(e.message)}finally{setLoading(false)}}
  async function revoke(share){setBusy(share.id+"-"+share.type);try{const r=await fetch("/api/security/shares/revoke",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json",...(csrfToken()?{"X-CSRF-Token":csrfToken()}: {})},body:JSON.stringify({id:share.id,type:share.type})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||"Unable to revoke share.");await load()}catch(e){setMessage(e.message)}finally{setBusy("")}}
  useEffect(()=>{load()},[]);
  const active=shares.filter(s=>!s.revokedAt&&Date.parse(s.expiresAt)>Date.now()).length;
  return <section className="content narrow"><div className="functionHero compact"><div><div className="eyebrow dark">SHARE MANAGEMENT</div><h2>Control every active share</h2><p>Review what you shared, when it expires, and whether the recipient has opened it.</p></div><div className="shareManageShield">↗</div></div><IdentityProfileEditor/><section className="panel"><div className="panelHead"><div><div className="eyebrow dark">SECURE SHARES</div><h2>{active} active share{active===1?"":"s"}</h2></div><button className="textButton" onClick={load} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button></div>{message&&<div className="vaultMessage">{message}</div>}{loading?<div className="activityEmpty">Loading your shares…</div>:shares.length===0?<div className="activityEmpty">No secure shares have been created yet.</div>:<div className="managedShareList">{shares.map(s=><ShareCard key={s.type+"-"+s.id} share={s} onRevoke={revoke} busy={busy===s.id+"-"+s.type}/>)}</div>}</section></section>
}