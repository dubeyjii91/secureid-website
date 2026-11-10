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
  const [inventory, setInventory] = useState({ buildings: [], rooms: [] });
  const [operations, setOperations] = useState({ allocations: [], fees: [], summary: {} });
  const [myFees, setMyFees] = useState([]);
  const [feeDrafts, setFeeDrafts] = useState({});
  const [paymentDrafts, setPaymentDrafts] = useState({});
  const [form, setForm] = useState(initialForm);
  const [buildingName, setBuildingName] = useState("");
  const [roomForm, setRoomForm] = useState({ buildingId: "", roomNumber: "", roomType: "shared", capacity: "2" });
  const [allocationRooms, setAllocationRooms] = useState({});
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
      const institutionIds = [...new Set(next.filter(item => item.status === "active").map(item => item.institutionId))];
      if (students.length) {
        const mine = await api("/api/institutions/my-hostel-applications", { cache: "no-store" });
        setApplications(mine.applications || []);
        const feeData = await api("/api/institutions/my-hostel-fees", { cache: "no-store" });
        setMyFees(feeData.fees || []);
        setForm(value => ({ ...value, institutionId: students.some(item => item.institutionId === value.institutionId) ? value.institutionId : students[0].institutionId }));
      } else { setApplications([]); setMyFees([]); }
      if (reviewers.length) {
        const reviewData = await api("/api/institutions/hostel-review-queue", { cache: "no-store" });
        setQueue(reviewData.applications || []);
        const operationsMembership = next.find(item => item.status === "active" && ["reviewer", "institution_admin", "read_only"].includes(item.role));
        if (operationsMembership) {
          const ops = await api(`/api/institutions/hostel-operations?institutionId=${encodeURIComponent(operationsMembership.institutionId)}`, { cache: "no-store" });
          setOperations({ allocations: ops.allocations || [], fees: ops.fees || [], summary: ops.summary || {} });
        }
      } else { setQueue([]); setOperations({ allocations: [], fees: [], summary: {} }); }
      if (institutionIds.length) {
        const inventoryData = await api("/api/institutions/hostel-inventory", { cache: "no-store" });
        setInventory({ buildings: inventoryData.buildings || [], rooms: inventoryData.rooms || [] });
        setRoomForm(value => ({ ...value, buildingId: value.buildingId || inventoryData.buildings?.[0]?.id || "" }));
      } else setInventory({ buildings: [], rooms: [] });
    } catch (err) {
      setError(err.message || "Hostel workspace could not be loaded. Please sign in again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submit(event) {
    event.preventDefault();
    setError(""); setMessage(""); setSaving(true);
    try {
      await api("/api/institutions/hostel-applications", { method: "POST", body: JSON.stringify({ ...form, consent }) });
      setConsent(false);
      setForm(value => ({ ...value, studentNote: "" }));
      setMessage("Hostel application submitted to your institution.");
      await load();
    } catch (err) { setError(err.message || "Hostel application could not be submitted."); }
    finally { setSaving(false); }
  }

  async function review(id, status) {
    setError(""); setMessage("");
    try {
      await api(`/api/institutions/hostel-applications/${encodeURIComponent(id)}`, {
        method: "PATCH", body: JSON.stringify({ status, reviewNote: notes[id] || "" })
      });
      setMessage("Hostel application review status updated.");
      await load();
    } catch (err) { setError(err.message || "Hostel application could not be reviewed."); }
  }

  async function withdraw(id) {
    setError(""); setMessage("");
    try {
      await api(`/api/institutions/hostel-applications/${encodeURIComponent(id)}`, { method: "DELETE" });
      setMessage("Hostel application withdrawn.");
      await load();
    } catch (err) { setError(err.message || "Hostel application could not be withdrawn."); }
  }

  async function addBuilding(event) {
    event.preventDefault(); setError(""); setMessage(""); setSaving(true);
    try {
      const institutionId = memberships.find(item => item.status === "active" && item.role === "institution_admin")?.institutionId;
      if (!institutionId) throw new Error("An active institution administrator membership is required.");
      await api("/api/institutions/hostel-buildings", { method: "POST", body: JSON.stringify({ institutionId, name: buildingName }) });
      setBuildingName(""); setMessage("Hostel building added."); await load();
    } catch (err) { setError(err.message || "Building could not be added."); }
    finally { setSaving(false); }
  }

  async function addRoom(event) {
    event.preventDefault(); setError(""); setMessage(""); setSaving(true);
    try {
      const institutionId = memberships.find(item => item.status === "active" && item.role === "institution_admin" && inventory.buildings.some(building => building.id === roomForm.buildingId))?.institutionId;
      if (!institutionId) throw new Error("Choose a building in an institution you administer.");
      await api("/api/institutions/hostel-rooms", { method: "POST", body: JSON.stringify({ ...roomForm, institutionId, capacity: Number(roomForm.capacity) }) });
      setRoomForm(value => ({ ...value, roomNumber: "" })); setMessage("Hostel room added."); await load();
    } catch (err) { setError(err.message || "Room could not be added."); }
    finally { setSaving(false); }
  }

  async function allocate(applicationId) {
    setError(""); setMessage("");
    try {
      const roomId = allocationRooms[applicationId];
      if (!roomId) throw new Error("Choose an available room first.");
      await api(`/api/institutions/hostel-applications/${encodeURIComponent(applicationId)}/allocation`, {
        method: "POST", body: JSON.stringify({ roomId })
      });
      setMessage("Bed allocated successfully."); await load();
    } catch (err) { setError(err.message || "Bed could not be allocated."); }
  }

  async function releaseAllocation(id) {
    setError(""); setMessage("");
    try {
      await api(`/api/institutions/hostel-allocations/${encodeURIComponent(id)}`, { method: "DELETE" });
      setMessage("Bed allocation released."); await load();
    } catch (err) { setError(err.message || "Bed allocation could not be released."); }
  }


  async function hostelOperation(path, body = {}) {
    setError(""); setMessage("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      setMessage("Hostel operation saved successfully.");
      await load();
    } catch (err) { setError(err.message || "Hostel operation could not be saved."); }
  }

  async function createFee(applicationId) {
    const draft = feeDrafts[applicationId] || {};
    await hostelOperation(`/api/institutions/hostel-applications/${encodeURIComponent(applicationId)}/fees`, {
      description: draft.description || "Hostel fee", amount: draft.amount, dueDate: draft.dueDate || ""
    });
  }

  async function recordFeePayment(feeId) {
    const draft = paymentDrafts[feeId] || {};
    await hostelOperation(`/api/institutions/hostel-fees/${encodeURIComponent(feeId)}/payments`, {
      amount: draft.amount, paymentMethod: draft.paymentMethod || "upi", reference: draft.reference || ""
    });
  }

  const activeStudents = memberships.filter(item => item.status === "active" && item.role === "student");
  const canReview = memberships.some(item => item.status === "active" && ["reviewer", "institution_admin"].includes(item.role));
  const canManageInventory = memberships.some(item => item.status === "active" && item.role === "institution_admin");
  const availableRooms = inventory.rooms.filter(room => room.status === "active" && room.availableBeds > 0);

  return <section className="panel collegeReviewPanel hostelPanel">
    <div className="eyebrow dark">HOSTEL MANAGEMENT · PHASE 3</div>
    <h2>Hostel applications & room allotment</h2>
    <p className="lead">Students apply with consent. Institution teams review applications, manage rooms, allot beds, record check-in/check-out and maintain a transparent manual fee ledger.</p>

    {loading ? <p>Loading hostel workspace…</p> : <>
      {activeStudents.length > 0 && <form className="collegeSubmissionForm" onSubmit={submit}>
        <label>Institution<select required value={form.institutionId} onChange={event => setForm(value => ({ ...value, institutionId: event.target.value }))}>{activeStudents.map(item => <option key={item.institutionId} value={item.institutionId}>{item.institutionName}</option>)}</select></label>
        <label>Academic year<input required pattern="20[0-9]{2}-20[0-9]{2}" maxLength={9} value={form.academicYear} onChange={event => setForm(value => ({ ...value, academicYear: event.target.value }))} placeholder="2026-2027" /></label>
        <label>Application type<select value={form.stayType} onChange={event => setForm(value => ({ ...value, stayType: event.target.value }))}><option value="new_admission">New hostel admission</option><option value="renewal">Hostel renewal</option></select></label>
        <label>Room preference<select value={form.roomPreference} onChange={event => setForm(value => ({ ...value, roomPreference: event.target.value }))}><option value="no_preference">No preference</option><option value="single">Single room preference</option><option value="shared">Shared room preference</option></select></label>
        <label className="hostelNoteField">Note (optional)<textarea rows={2} maxLength={500} value={form.studentNote} onChange={event => setForm(value => ({ ...value, studentNote: event.target.value }))} placeholder="Add a short accommodation-related note. Do not enter identity numbers or bank details." /></label>
        <label className="collegeConsent hostelConsent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />I consent to share this hostel application information with the selected institution for admission review.</label>
        <button className="primary" type="submit" disabled={saving || !consent || !form.institutionId}>{saving ? "Submitting…" : "Submit hostel application"}</button>
      </form>}

      {canManageInventory && <div className="hostelApplications">
        <h3>Hostel inventory management</h3>
        <p className="collegePrivacyNote">Only an institution administrator can create buildings and rooms. Room capacity is limited to 1–12 beds per room.</p>
        <form className="collegeSubmissionForm" onSubmit={addBuilding}>
          <label>New building name<input required minLength={2} maxLength={80} value={buildingName} onChange={event => setBuildingName(event.target.value)} placeholder="e.g. Boys Hostel A" /></label>
          <button className="primary" type="submit" disabled={saving}>Add building</button>
        </form>
        {inventory.buildings.length > 0 && <form className="collegeSubmissionForm" onSubmit={addRoom}>
          <label>Building<select required value={roomForm.buildingId} onChange={event => setRoomForm(value => ({ ...value, buildingId: event.target.value }))}>{inventory.buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label>
          <label>Room number<input required maxLength={20} value={roomForm.roomNumber} onChange={event => setRoomForm(value => ({ ...value, roomNumber: event.target.value }))} placeholder="101" /></label>
          <label>Room type<select value={roomForm.roomType} onChange={event => setRoomForm(value => ({ ...value, roomType: event.target.value }))}><option value="single">Single</option><option value="shared">Shared</option><option value="dormitory">Dormitory</option></select></label>
          <label>Bed capacity<input required type="number" min="1" max="12" value={roomForm.capacity} onChange={event => setRoomForm(value => ({ ...value, capacity: event.target.value }))} /></label>
          <button className="primary" type="submit" disabled={saving}>Add room</button>
        </form>}
      </div>}

      <div className="hostelApplications">
        <h3>Room availability</h3>
        {inventory.rooms.length === 0 ? <p className="lead">No rooms have been added yet. An institution administrator can create buildings and rooms.</p> : <div className="collegeRequestList">{inventory.rooms.map(room => <article className="collegeRequest" key={room.id}>
          <strong>{room.buildingName} · Room {room.roomNumber}</strong><span className="collegeStatus">{room.availableBeds} / {room.capacity} beds available</span>
          <small>{room.roomType.replaceAll("_", " ")} · {room.occupiedBeds} occupied · {room.status}</small>
        </article>)}</div>}
      </div>

      {activeStudents.length > 0 && <div className="hostelApplications">
        <h3>My hostel applications</h3>
        {applications.length === 0 ? <p className="lead">No hostel applications submitted yet.</p> : <div className="collegeRequestList">{applications.map(item => <article className="collegeRequest" key={item.id}>
          <strong>{item.institutionName}</strong><span className="collegeStatus">{item.status.replaceAll("_", " ")}</span>
          <small>{item.academicYear} · {item.stayType.replaceAll("_", " ")} · {item.roomPreference.replaceAll("_", " ")}</small>
          {item.allocationId && <p><strong>Allotted:</strong> {item.buildingName} · Room {item.roomNumber} · Bed {item.bedLabel}</p>}
          {item.reviewNote && <p>{item.reviewNote}</p>}
          {["submitted", "needs_correction"].includes(item.status) && <button type="button" className="secondary" onClick={() => withdraw(item.id)}>Withdraw application</button>}
        </article>)}</div>}
      </div>}


        {myFees.length > 0 && <div className="hostelApplications"><h3>My hostel fees</h3><div className="collegeRequestList">{myFees.map(fee => <article className="collegeRequest" key={fee.id}>
          <strong>{fee.institutionName} · {fee.description}</strong><span className="collegeStatus">{fee.status}</span>
          <small>{fee.academicYear} · Total ₹{(fee.amountPaise / 100).toFixed(2)} · Paid ₹{(fee.paidPaise / 100).toFixed(2)} · Balance ₹{((fee.amountPaise - fee.paidPaise) / 100).toFixed(2)}</small>
          {fee.dueDate && <small>Due date: {fee.dueDate}</small>}
        </article>)}</div><p className="collegePrivacyNote">Payment status is maintained by the institution. SecureID does not collect card, UPI PIN or banking credentials here.</p></div>}
\n      {memberships.some(item => item.status === "active" && ["reviewer", "institution_admin", "read_only"].includes(item.role)) && <div className="hostelApplications">
        <h3>Warden / reviewer queue</h3>
        <p className="collegePrivacyNote">Only active institution reviewers and administrators can change application status or allot beds. Read-only members can view the queue.</p>
        {queue.length === 0 ? <p className="lead">No hostel applications in your institution queue.</p> : <div className="collegeRequestList">{queue.map(item => <article className="collegeRequest" key={item.id}>
          <strong>{item.academicYear} · {item.stayType.replaceAll("_", " ")}</strong><span className="collegeStatus">{item.status.replaceAll("_", " ")}</span>
          <small>{item.institutionName} · Student account: {item.studentUserId} · Room preference: {item.roomPreference.replaceAll("_", " ")}</small>
          {item.studentNote && <p>{item.studentNote}</p>}
          {item.reviewNote && <p>Reviewer note: {item.reviewNote}</p>}
          {item.allocationId && <p><strong>Allotted:</strong> {item.buildingName} · Room {item.roomNumber} · Bed {item.bedLabel}</p>}
          {canReview && ["submitted", "needs_correction"].includes(item.status) && <div className="collegeReviewActions">
            <label>Review note (optional)<textarea rows={2} maxLength={500} value={notes[item.id] || ""} onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Tell the student what needs attention or the decision reason." /></label>
            <div className="collegeReviewButtons">
              <button type="button" className="secondary" onClick={() => review(item.id, "needs_correction")}>Needs correction</button>
              <button type="button" className="secondary" onClick={() => review(item.id, "rejected")}>Reject</button>
              <button type="button" className="primary" onClick={() => review(item.id, "approved")}>Approve</button>
            </div>
          </div>}
          {canReview && item.status === "approved" && !item.allocationId && <div className="collegeReviewActions">
            <label>Available room<select value={allocationRooms[item.id] || ""} onChange={event => setAllocationRooms(current => ({ ...current, [item.id]: event.target.value }))}><option value="">Choose room</option>{availableRooms.filter(room => room.institutionId === item.institutionId).map(room => <option key={room.id} value={room.id}>{room.buildingName} · {room.roomNumber} · {room.availableBeds} beds free</option>)}</select></label>
            <button type="button" className="primary" onClick={() => allocate(item.id)}>Allot bed</button>
          </div>}
          {canReview && item.allocationId && <button type="button" className="secondary" onClick={() => releaseAllocation(item.allocationId)}>Release bed allocation</button>}
        </article>)}</div>}
      </div>}
    </>}
    {error && <p className="collegeAlert error" role="alert">{error}</p>}
    {message && <p className="collegeAlert" role="status">{message}</p>}
  </section>;
}
