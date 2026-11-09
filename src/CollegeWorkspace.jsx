import { useEffect, useState } from "react";
import "./college-workspace.css";
import api from "./api.js";

const initialForm = { institutionName: "", role: "Student", studentCount: "Under 500", workflows: ["Student onboarding", "Document submission tracking"], notes: "" };

export default function CollegeWorkspace() {
  const [form, setForm] = useState(initialForm);
  const [requests, setRequests] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [mySubmissions, setMySubmissions] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [submissionPurpose, setSubmissionPurpose] = useState("College enrollment review");
  const [consent, setConsent] = useState(false);
  const [reviewNotes, setReviewNotes] = useState({});
  const [auditHistory, setAuditHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadRequests() {
    setLoading(true);
    setError("");
    try {
      const [requestData, membershipData] = await Promise.all([
        api("/api/college-pilot/requests", { cache: "no-store" }),
        api("/api/institutions/memberships", { cache: "no-store" })
      ]);
      const nextMemberships = membershipData.memberships || [];
      setRequests(requestData.requests || []);
      setMemberships(nextMemberships);
      const active = nextMemberships.filter(item => item.status === "active");
      const students = active.filter(item => item.role === "student");
      const reviewers = active.filter(item => ["reviewer", "institution_admin", "read_only"].includes(item.role));
      if (students.length) {
        const [documentData, submissionData] = await Promise.all([
          api("/api/documents", { cache: "no-store" }),
          api("/api/institutions/my-review-submissions", { cache: "no-store" })
        ]);
        setDocuments(documentData.documents || []);
        setMySubmissions(submissionData.submissions || []);
        setSelectedInstitutionId(current => students.some(item => item.institutionId === current) ? current : students[0].institutionId);
        setSelectedDocumentId(current => (documentData.documents || []).some(item => item.id === current) ? current : (documentData.documents || [])[0]?.id || "");
      } else {
        setDocuments([]);
        setMySubmissions([]);
      }
      if (reviewers.length) {
        const queueData = await api("/api/institutions/review-queue", { cache: "no-store" });
        setReviewQueue(queueData.submissions || []);
      } else {
        setReviewQueue([]);
      }
    } catch (err) {
      setError(err.message || "Could not load workspace data. Please sign in again and retry.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRequests(); }, []);

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const toggleWorkflow = workflow => update("workflows", form.workflows.includes(workflow)
    ? form.workflows.filter(item => item !== workflow)
    : [...form.workflows, workflow]);

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    setSaving(true);
    try {
      const data = await api("/api/college-pilot/requests", { method: "POST", body: JSON.stringify(form) });
      setRequests(current => [data.request, ...current]);
      setForm(initialForm);
      setMessage("Pilot interest saved securely. This is a request for follow-up, not a paid subscription or confirmed college partnership.");
    } catch (err) {
      setError(err.message || "Request could not be saved. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  async function submitDocument(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    setSaving(true);
    try {
      await api("/api/institutions/review-submissions", {
        method: "POST",
        body: JSON.stringify({ institutionId: selectedInstitutionId, documentId: selectedDocumentId, purpose: submissionPurpose, consent })
      });
      setConsent(false);
      setMessage("Your document reference was submitted to the selected college. The institution receives document metadata only in this workflow; file access is not granted.");
      await loadRequests();
    } catch (err) {
      setError(err.message || "Document submission could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function withdrawSubmission(id) {
    setError("");
    setMessage("");
    try {
      await api(`/api/institutions/review-submissions/${encodeURIComponent(id)}`, { method: "DELETE" });
      setMessage("Your review submission was withdrawn.");
      await loadRequests();
    } catch (err) {
      setError(err.message || "Could not withdraw this submission.");
    }
  }

  async function changeReview(id, status) {
    setError("");
    setMessage("");
    try {
      await api(`/api/institutions/review-submissions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status, reviewNote: reviewNotes[id] || "" })
      });
      setMessage("Institution review status updated. This is an administrative review, not government verification.");
      await loadRequests();
    } catch (err) {
      setError(err.message || "Review status could not be updated.");
    }
  }

  async function showAudit(id) {
    try {
      const data = await api(`/api/institutions/review-submissions/${encodeURIComponent(id)}/audit`, { cache: "no-store" });
      setAuditHistory(current => ({ ...current, [id]: data.audit || [] }));
    } catch (err) {
      setError(err.message || "Audit history could not be loaded.");
    }
  }

  const activeStudents = memberships.filter(item => item.status === "active" && item.role === "student");
  const activeReviewers = memberships.filter(item => item.status === "active" && ["reviewer", "institution_admin", "read_only"].includes(item.role));
  const canReview = memberships.some(item => item.status === "active" && ["reviewer", "institution_admin"].includes(item.role));

  return <section className="content collegeWorkspace">
    <div className="functionHero">
      <div><div className="eyebrow dark">INSTITUTIONAL WORKSPACE · PILOT</div><h2>Bring SecureID to your college</h2><p>Student-controlled document submissions, institution review tracking and accountable access boundaries. College staff do not receive file access through this review queue.</p></div>
      <div className="collegeHeroIcon" aria-hidden="true">🏫</div>
    </div>
    <div className="collegeValueGrid">
      <article className="panel"><span className="collegeStep">01</span><h3>Student onboarding</h3><p>Students manage their own SecureID profile and documents, then choose what to submit.</p><small>Explicit consent · Student-controlled</small></article>
      <article className="panel"><span className="collegeStep">02</span><h3>Submission review</h3><p>Assigned reviewers can track submissions and record administrative review outcomes.</p><small>Institution-scoped · Audited</small></article>
      <article className="panel"><span className="collegeStep">03</span><h3>Institution controls</h3><p>Memberships are provisioned by a trusted SecureID operator and protected by MFA.</p><small>No public self-assigned roles</small></article>
    </div>
    <section className="panel collegeMembershipPanel" aria-labelledby="college-membership-heading">
      <div className="eyebrow dark">INSTITUTION ACCESS</div><h2 id="college-membership-heading">Your college memberships</h2>
      {loading ? <p>Checking your institution access…</p> : memberships.length === 0
        ? <p className="lead">No institution membership is assigned to this account yet. Access is provisioned by a trusted SecureID operator; you cannot grant yourself staff or administrator permissions.</p>
        : <div className="collegeRequestList">{memberships.map(item => <article className="collegeRequest" key={item.institutionId}><strong>{item.institutionName}</strong><span className="collegeStatus">{item.status === "active" ? "Active membership" : "Membership suspended"}</span><small>Role: {item.role.replaceAll("_", " ")} · Joined {new Date(item.joinedAt).toLocaleDateString()}</small></article>)}</div>}
    </section>

    {activeStudents.length > 0 && <section className="panel collegeReviewPanel">
      <div className="eyebrow dark">STUDENT DOCUMENT SUBMISSION</div><h2>Submit a document for college review</h2>
      <p className="lead">Choose a document already in your SecureID Vault. Your college receives its name, category and submission purpose for tracking. This endpoint does not grant staff permission to download or view the encrypted file.</p>
      <form className="collegeSubmissionForm" onSubmit={submitDocument}>
        <label>Institution<select value={selectedInstitutionId} onChange={event => setSelectedInstitutionId(event.target.value)} required>{activeStudents.map(item => <option key={item.institutionId} value={item.institutionId}>{item.institutionName}</option>)}</select></label>
        <label>Document from your vault<select value={selectedDocumentId} onChange={event => setSelectedDocumentId(event.target.value)} required><option value="">Choose a document</option>{documents.map(doc => <option key={doc.id} value={doc.id}>{doc.name} · {doc.category}</option>)}</select></label>
        <label>Purpose<select value={submissionPurpose} onChange={event => setSubmissionPurpose(event.target.value)} required><option>College enrollment review</option><option>Scholarship application</option><option>Hostel admission</option><option>Exam registration</option><option>Student identity record</option></select></label>
        <p className="collegePrivacyNote">Consent text (college-review-v1): “I consent to submit the selected document reference, filename, document category, selected institution, and stated review purpose to that institution for the purpose shown. I understand that this workflow shares document metadata only and does not grant the institution access to the document file itself. I can withdraw an open submission while it is still awaiting review or correction. An institution’s review outcome is an administrative decision and is not government or identity verification.”</p>
        <label className="collegeConsent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />I agree to the college-review-v1 consent text above.</label>
        <button className="primary" type="submit" disabled={saving || !selectedDocumentId || !consent}>Submit for college review</button>
      </form>
      {documents.length === 0 && <p className="collegeAlert">Your Document Vault is empty. Add a document there before submitting it for college review.</p>}
      <h3>Your submissions</h3>
      {mySubmissions.length === 0 ? <p className="lead">You have not submitted any documents for college review.</p> : <div className="collegeRequestList">{mySubmissions.map(item => <article className="collegeRequest" key={item.id}><strong>{item.documentName}</strong><span className="collegeStatus">{item.status.replaceAll("_", " ")}</span><small>{item.institutionName} · {item.purpose} · Consent {item.consentVersion || "legacy"} · {new Date(item.consentedAt || item.createdAt).toLocaleString()}</small>{item.reviewNote && <p>{item.reviewNote}</p>}{["submitted", "needs_correction"].includes(item.status) && <button type="button" className="secondary" onClick={() => withdrawSubmission(item.id)}>Withdraw submission</button>}<button type="button" className="secondary" onClick={() => showAudit(item.id)}>View audit history</button>{auditHistory[item.id] && <ul className="collegeAuditList">{auditHistory[item.id].map((entry,index) => <li key={index}>{entry.action.replaceAll("_"," ")} · {entry.actorEmail || "account"} · {entry.toStatus || entry.fromStatus || "event"} · {new Date(entry.createdAt).toLocaleString()}</li>)}</ul>}</article>)}</div>}
    </section>}

    {activeReviewers.length > 0 && <section className="panel collegeReviewPanel">
      <div className="eyebrow dark">INSTITUTION REVIEW QUEUE</div><h2>Student submissions</h2>
      <p className="lead">Queue access is limited to active institution reviewer, institution administrator and read-only memberships. File contents and encrypted storage paths are not exposed here.</p>
      {reviewQueue.length === 0 ? <p className="lead">No student submissions are waiting in your institution queue.</p> : <div className="collegeRequestList">{reviewQueue.map(item => <article className="collegeRequest" key={item.id}><strong>{item.documentName}</strong><span className="collegeStatus">{item.status.replaceAll("_"," ")}</span><small>{item.institutionName} · Student account: {item.studentUserId} · {item.documentCategory} · {item.purpose}</small><button type="button" className="secondary" onClick={() => showAudit(item.id)}>View audit history</button>{auditHistory[item.id] && <ul className="collegeAuditList">{auditHistory[item.id].map((entry,index)=><li key={index}>{entry.action.replaceAll("_"," ")} · {entry.actorEmail || "account"} · {entry.toStatus || entry.fromStatus || "event"} · {new Date(entry.createdAt).toLocaleString()}</li>)}</ul>}{canReview && ["submitted","needs_correction"].includes(item.status) && <div className="collegeReviewActions"><label>Review note (optional)<textarea maxLength={500} rows={2} value={reviewNotes[item.id] || ""} onChange={event => setReviewNotes(current => ({...current,[item.id]:event.target.value}))} placeholder="Give the student a concise administrative note." /></label><div className="collegeReviewButtons"><button type="button" className="secondary" onClick={() => changeReview(item.id,"needs_correction")}>Needs correction</button><button type="button" className="secondary" onClick={() => changeReview(item.id,"rejected")}>Reject</button><button type="button" className="primary" onClick={() => changeReview(item.id,"approved")}>Approve</button></div></div>}</article>)}</div>}
      <p className="collegePrivacyNote">“Approved” and “rejected” are institution workflow decisions only. They do not mean SecureID or a government authority has verified the document or the student's identity.</p>
    </section>}

    <div className="collegeColumns">
      <form className="panel collegePilotForm" onSubmit={submit}>
        <div className="eyebrow dark">PILOT INTEREST</div><h2>Register institutional interest</h2>
        <p className="lead">Use a college name and general workflow needs only. Do not enter student names, identity numbers, documents, OTPs or other sensitive data here.</p>
        <label>College / institution name<input required maxLength={120} value={form.institutionName} onChange={e => update("institutionName", e.target.value)} placeholder="e.g. Example College" /></label>
        <label>Your role<select value={form.role} onChange={e => update("role", e.target.value)}><option>Student</option><option>Faculty</option><option>College administrator</option><option>IT / security team</option><option>Other</option></select></label>
        <label>Approximate student population<select value={form.studentCount} onChange={e => update("studentCount", e.target.value)}><option>Under 500</option><option>500–2,000</option><option>2,001–10,000</option><option>Over 10,000</option><option>Not sure</option></select></label>
        <fieldset><legend>Workflows you want to explore</legend>{["Student onboarding", "Document submission tracking", "Staff review queue", "Shareable student credentials", "Audit history and reports"].map(workflow => <label className="collegeCheck" key={workflow}><input type="checkbox" checked={form.workflows.includes(workflow)} onChange={() => toggleWorkflow(workflow)} />{workflow}</label>)}</fieldset>
        <label>Notes (optional)<textarea maxLength={500} value={form.notes} onChange={e => update("notes", e.target.value)} placeholder="Describe the problem you want the pilot to solve (no personal data)." rows={3} /></label>
        <button className="primary" type="submit" disabled={saving || form.workflows.length === 0}>{saving ? "Saving securely…" : "Save pilot interest"}</button>
      </form>
      <section className="panel collegeRequestPanel"><div className="eyebrow dark">YOUR REQUESTS</div><h2>Saved pilot interest</h2><p className="lead">Only requests submitted by your signed-in account appear here.</p>
        {loading ? <p>Loading your requests…</p> : requests.length === 0 ? <div className="collegeEmpty"><span>📋</span><strong>No requests yet</strong><p>Submit the form to record a college pilot interest.</p></div> : <div className="collegeRequestList">{requests.map(item => <article key={item.id} className="collegeRequest"><strong>{item.institutionName}</strong><span className="collegeStatus">{item.status === "received" ? "Interest received" : item.status}</span><small>{new Date(item.createdAt).toLocaleString()}</small><p>{item.workflows.join(" · ")}</p></article>)}</div>}
      </section>
    </div>
    {error && <p className="collegeAlert error" role="alert">{error}</p>}{message && <p className="collegeAlert" role="status">{message}</p>}
  </section>;
}
