import {useEffect,useState} from "react";
import api from "../api.js";
export default function InstitutionHR({institutionId,staff=[]}){
 const [leave,setLeave]=useState([]),[form,setForm]=useState({leaveType:"casual",startsOn:"",endsOn:"",reason:""}),[linkEmail,setLinkEmail]=useState({}),[attendanceDate,setAttendanceDate]=useState(new Date().toISOString().slice(0,10)),[attendance,setAttendance]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function load(){if(!institutionId)return;try{const r=await api(`/api/institutions/${encodeURIComponent(institutionId)}/hr/leave`,{cache:"no-store"});setLeave(r.requests||[]);}catch(e){setError(e.message||"HR requests could not be loaded.");}}
 async function loadAttendance(){try{const r=await api(`/api/institutions/${encodeURIComponent(institutionId)}/hr/attendance?date=${encodeURIComponent(attendanceDate)}`,{cache:"no-store"});setAttendance(r.attendance||[]);}catch(e){setAttendance([]);}}
 useEffect(()=>{load();},[institutionId]);useEffect(()=>{loadAttendance();},[institutionId,attendanceDate]);
 async function run(fn,msg){setBusy(true);setError("");setNotice("");try{await fn();setNotice(msg);await load();await loadAttendance();}catch(e){setError(e.message||"HR action failed.");}finally{setBusy(false);}}
 async function linkAccount(s){const email=linkEmail[s.id]||s.email||"";await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/staff/${encodeURIComponent(s.id)}/link-account`,{method:"POST",body:JSON.stringify({email})}),"Staff account linked by verified email.");}
 async function submitLeave(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/hr/leave`,{method:"POST",body:JSON.stringify(form)}),"Leave request submitted.");setForm({leaveType:"casual",startsOn:"",endsOn:"",reason:""});}
 async function review(item,status){const note=status==="rejected"?(window.prompt("Reason for rejection")||""):"Approved by institution administration.";if(status==="rejected"&&note.length<5)return;await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/hr/leave/${encodeURIComponent(item.id)}`,{method:"PATCH",body:JSON.stringify({status,reviewNote:note})}),"Leave request reviewed.");}
 async function mark(staffId,status){await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/hr/attendance/${encodeURIComponent(staffId)}`,{method:"PUT",body:JSON.stringify({date:attendanceDate,status})}),"Staff attendance saved.");}
 return <section className="institutionHRWorkspace">
  <p className="lead">Link verified staff accounts, process leave requests and record daily staff attendance. Payroll exports can use these approved HR records once institution pay rules are configured.</p>
  <h3>Link staff accounts</h3>
  {staff.map(s=><article className="collegeRequest" key={s.id}><strong>{s.fullName}</strong><small>{s.email||"No email"} · {s.employeeCode||"No employee code"} · {s.status}</small><div className="institutionModuleHeader"><input type="email" placeholder="Staff login email" value={linkEmail[s.id]??s.email??""} onChange={e=>setLinkEmail(v=>({...v,[s.id]:e.target.value}))}/><button className="secondary" disabled={busy||s.status!=="active"} onClick={()=>linkAccount(s)}>Link matching account</button></div></article>)}
  <form className="collegeSubmissionForm" onSubmit={submitLeave}><h3>Request staff leave</h3>
   <label>Leave type<select value={form.leaveType} onChange={e=>setForm(v=>({...v,leaveType:e.target.value}))}><option value="casual">Casual</option><option value="sick">Sick</option><option value="earned">Earned</option><option value="duty">Duty</option><option value="unpaid">Unpaid</option><option value="other">Other</option></select></label>
   <label>From<input required type="date" value={form.startsOn} onChange={e=>setForm(v=>({...v,startsOn:e.target.value}))}/></label>
   <label>To<input required type="date" value={form.endsOn} onChange={e=>setForm(v=>({...v,endsOn:e.target.value}))}/></label>
   <label>Reason<textarea required minLength="5" maxLength="1000" value={form.reason} onChange={e=>setForm(v=>({...v,reason:e.target.value}))}/></label>
   <button className="primary" disabled={busy}>Submit leave request</button>
  </form>
  <h3>Leave approvals</h3>
  {leave.length===0?<p>No leave requests.</p>:leave.map(item=><article className="collegeRequest" key={item.id}><strong>{item.staffName} · {item.leaveType}</strong><small>{item.employeeCode||"No employee code"} · {item.startsOn} to {item.endsOn} · {item.reason}</small><span className="collegeStatus">{item.status}</span>{item.status==="pending"&&<div className="institutionModuleHeader"><button className="secondary" disabled={busy} onClick={()=>review(item,"approved")}>Approve</button><button className="secondary" disabled={busy} onClick={()=>review(item,"rejected")}>Reject</button></div>}</article>)}
  <h3>Daily staff attendance</h3><label>Attendance date<input type="date" value={attendanceDate} onChange={e=>setAttendanceDate(e.target.value)}/></label>
  {staff.filter(s=>s.status==="active").map(s=>{const saved=attendance.find(a=>a.staffId===s.id);return <article className="collegeRequest" key={s.id}><strong>{s.fullName}</strong><small>{s.employeeCode||"No employee code"} · Recorded: {saved?.status||"Not marked"}</small><div className="institutionModuleHeader">{["present","absent","late","leave","holiday"].map(status=><button key={status} className="secondary" disabled={busy} onClick={()=>mark(s.id,status)}>{status}</button>)}</div></article>;})}
  {busy&&<p>Saving HR record…</p>}{error&&<p className="collegeAlert error" role="alert">{error}</p>}{notice&&<p className="collegeAlert" role="status">{notice}</p>}
 </section>;
}
