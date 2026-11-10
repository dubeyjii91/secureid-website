import { useEffect, useState } from "react";
import api from "./api.js";

const currentYear = new Date().getFullYear();
const initialForm = {
  institutionId: "",
  academicYear: `${currentYear}-${currentYear + 1}`,
  stayType: "new_admission",
  roomPreference: "no_preference",
  studentNote: ""
};

export default function HostelManagement() {
  const [memberships, setMemberships] = useState([]);
  const [applications, setApplications] = useState([]);
  const [queue, setQueue] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [notes, setNotes] = useState({});
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
      const next = membershipData.memberships || [];
      setMemberships(next);
      const students = next.filter(item => item.status === "active" && item.role === "student");
      const reviewers = next.filter(item => item.status === "active" && ["reviewer", "institution_admin", "read_only"].includes(item.role));
      if (students.length) {
        const mine = await api("/api/institutions/my-hostel-applications", { cache: "no-store" });
        setApplications(mine.applications || []);
        setForm(value => ({ ...value, institutionId: students.some(item => item.institutionId === value.institutionId) ? value.institutionId : students[0].institutionId }));
      } else setApplications([]);
      if (reviewers.length) {
        const reviewData = await api("/api/institutions/hostel-review-queue", { cache: "no-store" });
        setQueue(reviewData.applications || []);
      } else setQueue([]);
    } catch (err) {
      setError(err.message || "Hostel workspace could not be loaded. Please sign in again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      await api("/api/institutions/hostel-applications", {
        method: "POST",
        body: JSON.stringify({ ...form, consent })
      });
      setConsent(false);
      setForm(value => ({ ...value, studentNote: "" }));
      setMessage("Hostel application submitted to your institution.");
      await load();
    } catch (err) {
      setError(err.message || "Hostel application could not be submitted.");
    } finally {
      setSaving(false);
    }
  }

  async function review(id, status) {
    setError("");
    setMessage("");
    try {
      await api(`/api/institutions/hostel-applications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status, reviewNote: notes[id] || "" })
      });
      setMessage("Hostel application review status updated.");
      await load();
    } catch (err) {
      setError(err.message || "Hostel application could not be reviewed.");
    }
  }

  async function withdraw(id) {
    setError("");
    setMessage("");
    try {
      await api(`/api/institutions/hostel-applications/${encodeURIComponent(id)}`, { method: "DELETE" });
      setMessage("Hostel application withdrawn.");
      await load();
    } catch (err) {
      setError(err.message || "Hostel application could not be withdrawn.");
    }
  }

  const activeStudents = memberships.filter(item => item.status === "active" && item.role === "student");
  const canReview = memberships.some(item => item.status === "active" && ["reviewer", "institution_admin"].includes(item.role));

  return <section className="panel collegeReviewPanel hostelPanel">
    <div className="eyebrow dark">HOSTEL MANAGEMENT · PHASE 1</div>
    <h2>Hostel applications</h2>
    <p className="lead">Students can apply for hostel accommodation. Assigned institution reviewers can record an administrative decision. Room inventory and bed allotment will be added as the next phase.</p>

    {loading ? <p>Loading hostel applications…</p> : <>
      {activeStudents.length > 0 && <form className="collegeSubmissionForm" onSubmit={submit}>
        <label>Institution
          <select required value={form.institutionId} onChange={event => setForm(value => ({ ...value, institutionId: event.target.value }))}>
            {activeStudents.map(item => <option key={item.institutionId} value={item.institutionId}>{item.institutionName}</option>)}
          </select>
        </label>
        <label>Academic year
          <input required pattern="20[0-9]{2}-20[0-9]{2}" maxLength={9} value={form.academicYear} onChange={event => setForm(value => ({ ...value, academicYear: event.target.value }))} placeholder="2026-2027" />
        </label>
        <label>Application type
          <select value={form.stayType} onChange={event => setForm(value => ({ ...value, stayType: event.target.value }))}>
            <option value="new_admission">New hostel admission</option>
            <option value="renewal">Hostel renewal</option>
          </select>
        </label>
        <label>Room preference
          <select value={form.roomPreference} onChange={event => setForm(value => ({ ...value, roomPreference: event.target.value }))}>
            <option value="no_preference">No preference</option>
            <option value="single">Single room preference</option>
            <option value="shared">Shared room preference</option>
          </select>
        </label>
        <label className="hostelNoteField">Note (optional)
          <textarea rows={2} maxLength={500} value={form.studentNote} onChange={event => setForm(value => ({ ...value, studentNote: event.target.value }))} placeholder="Add a short accommodation-related note. Do not enter identity numbers or bank details." />
        </label>
        <label className="collegeConsent hostelConsent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />I consent to share this hostel application information with the selected institution for admission review.</label>
        <button className="primary" type="submit" disabled={saving || !consent || !form.institutionId}>{saving ? "Submitting…" : "Submit hostel application"}</button>
      </form>}

      {activeStudents.length > 0 && <div className="hostelApplications">
        <h3>My hostel applications</h3>
        {applications.length === 0 ? <p className="lead">No hostel applications submitted yet.</p> : <div className="collegeRequestList">{applications.map(item => <article className="collegeRequest" key={item.id}>
          <strong>{item.institutionName}</strong><span className="collegeStatus">{item.status.replaceAll("_", " ")}</span>
          <small>{item.academicYear} · {item.stayType.replaceAll("_", " ")} · {item.roomPreference.replaceAll("_", " ")}</small>
          {item.reviewNote && <p>{item.reviewNote}</p>}
          {["submitted", "needs_correction"].includes(item.status) && <button type="button" className="secondary" onClick={() => withdraw(item.id)}>Withdraw application</button>}
        </article>)}</div>}
      </div>}

      {memberships.some(item => item.status === "active" && ["reviewer", "institution_admin", "read_only"].includes(item.role)) && <div className="hostelApplications">
        <h3>Warden / reviewer queue</h3>
        <p className="collegePrivacyNote">Only active institution reviewers and administrators can change application status. Read-only members can view the queue.</p>
        {queue.length === 0 ? <p className="lead">No hostel applications in your institution queue.</p> : <div className="collegeRequestList">{queue.map(item => <article className="collegeRequest" key={item.id}>
          <strong>{item.academicYear} · {item.stayType.replaceAll("_", " ")}</strong><span className="collegeStatus">{item.status.replaceAll("_", " ")}</span>
          <small>{item.institutionName} · Student account: {item.studentUserId} · Room preference: {item.roomPreference.replaceAll("_", " ")}</small>
          {item.studentNote && <p>{item.studentNote}</p>}
          {item.reviewNote && <p>Reviewer note: {item.reviewNote}</p>}
          {canReview && ["submitted", "needs_correction"].includes(item.status) && <div className="collegeReviewActions">
            <label>Review note (optional)<textarea rows={2} maxLength={500} value={notes[item.id] || ""} onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Tell the student what needs attention or the decision reason." /></label>
            <div className="collegeReviewButtons">
              <button type="button" className="secondary" onClick={() => review(item.id, "needs_correction")}>Needs correction</button>
              <button type="button" className="secondary" onClick={() => review(item.id, "rejected")}>Reject</button>
              <button type="button" className="primary" onClick={() => review(item.id, "approved")}>Approve</button>
            </div>
          </div>}
        </article>)}</div>}
      </div>}
    </>}
    {error && <p className="collegeAlert error" role="alert">{error}</p>}
    {message && <p className="collegeAlert" role="status">{message}</p>}
  </section>;
}
