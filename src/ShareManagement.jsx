import { useEffect, useState } from "react";
import "./share-management.css";
import { api } from "./api.js";

function remaining(expiresAt) {
  const ms = Date.parse(expiresAt) - Date.now();
  if (ms <= 0) return "Expired";
  const total = Math.floor(ms / 1000);
  return `Expires in ${Math.floor(total / 60)}:${String(total % 60).padStart(2,"0")}`;
}
function ShareCard({share,onRevoke,onReissue,busy}) {
  const [time,setTime]=useState(remaining(share.expiresAt));
  const [recipientEmail,setRecipientEmail]=useState("");
  const [replacementLink,setReplacementLink]=useState("");
  const [reissuing,setReissuing]=useState(false);
  useEffect(()=>{const id=setInterval(()=>setTime(remaining(share.expiresAt)),1000);return()=>clearInterval(id)},[share.expiresAt]);
  const inactive=Boolean(share.revokedAt)||time==="Expired";
  const urgent=!inactive && /^Expires in 0:([0-5]\\d)$/.test(time);
  async function recreateShare(){
    setReissuing(true);
    try{
      const result=await onReissue(share,recipientEmail);
      if(result?.shareToken) setReplacementLink(new URL(`/${share.type==="identity"?"share":"document-share"}/${result.shareToken}`,window.location.origin).toString());
    }finally{setReissuing(false);}
  }
  async function copyReplacementLink(){
    try{await navigator.clipboard.writeText(replacementLink);}catch{}
  }
  return <article className={`managedShare ${inactive?"inactive":""} ${urgent?"urgent":""}`}>
    <div className="shareTypeIcon">{share.type==="identity"?"ID":"DOC"}</div>
    <div className="managedShareBody">
      <div className="managedShareTitle"><strong>{share.type==="identity"?"Identity share":"Document share"}</strong>{share.type==="identity"&&share.verificationBadge?.verified&&<span className="miniVerifiedBadge">✓ Verified</span>}{share.type==="document"&&<span>{share.name}</span>}<em className={inactive?"statusOff":"statusLive"}>{share.revokedAt?"Revoked":time==="Expired"?"Expired":"Active"}</em></div>
      {share.shareReason&&<div className="sharePurposeLine"><strong>Purpose:</strong> {share.shareReason}</div>}
      <div className="shareClaims">{share.type==="identity" ? `Shared: ${share.claims?.length ? share.claims.map(x=>x.replaceAll(/([A-Z])/g," $1").trim()).join(", ") : "Selected identity claims"}` : "Secure document access"}</div>
      <small>Created {new Date(share.createdAt).toLocaleString()} · {time}</small>
      <small>{share.recipientHint ? `One-time code protected · recipient ${share.recipientHint}` : "No recipient email is recorded for this older share."}</small>
      <small>{share.accessCount ? `Opened ${share.accessCount} time${share.accessCount===1?"":"s"} · Last opened ${new Date(share.accessedAt).toLocaleString()}` : "Not opened yet"}</small>
      {!share.recipientHint&&!share.revokedAt&&<div className="legacyShareReissue"><strong>Recreate with recipient protection</strong><small>Enter the intended recipient's email. The new link will expire in 15 minutes and require an emailed code.</small><input type="email" autoComplete="email" maxLength={254} value={recipientEmail} onChange={event=>setRecipientEmail(event.target.value)} placeholder="recipient@example.com" aria-label="Recipient email for replacement share"/><button className="primary" onClick={recreateShare} disabled={reissuing||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())}>{reissuing?"Creating…":"Create protected replacement"}</button>{replacementLink&&<div className="replacementShareLink"><code>{replacementLink}</code><button className="textButton" onClick={copyReplacementLink}>Copy new link</button></div>}</div>}
    </div>
    {!inactive&&<button className="textDangerButton" onClick={()=>onRevoke(share)} disabled={busy}>{busy?"Revoking…":"Revoke"}</button>}
  </article>
}
export default function ShareManagement(){
  const [shares,setShares]=useState([]),[loading,setLoading]=useState(true),[message,setMessage]=useState(""),[busy,setBusy]=useState("");
  async function load(showLoading=true){if(showLoading)setLoading(true);setMessage("");try{const d=await api("/api/security/shares");setShares(d.shares||[])}catch(e){setMessage(e.message)}finally{if(showLoading)setLoading(false)}}
  async function revoke(share){setBusy(share.id+"-"+share.type);try{await api("/api/security/shares/revoke",{method:"POST",body:JSON.stringify({id:share.id,type:share.type})});await load()}catch(e){setMessage(e.message)}finally{setBusy("")}}
  async function reissue(share,recipientEmail){
    setBusy(share.id+"-"+share.type);
    setMessage("");
    try{
      const d=await api("/api/security/shares/reissue",{method:"POST",body:JSON.stringify({id:share.id,type:share.type,recipientEmail})});
      await load(false);
      return d;
    }catch(e){setMessage(e.message);return null}finally{setBusy("")}
  }
  useEffect(()=>{load()},[]);
  const active=shares.filter(s=>!s.revokedAt&&Date.parse(s.expiresAt)>Date.now()).length;
  return <section className="content narrow"><div className="functionHero compact"><div><div className="eyebrow dark">SHARE MANAGEMENT</div><h2>Control every active share</h2><p>Review what you shared, when it expires, and whether the recipient has opened it.</p></div><div className="shareManageShield">↗</div></div><section className="panel"><div className="panelHead"><div><div className="eyebrow dark">SECURE SHARES</div><h2>{active} active share{active===1?"":"s"}</h2></div><button className="textButton" onClick={load} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button></div>{message&&<div className="vaultMessage">{message}</div>}{loading?<div className="activityEmpty">Loading your shares…</div>:shares.length===0?<div className="activityEmpty">No secure shares have been created yet.</div>:<div className="managedShareList">{shares.map(s=><ShareCard key={s.type+"-"+s.id} share={s} onRevoke={revoke} onReissue={reissue} busy={busy===s.id+"-"+s.type}/>)}</div>}</section></section>
}
