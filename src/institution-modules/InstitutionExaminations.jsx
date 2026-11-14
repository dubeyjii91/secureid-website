import {useEffect,useState} from "react";
import api from "../api.js";
export default function InstitutionExaminations({institutionId,students=[]}){
 const [data,setData]=useState({exams:[],registrations:[],subjects:[],marks:[],institutionName:"Institution",institutionType:"college",canManageSettings:false,canDownloadAdmitCards:false});
 const [examForm,setExamForm]=useState({title:"",academicYear:"2026-27",term:"",registrationOpenAt:"",registrationCloseAt:"",startsAt:"",endsAt:"",feeClearanceRequired:true});
 const [subjectForm,setSubjectForm]=useState({examId:"",subjectCode:"",title:"",examDate:"",startsAt:"",endsAt:"",venue:"",totalMarks:"100",passingMarks:"40"});
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function load(){if(!institutionId)return;try{const r=await api(`/api/institutions/${encodeURIComponent(institutionId)}/examinations`,{cache:"no-store"});setData({exams:r.exams||[],registrations:r.registrations||[],subjects:r.subjects||[],marks:r.marks||[],institutionName:r.institutionName||"Institution",institutionType:r.institutionType||"college",canManageSettings:!!r.canManageSettings,canDownloadAdmitCards:!!r.canDownloadAdmitCards});setSubjectForm(v=>({...v,examId:(r.exams||[]).some(x=>x.id===v.examId)?v.examId:(r.exams||[]).find(x=>["draft","registration_open"].includes(x.status))?.id||""}));}catch(e){setError(e.message||"Examination data could not be loaded.");}}
 useEffect(()=>{load();},[institutionId]);
 async function run(fn,msg){setBusy(true);setError("");setNotice("");try{await fn();setNotice(msg);await load();}catch(e){setError(e.message||"Examination action failed.");}finally{setBusy(false);}}
 async function createExam(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/examinations`,{method:"POST",body:JSON.stringify({...examForm,registrationOpenAt:examForm.registrationOpenAt?new Date(examForm.registrationOpenAt).toISOString():"",registrationCloseAt:examForm.registrationCloseAt?new Date(examForm.registrationCloseAt).toISOString():"",startsAt:new Date(examForm.startsAt).toISOString(),endsAt:new Date(examForm.endsAt).toISOString()})}),"Examination created.");}
 async function addSubject(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/examinations/${encodeURIComponent(subjectForm.examId)}/subjects`,{method:"POST",body:JSON.stringify({...subjectForm,startsAt:new Date(subjectForm.startsAt).toISOString(),endsAt:new Date(subjectForm.endsAt).toISOString()})}),"Subject added.");setSubjectForm(v=>({...v,subjectCode:"",title:"",venue:""}));}
 async function saveInstitutionType(e){e.preventDefault();const institutionType=e.currentTarget.elements.institutionType.value;await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/examinations/settings`,{method:"PATCH",body:JSON.stringify({institutionType})}),"Institution type updated.");}
 async function transition(exam,status){await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/examinations/${encodeURIComponent(exam.id)}/status`,{method:"PATCH",body:JSON.stringify({status})}),"Examination status updated.");}
 async function register(exam){await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/examinations/${encodeURIComponent(exam.id)}/register`,{method:"POST",body:JSON.stringify({})}),"Examination registration submitted.");}
 async function approve(reg){const roll=window.prompt("Assign roll number for this student");if(!roll)return;await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/examinations/${encodeURIComponent(reg.examId)}/registrations/${encodeURIComponent(reg.id)}`,{method:"PATCH",body:JSON.stringify({status:"approved",rollNumber:roll})}),"Registration approved and roll number assigned.");}
 async function assignSeat(reg){const venue=window.prompt("Examination venue");if(!venue)return;const room=window.prompt("Room number");if(!room)return;const seatNumber=window.prompt("Seat number");if(!seatNumber)return;await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/examinations/${encodeURIComponent(reg.examId)}/seating`,{method:"POST",body:JSON.stringify({registrationId:reg.id,venue,room,seatNumber})}),"Examination seat assigned.");}
 async function enterMarks(exam,subject,student){const value=window.prompt(`Enter marks out of ${(subject.totalMarksHundredths/100).toFixed(2)} for ${student.email}`);if(value===null||value.trim()==="")return;await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/examinations/${encodeURIComponent(exam.id)}/subjects/${encodeURIComponent(subject.id)}/marks/${encodeURIComponent(student.userId)}`,{method:"PUT",body:JSON.stringify({marks:Number(value)})}),"Marks saved.");}
 return <section className="institutionExaminationsWorkspace">
  <p className="lead">Manage examination schedules, registration, fee clearance, roll numbers, marks entry and publication of student results.</p>
  <form className="collegeSubmissionForm" onSubmit={createExam}><h3>Create examination</h3>
   <label>Exam title<input required value={examForm.title} onChange={e=>setExamForm(v=>({...v,title:e.target.value}))}/></label>
   <label>Academic year<input required value={examForm.academicYear} onChange={e=>setExamForm(v=>({...v,academicYear:e.target.value}))}/></label>
   <label>Term / semester<input value={examForm.term} onChange={e=>setExamForm(v=>({...v,term:e.target.value}))}/></label>
   <label>Registration opens<input type="datetime-local" value={examForm.registrationOpenAt} onChange={e=>setExamForm(v=>({...v,registrationOpenAt:e.target.value}))}/></label>
   <label>Registration closes<input type="datetime-local" value={examForm.registrationCloseAt} onChange={e=>setExamForm(v=>({...v,registrationCloseAt:e.target.value}))}/></label>
   <label>Exam starts<input required type="datetime-local" value={examForm.startsAt} onChange={e=>setExamForm(v=>({...v,startsAt:e.target.value}))}/></label>
   <label>Exam ends<input required type="datetime-local" value={examForm.endsAt} onChange={e=>setExamForm(v=>({...v,endsAt:e.target.value}))}/></label>
   <label><input type="checkbox" checked={examForm.feeClearanceRequired} onChange={e=>setExamForm(v=>({...v,feeClearanceRequired:e.target.checked}))}/> Require fee clearance before student registration</label>
   <button className="primary" disabled={busy}>Create examination</button>
  </form>
  <form className="collegeSubmissionForm" onSubmit={addSubject}><h3>Add exam subject</h3>
   <label>Examination<select required value={subjectForm.examId} onChange={e=>setSubjectForm(v=>({...v,examId:e.target.value}))}><option value="">Select draft / registration exam</option>{data.exams.filter(x=>["draft","registration_open"].includes(x.status)).map(x=><option key={x.id} value={x.id}>{x.title} · {x.academicYear}</option>)}</select></label>
   <label>Subject code<input required value={subjectForm.subjectCode} onChange={e=>setSubjectForm(v=>({...v,subjectCode:e.target.value}))}/></label>
   <label>Subject name<input required value={subjectForm.title} onChange={e=>setSubjectForm(v=>({...v,title:e.target.value}))}/></label>
   <label>Exam date<input required type="date" value={subjectForm.examDate} onChange={e=>setSubjectForm(v=>({...v,examDate:e.target.value}))}/></label>
   <label>Starts<input required type="datetime-local" value={subjectForm.startsAt} onChange={e=>setSubjectForm(v=>({...v,startsAt:e.target.value}))}/></label>
   <label>Ends<input required type="datetime-local" value={subjectForm.endsAt} onChange={e=>setSubjectForm(v=>({...v,endsAt:e.target.value}))}/></label>
   <label>Venue<input value={subjectForm.venue} onChange={e=>setSubjectForm(v=>({...v,venue:e.target.value}))}/></label>
   <label>Total marks<input required type="number" min="0.01" step="0.01" value={subjectForm.totalMarks} onChange={e=>setSubjectForm(v=>({...v,totalMarks:e.target.value}))}/></label>
   <label>Passing marks<input required type="number" min="0" step="0.01" value={subjectForm.passingMarks} onChange={e=>setSubjectForm(v=>({...v,passingMarks:e.target.value}))}/></label>
   <button className="primary" disabled={busy||!subjectForm.examId}>Add subject</button>
  </form>
  <h3>Examination calendar and lifecycle</h3>
  {data.exams.length===0?<p>No examinations created.</p>:<div className="collegeRequestList">{data.exams.map(exam=><article className="collegeRequest" key={exam.id}><strong>{exam.title} · {exam.academicYear}</strong><small>{exam.term||"Term not specified"} · {new Date(exam.startsAt).toLocaleString()} – {new Date(exam.endsAt).toLocaleString()}</small><span className="collegeStatus">{exam.status}</span><div className="institutionModuleHeader">
   {exam.status==="draft"&&<button className="secondary" disabled={busy} onClick={()=>transition(exam,"registration_open")}>Open registration</button>}
   {exam.status==="registration_open"&&<button className="secondary" disabled={busy} onClick={()=>transition(exam,"scheduled")}>Close registration / schedule</button>}
   {exam.status==="scheduled"&&<button className="secondary" disabled={busy} onClick={()=>transition(exam,"marks_entry")}>Start marks entry</button>}
   {exam.status==="marks_entry"&&<button className="secondary" disabled={busy} onClick={()=>transition(exam,"published")}>Publish results</button>}
   {exam.status==="registration_open"&&<button className="primary" disabled={busy} onClick={()=>register(exam)}>Register for exam</button>}
  </div>
  {data.subjects.filter(s=>s.examId===exam.id).map(subject=><div key={subject.id}><small>{subject.subjectCode} · {subject.title} · {subject.examDate} · {subject.venue||"Venue pending"} · Max {(subject.totalMarksHundredths/100).toFixed(2)}</small>{exam.status==="marks_entry"&&students.map(st=><button key={st.userId} className="secondary" disabled={busy} onClick={()=>enterMarks(exam,subject,st)}>Enter {st.email} marks</button>)}</div>)}
  </article>)}</div>}
  <h3>My registrations / student registrations</h3>
  {data.registrations.length===0?<p>No examination registrations.</p>:<div className="collegeRequestList">{data.registrations.map(r=><article className="collegeRequest" key={r.id}><strong>{r.examTitle}</strong><small>Roll number: {r.rollNumber||"Not assigned"}</small><span className="collegeStatus">{r.status}</span>{r.status==="registered"&&<button className="secondary" disabled={busy} onClick={()=>approve(r)}>Approve and assign roll number</button>}{r.status==="approved"&&data.canManageSettings&&<button className="secondary" disabled={busy} onClick={()=>assignSeat(r)}>Assign venue and seat</button>}{r.status==="approved"&&data.canDownloadAdmitCards&&<button className="primary" onClick={()=>window.open(`/api/institutions/${encodeURIComponent(institutionId)}/examinations/${encodeURIComponent(r.examId)}/admit-card?format=print`,"_blank","noopener,noreferrer")}>Print / Save admit card as PDF</button>}</article>)}</div>}
  {data.marks.length>0&&<><h3>Published results</h3>{data.marks.map(m=><p key={m.subjectId}>{m.subjectTitle}: {(m.marksHundredths/100).toFixed(2)} / {(m.totalMarksHundredths/100).toFixed(2)} · {(m.marksHundredths>=m.passingMarksHundredths*1)?"Pass":"Review"}</p>)}</>}
  {busy&&<p>Saving examination update…</p>}{error&&<p className="collegeAlert error" role="alert">{error}</p>}{notice&&<p className="collegeAlert" role="status">{notice}</p>}
 </section>;
}
