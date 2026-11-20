import "./owner-college-institution-layout.css";
import { useEffect, useState } from "react";
import api from "./api.js";
import SecureCloudPanel from "./SecureCloudPanel.jsx";
import MonetizationPanel from "./MonetizationPanel.jsx";
import InstitutionPartnershipPanel from "./InstitutionPartnershipPanel.jsx";
import OwnerTestInstitutionCleanup from "./OwnerTestInstitutionCleanup.jsx";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function toLocalDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
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
  const [userSearch, setUserSearch] = useState("");
  const [userOffset, setUserOffset] = useState(0);
  const [matchedUsers, setMatchedUsers] = useState(0);
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
  const [accountDetails, setAccountDetails] = useState(null);
  const [detailsBusy, setDetailsBusy] = useState("");
  const [bulkPreview, setBulkPreview] = useState(null);
  const [freshStartPreview, setFreshStartPreview] = useState(null);
  const [freshStartBusy, setFreshStartBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [backupInventory, setBackupInventory] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [institutions, setInstitutions] = useState([]);
  const [institutionMemberships, setInstitutionMemberships] = useState([]);
  const [institutionName, setInstitutionName] = useState("");
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const [selectedMemberUserId, setSelectedMemberUserId] = useState("");
  const [subscriptionPlan, setSubscriptionPlan] = useState("pilot");
  const [subscriptionStatus, setSubscriptionStatus] = useState("pilot");
  const [subscriptionFeatures, setSubscriptionFeatures] = useState(["hostel","scholarship","student_submissions","academics","student_management","staff_management","students","staff","finance","admissions","homework","notices","library","calendar","examinations","timetable","reports","hr","certificates","grievances","queue"]);
  const [subscriptionStartsAt, setSubscriptionStartsAt] = useState("");
  const [subscriptionEndsAt, setSubscriptionEndsAt] = useState("");
  const [institutionError, setInstitutionError] = useState("");
  const [institutionBusy, setInstitutionBusy] = useState(false);



  useEffect(() => {
    if (!selectedInstitutionId) {
      setSubscriptionPlan("");
      setSubscriptionStatus("");
      setSubscriptionFeatures([]);
      setSubscriptionStartsAt("");
      setSubscriptionEndsAt("");
      return undefined;
    }
    let cancelled = false;
    api("/api/admin/institutions/" + encodeURIComponent(selectedInstitutionId) + "/subscription", { cache: "no-store" })
      .then(result => {
        if (cancelled || !result.subscription) return;
        const value = result.subscription;
        setSubscriptionPlan(value.planKey || "pilot");
        setSubscriptionStatus(value.status || "pilot");
        setSubscriptionFeatures(Array.isArray(value.features) ? value.features : []);
        setSubscriptionStartsAt(toLocalDateTime(value.startsAt));
        setSubscriptionEndsAt(toLocalDateTime(value.endsAt));
      })
      .catch(error => { if (!cancelled) setInstitutionError(error?.message || "Subscription settings could not be loaded."); });
    return () => { cancelled = true; };
  }, [selectedInstitutionId]);

  async function load(nextOffset = userOffset, nextSearch = userSearch) {
    setLoading(true); setError(""); setUsersError(""); setActivityError(""); setNotificationError(""); setNotice("");
    const results = await Promise.allSettled([
      api("/api/admin/health"),
      api("/api/admin/users?limit=50&offset=" + String(nextOffset) + "&search=" + encodeURIComponent(String(nextSearch || "").trim())),
      api("/api/admin/activity?limit=50"),
      api("/api/admin/notifications?limit=50"),
      api("/api/admin/institutions")
    ]);
    if (results[0].status === "fulfilled") setHealth(results[0].value);
    else setError(results[0].reason?.message || "Owner status could not be loaded.");
    if (results[1].status === "fulfilled") {
      const nextUsers = results[1].value.users || [];
      setUsers(nextUsers);
      setMatchedUsers(Number(results[1].value.matched ?? results[1].value.total ?? 0));
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
      setSelectedInstitutionId(current => (directory.institutions || []).some(item => item.id === current) ? current : "");
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

  async function previewLocalBackups() {
    setBackupBusy(true); setUsersError("");
    try {
      const result = await api("/api/admin/backups", { cache: "no-store" });
      setBackupInventory(result);
    } catch (e) {
      setUsersError(e?.message || "Encrypted backup inventory could not be loaded.");
    } finally { setBackupBusy(false); }
  }

  async function purgeLocalBackups() {
    if (!backupInventory || backupBusy || backupInventory.totalBackups === 0) return;
    const email = String(window.prompt("This permanently deletes every on-volume encrypted backup. Type the configured Owner email:", backupInventory.protectedOwnerEmail || "") || "").trim();
    if (email.toLowerCase() !== String(backupInventory.protectedOwnerEmail || "").toLowerCase()) return;
    const phrase = String(window.prompt("Type DELETE ALL ENCRYPTED BACKUPS") || "").trim();
    if (phrase !== "DELETE ALL ENCRYPTED BACKUPS") return;
    const acknowledgement = String(window.prompt("This removes on-volume recovery copies. Type I UNDERSTAND BACKUP LOSS") || "").trim();
    if (acknowledgement !== "I UNDERSTAND BACKUP LOSS") return;
    setBackupBusy(true); setUsersError(""); setNotice("");
    try {
      const result = await api("/api/admin/backups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationEmail: email, confirmationPhrase: phrase, recoveryAcknowledged: true })
      });
      await previewLocalBackups();
      setNotice("On-volume encrypted backups deleted: " + result.deletedBackups + " (" + result.deletedBytes + " bytes). Off-site GitHub artifacts were not changed.");
    } catch (e) {
      setUsersError(e?.message || "Encrypted backup purge was not completed.");
    } finally { setBackupBusy(false); }
  }

  async function createFreshBackup() {
    if (backupBusy) return;
    if (!window.confirm("Create a fresh encrypted backup of the current production data?")) return;
    setBackupBusy(true); setUsersError(""); setNotice("");
    try {
      const result = await api("/api/admin/backups/create", { method: "POST" });
      await previewLocalBackups();
      setNotice("Fresh encrypted backup created: " + result.fileName + " (" + result.sizeBytes + " bytes).");
    } catch (e) {
      setUsersError(e?.message || "Fresh encrypted backup could not be created.");
    } finally { setBackupBusy(false); }
  }

  async function previewFreshStart() {
    setFreshStartBusy(true); setUsersError(""); setFreshStartPreview(null);
    try {
      const result = await api("/api/admin/fresh-start-preview", { cache: "no-store" });
      setFreshStartPreview(result);
    } catch (e) {
      setUsersError(e?.message || "Fresh-start category preview could not be loaded.");
    } finally { setFreshStartBusy(false); }
  }

  async function previewBulkCleanup() {
    setBulkBusy(true); setUsersError(""); setBulkPreview(null);
    try {
      const result = await api("/api/admin/users/bulk-delete-preview", { cache: "no-store" });
      setBulkPreview(result);
    } catch (e) {
      setUsersError(e?.message || "Bulk cleanup preview could not be loaded.");
    } finally { setBulkBusy(false); }
  }

  async function permanentlyDeleteAllNonOwners() {
    if (!bulkPreview?.deletionAllowed || bulkBusy) return;
    const email = String(window.prompt("This deletes every non-Owner account. Type your configured Owner email to continue:", "") || "").trim();
    if (email.toLowerCase() !== "police420ias@gmail.com") return;
    const phrase = String(window.prompt("Final confirmation: type DELETE ALL NON-OWNER ACCOUNTS", "") || "").trim();
    if (phrase !== "DELETE ALL NON-OWNER ACCOUNTS") return;
    setBulkBusy(true); setUsersError(""); setNotice("");
    try {
      const result = await api("/api/admin/users/bulk-delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationEmail: email, confirmationPhrase: phrase })
      });
      setBulkPreview(null); setAccountDetails(null);
      setUserOffset(0);
      await load(0, "");
      setNotice("Fresh-start cleanup completed: " + result.deletedAccounts + " accounts, " + result.relatedRecordsRemoved + " related records, " + result.encryptedFilesRemoved + " encrypted files removed. Owner and audit history retained.");
    } catch (e) {
      setUsersError(e?.message || "Bulk cleanup was not completed.");
    } finally { setBulkBusy(false); }
  }

  async function inspectAccount(user) {
    setDetailsBusy(user.id); setUsersError(""); setAccountDetails(null);
    try {
      const result = await api("/api/admin/users/" + encodeURIComponent(user.id) + "/details", { cache: "no-store" });
      setAccountDetails(result);
    } catch (e) {
      setUsersError(e?.message || "Account details could not be loaded.");
    } finally { setDetailsBusy(""); }
  }

  async function permanentlyDeleteAccount(user) {
    if (busyUser || user.role === "owner") return;
    const email = String(window.prompt("To permanently delete this account, type its exact email address:", "") || "").trim();
    if (email.toLowerCase() !== user.email.toLowerCase()) return;
    const phrase = String(window.prompt("Final confirmation: type DELETE " + user.email, "") || "").trim();
    if (phrase.toLowerCase() !== ("DELETE " + user.email).toLowerCase()) return;
    setBusyUser(user.id); setUsersError(""); setNotice("");
    try {
      const result = await api("/api/admin/users/" + encodeURIComponent(user.id), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationEmail: email, confirmationPhrase: phrase })
      });
      setAccountDetails(null);
      await load(0, userSearch);
      setUserOffset(0);
      setNotice("Permanently deleted " + result.deletedEmail + ". " + result.relatedRecordsRemoved + " related records and " + result.encryptedFilesRemoved + " encrypted files removed. Audit history retained.");
    } catch (e) {
      setUsersError(e?.message || "Account deletion was not completed.");
    } finally { setBusyUser(""); }
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
      setNotice("Institution created. Next, provision the separate school Principal / Institution Admin account.");
    } catch (e) {
      setInstitutionError(e?.message || "Institution could not be created.");
    } finally { setInstitutionBusy(false); }
  }

  async function provisionMembership(event) {
    event.preventDefault();
    if (!selectedInstitutionId || !selectedMemberUserId) return;
    setInstitutionBusy(true); setInstitutionError(""); setNotice("");
    try {
      await api("/api/admin/institutions/" + encodeURIComponent(selectedInstitutionId) + "/memberships", {
        method: "POST", body: JSON.stringify({ userId: selectedMemberUserId, role: "institution_admin" })
      });
      await load();
      setNotice("Separate school Principal / Institution Admin access provisioned. School operations remain outside the Platform Owner workspace.");
    } catch (e) {
      setInstitutionError(e?.message || "School administrator access could not be provisioned.");
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
      <p>Search the complete account directory by email or user ID. Results are paginated; account status changes remain audited and owner-protected.</p>
      <form onSubmit={event => { event.preventDefault(); setUserOffset(0); load(0, userSearch); }} style={{display:"flex",gap:10,flexWrap:"wrap",margin:"12px 0"}}>
        <input aria-label="Search accounts by email or user ID" value={userSearch} onChange={event => setUserSearch(event.target.value)} maxLength={160} placeholder="Search any user's email or ID" style={{flex:"1 1 260px",minWidth:0,border:"1px solid var(--border,#ddd)",borderRadius:9,padding:11}} />
        <button className="primary" type="submit" disabled={loading}>Search accounts</button>
        <button className="secondary" type="button" disabled={loading} onClick={() => { setUserSearch(""); setUserOffset(0); load(0, ""); }}>Clear</button>
      </form>
      <p><small>Showing {matchedUsers === 0 ? 0 : userOffset + 1}–{Math.min(userOffset + users.length, matchedUsers)} of {matchedUsers} matching accounts · {totalUsers} total accounts</small></p>
      {usersError && <p role="alert">{usersError}</p>}
      {!loading && !usersError && users.length === 0 && <p>No matching accounts found.</p>}
      {users.length > 0 && <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}><thead><tr><th style={{padding:"10px 8px"}}>Email / ID</th><th style={{padding:"10px 8px"}}>Registered</th><th style={{padding:"10px 8px"}}>Email</th><th style={{padding:"10px 8px"}}>Account</th><th style={{padding:"10px 8px"}}>Action</th></tr></thead><tbody>{users.map((user)=><tr key={user.id}><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}><strong>{user.email}</strong><br/><small>{user.id}</small></td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{formatDate(user.createdAt)}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{user.emailVerified ? "Verified" : "Pending"}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{user.role === "owner" ? "Owner" : user.accountStatus === "suspended" ? "Suspended" : "Active"}{user.suspensionReason ? <><br/><small>Reason: {user.suspensionReason}</small></> : null}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{user.role === "owner" ? "Protected" : <div style={{display:"flex",gap:7,flexWrap:"wrap"}}><button className="secondary" disabled={Boolean(detailsBusy)} onClick={() => inspectAccount(user)}>{detailsBusy === user.id ? "Loading…" : "Inspect"}</button><button className="secondary" disabled={Boolean(busyUser)} onClick={() => setAccountStatus(user, user.accountStatus === "suspended" ? "active" : "suspended")}>{busyUser === user.id ? "Saving…" : user.accountStatus === "suspended" ? "Reactivate" : "Suspend"}</button><button className="primary" disabled={Boolean(busyUser)} onClick={() => permanentlyDeleteAccount(user)}>{busyUser === user.id ? "Deleting…" : "Delete permanently"}</button></div>}</td></tr>)}</tbody></table></div>}
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:14}}>
        <button className="secondary" disabled={loading || userOffset <= 0} onClick={() => { const next = Math.max(0, userOffset - 50); setUserOffset(next); load(next); }}>Previous</button>
        <small>Page {Math.floor(userOffset / 50) + 1} of {Math.max(1, Math.ceil(matchedUsers / 50))}</small>
        <button className="secondary" disabled={loading || userOffset + users.length >= matchedUsers} onClick={() => { const next = userOffset + 50; setUserOffset(next); load(next); }}>Next</button>
        <button className="primary" onClick={() => load(userOffset)} disabled={loading || Boolean(busyUser)}>{loading ? "Refreshing…" : "Refresh dashboard"}</button>
      </div>
      {accountDetails && <div className="panel" style={{marginTop:16}}><div className="eyebrow dark">ACCOUNT INSPECTION</div><h3>{accountDetails.user.email}</h3><p>Account ID: {accountDetails.user.id} · Created: {formatDate(accountDetails.user.createdAt)} · {accountDetails.user.protectedOwner ? "Protected Owner" : "User account"}</p><p>Related user-owned records detected: {accountDetails.totalRelatedRecords}</p><p>Deletion readiness: {accountDetails.deletionAllowed ? "No restrictive database dependencies detected" : "Blocked — dependency review required"}</p>{accountDetails.inventory?.length > 0 && <ul>{accountDetails.inventory.map((item,index)=><li key={item.table + item.column + index}>{item.table}.{item.column}: {item.count}</li>)}</ul>}{accountDetails.blockers?.length > 0 && <ul>{accountDetails.blockers.map((item,index)=><li key={item.table + item.column + index}>{item.table}.{item.column}: {item.count} dependent rows ({item.onDelete})</li>)}</ul>}<button className="secondary" onClick={() => setAccountDetails(null)}>Close details</button></div>}
      <div className="panel" style={{marginTop:16,border:"1px solid var(--border,#ddd)"}}>
        <div className="eyebrow dark">COMPLETE FRESH-START INVENTORY</div>
        <h3>Category-wise cleanup preview</h3>
        <p>Read-only inventory across non-Owner accounts and every institution. Nothing is deleted by this preview. SecureID Test College is flagged as a test candidate; RVS College and any other real institution require separate test-only confirmation.</p>
        <button className="secondary" type="button" disabled={freshStartBusy} onClick={previewFreshStart}>{freshStartBusy ? "Counting records…" : "Preview all cleanup categories"}</button>
        {freshStartPreview && <div style={{marginTop:12}}>
          <p>Protected Owner: <strong>{freshStartPreview.protectedOwnerEmail}</strong></p>
          <p>Non-Owner accounts: <strong>{freshStartPreview.nonOwnerAccounts}</strong> · Account-linked records: <strong>{freshStartPreview.accountRelatedRows}</strong></p>
          {freshStartPreview.accountCategories?.map(item => <p key={item.category}>{item.category}: <strong>{item.count}</strong></p>)}
          {freshStartPreview.institutions?.map(item => <div key={item.id} style={{padding:"10px 0",borderTop:"1px solid var(--border,#ddd)"}}>
            <strong>{item.name}</strong> {item.testCandidate ? "· Test candidate" : item.manualReviewRequired ? "· Manual test-only confirmation required" : ""}
            <p>Total institution-linked records: <strong>{item.totalRelatedRows}</strong></p>
            {item.categories.map(category => <small key={category.category} style={{display:"block"}}>{category.category}: {category.count}</small>)}
            {item.tables.map(table => <small key={table.table} style={{display:"block",color:"var(--muted,#666)"}}>{table.table}: {table.count}</small>)}
          </div>)}
          <p>{freshStartPreview.note}</p>
        </div>}
      </div>
      <div className="panel" style={{marginTop:16,border:"1px solid var(--border,#ddd)"}}><div className="eyebrow dark">FRESH-START CLEANUP</div><h3>Delete all non-Owner accounts</h3><p>Preview first. The configured Owner account is excluded by the server. Cleanup is blocked if any account has unresolved restrictive dependencies; administrative audit evidence is retained.</p><button className="secondary" type="button" disabled={bulkBusy} onClick={previewBulkCleanup}>{bulkBusy ? "Checking…" : "Preview all non-Owner accounts"}</button>{bulkPreview && <div style={{marginTop:12}}><p>Accounts to delete: <strong>{bulkPreview.accountsToDelete}</strong></p><p>Related records to delete: <strong>{bulkPreview.relatedRecordsToDelete}</strong></p><p>Owner protected: <strong>{bulkPreview.protectedOwnerEmail}</strong></p>{bulkPreview.blockedDependencies?.length > 0 && <ul>{bulkPreview.blockedDependencies.map((item,index)=><li key={item.email + item.table + index}>{item.email}: {item.table}.{item.column} — {item.count} dependent records</li>)}</ul>}<p>{bulkPreview.deletionAllowed ? "Dependency preflight passed. This action is permanent." : "Blocked until dependency review is completed."}</p><button className="primary" type="button" disabled={!bulkPreview.deletionAllowed || bulkBusy || bulkPreview.accountsToDelete===0} onClick={permanentlyDeleteAllNonOwners}>Permanently delete all non-Owner accounts</button></div>}</div>
      <div className="panel" style={{marginTop:16,border:"1px solid var(--border,#ddd)"}}>
        <div className="eyebrow dark">ON-VOLUME ENCRYPTED BACKUPS</div>
        <h3>Backup inventory and retention</h3>
        <p>This controls encrypted backup files on the Railway volume only. GitHub off-site artifacts are separate. Delete old backups only after account cleanup and after confirming the recovery impact.</p>
        <div className="collegeSubscriptionActions">
          <button className="secondary" type="button" disabled={backupBusy} onClick={previewLocalBackups}>{backupBusy ? "Checking…" : "Preview on-volume backups"}</button>
          <button className="secondary" type="button" disabled={backupBusy} onClick={createFreshBackup}>Create fresh encrypted backup</button>
        </div>
        {backupInventory && <div style={{marginTop:12}}>
          <p>Files found: <strong>{backupInventory.totalBackups}</strong> · Total size: <strong>{backupInventory.totalBytes} bytes</strong></p>
          {backupInventory.backups?.length > 0 && <ul>{backupInventory.backups.map(item => <li key={item.fileName}>{item.fileName} — {item.sizeBytes} bytes · {new Date(item.createdAt).toLocaleString()}</li>)}</ul>}
          <p>{backupInventory.message}</p>
          <button className="primary" type="button" disabled={backupBusy || backupInventory.totalBackups === 0} onClick={purgeLocalBackups}>Permanently delete on-volume backups</button>
        </div>}
      </div>
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

    <div className="panel collegeInstitutionManagement">
      <div className="eyebrow dark">SCHOOL & COLLEGE SPONSORSHIP</div>
      <h3>Sponsored institution directory · {institutions.length}</h3>
      <p>Manage institution sponsorship, pilot status and subscription entitlements here. Only the separate Principal / Institution Admin account is provisioned from this screen; student, teacher and day-to-day school records stay inside the school workspace.</p>
      {institutionError && <p role="alert">{institutionError}</p>}
      <form className="collegeCreateInstitutionForm" onSubmit={createInstitution}>
        <input aria-label="Institution name" required maxLength={160} value={institutionName} onChange={event => setInstitutionName(event.target.value)} placeholder="New school / college name" style={{flex:"1 1 240px",minWidth:0,border:"1px solid var(--border,#ddd)",borderRadius:9,padding:11}} /><button type="button" className="secondary" onClick={() => setInstitutionName("")} disabled={!institutionName}>Clear value</button>
        <button className="primary" disabled={institutionBusy}>{institutionBusy ? "Saving…" : "Create institution"}</button>
      </form>
      {institutions.length > 0 && <>
        <p className="collegePrivacyNote">Choose the verified SecureID account belonging to the school Principal or authorized Institution Admin. The Platform Owner account is intentionally excluded from school operations.</p>
        <form className="collegeProvisionForm" onSubmit={provisionMembership}>
          <label>Institution<select value={selectedInstitutionId} onChange={event => setSelectedInstitutionId(event.target.value)}><option value="">Choose institution…</option>{institutions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="secondary" disabled={institutionBusy || !selectedInstitutionId} onClick={() => setSelectedInstitutionId("")}>Clear selection</button></label>
          <label>SecureID account<select value={selectedMemberUserId} onChange={event => setSelectedMemberUserId(event.target.value)}><option value="">Choose account…</option>{users.filter(user => user.role !== "owner").map(user => <option key={user.id} value={user.id}>{user.email}</option>)}</select><button type="button" className="secondary clearFieldButton" onClick={() => setSelectedMemberUserId("")} disabled={!selectedMemberUserId}>Clear selection</button></label>
          <p className="collegePrivacyNote">Access level: School Principal / Institution Admin only. The school administrator manages teachers, students, fees, attendance and all daily operations.</p>
          <button className="primary" type="submit" disabled={institutionBusy || !selectedMemberUserId}>Provision school admin</button><button className="secondary" type="button" disabled={institutionBusy} onClick={() => setSelectedMemberUserId("")}>Clear selection</button>
        </form>
        <form className="collegeSubscriptionForm" onSubmit={saveInstitutionSubscription}>
          <strong>Institution subscription & feature access</strong>
          <p className="collegePrivacyNote">Subscription controls only manage sponsored modules and dates. They do not grant anyone an operational role.</p>
          <div className="collegeSubscriptionFields">
            <label>Plan key<input value={subscriptionPlan} maxLength={40} onChange={event => setSubscriptionPlan(event.target.value)} required /><button type="button" className="secondary" onClick={() => setSubscriptionPlan("")} disabled={!subscriptionPlan}>Clear value</button></label>
            <label>Subscription status<select value={subscriptionStatus} onChange={event => setSubscriptionStatus(event.target.value)}><option value="">Clear / choose status</option><option value="pilot">Pilot</option><option value="active">Active</option><option value="past_due">Past due</option><option value="suspended">Suspended</option><option value="expired">Expired</option></select></label>
            <label>Starts at (optional)<input type="datetime-local" value={subscriptionStartsAt} onChange={event => setSubscriptionStartsAt(event.target.value)} /><button type="button" className="secondary" onClick={() => setSubscriptionStartsAt("")} disabled={!subscriptionStartsAt}>Clear value</button></label>
            <label>Ends at (optional)<input type="datetime-local" value={subscriptionEndsAt} onChange={event => setSubscriptionEndsAt(event.target.value)} /><button type="button" className="secondary" onClick={() => setSubscriptionEndsAt("")} disabled={!subscriptionEndsAt}>Clear value</button></label>
          </div>
          <div className="collegeSubscriptionFeatures">
            {[
              ["hostel","Hostel management"],
              ["scholarship","Scholarship management"],
              ["student_submissions","Student document submissions"],["academics","Academics & attendance"],["student_management","Student management"],["staff_management","Staff management"],["finance","Finance & fees"],["admissions","Admissions"],["homework","Homework & assignments"],["notices","Notices & circulars"],["library","Library"],["calendar","Academic calendar & holidays"],["examinations","Examinations & results"],["timetable","Timetable"],["reports","Reports & exports"],["hr","HR & staff attendance"],["certificates","Certificates"],["grievances","Grievances & helpdesk"],["queue","Service queue"]
            ].map(([feature,label]) => <label key={feature} style={{display:"inline-flex",gap:7,alignItems:"center"}}><input type="checkbox" checked={subscriptionFeatures.includes(feature)} onChange={event => setSubscriptionFeatures(current => event.target.checked ? [...current,feature] : current.filter(item => item!==feature))} />{label}</label>)}
          </div>
          <div className="collegeSubscriptionActions"><button className="secondary" type="button" disabled={institutionBusy} onClick={() => { setSubscriptionPlan(""); setSubscriptionStartsAt(""); setSubscriptionEndsAt(""); setSubscriptionFeatures([]); setSubscriptionStatus(""); }}>Clear values</button><button className="secondary" type="button" disabled={institutionBusy} onClick={() => { setSubscriptionPlan("pilot"); setSubscriptionStatus("pilot"); setSubscriptionFeatures(["hostel","scholarship","student_submissions","academics","student_management","staff_management","students","staff","finance","admissions","homework","notices","library","calendar","examinations","timetable","reports","hr","certificates","grievances","queue"]); setSubscriptionStartsAt(""); setSubscriptionEndsAt(""); }}>Reset defaults</button><button className="secondary" type="submit" disabled={institutionBusy || !selectedInstitutionId || !subscriptionPlan.trim() || !subscriptionStatus}>Save subscription entitlements</button></div>
        </form>
        <div className="collegeInstitutionTableWrap"><table className="collegeInstitutionTable"><thead><tr><th>Institution</th><th style={{padding:"10px 8px"}}>Account</th><th style={{padding:"10px 8px"}}>School access</th><th style={{padding:"10px 8px"}}>Status</th><th style={{padding:"10px 8px"}}>Action</th></tr></thead><tbody>{institutionMemberships.filter(member => member.role === "institution_admin").map(member => <tr key={member.id}><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{institutions.find(item => item.id === member.institutionId)?.name || member.institutionId}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{member.email}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{"Principal / Institution Admin"}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}>{member.status}</td><td style={{padding:"10px 8px",borderTop:"1px solid var(--border,#ddd)"}}><button className="primary" disabled={institutionBusy} onClick={() => updateMembership(member,member.status === "active" ? "suspended" : "active")}>{member.status === "active" ? "Suspend" : "Reactivate"}</button></td></tr>)}</tbody></table></div>
      </>}
      {institutions.length === 0 && <p>No institutions have been provisioned yet.</p>}
      <small>Student and staff onboarding, school records and daily operations are managed by the institution Principal/Admin, not by the Platform Owner.</small>
    </div>
    <InstitutionPartnershipPanel />
    <OwnerTestInstitutionCleanup />
    <MonetizationPanel />
    <SecureCloudPanel />
  </section>;
}
