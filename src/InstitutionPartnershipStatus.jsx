import { useEffect, useState } from "react";
import api from "./api.js";

const statusLabel = value => ({connected:"Connected",not_connected:"Not connected",suspended:"Suspended",verified:"Verified",pending:"Pending",rejected:"Rejected",signed:"Signed",draft:"Draft",not_required:"Not required",failed:"Failed"})[value] || value || "Pending";
const tone = value => value==="connected"||value==="verified"||value==="signed"?"#16834a":value==="rejected"||value==="failed"||value==="suspended"?"#b42318":"#946200";

export default function InstitutionPartnershipStatus() {
  const [items,setItems] = useState([]);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);
  useEffect(()=>{
    let cancelled=false;
    async function load(){
      try{
        const memberships=await api("/api/institutions/memberships",{cache:"no-store"});
        const admins=(memberships.memberships||[]).filter(item=>item.role==="institution_admin"&&item.status==="active");
        const results=await Promise.allSettled(admins.map(item=>api("/api/institutions/"+encodeURIComponent(item.institutionId)+"/partnership-status",{cache:"no-store"})));
        if(cancelled)return;
        setItems(results.filter(r=>r.status==="fulfilled").map(r=>r.value));
        const failed=results.find(r=>r.status==="rejected");
        if(failed)setError(failed.reason?.message||"Some institution partnership statuses could not be loaded.");
      }catch(e){if(!cancelled)setError(e.message||"Partnership status could not be loaded.");}
      finally{if(!cancelled)setLoading(false);}
    }
    load();
    return ()=>{cancelled=true;};
  },[]);
  if(loading)return <section className="panel"><p>Loading institution partnership status…</p></section>;
  if(!items.length&&!error)return null;
  return <section className="panel" aria-label="SecureID institution partnership status">
    <div className="eyebrow dark">SECUREID PARTNERSHIP STATUS</div>
    <h3>Your institution's SecureID connection</h3>
    <p>These statuses are based on checks recorded by SecureID. A pilot is not a paid subscription, and a selected API/ERP method is not proof of a tested integration.</p>
    {error&&<p role="status">{error}</p>}
    {items.map(item=><article key={item.institution.id} style={{border:"1px solid var(--border,#ddd)",borderRadius:12,padding:14,marginTop:10}}>
      <h4>{item.institution.name}</h4>
      <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
        <span><strong>Connection:</strong> <span style={{color:tone(item.profile.connectionStatus)}}>{statusLabel(item.profile.connectionStatus)}</span></span>
        <span><strong>Identity:</strong> <span style={{color:tone(item.profile.identityStatus)}}>{statusLabel(item.profile.identityStatus)}</span></span>
        <span><strong>Representative:</strong> <span style={{color:tone(item.profile.representativeStatus)}}>{statusLabel(item.profile.representativeStatus)}</span></span>
        <span><strong>Agreement:</strong> <span style={{color:tone(item.profile.agreementStatus)}}>{statusLabel(item.profile.agreementStatus)}</span></span>
        <span><strong>Payment:</strong> <span style={{color:tone(item.profile.paymentStatus)}}>{statusLabel(item.profile.paymentStatus)}</span></span>
      </div>
      <p><strong>Subscription:</strong> {item.subscription?.planKey||"Not configured"} · {item.subscription?.status||"none"} · <strong>Active members:</strong> {item.readiness?.connected?"Workspace connected":"Connection pending"}</p>
    </article>)}
  </section>;
}
