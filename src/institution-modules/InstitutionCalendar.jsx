import {useEffect,useState} from "react";
import api from "../api.js";
const blank=()=>({title:"",category:"academic",description:"",startsAt:"",endsAt:"",allDay:false,location:"",audience:"all"});
const localValue=value=>value?new Date(value).toISOString().slice(0,16):"";
export default function InstitutionCalendar({institutionId}){
 const [events,setEvents]=useState([]),[form,setForm]=useState(blank()),[editing,setEditing]=useState(""),[canManage,setCanManage]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function load(){if(!institutionId)return;try{const r=await api(`/api/institutions/${encodeURIComponent(institutionId)}/calendar`,{cache:"no-store"});setEvents(r.events||[]);setCanManage(!!r.canManage);}catch(e){setError(e.message||"Academic calendar could not be loaded.");}}
 useEffect(()=>{load();},[institutionId]);
 async function save(e){e.preventDefault();setBusy(true);setError("");setNotice("");try{const body={...form,startsAt:new Date(form.startsAt).toISOString(),endsAt:new Date(form.endsAt).toISOString()};await api(`/api/institutions/${encodeURIComponent(institutionId)}/calendar${editing?"/"+encodeURIComponent(editing):""}`,{method:editing?"PATCH":"POST",body:JSON.stringify(body)});setNotice(editing?"Calendar event updated.":"Calendar event published.");setForm(blank());setEditing("");await load();}catch(err){setError(err.message||"Calendar event could not be saved.");}finally{setBusy(false);}}
 function edit(item){setEditing(item.id);setForm({title:item.title,category:item.category,description:item.description||"",startsAt:localValue(item.startsAt),endsAt:localValue(item.endsAt),allDay:!!item.allDay,location:item.location||"",audience:item.audience||"all"});}
 async function cancel(item){if(!window.confirm("Cancel this calendar event? It will remain in the audit history."))return;setBusy(true);setError("");setNotice("");try{await api(`/api/institutions/${encodeURIComponent(institutionId)}/calendar/${encodeURIComponent(item.id)}`,{method:"DELETE"});setNotice("Calendar event cancelled.");await load();}catch(e){setError(e.message||"Event could not be cancelled.");}finally{setBusy(false);}}
 return <section className="institutionCalendarWorkspace">
  <p className="lead">Shared academic calendar for holidays, admissions, deadlines, meetings, campus events and exam dates.</p>
  {canManage&&<form className="collegeSubmissionForm" onSubmit={save}><h3>{editing?"Edit calendar event":"Publish calendar event"}</h3>
   <label>Event title<input required minLength="3" maxLength="180" value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))}/></label>
   <label>Category<select value={form.category} onChange={e=>setForm(v=>({...v,category:e.target.value}))}><option value="academic">Academic</option><option value="holiday">Holiday</option><option value="admission">Admission</option><option value="meeting">Meeting</option><option value="event">Campus event</option><option value="deadline">Deadline</option><option value="exam">Examination</option></select></label>
   <label>Starts<input required type="datetime-local" value={form.startsAt} onChange={e=>setForm(v=>({...v,startsAt:e.target.value}))}/></label>
   <label>Ends<input required type="datetime-local" value={form.endsAt} onChange={e=>setForm(v=>({...v,endsAt:e.target.value}))}/></label>
   <label>Location<input maxLength="180" value={form.location} onChange={e=>setForm(v=>({...v,location:e.target.value}))}/></label>
   <label>Audience<select value={form.audience} onChange={e=>setForm(v=>({...v,audience:e.target.value}))}><option value="all">Students and staff</option><option value="students">Students</option><option value="staff">Staff</option></select></label>
   <label>Description<textarea maxLength="2000" value={form.description} onChange={e=>setForm(v=>({...v,description:e.target.value}))}/></label>
   <label><input type="checkbox" checked={form.allDay} onChange={e=>setForm(v=>({...v,allDay:e.target.checked}))}/> All-day event</label>
   <div className="institutionModuleHeader"><button className="primary" disabled={busy}>{editing?"Save changes":"Publish event"}</button>{editing&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setEditing("");setForm(blank());}}>Cancel edit</button>}</div>
  </form>}
  <h3>Upcoming and scheduled events</h3>
  {events.length===0?<p>No calendar events have been published.</p>:<div className="collegeRequestList">{events.map(item=><article className="collegeRequest" key={item.id}><strong>{item.title}</strong><small>{item.category} · {new Date(item.startsAt).toLocaleString()} – {new Date(item.endsAt).toLocaleString()}</small><small>{item.location||"Location not specified"} · Audience: {item.audience}</small>{item.description&&<p>{item.description}</p>}{canManage&&<div className="institutionModuleHeader"><button className="secondary" disabled={busy} onClick={()=>edit(item)}>Edit</button><button className="secondary" disabled={busy} onClick={()=>cancel(item)}>Cancel event</button></div>}</article>)}</div>}
  {busy&&<p>Saving calendar changes…</p>}{error&&<p className="collegeAlert error" role="alert">{error}</p>}{notice&&<p className="collegeAlert" role="status">{notice}</p>}
 </section>;
}
