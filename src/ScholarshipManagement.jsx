import { useEffect, useState } from "react";
import api from "./api.js";

const yearNow = new Date().getFullYear();
const initialProgram = { institutionId: "", title: "", description: "", eligibility: "", awardAmount: "", deadline: "" };

export default function ScholarshipManagement() {
  const [memberships, setMemberships] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [programForm, setProgramForm] = useState(initialProgram);
  const [applicationDraft, setApplicationDraft] = useState({ programId: "", academicYear: yearNow + "-" + (yearNow + 1), studentNote: "", documentIds: [] });
  const [reviewNotes, setReviewNotes] = useState({});
  const [auditHistory, setAuditHistory] = useState({});
  const [documentPreviews, setDocumentPreviews] = useState({});
  const [previewLoading, setPreviewLoading] = useState({});
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const membershipData = await api("/api/institutions/memberships", { cache: "no-store" });
      const active = (membershipData.memberships || []).filter(item => item.status === "active");
      setMemberships(active);
      const institutionIds = [...new Set(active.map(item => item.institutionId))];
      const data = await Promise.all(institutionIds.map(async institutionId => {
        const workspace = await api("/api/institutions/scholarship-workspace?institutionId=" + encodeURIComponent(institutionId), { cache: "no-store" });
        const membership = active.find(item => item.institutionId === institutionId);
        return { ...workspace, institutionId, institutionName: membership?.institutionName || "Institution" };
      }));
      setWorkspaces(data);
      const studentMemberships = active.filter(item => item.role === "student");
      if (studentMemberships.length) {
        const documentData = await api("/api/documents", { cache: "no-store" });
        setDocuments(documentData.documents || []);
      } else setDocuments([]);
      const adminMembership = active.find(item => item.role === "institution_admin");
      setProgramForm(value => ({ ...value, institutionId: adminMembership?.institutionId || value.institutionId || "" }));
    } catch (err) {
      setError(err.message || "Scholarship workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const students = memberships.filter(item => item.role === "student");
  const reviewers = memberships.filter(item => ["reviewer", "institution_admin", "read_only"].includes(item.role));
  const admins = memberships.filter(item => item.role === "institution_admin");
  const programs = workspaces.flatMap(workspace => (workspace.programs || []).map(program => ({ ...program, institutionName: workspace.institutionName, institutionId: workspace.institutionId })));
  const applications = workspaces.flatMap(workspace => (workspace.applications || []).map(application => ({ ...application, institutionName: workspace.institutionName, institutionId: workspace.institutionId, membershipRole: workspace.membershipRole })));

  async function createProgram(event) {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      await api("/api/institutions/scholarship-programs", { method: "POST", body: JSON.stringify({ ...programForm, awardAmount: Number(programForm.awardAmount) }) });
      setProgramForm(value => ({ ...value, title: "", description: "", eligibility: "", awardAmount: "", deadline: "" }));
      setMessage("Scholarship program published for your institution.");
      await load();
    } catch (err) { setError(err.message || "Scholarship program could not be published."); }
    finally { setSaving(false); }
  }

  async function apply(event) {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      await api("/api/institutions/scholarship-programs/" + encodeURIComponent(applicationDraft.programId) + "/applications", {
        method: "POST",
        body: JSON.stringify({ academicYear: applicationDraft.academicYear, studentNote: applicationDraft.studentNote, documentIds: applicationDraft.documentIds, consent })
      });
      setApplicationDraft(value => ({ ...value, programId: "", studentNote: "", documentIds: [] }));
      setConsent(false);
      setMessage("Scholarship application submitted to your institution.");
      await load();
    } catch (err) { setError(err.message || "Scholarship application could not be submitted."); }
    finally { setSaving(false); }
  }

  async function review(applicationId, status) {
    setError(""); setMessage("");
    try {
      await api("/api/institutions/scholarship-applications/" + encodeURIComponent(applicationId), {
        method: "PATCH", body: JSON.stringify({ status, reviewNote: reviewNotes[applicationId] || "" })
      });
      setMessage("Scholarship application review status updated.");
      await load();
    } catch (err) { setError(err.message || "Scholarship review could not be saved."); }
  }

  async function deleteProgram(program) {
    if (!window.confirm(`Permanently delete scholarship program "${program.title}"? Programs with applications are protected and cannot be deleted.`)) return;
    setError(""); setMessage("");
    try {
      await api("/api/institutions/scholarship-programs/" + encodeURIComponent(program.id), { method: "DELETE" });
      setMessage("Scholarship program deleted."); await load();
    } catch (err) { setError(err.message || "Scholarship program could not be deleted. Check whether applications exist."); }
  }

  async function closeProgram(programId) {
    setError(""); setMessage("");
    try {
      await api("/api/institutions/scholarship-programs/" + encodeURIComponent(programId), { method: "PATCH", body: JSON.stringify({ status: "closed" }) });
      setMessage("Scholarship program closed. Existing applications remain in history.");
      await load();
    } catch (err) { setError(err.message || "Scholarship program could not be closed."); }
  }

  async function previewScholarshipDocument(applicationId, document) {
    const key = applicationId + ":" + document.id;
    setError(""); setMessage("");
    setPreviewLoading(current => ({ ...current, [key]: true }));
    try {
      const response = await api("/api/institutions/scholarship-applications/" + encodeURIComponent(applicationId) + "/documents/" + encodeURIComponent(document.id) + "/preview", { cache: "no-store" });
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(new Blob([blob], { type: document.mimeType }));
      setDocumentPreviews(current => ({ ...current, [key]: objectUrl }));
      setMessage("Secure document preview is ready. Access has been recorded in the audit history.");
    } catch (err) { setError(err.message || "Document preview could not be opened."); }
    finally { setPreviewLoading(current => ({ ...current, [key]: false })); }
  }

  async function showAudit(applicationId) {
    try {
      const data = await api("/api/institutions/scholarship-applications/" + encodeURIComponent(applicationId) + "/audit", { cache: "no-store" });
      setAuditHistory(current => ({ ...current, [applicationId]: data.audit || [] }));
    } catch (err) { setError(err.message || "Scholarship audit history could not be loaded."); }
  }

  async function withdraw(applicationId) {
    setError(""); setMessage("");
    try {
      await api("/api/institutions/scholarship-applications/" + encodeURIComponent(applicationId), { method: "DELETE" });
      setMessage("Scholarship application withdrawn.");
      await load();
    } catch (err) { setError(err.message || "Scholarship application could not be withdrawn."); }
  }

  return <section className="panel collegeReviewPanel hostelPanel scholarshipPanel">
    <div className="eyebrow dark">SCHOLARSHIP MANAGEMENT</div>
    <h2>Scholarship programs & applications</h2>
    <p className="lead">Institutions publish scholarship opportunities, students apply using references to documents in their SecureID Vault, and authorized reviewers record decisions. Document files are not shared with staff through this workflow.</p>
    {loading ? <p>Loading scholarship workspace…</p> : memberships.length === 0 ? <div className="hostelApplications"><h3>Connect your college account</h3><p className="lead">An active student, reviewer or institution administrator membership is required to use Scholarship Management.</p></div> : <>
      {admins.length > 0 && <div className="hostelApplications">
        <h3>Publish a scholarship program</h3>
        <p className="collegePrivacyNote">Only institution administrators can publish or close programs. Use eligibility criteria and deadlines that your institution can actually administer.</p>
        <form className="collegeSubmissionForm" onSubmit={createProgram}>
          <label>Institution<select required value={programForm.institutionId} onChange={event => setProgramForm(value => ({ ...value, institutionId: event.target.value }))}>{admins.map(item => <option key={item.institutionId} value={item.institutionId}>{item.institutionName}</option>)}</select><button type="button" className="secondary clearFieldButton" onClick={() => setProgramForm(value => ({ ...value, institutionId: "" }))} disabled={!programForm.institutionId}>Clear value</button></label>
          <label>Scholarship name<input required minLength={3} maxLength={100} value={programForm.title} onChange={event => setProgramForm(value => ({ ...value, title: event.target.value }))} placeholder="e.g. Merit Support Scholarship" /><button type="button" className="secondary clearFieldButton" onClick={() => setProgramForm(value => ({ ...value, title: "" }))} disabled={!programForm.title}>Clear value</button></label>
          <label>Description<textarea required minLength={20} maxLength={2000} rows={3} value={programForm.description} onChange={event => setProgramForm(value => ({ ...value, description: event.target.value }))} placeholder="Explain the scholarship and what it supports." /><button type="button" className="secondary clearFieldButton" onClick={() => setProgramForm(value => ({ ...value, description: "" }))} disabled={!programForm.description}>Clear value</button></label>
          <label>Eligibility criteria<textarea required minLength={10} maxLength={1000} rows={2} value={programForm.eligibility} onChange={event => setProgramForm(value => ({ ...value, eligibility: event.target.value }))} placeholder="State course, marks, income or other criteria clearly." /><button type="button" className="secondary clearFieldButton" onClick={() => setProgramForm(value => ({ ...value, eligibility: "" }))} disabled={!programForm.eligibility}>Clear value</button></label>
          <label>Award amount (₹)<input required type="number" min="0.01" max="10000000" step="0.01" value={programForm.awardAmount} onChange={event => setProgramForm(value => ({ ...value, awardAmount: event.target.value }))} /><button type="button" className="secondary clearFieldButton" onClick={() => setProgramForm(value => ({ ...value, awardAmount: "" }))} disabled={!programForm.awardAmount}>Clear value</button></label>
          <label>Application deadline<input required type="date" min={new Date().toISOString().slice(0, 10)} value={programForm.deadline} onChange={event => setProgramForm(value => ({ ...value, deadline: event.target.value }))} /><button type="button" className="secondary clearFieldButton" onClick={() => setProgramForm(value => ({ ...value, deadline: "" }))} disabled={!programForm.deadline}>Clear value</button></label>
          <button className="primary" type="submit" disabled={saving}>{saving ? "Publishing…" : "Publish scholarship"}</button>
        </form>
      </div>}

      <div className="hostelApplications">
        <h3>Available scholarship programs</h3>
        {programs.length === 0 ? <p className="lead">No scholarship programs have been published for your institution yet.</p> : <div className="collegeRequestList">{programs.map(program => <article className="collegeRequest" key={program.id}>
          <strong>{program.title}</strong><span className="collegeStatus">{program.status}</span>
          <small>{program.institutionName} · Award ₹{(program.awardAmountPaise / 100).toFixed(2)} · Deadline {program.deadline}</small>
          <p>{program.description}</p><small>Eligibility: {program.eligibility}</small>
          {admins.some(item => item.institutionId === program.institutionId) && <div className="collegeReviewActions">{program.status === "active" && <button type="button" className="secondary" onClick={() => closeProgram(program.id)}>Close applications</button>}<button type="button" className="dangerButton" onClick={() => deleteProgram(program)}>Delete program</button></div>}
        </article>)}</div>}
      </div>

      {students.length > 0 && <div className="hostelApplications">
        <h3>Apply for a scholarship</h3>
        <p className="collegePrivacyNote">Choose only documents relevant to this application. SecureID sends document references and metadata; the institution does not receive permission to download the files. Do not enter Aadhaar numbers, bank details, OTPs or passwords in the note.</p>
        <form className="collegeSubmissionForm" onSubmit={apply}>
          <label>Scholarship program<select required value={applicationDraft.programId} onChange={event => setApplicationDraft(value => ({ ...value, programId: event.target.value }))}><option value="">Choose an active scholarship</option>{programs.filter(program => program.status === "active" && program.deadline >= new Date().toISOString().slice(0, 10) && students.some(item => item.institutionId === program.institutionId)).map(program => <option key={program.id} value={program.id}>{program.institutionName} · {program.title} · ₹{(program.awardAmountPaise / 100).toFixed(2)}</option>)}</select><button type="button" className="secondary clearFieldButton" onClick={() => setApplicationDraft(value => ({ ...value, programId: "" }))} disabled={!applicationDraft.programId}>Clear value</button></label>
          <label>Academic year<input required pattern="20[0-9]{2}-20[0-9]{2}" maxLength={9} value={applicationDraft.academicYear} onChange={event => setApplicationDraft(value => ({ ...value, academicYear: event.target.value }))} /><button type="button" className="secondary clearFieldButton" onClick={() => setApplicationDraft(value => ({ ...value, academicYear: "" }))} disabled={!applicationDraft.academicYear}>Clear value</button></label>
          <label>Supporting documents from your Vault<select multiple size={Math.min(5, Math.max(2, documents.length))} value={applicationDraft.documentIds} onChange={event => setApplicationDraft(value => ({ ...value, documentIds: Array.from(event.target.selectedOptions, option => option.value) }))}>{documents.map(doc => <option key={doc.id} value={doc.id}>{doc.name} · {doc.category}</option>)}</select><button type="button" className="secondary clearFieldButton" onClick={() => setApplicationDraft(value => ({ ...value, documentIds: [] }))} disabled={applicationDraft.documentIds.length === 0}>Clear value</button></label>
          <small className="collegePrivacyNote">Hold Ctrl (Windows) or Command (Mac) to select multiple documents. Up to 10 document references are allowed.</small>
          <label>Application note (optional)<textarea rows={3} maxLength={1000} value={applicationDraft.studentNote} onChange={event => setApplicationDraft(value => ({ ...value, studentNote: event.target.value }))} placeholder="Add a short explanation without sensitive identity or banking details." /><button type="button" className="secondary clearFieldButton" onClick={() => setApplicationDraft(value => ({ ...value, studentNote: "" }))} disabled={!applicationDraft.studentNote}>Clear value</button></label>
          <label className="collegeConsent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />I consent to share this application and let authorized institution reviewers preview the selected Vault documents securely for scholarship review. I understand previews are audited and access ends if I withdraw my application.</label>
          <button className="primary" type="submit" disabled={saving || !applicationDraft.programId || !consent}>{saving ? "Submitting…" : "Submit scholarship application"}</button>
        </form>
        {documents.length === 0 && <p className="collegeAlert">Your SecureID Vault has no active documents. You can still apply without attachments if the program allows it.</p>}
      </div>}

      {applications.length > 0 && <div className="hostelApplications">
        <h3>{reviewers.length > 0 ? "Scholarship application review queue" : "My scholarship applications"}</h3>
        <div className="collegeRequestList">{applications.map(application => <article className="collegeRequest" key={application.id}>
          <strong>{application.programTitle}</strong><span className="collegeStatus">{application.status.replaceAll("_", " ")}</span>
          <small>{application.institutionName} · {application.academicYear} · Award ₹{(application.awardAmountPaise / 100).toFixed(2)} · {application.documentIds.length} document reference(s)</small>
          {application.studentNote && <p>{application.studentNote}</p>}
          {reviewers.some(item => item.institutionId === application.institutionId && ["reviewer", "institution_admin"].includes(item.role)) && application.documents?.length > 0 && ["submitted", "needs_correction"].includes(application.status) && <div className="collegeReviewActions">
            <strong>Consented supporting documents</strong>
            {application.documents.map(document => {
              const previewKey = application.id + ":" + document.id;
              return <div className="collegeRequest" key={document.id}>
                <small>{document.name} · {document.category} · {(document.sizeBytes / 1024).toFixed(0)} KB</small>
                <button type="button" className="secondary" disabled={Boolean(previewLoading[previewKey])} onClick={() => previewScholarshipDocument(application.id, document)}>{previewLoading[previewKey] ? "Preparing secure preview…" : "Prepare secure preview"}</button>
                {documentPreviews[previewKey] && <a href={documentPreviews[previewKey]} target="_blank" rel="noopener noreferrer">Open document preview</a>}
              </div>;
            })}
            <small className="collegePrivacyNote">View-only preview is available only to authorized reviewers while this application is under review. Each successful access is audited; files are not exposed as permanent download links.</small>
          </div>}
          {application.reviewNote && <p>Reviewer note: {application.reviewNote}</p>}
          <small>Submitted: {new Date(application.consentedAt || application.createdAt).toLocaleString()}</small>
          {application.status === "needs_correction" && students.some(item => item.institutionId === application.institutionId) && <p className="collegePrivacyNote">Please update the application note or document selection above, keep the same program and academic year, then submit again to resubmit this application.</p>}
          <button type="button" className="secondary" onClick={() => showAudit(application.id)}>View application history</button>
          {auditHistory[application.id] && <ul className="collegeAuditList">{auditHistory[application.id].map((entry, index) => <li key={index}>{entry.action.replaceAll("_", " ")} · {entry.toStatus || entry.fromStatus || "event"} · {new Date(entry.createdAt).toLocaleString()}</li>)}</ul>}
          {students.some(item => item.institutionId === application.institutionId && item.role === "student") && ["submitted", "needs_correction"].includes(application.status) && <button type="button" className="secondary" onClick={() => withdraw(application.id)}>Withdraw application</button>}
          {reviewers.some(item => item.institutionId === application.institutionId && ["reviewer", "institution_admin"].includes(item.role)) && ["submitted", "needs_correction"].includes(application.status) && <div className="collegeReviewActions">
            <label>Review note (optional)<textarea rows={2} maxLength={500} value={reviewNotes[application.id] || ""} onChange={event => setReviewNotes(current => ({ ...current, [application.id]: event.target.value }))} placeholder="Tell the student what needs attention or record the decision reason." /><button type="button" className="secondary clearFieldButton" onClick={() => setReviewNotes(current => ({ ...current, [application.id]: "" }))} disabled={!(reviewNotes[application.id] || "")}>Clear value</button></label>
            <div className="collegeReviewButtons">
              <button type="button" className="secondary" onClick={() => review(application.id, "needs_correction")}>Needs correction</button>
              <button type="button" className="secondary" onClick={() => review(application.id, "rejected")}>Reject</button>
              <button type="button" className="primary" onClick={() => review(application.id, "approved")}>Approve</button>
            </div>
          </div>}
        </article>)}</div>
      </div>}
    </>}
    {error && <p className="collegeAlert error" role="alert">{error}</p>}
    {message && <p className="collegeAlert" role="status">{message}</p>}
  </section>;
}
