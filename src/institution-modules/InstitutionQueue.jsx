import { useEffect, useState } from "react";
import api from "../api.js";

export default function InstitutionQueue({ institutionId }) {
  const [counters,setCounters]=useState([]);
  const [tokens,setTokens]=useState([]);
  const [appointments,setAppointments]=useState([]);
  const [canBookAppointments,setCanBookAppointments]=useState(false);
  const [canManageAppointments,setCanManageAppointments]=useState(false);
  const [appointmentForm,setAppointmentForm]=useState({counterId:"",scheduledFor:"",purpose:""});
  const [counterForm,setCounterForm]=useState({department:"Administration",name:"Student Services"});
  const [purpose,setPurpose]=useState("");
  const [counterId,setCounterId]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  async function load() {
    if(!institutionId)return;
    setError("");
    try {
      const [result,appointmentResult]=await Promise.all([api(`/api/institutions/${encodeURIComponent(institutionId)}/queue`,{cache:"no-store"}),api(`/api/institutions/${encodeURIComponent(institutionId)}/appointments`,{cache:"no-store"})]);
      setCounters(result.counters||[]);
      setTokens(result.tokens||[]);
      setAppointments(appointmentResult.appointments||[]);
      setCanBookAppointments(!!appointmentResult.canBook);
      setCanManageAppointments(!!appointmentResult.canManage);
      setAppointmentForm(v=>({...v,counterId:(result.counters||[]).some(x=>x.id===v.counterId&&x.status==="active")?v.counterId:(result.counters||[]).find(x=>x.status==="active")?.id||""}));
      setCounterId(current=>(result.counters||[]).some(c=>c.id===current)?current:(result.counters||[]).find(c=>c.status==="active")?.id||"");
    } catch(err) { setError(err.message||"Queue data could not be loaded."); }
  }
  useEffect(()=>{load();},[institutionId]);

  async function run(action,success) {
    setBusy(true);setError("");setNotice("");
    try { await action();setNotice(success);await load(); }
    catch(err) { setError(err.message||"Queue action failed."); }
    finally { setBusy(false); }
  }
  async function createCounter(event) {
    event.preventDefault();
    await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/queue/counters`,{method:"POST",body:JSON.stringify(counterForm)}),"Service counter created.");
  }
  async function issueToken(event) {
    event.preventDefault();
    if(!counterId)return;
    await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/queue/counters/${encodeURIComponent(counterId)}/tokens`,{method:"POST",body:JSON.stringify({purpose})}),"Queue token issued.");
    setPurpose("");
  }
  async function callNext(id) {
    await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/queue/counters/${encodeURIComponent(id)}/call-next`,{method:"POST",body:JSON.stringify({})}),"Next waiting token called.");
  }
  async function setTokenStatus(token,status) {
    await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/queue/tokens/${encodeURIComponent(token.id)}`,{method:"PATCH",body:JSON.stringify({status})}),`Token #${token.tokenNumber} updated to ${status.replaceAll("_"," ")}.`);
  }
  async function setCounterStatus(counter,status) {
    await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/queue/counters/${encodeURIComponent(counter.id)}`,{method:"PATCH",body:JSON.stringify({status})}),`${counter.name} is now ${status}.`);
  }
  async function bookAppointment(event){event.preventDefault();if(!appointmentForm.counterId||!appointmentForm.scheduledFor)return;await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/appointments`,{method:"POST",body:JSON.stringify({...appointmentForm,scheduledFor:new Date(appointmentForm.scheduledFor).toISOString()})}),"Appointment request submitted.");setAppointmentForm(v=>({...v,scheduledFor:"",purpose:""}));}
  async function updateAppointment(item,status){const reviewNote=["rejected","cancelled"].includes(status)?(window.prompt("Add a short note for this appointment decision:")||""):"";if(["rejected","cancelled"].includes(status)&&reviewNote.trim().length<4)return;await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/appointments/${encodeURIComponent(item.id)}`,{method:"PATCH",body:JSON.stringify({status,reviewNote})}),`Appointment ${status.replaceAll("_"," ")}.`);}

  return <section className="institutionQueueWorkspace">
    <p className="lead">Issue numbered service tokens, monitor waiting students, call the next token and track each visit through completion.</p>
    <form className="collegeSubmissionForm" onSubmit={issueToken}>
      <h3>Get a service token</h3>
      <label>Department counter<select required value={counterId} onChange={e=>setCounterId(e.target.value)}><option value="">Choose a counter</option>{counters.filter(c=>c.status==="active").map(c=><option key={c.id} value={c.id}>{c.department} · {c.name}</option>)}</select></label>
      <label>Purpose of visit<input required minLength="3" maxLength="180" value={purpose} onChange={e=>setPurpose(e.target.value)} placeholder="e.g. Fee receipt correction"/></label>
      <button className="primary" disabled={busy||!counterId||purpose.trim().length<3}>Issue token</button>
    </form>
    {canBookAppointments&&<form className="collegeSubmissionForm" onSubmit={bookAppointment}><h3>Book a service appointment</h3><label>Department counter<select required value={appointmentForm.counterId} onChange={e=>setAppointmentForm(v=>({...v,counterId:e.target.value}))}><option value="">Choose a counter</option>{counters.filter(x=>x.status==="active").map(x=><option key={x.id} value={x.id}>{x.department} · {x.name}</option>)}</select></label><label>Appointment date and time<input required type="datetime-local" value={appointmentForm.scheduledFor} onChange={e=>setAppointmentForm(v=>({...v,scheduledFor:e.target.value}))}/></label><label>Purpose<input required minLength="3" maxLength="180" value={appointmentForm.purpose} onChange={e=>setAppointmentForm(v=>({...v,purpose:e.target.value}))} placeholder="e.g. Admission document review"/></label><button className="primary" disabled={busy||!appointmentForm.counterId||!appointmentForm.scheduledFor||appointmentForm.purpose.trim().length<3}>Request appointment</button></form>}
    <h3>Live service counters</h3>
    {counters.length===0?<p>No service counters have been configured yet.</p>:<div className="collegeRequestList">{counters.map(counter=><article className="collegeRequest" key={counter.id}>
      <strong>{counter.department} · {counter.name}</strong><span className="collegeStatus">{counter.status}</span>
      <small>Currently called: {counter.current_token??"—"} · Waiting: {counter.waiting_count}</small>
      <div className="institutionModuleHeader"><button type="button" className="secondary" disabled={busy||counter.status!=="active"} onClick={()=>callNext(counter.id)}>Call next token</button><button type="button" className="secondary" disabled={busy} onClick={()=>setCounterStatus(counter,counter.status==="active"?"paused":"active")}>{counter.status==="active"?"Pause counter":"Resume counter"}</button></div>
    </article>)}</div>}
    <form className="collegeSubmissionForm" onSubmit={createCounter}>
      <h3>Add a service counter</h3>
      <label>Department<input required maxLength="100" value={counterForm.department} onChange={e=>setCounterForm(v=>({...v,department:e.target.value}))}/></label>
      <label>Counter name<input required maxLength="100" value={counterForm.name} onChange={e=>setCounterForm(v=>({...v,name:e.target.value}))}/></label>
      <button className="primary" disabled={busy}>Create counter</button>
    </form>
    <h3>Active queue</h3>
    {tokens.length===0?<p>No active queue tokens.</p>:<div className="collegeRequestList">{tokens.map(token=><article className="collegeRequest" key={token.id}>
      <strong>Token #{token.tokenNumber} · {token.department} / {token.counterName}</strong><span className="collegeStatus">{token.status}</span>
      <small>{token.purpose} · {token.studentEmail}</small>
      <div className="institutionModuleHeader">
        {token.status==="called"&&<button type="button" className="secondary" disabled={busy} onClick={()=>setTokenStatus(token,"serving")}>Start service</button>}
        {token.status==="serving"&&<button type="button" className="secondary" disabled={busy} onClick={()=>setTokenStatus(token,"completed")}>Complete</button>}
        {["waiting","called"].includes(token.status)&&<button type="button" className="secondary" disabled={busy} onClick={()=>setTokenStatus(token,"cancelled")}>Cancel token</button>}
        {token.status==="called"&&<button type="button" className="secondary" disabled={busy} onClick={()=>setTokenStatus(token,"no_show")}>Mark no-show</button>}
      </div>
    </article>)}</div>}
    <h3>Service appointments</h3>{appointments.length===0?<p>No service appointments.</p>:<div className="collegeRequestList">{appointments.map(item=><article className="collegeRequest" key={item.id}><strong>{item.department} · {item.counterName}</strong><small>{new Date(item.scheduledFor).toLocaleString()} · {item.purpose}</small>{canManageAppointments&&<small>{item.studentEmail}</small>}<span className="collegeStatus">{item.status}</span><div className="institutionModuleHeader">{canManageAppointments&&item.status==="requested"&&<><button type="button" className="primary" disabled={busy} onClick={()=>updateAppointment(item,"confirmed")}>Confirm</button><button type="button" className="secondary" disabled={busy} onClick={()=>updateAppointment(item,"rejected")}>Reject</button></>}{canManageAppointments&&item.status==="confirmed"&&<><button type="button" className="secondary" disabled={busy} onClick={()=>updateAppointment(item,"completed")}>Mark completed</button><button type="button" className="secondary" disabled={busy} onClick={()=>updateAppointment(item,"no_show")}>Mark no-show</button></>}{canBookAppointments&&["requested","confirmed"].includes(item.status)&&<button type="button" className="secondary" disabled={busy} onClick={()=>updateAppointment(item,"cancelled")}>Cancel appointment</button>}</div>{item.reviewNote&&<small>Note: {item.reviewNote}</small>}</article>)}</div>}
    {busy&&<p>Saving queue update…</p>}
    {error&&<p className="collegeAlert error" role="alert">{error}</p>}
    {notice&&<p className="collegeAlert" role="status">{notice}</p>}
  </section>;
}
