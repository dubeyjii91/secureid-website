import { useEffect, useState } from "react";
import api from "../api.js";

const blank = { title:"", subject:"", classLabel:"", body:"", dueAt:"", audience:"students" };

export default function InstitutionSchoolPosts({ institutionId, type }) {
  const [posts,setPosts] = useState([]);
  const [form,setForm] = useState(blank);
  const [canManage,setCanManage] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const homework = type === "homework";
  const title = homework ? "Homework & Assignments" : "Notices & Circulars";

  async function load() {
    if (!institutionId) return;
    setError("");
    try {
      const result = await api(`/api/institutions/${encodeURIComponent(institutionId)}/school-posts?type=${type}`,{cache:"no-store"});
      setPosts(result.posts || []);
      setCanManage(Boolean(result.canManage));
    } catch (err) {
      setError(err.message || `${title} could not be loaded.`);
    }
  }
  useEffect(()=>{load();},[institutionId,type]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);setError("");setMessage("");
    try {
      await api(`/api/institutions/${encodeURIComponent(institutionId)}/school-posts`,{
        method:"POST",
        body:JSON.stringify({...form,type,dueAt:homework?new Date(form.dueAt).toISOString():null})
      });
      setForm(blank);
      setMessage(homework ? "Homework published to the selected student audience." : "School notice published.");
      await load();
    } catch (err) {
      setError(err.message || "The school update could not be published.");
    } finally { setBusy(false); }
  }

  async function archive(post) {
    if (!window.confirm(`Archive "${post.title}"? It will no longer appear in the active feed.`)) return;
    setBusy(true);setError("");setMessage("");
    try {
      await api(`/api/institutions/${encodeURIComponent(institutionId)}/school-posts/${encodeURIComponent(post.id)}`,{
        method:"PATCH",body:JSON.stringify({status:"archived"})
      });
      setMessage("School update archived.");
      await load();
    } catch (err) {
      setError(err.message || "The school update could not be archived.");
    } finally { setBusy(false); }
  }

  return <>
    <div className="institutionSchoolPostsIntro">
      <h3>{title}</h3>
      <p>{homework
        ? "Publish subject-wise homework with class/section, instructions and a due date. Students see only updates intended for them."
        : "Publish school circulars, announcements and operational updates for students, staff or the whole school."}</p>
    </div>
    {canManage && <form className="collegeSubmissionForm institutionSchoolPostForm" onSubmit={submit}>
      <label>Title<input required minLength="3" maxLength="180" value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))} placeholder={homework?"e.g. Mathematics worksheet":"e.g. School will remain closed"}/></label>
      {homework && <label>Subject<input maxLength="100" value={form.subject} onChange={e=>setForm(v=>({...v,subject:e.target.value}))} placeholder="e.g. Mathematics"/></label>}
      <label>Class / section<input maxLength="60" value={form.classLabel} onChange={e=>setForm(v=>({...v,classLabel:e.target.value}))} placeholder="e.g. Class 3-A or All classes"/></label>
      {homework && <label>Due date & time<input type="datetime-local" required value={form.dueAt} onChange={e=>setForm(v=>({...v,dueAt:e.target.value}))}/></label>}
      <label>Audience<select value={form.audience} onChange={e=>setForm(v=>({...v,audience:e.target.value}))}><option value="students">Students</option><option value="staff">Teachers & staff</option><option value="all">Everyone</option></select></label>
      <label className="institutionSchoolPostBody">Instructions / message<textarea required minLength="5" maxLength="5000" rows={4} value={form.body} onChange={e=>setForm(v=>({...v,body:e.target.value}))} placeholder={homework?"Write homework instructions…":"Write the school circular or announcement…"}/></label>
      <button className="primary" disabled={busy}>{busy?"Publishing…":homework?"Publish homework":"Publish notice"}</button>
    </form>}
    {error&&<p className="collegeAlert error" role="alert">{error}</p>}
    {message&&<p className="collegeAlert" role="status">{message}</p>}
    {!posts.length ? <div className="collegeEmpty"><span>{homework?"📚":"📣"}</span><strong>No active {homework?"homework":"notices"}</strong><p>{canManage?"Publish the first update using the form above.":"New school updates will appear here when published by the school office."}</p></div>
      : <div className="collegeRequestList institutionSchoolPostList">{posts.map(post=><article className="collegeRequest institutionSchoolPost" key={post.id}>
        <div className="institutionSchoolPostMeta"><span>{post.subject|| (homework?"Homework":"School notice")}</span>{post.classLabel&&<span>{post.classLabel}</span>}</div>
        <strong>{post.title}</strong>
        <p>{post.body}</p>
        <small>{post.audience==="all"?"All school users":post.audience==="students"?"Students":"Teachers & staff"} · Published {new Date(post.createdAt).toLocaleString()}{post.dueAt? " · Due "+new Date(post.dueAt).toLocaleString():""}</small>
        {canManage&&<button type="button" className="secondary" disabled={busy} onClick={()=>archive(post)}>Archive</button>}
      </article>)}</div>}
  </>;
}
