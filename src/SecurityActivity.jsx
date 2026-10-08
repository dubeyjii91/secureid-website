import { useEffect, useState } from "react";
import "./security-activity.css";

const labels = {
  ACCOUNT_CREATED: "Account created",
  EMAIL_VERIFICATION_SENT: "Verification email sent",
  LOGIN_SUCCESS: "Successful sign in",
  EMAIL_VERIFIED: "Email verified",
  PASSWORD_RESET_REQUESTED: "Password reset requested",
  PASSWORD_RESET_COMPLETED: "Password changed",
  LOGOUT: "Signed out",
  MFA_VERIFIED: "MFA verification completed",
  IDENTITY_PROFILE_UPDATED: "Identity profile updated",
  DOCUMENT_UPLOADED: "Document uploaded",
  STUDENT_ID_PROOF_UPDATED: "Student ID proof updated",
  INSTITUTION_PROOF_UPDATED: "Institution proof updated",
  DOCUMENT_ACCESSED: "Document accessed",
  DOCUMENT_DELETED: "Document deleted",
  DOCUMENT_SHARED: "Document shared",
  DOCUMENT_SHARE_REVOKED: "Document share revoked",
  WALLET_LOCKED: "Wallet locked",
  WALLET_UNLOCKED: "Wallet unlocked",
  IDENTITY_SHARED: "Identity share created",
  IDENTITY_SHARE_ACCESSED: "Identity share opened",
  IDENTITY_SHARES_REVOKED: "Identity shares revoked",
  SESSION_REVOKED: "Device session signed out",
  ALL_OTHER_SESSIONS_REVOKED: "All other device sessions signed out",
};

function browserName(ua = "") {
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/Chrome\//.test(ua)) return "Google Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  return "Browser";
}

function deviceName(ua = "") {
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) return "Mobile device";
  return "Desktop";
}

export default function SecurityActivity() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/security/activity?limit=100", { credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to load security activity.");
      setEvents(data.events || []);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return <section className="content narrow">
    <div className="functionHero compact">
      <div>
        <div className="eyebrow dark">SECURITY ACTIVITY</div>
        <h2>Your security history</h2>
        <p>Review important account, identity, sharing and document activity in one place.</p>
      </div>
      <div className="activityShield" aria-hidden="true">✓</div>
    </div>

    <section className="panel securityActivityPanel">
      <div className="panelHead">
        <div>
          <div className="eyebrow dark">AUDIT LOG</div>
          <h2>Recent security events</h2>
        </div>
        <button className="textButton" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      <p className="lead">Events are recorded with the time and browser/device used. Sensitive IP addresses are not displayed.</p>

      {message && <div className="vaultMessage">{message}</div>}
      {loading ? <div className="activityEmpty">Loading your security history…</div> :
        events.length === 0 ? <div className="activityEmpty">No security activity recorded yet.</div> :
        <div className="activityList">
          {events.map((event) => <article className="activityItem" key={event.id}>
            <div className="activityIcon">✓</div>
            <div className="activityBody">
              <strong>{labels[event.eventType] || event.eventType.replaceAll("_", " ")}</strong>
              <span>{new Date(event.createdAt).toLocaleString()}</span>
              <small>{deviceName(event.userAgent)} · {browserName(event.userAgent)}</small>
            </div>
          </article>)}
        </div>}
    </section>
  </section>;
}
