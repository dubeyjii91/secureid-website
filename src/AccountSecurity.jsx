import { useEffect, useMemo, useState } from "react";
import "./account-security.css";

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
  });
  const data = (response.headers.get("content-type") || "").includes("application/json")
    ? await response.json().catch(() => ({}))
    : {};
  if (!response.ok) {
    const error = new Error(data?.message || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function strength(password) {
  if (!password) return { label: "Enter a password", score: 0 };
  let score = 0;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return { label: score >= 4 ? "Strong" : score >= 3 ? "Good" : "Needs improvement", score };
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

export default function AccountSecurity() {
  const [account, setAccount] = useState(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [codes, setCodes] = useState([]);
  const [codesMessage, setCodesMessage] = useState("");
  const [codesLoading, setCodesLoading] = useState(false);

  const meter = useMemo(() => strength(newPassword), [newPassword]);

  const load = async () => {
    try {
      const result = await api("/api/security/account");
      setAccount(result.account);
    } catch (error) {
      setMessage(error.message);
    }
  };

  useEffect(() => { load(); }, []);

  const changePassword = async (event) => {
    event.preventDefault();
    if (loading) return;
    setMessage("");
    if (newPassword !== confirmPassword) {
      setMessage("New passwords do not match.");
      return;
    }
    if (meter.score < 4) {
      setMessage("Use at least 12 characters with upper/lowercase letters, a number and a symbol.");
      return;
    }
    setLoading(true);
    try {
      const result = await api("/api/security/password/change", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setMessage(result.message);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  const generateCodes = async () => {
    if (codesLoading) return;
    const confirmed = window.confirm("Generating new recovery codes will invalidate any older recovery codes. Continue?");
    if (!confirmed) return;
    setCodesLoading(true);
    setCodesMessage("");
    setCodes([]);
    try {
      const result = await api("/api/security/mfa/recovery/regenerate", { method: "POST" });
      setCodes(result.codes || []);
      setCodesMessage("Save these codes somewhere private. Each code works once.");
      await load();
    } catch (error) {
      setCodesMessage(error.message);
    } finally {
      setCodesLoading(false);
    }
  };

  const copyCodes = async () => {
    if (!codes.length) return;
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCodesMessage("Recovery codes copied. Store them securely.");
    } catch {
      setCodesMessage("Copy failed. You can select the codes and copy them manually.");
    }
  };

  return <section className="content narrow accountSecurityPage">
    <div className="functionHero compact">
      <div>
        <div className="eyebrow dark">ACCOUNT SECURITY</div>
        <h2>Keep your account protected.</h2>
        <p>Change your password, review recovery readiness, and manage one-time MFA recovery codes.</p>
      </div>
      <div className="accountSecurityVisual" aria-hidden="true">S</div>
    </div>

    <section className="panel">
      <div className="eyebrow dark">PASSWORD</div>
      <h2>Change password</h2>
      <p className="lead">Your current password and MFA verification are required. Other active sessions are signed out after a successful change.</p>
      <form className="securityForm" onSubmit={changePassword}>
        <label>Current password
          <input type="password" autoComplete="current-password" minLength={12} maxLength={72} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </label>
        <label>New password
          <input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
        </label>
        {newPassword && <div className="passwordMeter"><span>Strength: <strong>{meter.label}</strong></span><div><i style={{ width: Math.min(100, meter.score * 20) + "%" }} /></div><small>Use 12+ characters, mixed case, a number and a symbol.</small></div>}
        <label>Confirm new password
          <input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        </label>
        <button className="primary" disabled={loading}>{loading ? "Changing password…" : "Change password"}</button>
      </form>
      {message && <div className="accountSecurityMessage">{message}</div>}
    </section>

    <section className="panel">
      <div className="eyebrow dark">ACCOUNT STATUS</div>
      <h2>Security details</h2>
      <div className="securityDetailGrid">
        <div><span>Account email</span><strong>{account?.email || "Loading…"}</strong></div>
        <div><span>Account created</span><strong>{formatDate(account?.createdAt)}</strong></div>
        <div><span>Last password change</span><strong>{formatDate(account?.passwordChangedAt)}</strong></div>
        <div><span>Recovery codes remaining</span><strong>{account ? account.recoveryCodesRemaining + " / " + account.recoveryCodesTotal : "Loading…"}</strong></div>
      </div>
    </section>

    <section className="panel recoveryPanel">
      <div className="eyebrow dark">MFA RECOVERY</div>
      <h2>One-time recovery codes</h2>
      <p className="lead">Use a recovery code instead of the email verification code if you cannot receive an MFA code. Each code can be used only once.</p>
      <button className="primary" onClick={generateCodes} disabled={codesLoading}>{codesLoading ? "Generating…" : account?.recoveryCodesRemaining ? "Regenerate recovery codes" : "Generate recovery codes"}</button>
      {codes.length > 0 && <div className="recoveryCodesBox">
        <div className="recoveryWarning">These codes are shown only now. Store them somewhere private and do not share them.</div>
        <div className="recoveryCodes">{codes.map((code) => <code key={code}>{code}</code>)}</div>
        <button className="textButton" onClick={copyCodes}>Copy recovery codes</button>
      </div>}
      {codesMessage && <div className="accountSecurityMessage">{codesMessage}</div>}
    </section>
  </section>;
}
