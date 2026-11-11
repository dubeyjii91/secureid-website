import { useEffect, useState } from "react";
import api from "./api.js";
import SecureCloudPanel from "./SecureCloudPanel.jsx";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function eventLabel(action) {
  const labels = {
    ACCOUNT_CREATED: "New account registered",
    EMAIL_VERIFICATION_SENT: "Verification email requested",
    LOGIN_FAILED: "Failed sign-in",
    MFA_FAILED: "Failed MFA attempt",
    LOGIN_BLOCKED_ACCOUNT_SUSPENDED: "Sign-in blocked for suspended account",
    EMAIL_VERIFIED: "Email address verified",
    USER_SUSPENDED: "Account suspended by owner",
    USER_REACTIVATED: "Account reactivated by owner",
    ACCOUNT_SUSPENDED_BY_OWNER: "Account suspension recorded",
    ACCOUNT_REACTIVATED_BY_OWNER: "Account reactivation recorded"
  };
  return labels[action] || String(action || "Security activity").replaceAll("_", " ").toLowerCase();
}

export default function OwnerAdminDashboard() {
  const [health, setHealth] = useState(null);
  const [users, setUsers] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [activeUsers, setActiveUsers] = useState(0);
  const [suspendedUsers, setSuspendedUsers] = useState(0);
  const [events, setEvents] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [notificationTotals, setNotificationTotals] = useState({ total: 0, pending: 0, sent: 0, failed: 0 });
  const [notificationError, setNotificationError] = useState("");
  const [busyNotification, setBusyNotification] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [usersError, setUsersError] = useState("");
  const [activityError, setActivityError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyUser, setBusyUser] = useState("");
  const [institutions, setInstitutions] = useState([]);
  const [institutionMemberships, setInstitutionMemberships] = useState([]);
  const [institutionName, setInstitutionName] = useState("");
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const [selectedMemberUserId, setSelectedMemberUserId] = useState("");
  const [selectedMemberRole, setSelectedMemberRole] = useState("student");
  const [subscriptionPlan, setSubscriptionPlan] = useState("pilot");
  const [subscriptionStatus, setSubscriptionStatus] = useState("pilot");
  const [subscriptionFeatures, setSubscriptionFeatures] = useState(["hostel","scholarship","student_submissions"]);
  const [subscriptionStartsAt, setSubscriptionStartsAt] = useState("");
  const [subscriptionEndsAt, setSubscriptionEndsAt] = useState("");
  const [institutionError, setInstitutionError] = useState("");
  const [institutionBusy, setInstitutionBusy] = useState(false);
  const [institutionAudit, setInstitutionAudit] = useState({});



  useEffect(() => {
    if (!selectedInstitutionId) return undefined;
    let cancelled = false;
    api("/api/admin/institutions/" + encodeURIComponent(selectedInstitutionId) + "/subscription", { cache: "no-store" })
      .then(result => {
        if (cancelled || !result.subscription) return;
        const value = result.subscription;
        setSubscriptionPlan(value.planKey || "pilot");
        setSubscriptionStatus(value.status || "pilot");
        setSubscriptionFeatures(Array.isArray(value.features) ? value.features : []);
        setSubscriptionStartsAt(value.startsAt ? new Date(value.startsAt).toISOString().slice(0,16) : "");
        setSubscriptionEndsAt(value.endsAt ? new Date(value.endsAt).toISOString().slice(0,16) : "");
      })
      .catch(error => { if (!cancelled) setInstitutionError(error?.message || "Subscription settings could not be loaded."); });
    return () => { cancelled = true; };
  }, [selectedInstitutionId]);

  async function load() {
    setLoading(true); setError(""); setUsersError(""); setActivityError(""); setNotificationError(""); setNotice("");
    const results = await Promise.allSettled([
      api("/api/admin/health"),
      api("/api/admin/users?limit=100"),
      api("/api/admin/activity?limit=50"),
      api("/api/admin/notifications?limit=50"),
      api("/api/admin/institutions")
    ]);
    if (results[0].status === "fulfilled") setHealth(results[0].value);
    else setError(results[0].reason?.message || "Owner status could not be loaded.");
    if (results[1].status === "fulfilled") {
      const nextUsers = results[1].value.users || [];
      setUsers(nextUsers);
      setSelectedMemberUserId(current => nextUsers.some(item => item.id === current) ? current : nextUsers.find(item => item.role !== "owner")?.id || "");
      setTotalUsers(Number(results[1].value.total || 0));
      setActiveUsers(Number(results[1].value.active || 0));
      setSuspendedUsers(Number(results[1].value.suspended || 0));
    } else setUsersError(results[1].reason?.message || "User list could not be loaded.");
    if (results[2].status === "fulfilled") setEvents(results[2].value.events || []);
    else setActivityError(results[2].reason?.message || "Activity feed could not be loaded.");
    if (results[3].status === "fulfilled") {
      setNotifications(results[3].value.notifications || []);
      setNotificationTotals(results[3].value.totals || { total: 0, pending: 0, sent: 0, failed: 0 });
    } else setNotificationError(results[3].reason?.message || "Notification history could not be loaded.");
    if (results[4].status === "fulfilled") {
      const directory = results[4].value;
      setInstitutions(directory.institutions || []);
      setInstitutionMemberships(directory.memberships || []);
      setSelectedInstitutionId(current => (directory.institutions || []).some(item => item.id === current) ? current : (directory.institutions || [])[0]?.id || "");
    } else setInstitutionError(results[4].reason?.message || "Institution directory could not be loaded.");
    setLoading(false);
  }

  async function setAccountStatus(user, status) {
    if (busyUser) return;
    const confirmed = window.confirm(
      status === "suspended"
        ? "Suspend " + user.email + "? Their active sessions will be revoked and sign-in blocked until reactivated."
        : "Reactivate " + user.email + "? They will be able to sign in again."
    );
    if (!confirmed) return;
    let reason = "";
    if (status === "suspended") {
      reason = String(window.prompt("Optional reason for the audit log (do not enter sensitive data):", "") || "").trim().slice(0, 240);
    }
    setBusyUser(user.id); setNotice(""); setUsersError("");
    try {
      await api("/api/admin/users/" + encodeURIComponent(user.id) + "/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason })
      });
      await load();
      setNotice("Account " + (status === "suspended" ? "suspended" : "reactivated") + " successfully. Audit entry recorded.");
    } catch (e) {
      setUsersError(e?.message || "Could not change account status.");
    } finally {
      setBusyUser("");
    }
  }

  async function retryNotification(notification) {
    if (busyNotification || !window.confirm("Retry sending the registration alert for " + notification.userEmail + " to the configured owner email?")) return;
    setBusyNotification(notification.id); setNotificationError(""); setNotice("");
    try {
      const result = await api("/api/admin/notifications/" + encodeURIComponent(notification.id) + "/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      await load();
      setNotice(result.message || "Notification retry completed.");
    } catch (e) {
      setNotificationError(e?.message || "Could not retry the notification.");
    } finally {
      setBusyNotification("");
    }
  }


  async function createInstitution(event) {
    event.preventDefault();
    setInstitutionBusy(true); setInstitutionError(""); setNotice("");
    try {
      const result = await api("/api/admin/institutions", { method: "POST", body: JSON.stringify({ name: institutionName }) });
      setInstitutionName("");
      await load();
      setSelectedInstitutionId(result.institution.id);
      setNotice("Institution created. Provision staff and student memberships explicitly.");
    } catch (e) {
      setInstitutionError(e?.message || "Institution could not be created.");
    } finally { setInstitutionBusy(false); }
  }

  async function provisionMembership(event) {
    event.preventDefault();
    if (!selectedInstitutionId || !selectedMemberUserId) return;
    setInstitutionBusy(true); setInstitutionError(""); setNotice("");
    try {
      const baseRole = selectedMemberRole === "warden" ? "read_only" : selectedMemberRole;
      await api("/api/admin/institutions/" + encodeURIComponent(selectedInstitutionId) + "/memberships", {
        method: "POST", body: JSON.stringify({ userId: selectedMemberUserId, role: baseRole })
      });
      if (selectedMemberRole === "warden") {
        await api("/api/admin/institutions/" + encodeURIComponent(selectedInstitutionId) + "/membership-roles", {
          method: "POST", body: JSON.stringify({ userId: selectedMemberUserId, role: "warden", action: "grant" })
        });
      }
      await load();
      setNotice("Institution membership provisioned and audit entry recorded.");
    } catch (e) {
      setInstitutionError(e?.message || "Membership could not be provisioned.");
    } finally { setInstitutionBusy(false); }
  }

  async function saveInstitutionSubscription(event) {
    event.preventDefault();
    if (!selectedInstitutionId || institutionBusy) return;
    setInstitutionBusy(true); setInstitutionError(""); setNotice("");
    try {
      await api("/api/admin/institutions/" + encodeURIComponent(selectedInstitutionId) + "/subscription", {
        method: "PUT",
        body: JSON.stringify({
          planKey: subscriptionPlan, status: subscriptionStatus, features: subscriptionFeatures,
          startsAt: subscriptionStartsAt ? new Date(subscriptionStartsAt).toISOString() : null,
          endsAt: subscriptionEndsAt ? new Date(subscriptionEndsAt).toISOString() : null
        })
      });
      setNotice("Institution subscription entitlements saved. These entitlements do not change anyone's role.");
    } catch (e) {
      setInstitutionError(e?.message || "Subscription entitlements could not be saved.");
    } finally { setInstitutionBusy(false); }
  }

  async function loadInstitutionAudit(institutionId) {
    setInstitutionError("");
    try {
      const result = await api("/api/admin/institutions/" + encodeURIComponent(institutionId) + "/audit", { cache: "no-store" });
      setInstitutionAudit(current => ({ ...current, [institutionId]: result.audit || [] }));
    } catch (e) {
      setInstitutionError(e?.message || "Institution audit history could not be loaded.");
    }
  }

  async function updateMembership(membership, status) {
    if (institutionBusy || !window.confirm((status === "suspended" ? "Suspend " : "Reactivate ") + membership.email + " in this institution?")) return;
    setInstitutionBusy(true); setInstitutionError(""); setNotice("");
    try {
      await api("/api/admin/institutions/" + encodeURIComponent(membership.institutionId) + "/memberships/" + encodeURIComponent(membership.id), {
        method: "PATCH", body: JSON.stringify({ status })
      });
      await load();
      setNotice("Institution membership status updated and audit entry recorded.");
    } catch (e) {
      setInstitutionError(e?.message || "Membership status could not be updated.");
    } finally { setInstitutionBusy(false); }
  }

  useEffect(() => { load(); }, []);

  return <section className="content narrow">
    <div className="functionHero compact"><div><div className="eyebrow dark">RESTRICTED · OWNER ONLY</div><h2>SecureID owner console</h2><p>Operational health, registered accounts and security activity. Owner authorization and verified MFA are enforced by the server.</p></div><div className="dashboardScore"><strong>🔐</strong><small>Restricted access</small></div></div>
    {notice && <div className="panel" role="status"><p>{notice}</p></div>}
    {loading && <div className="panel">Checking owner permissions, service health, users and activity…</div>}
    {error && <div className="panel" role="alert"><h3>Owner health check failed</h3><p>{error}</p><p>Sign in with the configured owner email and complete MFA. A hidden menu never grants access.</p></div>}
    {health && <>
      <div className="dashboardGrid">
        <article className="panel"><div className="eyebrow dark">API</div><h3>{health.status === "ready" ? "Operational" : "Check required"}</h3><p>{health.service || "SecureID API"}</p></article>
        <article className="panel"><div className="eyebrow dark">DATABASE</div><h3>{health.database === "ok" ? "Healthy" : "Check required"}</h3><p>Live readiness check</p></article>
        <article className="panel"><div className="eyebrow dark">EMAIL PROVIDER</div><h3>{health.emailDelivery?.configured ? (health.emailDelivery.testSender ? "Test sender" : "Configured") : "Setup required"}</h3><p>{health.emailDelivery?.provider || "Provider unavailable"} · Configuration does not guarantee inbox delivery.</p></article>
        <article className="panel"><div className="eyebrow dark">ENCRYPTED BACKUPS</div><h3>{health.backup?.enabled ? (health.backup.lastSuccessAt ? "Backup recorded" : "Scheduled") : "Not configured"}</h3><p>{health.backup?.lastSuccessAt ? "Last success: " + new Date(health.backup.lastSuccessAt).toLocaleString() : "Confirm a recent backup before relying on recovery."}</p></article>
      </div>
      <div className="panel"><div className="eyebrow dark">OWNER ACCESS AUDIT</div><h3>Protected administrative access</h3><p>User data and account controls require a valid session, verified MFA and server-side owner authorization. Passwords, MFA codes and verification tokens are never returned.</p><p><small>Health checked: {health.timestamp ? new Date(health.timestamp).toLocaleString() : "just now"}</small></p></div>
    </>}
    <div className="panel">
      <div className="eyebrow dark">USER MANAGEMENT</div>
      <h3>Registered accounts · {totalUsers}</h3>
      <div className="dashboardGrid">
        <article className="panel"><div className="eyebrow dark">ACTIVE</div><h3>{activeUsers}</h3></article>
        <article className="panel"><div className="eyebrow dark">SUSPENDED</div><h3>{suspendedUsers}</h3></article>
      </div>
      <p>Latest {users.length} accounts, newest first. Registration email alerts are attempted when the configured email provider accepts the message.</p>
      {usersError && <p role="alert">{usersError}</p>}
      {!loading && !usersError && users.length === 0 && <p>No registered accounts found.</p>}
      {users.length > 0 && <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}><thead><tr><th style={{padding:"10px 8px"}}>Email / ID</th><th style={{padding:"10px 8px"}}>Registered</th><th style={{padding:"10px 8px"}}>Email</th><th style={{padding:"10px 8px"}}>Account</th><th style={{padding:"10px 8px"}}>Action</th></tr></thead><tbody>{users.map((user)=><tr key={user.id}><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}><strong>{user.email}</strong><br/><small>{user.id}</small></td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{formatDate(user.createdAt)}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{user.emailVerified ? "Verified" : "Pending"}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{user.role === "owner" ? "Owner" : user.accountStatus === "suspended" ? "Suspended" : "Active"}{user.suspensionReason ? <><br/><small>Reason: {user.suspensionReason}</small></> : null}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{user.role === "owner" ? "Protected" : <button className="primary" disabled={Boolean(busyUser)} onClick={() => setAccountStatus(user, user.accountStatus === "suspended" ? "active" : "suspended")}>{busyUser === user.id ? "Saving…" : user.accountStatus === "suspended" ? "Reactivate" : "Suspend"}</button>}</td></tr>)}</tbody></table></div>}
      <button className="primary" onClick={load} disabled={loading || Boolean(busyUser)}>{loading ? "Refreshing…" : "Refresh dashboard"}</button>
      <p><small>Only account metadata is displayed. Suspending an account revokes its current sessions. Owner accounts cannot be suspended from this console.</small></p>
    </div>
    <div className="panel">
      <div className="eyebrow dark">OWNER EMAIL NOTIFICATION HISTORY</div>
      <h3>Registration alerts · {notificationTotals.total}</h3>
      <div className="dashboardGrid">
        <article className="panel"><div className="eyebrow dark">PENDING</div><h3>{notificationTotals.pending}</h3></article>
        <article className="panel"><div className="eyebrow dark">PROVIDER ACCEPTED</div><h3>{notificationTotals.sent}</h3></article>
        <article className="panel"><div className="eyebrow dark">FAILED</div><h3>{notificationTotals.failed}</h3></article>
      </div>
      <p>Provider acceptance is not proof that the message reached the inbox. Failed alerts can be retried after checking email configuration.</p>
      {notificationError && <p role="alert">{notificationError}</p>}
      {!notificationError && notifications.length === 0 && !loading && <p>No registration notifications recorded yet.</p>}
      {notifications.length > 0 && <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}><thead><tr><th style={{padding:"10px 8px"}}>Created</th><th style={{padding:"10px 8px"}}>Registered user</th><th style={{padding:"10px 8px"}}>Delivery status</th><th style={{padding:"10px 8px"}}>Action</th></tr></thead><tbody>{notifications.map((notification)=><tr key={notification.id}><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{formatDate(notification.createdAt)}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{notification.userEmail}<br/><small>{notification.userId}</small></td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{notification.status === "sent" ? "Provider accepted" : notification.status === "pending" ? "Sending" : "Failed" + (notification.errorCode ? " · " + notification.errorCode : "")}{notification.sentAt ? <><br/><small>Accepted: {formatDate(notification.sentAt)}</small></> : null}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{notification.status === "failed" ? <button className="primary" disabled={Boolean(busyNotification)} onClick={() => retryNotification(notification)}>{busyNotification === notification.id ? "Retrying…" : "Retry email"}</button> : "—"}</td></tr>)}</tbody></table></div>}
    </div>
    <div className="panel">
      <div className="eyebrow dark">SECURITY & REGISTRATION ACTIVITY</div>
      <h3>Recent activity</h3>
      <p>Recent registration, failed sign-in/MFA and owner account-control events.</p>
      {activityError && <p role="alert">{activityError}</p>}
      {!activityError && events.length === 0 && !loading && <p>No activity events found yet.</p>}
      {events.length > 0 && <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}><thead><tr><th style={{padding:"10px 8px"}}>Time</th><th style={{padding:"10px 8px"}}>Event</th><th style={{padding:"10px 8px"}}>Account</th><th style={{padding:"10px 8px"}}>Actor</th></tr></thead><tbody>{events.map((event)=><tr key={event.id}><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{new Date(event.createdAt).toLocaleString()}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{eventLabel(event.action)}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{event.targetEmail || event.targetUserId || "—"}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{event.actorEmail || "System"}</td></tr>)}</tbody></table></div>}
    </div>

    <div className="panel">
      <div className="eyebrow dark">COLLEGE / INSTITUTION MANAGEMENT</div>
      <h3>Institution directory · {institutions.length}</h3>
      <p>Provision institution access only after verifying the institution and the user's account. Every membership creation or status change is recorded in the institution audit trail. All actions require owner authorization and MFA on the server.</p>
      {institutionError && <p role="alert">{institutionError}</p>}
      <form onSubmit={createInstitution} style={{display:"flex",gap:10,flexWrap:"wrap",margin:"14px 0"}}>
        <input aria-label="Institution name" required maxLength={160} value={institutionName} onChange={event => setInstitutionName(event.target.value)} placeholder="New college / institution name" style={{flex:"1 1 240px",minWidth:0,border:"1px solid var(--border,#ddd)",borderRadius:9,padding:11}} />
        <button className="primary" disabled={institutionBusy}>{institutionBusy ? "Saving…" : "Create institution"}</button>
      </form>
      {institutions.length > 0 && <>
        <p className="collegePrivacyNote">Provision a specific account for this institution. You may also assign the platform owner account an explicit institution role when needed; this creates an audited, institution-scoped membership and does not grant access to other colleges.</p>
        <form onSubmit={provisionMembership} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10,margin:"14px 0"}}>
          <label>Institution<select value={selectedInstitutionId} onChange={event => setSelectedInstitutionId(event.target.value)}>{institutions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>SecureID account<select value={selectedMemberUserId} onChange={event => setSelectedMemberUserId(event.target.value)}>{users.map(user => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label>
          <label>Institution role<select value={selectedMemberRole} onChange={event => setSelectedMemberRole(event.target.value)}><option value="student">Student</option><option value="reviewer">Reviewer</option><option value="institution_admin">Institution admin</option><option value="warden">Warden (hostel operations)</option><option value="read_only">Read only</option></select></label>
          <button className="primary" type="submit" disabled={institutionBusy || !selectedMemberUserId}>Provision membership</button>
        </form>
        <form onSubmit={saveInstitutionSubscription} style={{border:"1px solid var(--border,#ddd)",borderRadius:12,padding:14,margin:"16px 0",display:"grid",gap:10}}>
          <strong>Institution subscription & feature access</strong>
          <p className="collegePrivacyNote">Subscription controls enabled modules only. It never grants Student, Warden, Reviewer or Institution Admin permissions.</p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
            <label>Plan key<input value={subscriptionPlan} maxLength={40} onChange={event => setSubscriptionPlan(event.target.value)} required /></label>
            <label>Subscription status<select value={subscriptionStatus} onChange={event => setSubscriptionStatus(event.target.value)}><option value="pilot">Pilot</option><option value="active">Active</option><option value="past_due">Past due</option><option value="suspended">Suspended</option><option value="expired">Expired</option></select></label>
            <label>Starts at (optional)<input type="datetime-local" value={subscriptionStartsAt} onChange={event => setSubscriptionStartsAt(event.target.value)} /></label>
            <label>Ends at (optional)<input type="datetime-local" value={subscriptionEndsAt} onChange={event => setSubscriptionEndsAt(event.target.value)} /></label>
          </div>
          <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
            {[
              ["hostel","Hostel management"],
              ["scholarship","Scholarship management"],
              ["student_submissions","Student document submissions"]
            ].map(([feature,label]) => <label key={feature} style={{display:"inline-flex",gap:7,alignItems:"center"}}><input type="checkbox" checked={subscriptionFeatures.includes(feature)} onChange={event => setSubscriptionFeatures(current => event.target.checked ? [...current,feature] : current.filter(item => item!==feature))} />{label}</label>)}
          </div>
          <button className="secondary" type="submit" disabled={institutionBusy || !selectedInstitutionId}>Save subscription entitlements</button>
        </form>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",margin:"10px 0"}}>
          <button type="button" className="secondary" disabled={!selectedInstitutionId} onClick={() => loadInstitutionAudit(selectedInstitutionId)}>View selected institution audit</button>
          {institutionAudit[selectedInstitutionId] && <small>{institutionAudit[selectedInstitutionId].length} recent audit events</small>}
        </div>
        {institutionAudit[selectedInstitutionId] && <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}><thead><tr><th style={{padding:"8px"}}>Time</th><th style={{padding:"8px"}}>Action</th><th style={{padding:"8px"}}>Account</th><th style={{padding:"8px"}}>Role / status</th></tr></thead><tbody>{institutionAudit[selectedInstitutionId].map((event,index)=><tr key={index}><td style={{padding:"8px",borderTop:"1px solid var(--border,#ddd)"}}>{formatDate(event.createdAt)}</td><td style={{padding:"8px",borderTop:"1px solid var(--border,#ddd)"}}>{event.action.replaceAll("_"," ")}</td><td style={{padding:"8px",borderTop:"1px solid var(--border,#ddd)"}}>{event.targetEmail}</td><td style={{padding:"8px",borderTop:"1px solid var(--border,#ddd)"}}>{event.fromRole || "—"} → {event.toRole || "—"} · {event.fromStatus || "—"} → {event.toStatus || "—"}</td></tr>)}</tbody></table></div>}
        <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}><thead><tr><th style={{padding:"10px 8px"}}>Institution</th><th style={{padding:"10px 8px"}}>Account</th><th style={{padding:"10px 8px"}}>Role</th><th style={{padding:"10px 8px"}}>Status</th><th style={{padding:"10px 8px"}}>Action</th></tr></thead><tbody>{institutionMemberships.map(member => <tr key={member.id}><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{institutions.find(item => item.id === member.institutionId)?.name || member.institutionId}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{member.email}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{member.role.replaceAll("_"," ")}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{member.status}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}><button className="primary" disabled={institutionBusy} onClick={() => updateMembership(member,member.status === "active" ? "suspended" : "active")}>{member.status === "active" ? "Suspend" : "Reactivate"}</button></td></tr>)}</tbody></table></div>
      </>}
      {institutions.length === 0 && <p>No institutions have been provisioned yet.</p>}
      <small>Never provision a student or staff role based only on an unverified email or college name. Membership does not itself authorize document downloads.</small>
    </div>
    <SecureCloudPanel />
  </section>;
}
