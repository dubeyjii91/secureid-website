import { useState } from "react";
import api from "../api.js";

const emptyGuardian={fullName:"",relationship:"parent",email:"",phone:"",isPrimary:false};

export default function InstitutionStudents({institutionId,canManageStudents,students,profileDrafts,setProfileDrafts,saveStudentProfile,busy}){
 const [selectedStudentId,setSelectedStudentId]=useState("");
 const [guardians,setGuardians]=useState([]);
 const [canManageGuardians,setCanManageGuardians]=useState(false);
 const [history,setHistory]=useState([]);
 const [guardianDraft,setGuardianDraft]=useState(emptyGuardian);
 const [editingGuardianId,setEditingGuardianId]=useState("");
 const [loadingDetails,setLoadingDetails]=useState(false);
 const [savingGuardian,setSavingGuardian]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");

 async function loadDetails(userId){
  setSelectedStudentId(userId);setLoadingDetails(true);setError("");setNotice("");
  try{
   const [g,h]=await Promise.all([
    api(`/api/institutions/${encodeURIComponent(institutionId)}/students/${encodeURIComponent(userId)}/guardians`,{cache:"no-store"}),
    api(`/api/institutions/${encodeURIComponent(institutionId)}/students/${encodeURIComponent(userId)}/status-history`,{cache:"no-store"})
   ]);
   setGuardians(g.guardians||[]);setCanManageGuardians(!!g.canManage);setHistory(h.history||[]);
  }catch(err){setError(err.message||"Student lifecycle records could not be loaded.");}
  finally{setLoadingDetails(false);}
 }
 function editGuardian(item){
  setEditingGuardianId(item.id);
  setGuardianDraft({fullName:item.fullName,relationship:item.relationship,email:item.email||"",phone:item.phone||"",isPrimary:!!item.isPrimary});
 }
 async function saveGuardian(event){
  event.preventDefault();if(!selectedStudentId)return;
  setSavingGuardian(true);setError("");setNotice("");
  try{
   const path=`/api/institutions/${encodeURIComponent(institutionId)}/students/${encodeURIComponent(selectedStudentId)}/guardians`;
   await api(editingGuardianId?`${path}/${encodeURIComponent(editingGuardianId)}`:path,{method:editingGuardianId?"PATCH":"POST",body:JSON.stringify(guardianDraft)});
   setGuardianDraft(emptyGuardian);setEditingGuardianId("");setNotice(editingGuardianId?"Guardian contact updated.":"Guardian contact added.");
   await loadDetails(selectedStudentId);
  }catch(err){setError(err.message||"Guardian contact could not be saved.");}
  finally{setSavingGuardian(false);}
 }
 async function deleteGuardian(item){
  if(!window.confirm(`Delete guardian contact for ${item.fullName}?`))return;
  setSavingGuardian(true);setError("");setNotice("");
  try{
   await api(`/api/institutions/${encodeURIComponent(institutionId)}/students/${encodeURIComponent(selectedStudentId)}/guardians/${encodeURIComponent(item.id)}`,{method:"DELETE"});
   setNotice("Guardian contact deleted.");await loadDetails(selectedStudentId);
  }catch(err){setError(err.message||"Guardian contact could not be deleted.");}
  finally{setSavingGuardian(false);}
 }
 return <>
  <h3>Student directory</h3>
  <p className="collegePrivacyNote">Only students with active or institution-suspended memberships are listed. A suspended/withdrawn record blocks that student's institution access; changing status requires a reason and creates a permanent history entry.</p>
  {students.length===0?<p>No student memberships found.</p>:<div className="collegeRequestList">{students.map(s=><article className="collegeRequest" key={s.userId}>
   <strong>{s.email}</strong><small>Institution membership: {s.membershipStatus||"active"}</small>
   <div className="collegeSubmissionForm">
    <label>Student number<input disabled={!canManageStudents} value={profileDrafts[s.userId]?.studentNumber||""} onChange={e=>setProfileDrafts(v=>({...v,[s.userId]:{...v[s.userId],studentNumber:e.target.value}}))}/></label>
    <label>Department<input disabled={!canManageStudents} value={profileDrafts[s.userId]?.department||""} onChange={e=>setProfileDrafts(v=>({...v,[s.userId]:{...v[s.userId],department:e.target.value}}))}/></label>
    <label>Course / program<input disabled={!canManageStudents} value={profileDrafts[s.userId]?.program||""} onChange={e=>setProfileDrafts(v=>({...v,[s.userId]:{...v[s.userId],program:e.target.value}}))}/></label>
    <label>Academic year<input disabled={!canManageStudents} placeholder="2026-2027" value={profileDrafts[s.userId]?.academicYear||""} onChange={e=>setProfileDrafts(v=>({...v,[s.userId]:{...v[s.userId],academicYear:e.target.value}}))}/></label>
    <label>Record status<select disabled={!canManageStudents} value={profileDrafts[s.userId]?.status||"active"} onChange={e=>setProfileDrafts(v=>({...v,[s.userId]:{...v[s.userId],status:e.target.value}}))}><option value="active">Active</option><option value="graduated">Graduated</option><option value="suspended">Suspended — institution access blocked</option><option value="withdrawn">Withdrawn — institution access blocked</option></select></label>
    <label>Status-change reason<input disabled={!canManageStudents} minLength="5" maxLength="500" placeholder="Required only when changing status" value={profileDrafts[s.userId]?.statusReason||""} onChange={e=>setProfileDrafts(v=>({...v,[s.userId]:{...v[s.userId],statusReason:e.target.value}}))}/></label>
    {canManageStudents&&<button type="button" className="secondary" disabled={busy} onClick={()=>saveStudentProfile(s.userId)}>Save student record</button>}
    <button type="button" className="secondary" disabled={loadingDetails||savingGuardian} onClick={()=>selectedStudentId===s.userId?setSelectedStudentId(""):loadDetails(s.userId)}>{selectedStudentId===s.userId?"Close lifecycle records":"Manage guardians & status history"}</button>
   </div>
   {selectedStudentId===s.userId&&<section className="collegeRequestList">
    <h4>Guardian / parent contacts</h4>
    {loadingDetails?<p>Loading student records…</p>:guardians.length===0?<p>No guardian contacts have been added.</p>:guardians.map(item=><article className="collegeRequest" key={item.id}>
     <strong>{item.fullName} · {item.relationship}</strong>{item.isPrimary===1&&<span className="collegeStatus">Primary contact</span>}
     <small>{item.email||"No email"} · {item.phone||"No phone"}</small>
     {canManageGuardians&&<div className="institutionModuleHeader"><button type="button" className="secondary" disabled={savingGuardian} onClick={()=>editGuardian(item)}>Edit</button><button type="button" className="secondary" disabled={savingGuardian} onClick={()=>deleteGuardian(item)}>Delete</button></div>}
    </article>)}
    {canManageGuardians&&<form className="collegeSubmissionForm" onSubmit={saveGuardian}>
     <h4>{editingGuardianId?"Edit guardian contact":"Add guardian contact"}</h4>
     <label>Full name<input required minLength="2" maxLength="120" value={guardianDraft.fullName} onChange={e=>setGuardianDraft(v=>({...v,fullName:e.target.value}))}/></label>
     <label>Relationship<select value={guardianDraft.relationship} onChange={e=>setGuardianDraft(v=>({...v,relationship:e.target.value}))}><option value="parent">Parent</option><option value="guardian">Guardian</option><option value="spouse">Spouse</option><option value="sibling">Sibling</option><option value="other">Other</option></select></label>
     <label>Email<input type="email" maxLength="254" value={guardianDraft.email} onChange={e=>setGuardianDraft(v=>({...v,email:e.target.value}))}/></label>
     <label>Phone<input type="tel" maxLength="30" value={guardianDraft.phone} onChange={e=>setGuardianDraft(v=>({...v,phone:e.target.value}))}/></label>
     <label><input type="checkbox" checked={guardianDraft.isPrimary} onChange={e=>setGuardianDraft(v=>({...v,isPrimary:e.target.checked}))}/> Primary guardian contact</label>
     <div className="institutionModuleHeader"><button className="primary" disabled={savingGuardian}>{savingGuardian?"Saving…":"Save guardian"}</button><button type="button" className="secondary" disabled={savingGuardian} onClick={()=>{setGuardianDraft(emptyGuardian);setEditingGuardianId("");}}>Clear</button></div>
     <small>At least one guardian email or phone number is required. Only an institution administrator can edit these records.</small>
    </form>}
    <h4>Student status history</h4>
    {history.length===0?<p>No status changes recorded yet.</p>:history.map(item=><article className="collegeRequest" key={item.id}><strong>{item.fromStatus} → {item.toStatus}</strong><small>{new Date(item.changedAt).toLocaleString()} · {item.changedBy}</small><p>{item.reason}</p></article>)}
   </section>}
  </article>)}</div>}
  {error&&<p className="collegeAlert error" role="alert">{error}</p>}
  {notice&&<p className="collegeAlert" role="status">{notice}</p>}
 </>;
}
