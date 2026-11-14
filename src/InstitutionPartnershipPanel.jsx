import { useEffect, useState } from "react";
import api from "./api.js";

const initial = { aisheCode:"", institutionType:"", affiliation:"", officialWebsite:"", officialEmailDomain:"", address:"", representativeName:"", representativeTitle:"", representativeEmail:"", agreementReference:"", paymentReference:"", paymentAmountPaise:"", connectionMode:"dashboard", notes:"" };
const checks = [
  ["institution_identity","Institution identity"],
  ["representative_authority","Authorized representative"],
  ["partnership_agreement","Partnership agreement"],
  ["subscription_payment","Subscription payment"],
  ["technical_connection","Technical connection"]
];
const labels = { pending:"Pending", verified:"Verified", rejected:"Rejected", draft:"Draft", signed:"Signed", not_required:"Not required", failed:"Failed", not_connected:"Not connected", connected:"Connected", suspended:"Suspended" };
const statusColor = value => value === "verified" || value === "signed" || value === "connected" ? "#16834a" : value === "rejected" || value === "failed" || value === "suspended" ? "#b42318" : "#946200";

export default function InstitutionPartnershipPanel() {
  const [institutions,setInstitutions] = useState([]);
  const [institutionId,setInstitutionId] = useState("");
  const [form,setForm] = useState(initial);
  const [snapshot,setSnapshot] = useState(null);
  const [checkType,setCheckType] = useState(checks[0][0]);
  const [outcome,setOutcome] = useState("verified");
  const [evidenceReference,setEvidenceReference] = useState("");
  const [checkNotes,setCheckNotes] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");

  async function loadDirectory() {
    const result = await api("/api/admin/institutions",{cache:"no-store"});
    setInstitutions(result.institutions || []);
    setInstitutionId(current => current || result.institutions?.[0]?.id || "");
  }
  async function loadProfile(id) {
    if(!id){setSnapshot(null);setForm(initial);return;}
    const result = await api("/api/admin/institutions/"+encodeURIComponent(id)+"/partnership",{cache:"no-store"});
    setSnapshot(result);
    const p = result.profile || {};
    setForm({aisheCode:p.aisheCode||"",institutionType:p.institutionType||"",affiliation:p.affiliation||"",officialWebsite:p.officialWebsite||"",officialEmailDomain:p.officialEmailDomain||"",address:p.address||"",representativeName:p.representativeName||"",representativeTitle:p.representativeTitle||"",representativeEmail:p.representativeEmail||"",agreementReference:p.agreementReference||"",paymentReference:p.paymentReference||"",paymentAmountPaise:p.paymentAmountPaise==null?"":String(Number(p.paymentAmountPaise)/100),connectionMode:p.connectionMode||"dashboard",notes:p.notes||""});
  }
  useEffect(()=>{loadDirectory().catch(e=>setError(e.message||"Institution directory unavailable."));},[]);
  useEffect(()=>{if(institutionId)loadProfile(institutionId).catch(e=>setError(e.message||"Partnership profile unavailable."));},[institutionId]);

  async function saveProfile(event) {
    event.preventDefault();setBusy(true);setError("");setNotice("");
    try { const result=await api("/api/admin/institutions/"+encodeURIComponent(institutionId)+"/partnership",{method:"PUT",body:JSON.stringify({...form,paymentAmountPaise:form.paymentAmountPaise===""?null:Math.round(Number(form.paymentAmountPaise)*100)})});setSnapshot(result);setNotice("Institution profile saved. No verification status was granted."); }
    catch(e){setError(e.message||"Profile could not be saved.");} finally{setBusy(false);}
  }
  async function recordCheck(event) {
    event.preventDefault();setBusy(true);setError("");setNotice("");
    try { const result=await api("/api/admin/institutions/"+encodeURIComponent(institutionId)+"/partnership/checks",{method:"POST",body:JSON.stringify({checkType,outcome,evidenceReference,notes:checkNotes})});setSnapshot(result);setEvidenceReference("");setCheckNotes("");setNotice("Verification evidence recorded and audit trail updated."); }
    catch(e){setError(e.message||"Verification check could not be recorded.");} finally{setBusy(false);}
  }
  const field=(key,label,placeholder="",type="text")=><label style={{display:"grid",gap:5,fontSize:13}}>{label}<input type={type} value={form[key]} placeholder={placeholder} onChange={e=>setForm(current=>({...current,[key]:e.target.value}))} maxLength={key==="notes"?1000:500} /></label>;

  return <section className="panel" style={{marginTop:18}} aria-labelledby="institution-partnership-heading">
    <div className="eyebrow dark">INSTITUTION TRUST & CONNECTION</div>
    <h3 id="institution-partnership-heading">Institution partnership verification</h3>
    <p>College name, identity, representative authority, signed agreement, payment and technical connection are tracked separately. A name or membership alone never means a paid or connected partner.</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <label style={{display:"grid",gap:6,maxWidth:520}}>Select institution<select value={institutionId} onChange={e=>setInstitutionId(e.target.value)}><option value="">Choose institution</option>{institutions.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {institutionId&&<>
      {snapshot&&<div className="dashboardGrid" style={{marginTop:14}}>
        {checks.map(([key,title])=>{const p=snapshot.profile||{};const value=key==="institution_identity"?p.identityStatus:key==="representative_authority"?p.representativeStatus:key==="partnership_agreement"?p.agreementStatus:key==="subscription_payment"?p.paymentStatus:p.connectionStatus;return <article className="panel" key={key}><small>{title}</small><h4 style={{color:statusColor(value)}}>{labels[value]||value}</h4></article>;})}
      </div>}
      {snapshot&&<p><strong>Subscription:</strong> {snapshot.subscription?.planKey||"Not configured"} · {snapshot.subscription?.status||"none"} &nbsp; <strong>Workspace members:</strong> {snapshot.members?.active||0}/{snapshot.members?.total||0} active</p>}
      {snapshot&&<p><strong>Connection readiness:</strong> {snapshot.readiness?.canConnect?"All prerequisite checks passed":"Prerequisites incomplete"} · <strong>Actual connection:</strong> {snapshot.readiness?.connected?"Connected":"Not connected"}</p>}
      <form onSubmit={saveProfile} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12,marginTop:12}}>
        {field("aisheCode","AISHE code","Enter official AISHE code")}
        {field("institutionType","Institution type","University / College / Institute")}
        {field("affiliation","Affiliating university / regulator","Affiliation")}
        {field("officialWebsite","Official website","https://college.edu.in","url")}
        {field("officialEmailDomain","Official email domain","college.edu.in")}
        {field("representativeName","Authorized representative","Full name")}
        {field("representativeTitle","Representative designation","Principal / Registrar / Director")}
        {field("representativeEmail","Official representative email","name@college.edu.in","email")}
        {field("agreementReference","Signed agreement reference","Agreement ID / document reference")}
        {field("paymentReference","Payment transaction reference","UTR / bank reference")}
        {field("paymentAmountPaise","Payment amount (₹)","Amount","number")}
        <label style={{display:"grid",gap:5,fontSize:13}}>Connection method<select value={form.connectionMode} onChange={e=>setForm(current=>({...current,connectionMode:e.target.value}))}><option value="dashboard">SecureID dashboard</option><option value="csv">Secure CSV import</option><option value="api">API integration</option><option value="erp">College ERP integration</option></select></label>
        <label style={{display:"grid",gap:5,fontSize:13,gridColumn:"1/-1"}}>Institution address<textarea rows="2" value={form.address} onChange={e=>setForm(current=>({...current,address:e.target.value}))}/></label>
        <label style={{display:"grid",gap:5,fontSize:13,gridColumn:"1/-1"}}>Internal notes<textarea rows="2" value={form.notes} onChange={e=>setForm(current=>({...current,notes:e.target.value}))}/></label>
        <button className="primary" disabled={busy||!institutionId}>Save institution details</button>
      </form>
      <form onSubmit={recordCheck} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10,border:"1px solid var(--border,#ddd)",borderRadius:12,padding:14,marginTop:16}}>
        <strong style={{gridColumn:"1/-1"}}>Record independent verification evidence</strong>
        <label>Verification stage<select value={checkType} onChange={e=>setCheckType(e.target.value)}>{checks.map(([key,title])=><option key={key} value={key}>{title}</option>)}</select></label>
        <label>Result<select value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="verified">Verified</option><option value="pending">Pending</option><option value="rejected">Rejected</option></select></label>
        <label>Evidence reference<input required minLength={4} maxLength={240} value={evidenceReference} onChange={e=>setEvidenceReference(e.target.value)} placeholder="Official source / agreement / UTR / test report ID"/></label>
        <label>Non-sensitive notes<input maxLength={500} value={checkNotes} onChange={e=>setCheckNotes(e.target.value)} placeholder="What was checked and how"/></label>
        <button className="primary" disabled={busy||!institutionId||evidenceReference.trim().length<4}>Save verification result</button>
      </form>
      <p className="collegePrivacyNote">Important: SecureID does not automatically verify AISHE, college ownership, legal authority or bank settlement. The authorized SecureID operator must independently check the cited source and record evidence. A pilot is not a paid subscription. API/ERP is only a selected integration mode until its real endpoint and data-flow test are separately completed.</p>
      {snapshot?.evidence?.length>0&&<div style={{overflowX:"auto",marginTop:14}}><h4>Verification evidence history</h4><table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}><thead><tr><th style={{padding:8}}>Time</th><th style={{padding:8}}>Check</th><th style={{padding:8}}>Outcome</th><th style={{padding:8}}>Evidence reference</th><th style={{padding:8}}>Notes</th></tr></thead><tbody>{snapshot.evidence.map(item=><tr key={item.id}><td style={{padding:8,borderTop:"1px solid var(--border,#ddd)"}}>{new Date(item.checkedAt).toLocaleString()}</td><td style={{padding:8,borderTop:"1px solid var(--border,#ddd)"}}>{item.checkType.replaceAll("_"," ")}</td><td style={{padding:8,borderTop:"1px solid var(--border,#ddd)"}}>{item.outcome}</td><td style={{padding:8,borderTop:"1px solid var(--border,#ddd)"}}>{item.evidenceReference}</td><td style={{padding:8,borderTop:"1px solid var(--border,#ddd)"}}>{item.notes||"—"}</td></tr>)}</tbody></table></div>}
    </>}
  </section>;
}
