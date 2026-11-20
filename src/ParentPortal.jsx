import { useEffect, useState } from "react";
import api from "./api.js";
import "./parent-portal.css";

export default function ParentPortal() {
  const [children,setChildren]=useState([]);
  const [selected,setSelected]=useState(null);
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  async function loadChildren(){
    setLoading(true);setError("");
    try{const result=await api("/api/parent-portal/children",{cache:"no-store"});setChildren(result.children||[]);}
    catch(e){setError(e.message||"Parent portal could not be loaded.");}
    finally{setLoading(false);}
  }
  async function openChild(child){
    setSelected(child);setData(null);setError("");
    try{const result=await api("/api/parent-portal/children/"+encodeURIComponent(child.studentUserId)+"?institutionId="+encodeURIComponent(child.institutionId),{cache:"no-store"});setData(result);}
    catch(e){setError(e.message||"Child records could not be loaded.");}
  }
  useEffect(()=>{loadChildren();},[]);
  const money=(paise)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(Number(paise||0)/100);
  return <section className="content parentPortal">
    <div className="functionHero"><div><div className="eyebrow dark">FAMILY ACCESS · SECUREID</div><h2>Parent Portal</h2><p>View school updates and your linked child's attendance, fees, homework and published results.</p></div><div className="collegeHeroIcon" aria-hidden="true">👨‍👩‍👧</div></div>
    {loading?<section className="panel">Loading your linked children…</section>:error?<section className="panel parentError" role="alert">{error}<button className="secondary" onClick={loadChildren}>Try again</button></section>:children.length===0?<section className="panel"><h3>No child linked yet</h3><p className="lead">Ask your child's school administrator to link your verified SecureID account using your account email. The school must confirm guardian authorization. You will only see children linked to this account.</p></section>:
    <><section className="panel"><div className="eyebrow dark">YOUR LINKED CHILDREN</div><div className="parentChildGrid">{children.map(child=><button key={child.institutionId+child.studentUserId} className={selected?.studentUserId===child.studentUserId?"parentChildCard selected":"parentChildCard"} onClick={()=>openChild(child)}><strong>{child.studentNumber||"Student"}</strong><span>{child.institutionName}</span><small>{child.relationship} · {child.studentEmail}</small></button>)}</div></section>
    {selected&&<>{!data?<section className="panel">Loading child records…</section>:<><div className="parentRecordHeading"><div><div className="eyebrow dark">{data.child?.institutionName||selected.institutionName}</div><h2>{data.child?.studentNumber||"Student record"}</h2><p>{data.child?.studentEmail}</p></div><button className="secondary" onClick={()=>openChild(selected)}>Refresh records</button></div>
    <div className="parentRecordGrid">
      <section className="panel"><h3>Attendance</h3>{data.attendance?.length?data.attendance.map((x,i)=><div className="parentDataRow" key={i}><span>{x.date} · {x.subject}</span><b>{x.status}</b></div>):<p>No attendance entries published yet.</p>}</section>
      <section className="panel"><h3>Fees & dues</h3>{data.invoices?.length?data.invoices.map(x=><div className="parentDataRow" key={x.id}><span><b>{x.feeHead}</b><small>{x.dueDate||"No due date"} · {x.status}</small></span><b>{money(x.amountPaise)}</b></div>):<p>No fee invoices available.</p>}</section>
      <section className="panel"><h3>Homework & assignments</h3>{data.homework?.length?data.homework.map(x=><article className="parentPost" key={x.id}><b>{x.title}</b><small>{x.subject||"General"} · Due {x.dueAt?new Date(x.dueAt).toLocaleDateString():"Not specified"}</small><p>{x.body}</p></article>):<p>No homework published yet.</p>}</section>
      <section className="panel"><h3>Exam results</h3>{data.results?.length?data.results.map((x,i)=><div className="parentDataRow" key={i}><span><b>{x.title}</b><small>{x.subject} · {x.examDate}</small></span><b>{(x.marksHundredths/100).toFixed(2)} / {(x.totalMarksHundredths/100).toFixed(2)}</b></div>):<p>No published results available.</p>}</section>
    </div></>}</>}
    </>}
    <p className="parentPrivacyNote">Privacy: this portal only returns records for active parent-child links. Contact the school administrator to correct or revoke a link. Parent access is read-only.</p>
  </section>;
}
