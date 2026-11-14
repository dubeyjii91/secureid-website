import {useEffect,useState} from "react";
import api from "../api.js";
export default function InstitutionGrievances({institutionId}){
 const [items,setItems]=useState([]),[form,setForm]=useState({category:"General",subject:"",description:"",priority:"normal"}),[reply,setReply]=useState(""),[selected,setSelected]=useState(""),[messages,setMessages]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function load(){if(!institutionId)return;try{const r=await api(`/api/institutions/${encodeURIComponent(institutionId)}/grievances`,{cache:"no-store"});setItems(r.grievances||[]);}catch(e){setError(e.message||"Grievances could not be loaded.");}}
 async function loadMessages(id){setSelected(id);try{const r=await api(`/api/institutions/${encodeURIComponent(institutionId)}/grievances/${encodeURIComponent(id)}/messages`,{cache:"no-store"});setMessages(r.messages||[]);}catch(e){setError(e.message||"Messages could not be loaded.");}}
 useEffect(()=>{load();},[institutionId]);
 async function run(fn,msg){setBusy(true);setError("");setNotice("");try{await fn();setNotice(msg);await load();if(selected)await loadMessages(selected);}catch(e){setError(e.message||"Grievance action failed.");}finally{setBusy(false);}}
 async function submit(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/grievances`,{method:"POST",body:JSON.stringify(form)}),"Grievance submitted and ticket created.");setForm({category:"General",subject:"",description:"",priority:"normal"});}
 async function sendReply(e){e.preventDefault();if(!selected||!reply.trim())return;await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/grievances/${encodeURIComponent(selected)}/messages`,{method:"POST",body:JSON.stringify({message:reply})}),"Reply added.");setReply("");}
 async function update(item,status){const resolution=status==="resolved"?(window.prompt("Resolution note (required)")||""):"";if(status==="resolved"&&resolution.trim().length<5)return;await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/grievances/${encodeURIComponent(item.id)}`,{method:"PATCH",body:JSON.stringify({status,resolution})}),"Ticket status updated.");}
 return <section className="institutionGrievancesWorkspace">
  <p className="lead">Submit and track student complaints with priority-based service deadlines, staff assignment, message history and resolution records.</p>
  <form className="collegeSubmissionForm" onSubmit={submit}><h3>Submit a grievance</h3>
   <label>Category<select value={form.category} onChange={e=>setForm(v=>({...v,category:e.target.value}))}><option>General</option><option>Fees</option><option>Academics</option><option>Examinations</option><option>Hostel</option><option>Library</option><option>Transport</option><option>Harassment / safety</option><option>IT services</option></select></label>
   <label>Subject<input required minLength="5" maxLength="160" value={form.subject} onChange={e=>setForm(v=>({...v,subject:e.target.value}))}/></label>
   <label>Details<textarea required minLength="10" maxLength="4000" value={form.description} onChange={e=>setForm(v=>({...v,description:e.target.value}))}/></label>
   <label>Priority<select value={form.priority} onChange={e=>setForm(v=>({...v,priority:e.target.value}))}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
   <button className="primary" disabled={busy}>Submit grievance</button>
  </form>
  <h3>Grievance tickets</h3>
  {items.length===0?<p>No grievance tickets found.</p>:<div className="collegeRequestList">{items.map(item=><article className="collegeRequest" key={item.id}>
   <strong>#{item.ticketNumber} · {item.subject}</strong><small>{item.category} · {item.studentEmail} · SLA {new Date(item.slaDueAt).toLocaleString()}</small><span className="collegeStatus">{item.status} · {item.priority}</span><p>{item.description}</p>
   <div className="institutionModuleHeader"><button type="button" className="secondary" onClick={()=>loadMessages(item.id)}>View conversation</button>
   {["open","assigned","reopened"].includes(item.status)&&<button type="button" className="secondary" disabled={busy} onClick={()=>update(item,"in_progress")}>Start work</button>}
   {["open","assigned","in_progress","reopened"].includes(item.status)&&<button type="button" className="secondary" disabled={busy} onClick={()=>update(item,"resolved")}>Resolve</button>}
   {item.status==="resolved"&&<button type="button" className="secondary" disabled={busy} onClick={()=>update(item,"closed")}>Close ticket</button>}</div>
  </article>)}</div>}
  {selected&&<div className="collegeSubmissionForm"><h3>Ticket conversation</h3>{messages.map(m=><p key={m.id}><strong>{m.senderUserId}</strong> · {new Date(m.createdAt).toLocaleString()}<br/>{m.message}</p>)}<form onSubmit={sendReply}><label>Reply<textarea required minLength="2" maxLength="2000" value={reply} onChange={e=>setReply(e.target.value)}/></label><button className="primary" disabled={busy}>Send reply</button></form></div>}
  {busy&&<p>Saving grievance update…</p>}{error&&<p className="collegeAlert error" role="alert">{error}</p>}{notice&&<p className="collegeAlert" role="status">{notice}</p>}
 </section>;
}
