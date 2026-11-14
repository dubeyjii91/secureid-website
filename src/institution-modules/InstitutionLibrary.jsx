import {useEffect,useState} from "react";
import api from "../api.js";
export default function InstitutionLibrary({institutionId,students=[]}){
 const [data,setData]=useState({books:[],loans:[],reservations:[]}),[form,setForm]=useState({accessionNumber:"",title:"",author:"",category:"",totalCopies:"1",shelfLocation:""}),[issue,setIssue]=useState({bookId:"",studentUserId:"",loanDays:"14"}),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function load(){if(!institutionId)return;try{const r=await api(`/api/institutions/${encodeURIComponent(institutionId)}/library`,{cache:"no-store"});setData({books:r.books||[],loans:r.loans||[],reservations:r.reservations||[]});}catch(e){setError(e.message||"Library data could not be loaded.");}}
 useEffect(()=>{load();},[institutionId]);
 async function run(fn,message){setBusy(true);setError("");setNotice("");try{await fn();setNotice(message);await load();}catch(e){setError(e.message||"Library operation failed.");}finally{setBusy(false);}}
 async function addBook(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/library/books`,{method:"POST",body:JSON.stringify({...form,totalCopies:Number(form.totalCopies)})}),"Book added to catalogue.");setForm({accessionNumber:"",title:"",author:"",category:"",totalCopies:"1",shelfLocation:""});}
 async function issueBook(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/library/loans`,{method:"POST",body:JSON.stringify({...issue,loanDays:Number(issue.loanDays)})}),"Book issued successfully.");setIssue({bookId:"",studentUserId:"",loanDays:"14"});}
 async function returnBook(loan){await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/library/loans/${encodeURIComponent(loan.id)}/return`,{method:"POST",body:JSON.stringify({})}),"Book returned and inventory updated.");}
 async function reserve(book){await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/library/reservations`,{method:"POST",body:JSON.stringify({bookId:book.id})}),"Reservation placed.");}
 return <section className="institutionLibraryWorkspace">
  <p className="lead">Manage the catalogue, live copy availability, circulation, due dates, overdue fines and student reservations.</p>
  <form className="collegeSubmissionForm" onSubmit={addBook}><h3>Add catalogue title</h3>
   <label>Accession number<input required value={form.accessionNumber} onChange={e=>setForm(v=>({...v,accessionNumber:e.target.value}))}/></label>
   <label>Book title<input required value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))}/></label>
   <label>Author<input required value={form.author} onChange={e=>setForm(v=>({...v,author:e.target.value}))}/></label>
   <label>Category<input value={form.category} onChange={e=>setForm(v=>({...v,category:e.target.value}))}/></label>
   <label>Total copies<input type="number" min="1" max="100000" required value={form.totalCopies} onChange={e=>setForm(v=>({...v,totalCopies:e.target.value}))}/></label>
   <label>Shelf location<input value={form.shelfLocation} onChange={e=>setForm(v=>({...v,shelfLocation:e.target.value}))}/></label>
   <button className="primary" disabled={busy}>Add book</button>
  </form>
  <form className="collegeSubmissionForm" onSubmit={issueBook}><h3>Issue a book</h3>
   <label>Book<select required value={issue.bookId} onChange={e=>setIssue(v=>({...v,bookId:e.target.value}))}><option value="">Select available book</option>{data.books.filter(b=>b.status==="active"&&b.availableCopies>0).map(b=><option key={b.id} value={b.id}>{b.title} · {b.accessionNumber} ({b.availableCopies} available)</option>)}</select></label>
   <label>Student<select required value={issue.studentUserId} onChange={e=>setIssue(v=>({...v,studentUserId:e.target.value}))}><option value="">Select student</option>{students.map(s=><option key={s.userId} value={s.userId}>{s.email}</option>)}</select></label>
   <label>Loan period (days)<input type="number" min="1" max="90" value={issue.loanDays} onChange={e=>setIssue(v=>({...v,loanDays:e.target.value}))}/></label>
   <button className="primary" disabled={busy||!issue.bookId||!issue.studentUserId}>Issue book</button>
  </form>
  <h3>Catalogue and inventory</h3>
  {data.books.length===0?<p>No books in the catalogue.</p>:<div className="collegeRequestList">{data.books.map(b=><article className="collegeRequest" key={b.id}><strong>{b.title}</strong><small>{b.author} · {b.accessionNumber} · {b.category||"Uncategorised"} · Shelf {b.shelfLocation||"—"}</small><span className="collegeStatus">{b.availableCopies} / {b.totalCopies} available</span>{b.status==="active"&&b.availableCopies===0&&<button className="secondary" type="button" disabled={busy} onClick={()=>reserve(b)}>Reserve title</button>}</article>)}</div>}
  <h3>Active loans</h3>
  {data.loans.length===0?<p>No active loans.</p>:<div className="collegeRequestList">{data.loans.map(l=><article className="collegeRequest" key={l.id}><strong>{l.title}</strong><small>{l.studentEmail} · Due {new Date(l.dueAt).toLocaleDateString()}</small><button className="secondary" type="button" disabled={busy} onClick={()=>returnBook(l)}>Record return</button></article>)}</div>}
  {data.reservations.length>0&&<><h3>My reservations</h3>{data.reservations.map(r=><p key={r.id}>Reservation {r.id.slice(0,8)} · {r.status}</p>)}</>}
  {busy&&<p>Saving library update…</p>}{error&&<p className="collegeAlert error" role="alert">{error}</p>}{notice&&<p className="collegeAlert" role="status">{notice}</p>}
 </section>;
}
