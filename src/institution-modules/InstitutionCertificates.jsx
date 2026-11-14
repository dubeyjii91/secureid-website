import {useEffect,useState} from "react";
import api from "../api.js";
export default function InstitutionCertificates({institutionId}){
 const [items,setItems]=useState([]),[form,setForm]=useState({certificateType:"bonafide",studentName:"",studentNumber:"",purpose:""}),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[issued,setIssued]=useState(null);
 async function load(){if(!institutionId)return;try{const r=await api(`/api/institutions/${encodeURIComponent(institutionId)}/certificates`,{cache:"no-store"});setItems(r.requests||[]);}catch(e){setError(e.message||"Certificate requests could not be loaded.");}}
 useEffect(()=>{load();},[institutionId]);
 async function run(fn,msg){setBusy(true);setError("");setNotice("");try{const r=await fn();setNotice(msg);await load();return r;}catch(e){setError(e.message||"Certificate action failed.");return null;}finally{setBusy(false);}}
 async function submit(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/certificates`,{method:"POST",body:JSON.stringify(form)}),"Certificate request submitted.");setForm({certificateType:"bonafide",studentName:"",studentNumber:"",purpose:""});}
 async function review(item,status){const note=status==="rejected"?(window.prompt("Reason for rejection")||""):"Record reviewed against institution data.";if(status==="rejected"&&note.length<5)return;await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/certificates/${encodeURIComponent(item.id)}`,{method:"PATCH",body:JSON.stringify({status,reviewNote:note})}),"Certificate request reviewed.");}
 async function issue(item){const r=await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/certificates/${encodeURIComponent(item.id)}/issue`,{method:"POST",body:JSON.stringify({})}),"Certificate issued. Save the verification link shown below.");if(r?.certificate)setIssued(r.certificate);}
 function openDocument(item){window.open(`/api/institutions/${encodeURIComponent(institutionId)}/certificates/${encodeURIComponent(item.certificateId)}/document`,"_blank","noopener,noreferrer");}
 return <section className="institutionCertificatesWorkspace">
  <p className="lead">Request, review, issue and verify bonafide, character, transfer and fee-clearance certificates.</p>
  <form className="collegeSubmissionForm" onSubmit={submit}><h3>Request certificate</h3>
   <label>Certificate type<select value={form.certificateType} onChange={e=>setForm(v=>({...v,certificateType:e.target.value}))}><option value="bonafide">Bonafide</option><option value="character">Character</option><option value="transfer">Transfer</option><option value="fee_clearance">Fee clearance</option></select></label>
   <label>Student legal name<input required minLength="2" maxLength="120" value={form.studentName} onChange={e=>setForm(v=>({...v,studentName:e.target.value}))}/></label>
   <label>Student / roll number<input required minLength="2" maxLength="60" value={form.studentNumber} onChange={e=>setForm(v=>({...v,studentNumber:e.target.value}))}/></label>
   <label>Purpose<input required minLength="5" maxLength="300" value={form.purpose} onChange={e=>setForm(v=>({...v,purpose:e.target.value}))}/></label>
   <button className="primary" disabled={busy}>Submit request</button>
  </form>
  {issued&&<article className="collegeRequest"><strong>Certificate issued · {issued.serialNumber}</strong><p>Verification link: <a href={issued.verificationPath} target="_blank" rel="noreferrer">{issued.verificationPath}</a></p><small>Keep this verification link. It is a one-time secret and cannot be recovered from the database.</small></article>}
  <h3>Certificate requests</h3>
  {items.length===0?<p>No certificate requests.</p>:<div className="collegeRequestList">{items.map(item=><article className="collegeRequest" key={item.id}><strong>{item.certificateType.replaceAll("_"," ")} · {item.studentName}</strong><small>{item.studentEmail} · Student no. {item.studentNumber} · {item.purpose}</small><span className="collegeStatus">{item.status}</span>{item.reviewNote&&<small>Review: {item.reviewNote}</small>}<div className="institutionModuleHeader">
   {item.status==="pending"&&<><button className="secondary" disabled={busy} onClick={()=>review(item,"approved")}>Approve</button><button className="secondary" disabled={busy} onClick={()=>review(item,"rejected")}>Reject</button></>}
   {item.status==="approved"&&<button className="primary" disabled={busy} onClick={()=>issue(item)}>Issue certificate</button>}
   {item.status==="issued"&&<><button className="secondary" onClick={()=>openDocument(item)}>Open printable certificate</button><small>Serial: {item.serialNumber} · {item.issuedAt}</small></>}
  </div></article>)}</div>}
  {busy&&<p>Saving certificate request…</p>}{error&&<p className="collegeAlert error" role="alert">{error}</p>}{notice&&<p className="collegeAlert" role="status">{notice}</p>}
 </section>;
}
