import { useEffect, useState } from "react";
import api from "./api.js";

const emptyForm = { institutionId:"", fullName:"", studentNumber:"", department:"", course:"", academicYear:"", admissionYear:String(new Date().getFullYear()), message:"" };

export default function StudentAdmissions({ memberships = [], adminInstitutions = [] }) {
  const [institutions,setInstitutions]=useState([]);
  const [applications,setApplications]=useState([]);
  const [form,setForm]=useState(emptyForm);
  const [notes,setNotes]=useState({});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [consent,setConsent]=useState(false);
  const isAdmin=adminInstitutions.length>0;
  const hasMembership=memberships.some(item=>item.status==="active");
  const showStudentApply=!isAdmin&&!hasMembership;

  async function load(){
    setError("");
    try{
      if(showStudentApply){
        const [directory,mine]=await Promise.all([
          api("/api/admissions/institutions",{cache:"no-store"}),
          api("/api/admissions/mine",{cache:"no-store"})
        ]);
        setInstitutions(directory.institutions||[]);
        setApplications(mine.applications||[]);
        setForm(current=>({...current,institutionId:current.institutionId||directory.institutions?.[0]?.id||""}));
      }else if(isAdmin){
        const results=await Promise.all(adminInstitutions.map(item=>api(`/api/institutions/${encodeURIComponent(item.institutionId)}/admission-requests`,{cache:"no-store"})));
        setApplications(results.flatMap(result=>result.applications||[]));
      }
    }catch(err){setError(err.message||"Admission data could not be loaded.");}
  }
  useEffect(()=>{load();},[showStudentApply,isAdmin,adminInstitutions.map(x=>x.institutionId).join("|")]);

  const update=(key,value)=>setForm(current=>({...current,[key]:value}));
  async function submit(event){
    event.preventDefault();setBusy(true);setError("");setMessage("");
    try{
      await api("/api/admissions/applications",{method:"POST",body:JSON.stringify({...form,consent})});
      setForm(current=>({...emptyForm,institutionId:current.institutionId,admissionYear:String(new Date().getFullYear())}));
      setConsent(false);
      setMessage("Admission request submitted. Your college will review it.");
      await load();
    }catch(err){setError(err.message||"Admission request could not be submitted.");}
    finally{setBusy(false);}
  }
  async function withdraw(id){
    setBusy(true);setError("");setMessage("");
    try{await api(`/api/admissions/applications/${encodeURIComponent(id)}`,{method:"DELETE"});setMessage("Admission request withdrawn.");await load();}
    catch(err){setError(err.message||"Request could not be withdrawn.");}
    finally{setBusy(false);}
  }
  async function review(item,status){
    setBusy(true);setError("");setMessage("");
    try{
      await api(`/api/institutions/${encodeURIComponent(item.institutionId)}/admission-requests/${encodeURIComponent(item.id)}`,{
        method:"PATCH",body:JSON.stringify({status,reviewNote:notes[item.id]||""})
      });
      setMessage(status==="approved"?"Admission approved. Student is now in Student Management.":"Admission review updated.");
      await load();
    }catch(err){setError(err.message||"Admission decision could not be saved.");}
    finally{setBusy(false);}
  }
  if(!showStudentApply&&!isAdmin)return null;

  return <section className="panel collegeReviewPanel studentAdmissions">
    <div className="eyebrow dark">{isAdmin?"ADMISSION MANAGEMENT":"STUDENT ADMISSION"}</div>
    <h2>{isAdmin?"Admission Requests":"Apply for College Admission"}</h2>
    <p className="lead">{isAdmin?"Review student applications for your institution. Approval creates the student's institution membership and Student Management profile.":"Choose your college, enter your academic details and submit an admission request. Your account becomes a student member only after the college approves it."}</p>
    {showStudentApply&&<form className="collegeSubmissionForm" onSubmit={submit}>
      <label>College / Institution<select required value={form.institutionId} onChange={e=>update("institutionId",e.target.value)}><option value="">Choose institution</option>{institutions.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Full name<input required maxLength={120} value={form.fullName} onChange={e=>update("fullName",e.target.value)} /></label>
      <label>Student number (if already assigned)<input maxLength={40} value={form.studentNumber} onChange={e=>update("studentNumber",e.target.value)} /></label>
      <label>Department<input required maxLength={120} value={form.department} onChange={e=>update("department",e.target.value)} placeholder="e.g. Computer Science" /></label>
      <label>Course / Program<input required maxLength={120} value={form.course} onChange={e=>update("course",e.target.value)} placeholder="e.g. BCA" /></label>
      <label>Academic year<input required maxLength={32} value={form.academicYear} onChange={e=>update("academicYear",e.target.value)} placeholder="e.g. 2026-2027" /></label>
      <label>Admission year<input required maxLength={16} value={form.admissionYear} onChange={e=>update("admissionYear",e.target.value)} /></label>
      <label>Message (optional)<textarea rows={3} maxLength={500} value={form.message} onChange={e=>update("message",e.target.value)} /></label>
      <p className="collegePrivacyNote">Consent (student-admission-v1): I confirm that these details are submitted to the selected institution for admission review. The institution will see the details entered here. No Vault documents are shared by this form.</p>
      <label className="collegeConsent"><input type="checkbox" required checked={consent} onChange={e=>setConsent(e.target.checked)} />I confirm and consent to submit these admission details.</label>
      <button className="primary" type="submit" disabled={busy||!institutions.length||!consent}>{busy?"Submitting…":"Submit Admission Request"}</button>
    </form>}
    {isAdmin&&applications.length===0&&<p className="lead">No admission requests have been submitted yet.</p>}
    {applications.length>0&&<div className="collegeRequestList">{applications.map(item=><article className="collegeRequest" key={item.id}>
      <strong>{item.fullName||item.studentEmail}</strong><span className="collegeStatus">{item.status.replaceAll("_"," ")}</span>
      <small>{item.studentEmail||"Student account"} · {item.course} · {item.department} · {item.academicYear} · Admission {item.admissionYear}</small>
      {item.studentNumber&&<small>Student number: {item.studentNumber}</small>}{item.message&&<p>{item.message}</p>}{item.reviewNote&&<p>Review note: {item.reviewNote}</p>}
      {isAdmin&&["submitted","needs_correction"].includes(item.status)&&<div className="collegeReviewActions">
        <label>Review note<textarea rows={2} maxLength={500} value={notes[item.id]||""} onChange={e=>setNotes(current=>({...current,[item.id]:e.target.value}))} /></label>
        <div className="collegeReviewButtons"><button type="button" className="secondary" disabled={busy} onClick={()=>review(item,"needs_correction")}>Needs correction</button><button type="button" className="secondary" disabled={busy} onClick={()=>review(item,"rejected")}>Reject</button><button type="button" className="primary" disabled={busy} onClick={()=>review(item,"approved")}>Approve Admission</button></div>
      </div>}
      {showStudentApply&&["submitted","needs_correction"].includes(item.status)&&<button type="button" className="secondary" disabled={busy} onClick={()=>withdraw(item.id)}>Withdraw request</button>}
    </article>)}</div>}
    {error&&<p className="collegeAlert error" role="alert">{error}</p>}{message&&<p className="collegeAlert" role="status">{message}</p>}
  </section>;
}
