import { useEffect, useState } from "react";
import "./share-management.css";

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
  return <article className={`managedShare ${inactive?"inactive":""}`}>
    <div className="shareTypeIcon">{share.type==="identity"?"ID":"DOC"}</div>
    <div className="managedShareBody">
      <div className="managedShareTitle"><strong>{share.type==="identity"?"Identity share":"Document share"}</strong>{share.type==="identity"&&share.verificationBadge?.verified&&<span className="miniVerifiedBadge">✓ Verified</span>}{share.type==="document"&&<span>{share.name}</span>}<em className={inactive?"statusOff":"statusLive"}>{share.revokedAt?"Revoked":time==="Expired"?"Expired":"Active"}</em></div>
      {share.shareReason&&<div className="sharePurposeLine"><strong>Purpose:</strong> {share.shareReason}</div>}
      <div className="shareClaims">{share.type==="identity" ? `Shared: ${share.claims?.length ? share.claims.map(x=>x.replaceAll(/([A-Z])/g," $1").trim()).join(", ") : "Selected identity claims"}` : "Secure document access"}</div>
      <small>Created {new Date(share.createdAt).toLocaleString()} · {time}</small>
      <small>{share.accessCount ? `Opened ${share.accessCount} time${share.accessCount===1?"":"s"} · Last opened ${new Date(share.accessedAt).toLocaleString()}` : "Not opened yet"}</small>
    </div>
    {!inactive&&<button className="textDangerButton" onClick={()=>onRevoke(share)} disabled={busy}>{busy?"Revoking…":"Revoke"}</button>}
  </article>
}
export default function ShareManagement(){
  const [shares,setShares]=useState([]),[loading,setLoading]=useState(true),[message,setMessage]=useState(""),[busy,setBusy]=useState("");
  async function load(){setLoading(true);setMessage("");try{const r=await fetch("/api/security/shares",{credentials:"include"});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||"Unable to load shares.");setShares(d.shares||[])}catch(e){setMessage(e.message)}finally{setLoading(false)}}
  async function revoke(share){setBusy(share.id+"-"+share.type);try{const r=await fetch("/api/security/shares/revoke",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:share.id,type:share.type})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||"Unable to revoke share.");await load()}catch(e){setMessage(e.message)}finally{setBusy("")}}
  useEffect(()=>{load()},[]);
  const active=shares.filter(s=>!s.revokedAt&&Date.parse(s.expiresAt)>Date.now()).length;
  return <section className="content narrow"><div className="functionHero compact"><div><div className="eyebrow dark">SHARE MANAGEMENT</div><h2>Control every active share</h2><p>Review what you shared, when it expires, and whether the recipient has opened it.</p></div><div className="shareManageShield">↗</div></div><section className="panel"><div className="panelHead"><div><div className="eyebrow dark">SECURE SHARES</div><h2>{active} active share{active===1?"":"s"}</h2></div><button className="textButton" onClick={load} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button></div>{message&&<div className="vaultMessage">{message}</div>}{loading?<div className="activityEmpty">Loading your shares…</div>:shares.length===0?<div className="activityEmpty">No secure shares have been created yet.</div>:<div className="managedShareList">{shares.map(s=><ShareCard key={s.type+"-"+s.id} share={s} onRevoke={revoke} busy={busy===s.id+"-"+s.type}/>)}</div>}</section></section>
}