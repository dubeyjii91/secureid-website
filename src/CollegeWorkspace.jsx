import { useEffect, useState } from "react";
import "./college-workspace.css";

function csrfToken() {
  const match = document.cookie.match(/(?:^|; )(?:__Host-secureid\\.csrf|secureid\\.csrf)=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function securePost(url, body) {
  let token = csrfToken();
  if (!token) {
    const response = await fetch("/api/auth/csrf", { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error("Secure request protection could not be initialized. Refresh and try again.");
    token = csrfToken();
  }
  if (!token) throw new Error("Security token was not received. Refresh and try again.");
  return fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
    body: JSON.stringify(body)
  });
}

const initialForm = { institutionName: "", role: "Student", studentCount: "Under 500", workflows: ["Student onboarding", "Document submission tracking"], notes: "" };

export default function CollegeWorkspace() {
  const [form, setForm] = useState(initialForm);
  const [requests, setRequests] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadRequests() {
    setLoading(true);
    try {
      const [requestResponse, membershipResponse] = await Promise.all([
        fetch("/api/college-pilot/requests", { credentials: "include", cache: "no-store" }),
        fetch("/api/institutions/memberships", { credentials: "include", cache: "no-store" })
      ]);
      const [requestData, membershipData] = await Promise.all([requestResponse.json(), membershipResponse.json()]);
      if (!requestResponse.ok || !requestData.success) throw new Error(requestData.message || "Could not load pilot requests.");
      if (!membershipResponse.ok || !membershipData.success) throw new Error(membershipData.message || "Could not load institution access.");
      setRequests(requestData.requests || []);
      setMemberships(membershipData.memberships || []);
    } catch (err) {
      setError(err.message || "Could not load workspace data. Please sign in again and retry.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRequests(); }, []);

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const toggleWorkflow = (workflow) => update("workflows", form.workflows.includes(workflow)
    ? form.workflows.filter(item => item !== workflow)
    : [...form.workflows, workflow]);

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    setSaving(true);
    try {
      const response = await securePost("/api/college-pilot/requests", form);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Could not submit the pilot request.");
      setRequests(current => [data.request, ...current]);
      setForm(initialForm);
      setMessage("Pilot interest saved securely. This is a request for follow-up, not a paid subscription or confirmed college partnership.");
    } catch (err) {
      setError(err.message || "Request could not be saved. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="content collegeWorkspace">
    <div className="functionHero">
      <div><div className="eyebrow dark">INSTITUTIONAL WORKSPACE · PILOT</div><h2>Bring SecureID to your college</h2><p>Start with a small, privacy-first pilot for student onboarding and document-submission tracking. Colleges can explore a paid institutional plan after the workflow is validated.</p></div>
      <div className="collegeHeroIcon" aria-hidden="true">🏫</div>
    </div>
    <div className="collegeValueGrid">
      <article className="panel"><span className="collegeStep">01</span><h3>Student onboarding</h3><p>Give students a consistent place to prepare identity information and manage their own documents.</p><small>Student-controlled · No data resale</small></article>
      <article className="panel"><span className="collegeStep">02</span><h3>Submission tracking</h3><p>Build a clear workflow for what has been submitted, what needs review, and what needs follow-up.</p><small>Designed for accountable review</small></article>
      <article className="panel"><span className="collegeStep">03</span><h3>Institution controls</h3><p>Planned institutional roles, access boundaries and audit history must be tested before real college data is onboarded.</p><small>Not yet represented as live features</small></article>
    </div>
    <section className="panel collegeMembershipPanel" aria-labelledby="college-membership-heading">
      <div className="eyebrow dark">INSTITUTION ACCESS</div>
      <h2 id="college-membership-heading">Your college memberships</h2>
      {loading ? <p>Checking your institution access…</p> : memberships.length === 0
        ? <p className="lead">No institution membership is assigned to this account yet. Access is provisioned by a trusted SecureID operator; you cannot grant yourself staff or administrator permissions.</p>
        : <div className="collegeRequestList">{memberships.map(item => <article className="collegeRequest" key={item.institutionId}><strong>{item.institutionName}</strong><span className="collegeStatus">{item.status === "active" ? "Active membership" : "Membership suspended"}</span><small>Role: {item.role.replaceAll("_", " ")} · Joined {new Date(item.joinedAt).toLocaleDateString()}</small></article>)}</div>}
      <p className="lead">Membership visibility only. Staff review queues and access to student documents are not enabled in this release.</p>
    </section>
    <div className="collegeColumns">
      <form className="panel collegePilotForm" onSubmit={submit}>
        <div className="eyebrow dark">PILOT INTEREST</div><h2>Register institutional interest</h2>
        <p className="lead">Use a college name and general workflow needs only. Do not enter student names, identity numbers, documents, OTPs or other sensitive data here.</p>
        <label>College / institution name<input required maxLength={120} value={form.institutionName} onChange={e => update("institutionName", e.target.value)} placeholder="e.g. Example College" /></label>
        <label>Your role<select value={form.role} onChange={e => update("role", e.target.value)}><option>Student</option><option>Faculty</option><option>College administrator</option><option>IT / security team</option><option>Other</option></select></label>
        <label>Approximate student population<select value={form.studentCount} onChange={e => update("studentCount", e.target.value)}><option>Under 500</option><option>500–2,000</option><option>2,001–10,000</option><option>Over 10,000</option><option>Not sure</option></select></label>
        <fieldset><legend>Workflows you want to explore</legend>{["Student onboarding", "Document submission tracking", "Staff review queue", "Shareable student credentials", "Audit history and reports"].map(workflow => <label className="collegeCheck" key={workflow}><input type="checkbox" checked={form.workflows.includes(workflow)} onChange={() => toggleWorkflow(workflow)} />{workflow}</label>)}</fieldset>
        <label>Notes (optional)<textarea maxLength={500} value={form.notes} onChange={e => update("notes", e.target.value)} placeholder="Describe the problem you want the pilot to solve (no personal data)." rows={3} /></label>
        {error && <p className="collegeAlert error" role="alert">{error}</p>}{message && <p className="collegeAlert" role="status">{message}</p>}
        <button className="primary" type="submit" disabled={saving || form.workflows.length === 0}>{saving ? "Saving securely…" : "Save pilot interest"}</button>
      </form>
      <section className="panel collegeRequestPanel"><div className="eyebrow dark">YOUR REQUESTS</div><h2>Saved pilot interest</h2><p className="lead">Only requests submitted by your signed-in account appear here.</p>
        {loading ? <p>Loading your requests…</p> : requests.length === 0 ? <div className="collegeEmpty"><span>📋</span><strong>No requests yet</strong><p>Submit the form to record a college pilot interest.</p></div> : <div className="collegeRequestList">{requests.map(item => <article key={item.id} className="collegeRequest"><strong>{item.institutionName}</strong><span className="collegeStatus">{item.status === "received" ? "Interest received" : item.status}</span><small>{new Date(item.createdAt).toLocaleString()}</small><p>{item.workflows.join(" · ")}</p></article>)}</div>}
      </section>
    </div>
  </section>;
}
