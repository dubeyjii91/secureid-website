import "./document-vault.css";
import DocumentVault from "./DocumentVault.jsx";
import SecurityActivity from "./SecurityActivity.jsx";
import SecuritySessions from "./SecuritySessions.jsx";
import ShareManagement from "./ShareManagement.jsx";
import AccountSecurity from "./AccountSecurity.jsx";
import SecurityDashboard from "./SecurityDashboard.jsx";
import SecureShareQR from "./SecureShareQR.jsx";
import { api } from "./api.js";
import "./secureid-font-clean.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import "./secureid-redesign.css";
import "./secureid-polish.css";
import "./secureid-layout-fixes.css";
import "./landing-page.css";
const defaultShare = { name: true, age: false, dateOfBirth: false, identityId: true, verificationStatus: false, email: false, phone: false, address: false, college: false, studentId: false, governmentId: false };
const defaultWallet = { risk: 18, locked: false, shareData: defaultShare };

function WelcomeSplash({ onClose }) {
  return <div className="welcomeSplash" role="dialog" aria-label="Welcome to SecureID">
    <div className="welcomeGlow" />
    <div className="welcomeCard">
      <img className="welcomeGif" src="/secureid-welcome.svg" alt="SecureID security animation" />
      <div className="eyebrow">SECUREID</div>
      <h2>Welcome to SecureID! ✨</h2>
      <p>Well wishes for a safer digital identity journey — private, secure and always in your control.</p>
      <button className="primary" onClick={onClose}>Continue securely</button>
    </div>
  </div>;
}

function FunctionVisual({ label }) {
  return <div className="functionVisual" aria-label={label}><img src="/secureid-welcome.svg" alt="" /></div>;
}

function ShareAccessGate({ type, token, recipientHint, onAccess }) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const accessUrl = `/api/${type === "document" ? "document-share" : "share"}/${token}`;
  const requestCode = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${accessUrl}/challenge`, { method: "POST", credentials: "omit", referrerPolicy: "no-referrer" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.retryAfter) setCooldown(result.retryAfter);
        throw new Error(result.message || "Could not send the access code.");
      }
      setSent(true);
      setCooldown(result.resendAvailableIn || 60);
      setMessage(`Code sent to ${result.recipientHint || recipientHint}.`);
    } catch (error) {
      setMessage(error.message || "Could not send the access code.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${accessUrl}/verify`, {
        method: "POST",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) {
        const result = contentType.includes("application/json") ? await response.json().catch(() => ({})) : {};
        throw new Error(result.message || "Could not verify the access code.");
      }
      if (type === "document") {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        onAccess({ success: true, url, mimeType: blob.type || contentType || "application/octet-stream", name: "Shared SecureID document", purpose: response.headers.get("X-SecureID-Share-Reason") || "" });
      } else {
        onAccess(await response.json());
      }
    } catch (error) {
      setMessage(error.message || "Could not verify the access code.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="shareAccessGate">
    <p>The owner protected this share with a one-time email code. Request the code sent to <strong>{recipientHint || "the recipient email on file"}</strong> to view it.</p>
    <button className="primary" type="button" onClick={requestCode} disabled={busy || cooldown > 0}>{busy ? "Please wait…" : sent ? cooldown > 0 ? `Resend in ${cooldown}s` : "Send another code" : "Send access code"}</button>
    {sent && <form onSubmit={verifyCode} className="shareAccessForm"><label>Email code<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></label><button className="primary" type="submit" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Unlock share"}</button></form>}
    {message && <p className="shareAccessMessage" role="status">{message}</p>}
    <p className="shareExpiry">The code expires after five minutes. The share itself remains time-limited.</p>
  </div>;
}

const navItems = [
  ["dashboard", "Dashboard", "◉"],
  ["identity", "My identity", "◆"],
  ["documents", "Document vault", "▣"],
  ["share", "Share ID", "↗"],
  ["safety", "Safety check", "✓"],
  ["lock", "Emergency lock/unlock", "◆"],
  ["activity", "Security activity", "◉"],
  ["sessions", "Active sessions", "▣"],
  ["shares", "Share management", "↗"],
  ["account", "Account security", "⚿"],
];

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionUser, setSessionUser] = useState("");
  const [wallet, setWallet] = useState(defaultWallet);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [page, setPage] = useState("dashboard");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaVerified, setMfaVerified] = useState(false);
  const [otp, setOtp] = useState("");
  const [mfaRecoveryMode, setMfaRecoveryMode] = useState(false);
  const [challengeId, setChallengeId] = useState("");
  const [mfaMessage, setMfaMessage] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [phishingUrl, setPhishingUrl] = useState("");
  const [phishingResult, setPhishingResult] = useState(null);
  const [shareToken, setShareToken] = useState("");
  const [shareExpiresAt, setShareExpiresAt] = useState("");
  const [shareClock, setShareClock] = useState(() => Date.now());
  const [shareContext, setShareContext] = useState("");
  const [shareRecipientEmail, setShareRecipientEmail] = useState("");
  const [shareDurationMinutes, setShareDurationMinutes] = useState(15);
  const [publicShare, setPublicShare] = useState(null);
  const [publicDocumentShare, setPublicDocumentShare] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [verificationPending, setVerificationPending] = useState(() => new URLSearchParams(window.location.search).has("verify_email"));
  const [verificationMessage, setVerificationMessage] = useState(() => new URLSearchParams(window.location.search).has("verify_email") ? "Verifying your email address…" : "");
  const [recoveryMode, setRecoveryMode] = useState(() => new URLSearchParams(window.location.search).has("reset_password") ? "reset" : "");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get("reset_password") || "");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [showWelcome, setShowWelcome] = useState(true);
  const [textScale, setTextScale] = useState(100);

  useEffect(() => {
    document.documentElement.style.fontSize = `${textScale}%`;
    return () => { document.documentElement.style.fontSize = ""; };
  }, [textScale]);

  const riskState = useMemo(() => {
    if (wallet.locked) return { label: "Action needed", tone: "danger", detail: "Your wallet is locked." };
    if (wallet.risk >= 70) return { label: "Action needed", tone: "danger", detail: "Review recent activity and verify MFA." };
    if (wallet.risk >= 40) return { label: "Review recommended", tone: "warning", detail: "Some activity may need your attention." };
    return { label: "Protected", tone: "success", detail: "No immediate action is required." };
  }, [wallet]);

  useEffect(() => {
    const navigate=(event)=>{ if(event.detail) setPage(event.detail); };
    window.addEventListener("secureid:navigate",navigate);
    return()=>window.removeEventListener("secureid:navigate",navigate);
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (!shareExpiresAt) return undefined;
    const id=window.setInterval(() => setShareClock(Date.now()),1000);
    return()=>window.clearInterval(id);
  }, [shareExpiresAt]);

  const shareRemaining = useMemo(() => {
    if (!shareExpiresAt) return "";
    const ms=Date.parse(shareExpiresAt)-shareClock;
    if(ms<=0) return "Expired";
    const s=Math.floor(ms/1000);
    return `Expires in ${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  }, [shareExpiresAt, shareClock]);

  const applySession = useCallback((result) => {
    setIsAuthenticated(true);
    setSessionUser(result.user.email);
    setMfaVerified(Boolean(result.user.mfaVerified));
    setMfaRequired(!result.user.mfaVerified);
    if (result.wallet) setWallet(result.wallet);
  }, []);

  const requestOtp = useCallback(async () => {
    setMfaLoading(true);
    setChallengeId("");
    setOtp("");
    setMfaMessage("Sending a verification code…");
    try {
      const result = await api("/api/mfa/challenge", { method: "POST" });
      setChallengeId(result.challengeId);
      setResendCooldown(result.resendAvailableIn || 60);
      setMfaMessage("Your email provider accepted the code request. Check Inbox, Spam, and Promotions. The code expires in five minutes.");
    } catch (error) {
      if (error.retryAfter) setResendCooldown(error.retryAfter);
      setMfaMessage(error.code === "EMAIL_DELIVERY_FAILED"
        ? `${error.message} Also check Spam and Promotions before retrying.`
        : error.message);
    } finally {
      setMfaLoading(false);
    }
  }, []);

  // SECUREID_QUERY_HANDLERS
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get("verify_email");
    const passwordToken = params.get("reset_password");

    if (verifyToken) {
      api(`/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`)
        .then((result) => {
          setVerificationMessage(result.message || "Your email has been verified. You can sign in now.");
          setAuthMode("login");
        })
        .catch((error) => {
          setVerificationMessage(error.message || "Email verification failed.");
        })
        .finally(() => {
          window.history.replaceState({}, document.title, window.location.pathname);
        });
    }

    if (passwordToken) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const documentMatch = window.location.pathname.match(/^\/document-share\/([A-Za-z0-9_-]{30,100})$/);
    if (documentMatch) {
      fetch("/api/document-share/" + documentMatch[1], { credentials: "omit" })
        .then(async (response) => {
          const contentType = response.headers.get("content-type") || "";
          if (!response.ok) {
            const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : {};
            throw new Error(data.message || "This secure document share is no longer available.");
          }
          if (contentType.includes("application/json")) {
            const data = await response.json();
            if (data.accessRequired) return setPublicDocumentShare(data);
            throw new Error(data.message || "This secure document share is unavailable.");
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          setPublicDocumentShare({ success: true, url, mimeType: blob.type || contentType || "application/octet-stream", name: "Shared SecureID document", purpose: response.headers.get("X-SecureID-Share-Reason") || "" });
        })
        .catch((error) => setPublicDocumentShare({ success: false, message: error.message }))
        .finally(() => setSessionLoading(false));
      return;
    }

    const match = window.location.pathname.match(/^\/share\/([A-Za-z0-9_-]{30,100})$/);
    if (match) {
      fetch("/api/share/" + match[1], { credentials: "omit" })
        .then(async (response) => {
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.message || "This secure share is no longer available.");
          return result;
        })
        .then((result) => setPublicShare(result))
        .catch((error) => setPublicShare({ success: false, message: error.message }))
        .finally(() => setSessionLoading(false));
      return;
    }

    api("/api/auth/session")
      .then(async (result) => {
        applySession(result);
        if (!result.user.mfaVerified) await requestOtp();
      })
      .catch(() => {})
      .finally(() => setSessionLoading(false));
  }, [applySession, requestOtp]);

  const submitAuth = async (event) => {
    event.preventDefault();
    if (authLoading) return;

    setAuthLoading(true);
    setAuthMessage("");

    try {
      const result = await api(`/api/auth/${authMode}`, {
        method: "POST",
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });

      setAuthPassword("");

      if (authMode === "register") {
        setVerificationMessage(result.message || "Account created. Check your email to verify your address before signing in.");
        setAuthMessage("");
        setAuthMode("login");
        return;
      }

      applySession({ ...result, wallet: result.wallet || defaultWallet });
      setWallet(result.wallet || defaultWallet);
      await requestOtp();
    } catch (error) {
      if (error.status === 403 && error.message) {
        setVerificationMessage(error.message);
      }
      setAuthMessage(error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const resendVerification = async () => {
    if (!authEmail || recoveryLoading) return;

    setRecoveryLoading(true);
    setRecoveryMessage("");

    try {
      const result = await api("/api/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email: authEmail }),
      });
      setRecoveryMessage(result.message || "Verification email sent.");
    } catch (error) {
      setRecoveryMessage(error.message);
    } finally {
      setRecoveryLoading(false);
    }
  };

  const forgotPassword = async (event) => {
    event.preventDefault();
    if (!authEmail || recoveryLoading) return;

    setRecoveryLoading(true);
    setRecoveryMessage("");

    try {
      const result = await api("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: authEmail }),
      });
      setRecoveryMessage(result.message || "If the account exists, a reset email has been sent.");
    } catch (error) {
      setRecoveryMessage(error.message);
    } finally {
      setRecoveryLoading(false);
    }
  };

  const submitResetPassword = async (event) => {
    event.preventDefault();

    if (recoveryLoading || !resetToken) return;

    if (resetPassword.length < 12) {
      setRecoveryMessage("Password must be at least 12 characters.");
      return;
    }

    if (resetPassword !== resetPasswordConfirm) {
      setRecoveryMessage("Passwords do not match.");
      return;
    }

    setRecoveryLoading(true);
    setRecoveryMessage("");

    try {
      const result = await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          token: resetToken,
          password: resetPassword,
        }),
      });

      setRecoveryMessage(result.message || "Password reset successfully. You can sign in now.");
      setResetPassword("");
      setResetPasswordConfirm("");
      setResetToken("");
      setRecoveryMode("");
      setAuthMode("login");
    } catch (error) {
      setRecoveryMessage(error.message);
    } finally {
      setRecoveryLoading(false);
    }
  };

  const verifyOtp = async (event) => {
    event.preventDefault();
    const validRecovery = mfaRecoveryMode && /^[A-Za-z0-9-]{16,24}$/.test(otp);
    if ((!mfaRecoveryMode && (otp.length !== 6 || !challengeId)) || (mfaRecoveryMode && !validRecovery) || mfaLoading) return;
    setMfaLoading(true);
    setMfaMessage(mfaRecoveryMode ? "Verifying recovery code…" : "Verifying your code…");
    try {
      const result = await api("/api/mfa/verify", { method: "POST", body: JSON.stringify({ challengeId: mfaRecoveryMode ? "" : challengeId, code: otp, trustDevice: !mfaRecoveryMode && trustDevice }) });
      setMfaVerified(true);
      setMfaRequired(false);
      setChallengeId("");
      setOtp("");
      setMfaRecoveryMode(false);
      setTrustDevice(false);
      setMfaMessage(result.message);
    } catch (error) {
      if (error.status === 410) setChallengeId("");
      setMfaMessage(error.message);
    } finally {
      setMfaLoading(false);
    }
  };

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setIsAuthenticated(false);
    setSessionUser("");
    setWallet(defaultWallet);
    setAuthEmail("");
    setAuthPassword("");
    setMfaRequired(false);
    setMfaVerified(false);
    setChallengeId("");
    setOtp("");
    setMfaRecoveryMode(false);
  };

  const toggleLock = async () => {
    setBusyAction("lock");
    try {
      const result = await api("/api/wallet/lock", { method: "POST", body: JSON.stringify({ locked: !wallet.locked }) });
      setWallet(result.wallet);
    } catch (error) {
      setMfaMessage(error.message);
    } finally {
      setBusyAction("");
    }
  };

  const toggleShareData = (field) => {
    setWallet((current) => ({ ...current, shareData: { ...current.shareData, [field]: !current.shareData[field] } }));
    setShareToken("");
  };

  const generateSecureShare = async () => {
    setBusyAction("share");
    try {
      const result = await api("/api/wallet/share", { method: "POST", body: JSON.stringify({ ...wallet.shareData, recipientEmail: shareRecipientEmail, shareDurationMinutes, contextLabel: shareContext, share_reason: shareContext }) });
      setWallet(result.wallet);
      setShareToken(result.shareToken);
      setShareExpiresAt(result.shareExpiresAt || "");
    } catch (error) {
      setMfaMessage(error.message);
    } finally {
      setBusyAction("");
    }
  };

  const shareSecureLink = async () => {
    if (!shareToken) return;
    const link = new URL("/share/" + shareToken, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: "SecureID secure share", text: "SecureID identity share", url: link });
        setMfaMessage("Secure share opened in your device share menu.");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(link);
        setMfaMessage("Secure share link copied. Paste it into WhatsApp, email, SMS, or another app.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") setMfaMessage("Could not open the share menu. Use Copy secure link instead.");
    }
  };

  const copySecureLink = async () => {
    if (!shareToken) return;
    const link = new URL("/share/" + shareToken, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(link);
      setMfaMessage("Secure share link copied. Paste it into WhatsApp, email, SMS, or another app.");
    } catch {
      setMfaMessage("Copy failed. Select the link manually and copy it.");
    }
  };

  const revokeSecureShares = async () => {
    setBusyAction("revoke");
    try {
      await api("/api/wallet/share/revoke", { method: "POST" });
      setShareToken("");
      setShareExpiresAt("");
      setMfaMessage("All active secure shares have been revoked.");
    } catch (error) {
      setMfaMessage(error.message);
    } finally {
      setBusyAction("");
    }
  };

  const scanPhishingUrl = () => {
    const value = phishingUrl.trim();
    if (!value) return setPhishingResult({ safe: false, text: "Enter a website address to scan." });
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      const hostname = url.hostname.toLowerCase();
      const labels = hostname.split(".");
      const suspicious = url.protocol !== "https:" || labels.length > 4 || [...hostname].some((character) => character.charCodeAt(0) > 127) || /(^|[-.])(secureid-login|verify-account|account-security)([-.]|$)/.test(hostname);
      setPhishingResult(suspicious ? { safe: false, text: "Suspicious indicators found. Do not enter passwords or verification codes on this site." } : { safe: true, text: "No obvious phishing indicators detected. Still verify the site before entering sensitive information." });
    } catch {
      setPhishingResult({ safe: false, text: "Invalid website address." });
    }
  };

  if (sessionLoading) return <div className="loadingPage"><div className="spinner" /><span>Loading SecureID share…</span></div>;

  if (publicDocumentShare) {
    if (!publicDocumentShare.success) return <div className="authShell"><div className="authBrand"><span className="shield">S</span><span>SecureID</span></div><section className="authCard"><div className="eyebrow">SECURE DOCUMENT SHARE</div><h1>Document unavailable</h1><p>{publicDocumentShare.message || "This secure document share has expired or was revoked."}</p><a className="textButton" href="/">Open SecureID</a></section></div>;
    if (publicDocumentShare.accessRequired) return <div className="authShell"><div className="authBrand"><span className="shield">S</span><span>SecureID</span></div><section className="authCard"><div className="eyebrow">SECURE DOCUMENT SHARE</div><h1>Unlock shared document</h1><ShareAccessGate type="document" token={window.location.pathname.split("/").pop()} recipientHint={publicDocumentShare.recipientHint} onAccess={setPublicDocumentShare} /><a className="textButton" href="/">Open SecureID</a></section></div>;
    const mime = publicDocumentShare.mimeType || "";
    return <div className="authShell"><div className="authBrand"><span className="shield">S</span><span>SecureID</span></div><section className="authCard publicDocumentCard"><div className="eyebrow">SECURE DOCUMENT SHARE</div><h1>Shared document</h1><p>This document was shared through a time-limited SecureID link.</p>{publicDocumentShare.purpose && <div className="shareContextPublic"><strong>Share purpose</strong><span>{publicDocumentShare.purpose}</span></div>}{mime === "application/pdf" ? <iframe className="sharedDocumentFrame" src={publicDocumentShare.url} title="Shared SecureID document" /> : mime.startsWith("image/") ? <img className="sharedDocumentImage" src={publicDocumentShare.url} alt="Shared SecureID document" /> : <a className="primary" href={publicDocumentShare.url} target="_blank" rel="noreferrer">Open document</a>}<a className="textButton" href="/">Open SecureID</a></section></div>;
  }

  if (publicShare) {
    if (!publicShare.success) return <div className="authShell"><div className="authBrand"><span className="shield">S</span><span>SecureID</span></div><section className="authCard"><div className="eyebrow">SECURE SHARE</div><h1>Share unavailable</h1><p>{publicShare.message || "This secure share is no longer available."}</p><a className="textButton" href="/">Open SecureID</a></section></div>;
    if (publicShare.accessRequired) return <div className="authShell"><div className="authBrand"><span className="shield">S</span><span>SecureID</span></div><section className="authCard"><div className="eyebrow">SECURE SHARE</div><h1>Unlock shared identity</h1><ShareAccessGate type="identity" token={window.location.pathname.split("/").pop()} recipientHint={publicShare.recipientHint} onAccess={setPublicShare} /><a className="textButton" href="/">Open SecureID</a></section></div>;
    const claims = publicShare.claims || {};
    return <div className="authShell"><div className="authBrand"><span className="shield">S</span><span>SecureID</span></div><section className="authCard"><div className="eyebrow">SECURE SHARE</div><h1>Shared identity</h1>{publicShare.verificationBadge?.verified && <div className="verificationBadge" title="This badge is issued by SecureID for a valid share created after MFA verification."><span>✓</span><div><strong>{publicShare.verificationBadge.label || "SecureID Verified Share"}</strong><small>{publicShare.verificationBadge.assurance || "MFA-authenticated at creation"}</small></div></div>}<p>This page contains only the identity claims selected by the account owner.</p><div className="shareTrustNotice"><strong>Owner-provided information</strong><span>These claims were shared by the account owner. SecureID has not independently verified their accuracy or authenticity.</span></div>{publicShare.contextLabel && <div className="shareContextPublic"><strong>Share purpose</strong><span>{publicShare.contextLabel}</span></div>}<div className="sharePublicGrid">{Object.entries(claims).filter(([, value]) => String(value ?? "").trim() !== "").map(([key,value]) => <div className="sharePublicItem" key={key}><span>{key.replace(/([A-Z])/g, " $1").replace(/^./, (m) => m.toUpperCase())}</span><strong>{String(value)}</strong></div>)}</div><p className="shareExpiry">Expires {publicShare.expiresAt ? new Date(publicShare.expiresAt).toLocaleString() : "soon"}.</p></section></div>;
  }

  if (!isAuthenticated) {
    if (verificationPending) {
      return (
        <div className="authShell">
          <div className="authBrand"><span className="shield">S</span><span>SecureID</span></div>
          <section className="authCard">
            <div className="eyebrow">EMAIL VERIFICATION</div>
            <h1>{verificationMessage === "Verifying your email address…" ? "Verify your email" : "Email verification"}</h1>
            <p>{verificationMessage === "Verifying your email address…" ? "We're confirming your SecureID email address." : "Your verification request has finished."}</p>
            <div className="authMessage">{verificationMessage}</div>
            {verificationMessage !== "Verifying your email address…" && <button className="textButton" onClick={() => setVerificationPending(false)}>Continue to sign in</button>}
          </section>
        </div>
      );
    }

    if (recoveryMode === "reset") {
      return (
        <div className="authShell">
          <div className="authBrand"><span className="shield">S</span><span>SecureID</span></div>
          <section className="authCard">
            <div className="eyebrow">ACCOUNT RECOVERY</div>
            <h1>Set a new password</h1>
            <p>Create a new password for your SecureID account.</p>

            <form onSubmit={submitResetPassword}>
              <label>New password
                <input
                  type="password"
                  required
                  minLength={12}
                  maxLength={72}
                  autoComplete="new-password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                />
              </label>

              <label>Confirm password
                <input
                  type="password"
                  required
                  minLength={12}
                  maxLength={72}
                  autoComplete="new-password"
                  value={resetPasswordConfirm}
                  onChange={(e) => setResetPasswordConfirm(e.target.value)}
                />
              </label>

              <button className="primary full" disabled={recoveryLoading}>
                {recoveryLoading ? "Updating…" : "Update password"}
              </button>
            </form>

            <div className="authMessage">{recoveryMessage}</div>
            <button className="textButton" onClick={() => {
              setRecoveryMode("");
              setRecoveryMessage("");
            }}>
              Back to sign in
            </button>
          </section>
        </div>
      );
    }

    if (recoveryMode === "forgot") {
      return (
        <div className="authShell">
          <div className="authBrand"><span className="shield">S</span><span>SecureID</span></div>
          <section className="authCard">
            <div className="eyebrow">ACCOUNT RECOVERY</div>
            <h1>Forgot your password?</h1>
            <p>Enter your account email and we'll send a secure password reset link.</p>

            <form onSubmit={forgotPassword}>
              <label>Email address
                <input
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                />
              </label>

              <button className="primary full" disabled={recoveryLoading}>
                {recoveryLoading ? "Sending…" : "Send reset link"}
              </button>
            </form>

            <div className="authMessage">{recoveryMessage}</div>

            <button className="textButton" onClick={() => {
              setRecoveryMode("");
              setRecoveryMessage("");
            }}>
              Back to sign in
            </button>
          </section>
        </div>
      );
    }

    return (
      <div className="authShell authLanding">
        <div className="authBrand"><span className="shield">S</span><span>SecureID</span></div>

        <section className="landingIntro" aria-labelledby="landing-title">
          <div className="landingEyebrow"><span className="landingEyebrowDot" /> YOUR IDENTITY, IN YOUR HANDS</div>
          <h1 id="landing-title">Your identity.<br /><span>Your choice.</span></h1>
          <p className="landingLead">A private place to manage your identity and documents, then share only the details you choose.</p>

          <div className="landingFeatures">
            <article className="landingFeature">
              <span className="landingFeatureIcon" aria-hidden="true">◇</span>
              <div><h2>Share only what matters</h2><p>Choose the identity details a recipient can see. Your share has an expiry and can be revoked.</p></div>
            </article>
            <article className="landingFeature">
              <span className="landingFeatureIcon" aria-hidden="true">▣</span>
              <div><h2>Keep documents together</h2><p>Manage your identity documents in one private vault, protected by your account.</p></div>
            </article>
            <article className="landingFeature">
              <span className="landingFeatureIcon" aria-hidden="true">✓</span>
              <div><h2>Add a layer of account security</h2><p>Email verification and multi-factor checks help protect sign-in and sensitive actions.</p></div>
            </article>
          </div>

          <div className="landingSteps" aria-label="How SecureID works">
            <div><span>01</span><strong>Create your account</strong></div>
            <i aria-hidden="true" />
            <div><span>02</span><strong>Add your details</strong></div>
            <i aria-hidden="true" />
            <div><span>03</span><strong>Share on your terms</strong></div>
          </div>
          <p className="landingPrivacy"><span aria-hidden="true">✓</span> You stay in control of what you share.</p>
        </section>

        <section className="authCard">
          <div className="eyebrow">SECURE DIGITAL IDENTITY</div>

          <h1>{authMode === "register" ? "Create your account" : "Welcome back"}</h1>

          <p>
            Protect your digital identity with secure authentication,
            MFA and privacy-first sharing.
          </p>

          <div className="authTabs">
            <button
              className={authMode === "login" ? "active" : ""}
              onClick={() => {
                setAuthMode("login");
                setAuthMessage("");
                setRecoveryMessage("");
              }}
            >
              Sign in
            </button>

            <button
              className={authMode === "register" ? "active" : ""}
              onClick={() => {
                setAuthMode("register");
                setAuthMessage("");
                setRecoveryMessage("");
              }}
            >
              Create account
            </button>
          </div>

          <form onSubmit={submitAuth}>
            <label>Email address
              <input
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
              />
            </label>

            <label>Password
              <input
                type="password"
                required
                minLength={12}
                maxLength={72}
                autoComplete={authMode === "register" ? "new-password" : "current-password"}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
            </label>

            <button className="primary full" disabled={authLoading}>
              {authLoading
                ? "Authenticating…"
                : authMode === "register"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>

          <div className="authMessage">{authMessage}</div>
          <div className="authMessage">{verificationMessage}</div>

          {authMode === "login" && (
            <>
              <button
                className="textButton"
                onClick={() => {
                  setRecoveryMode("forgot");
                  setRecoveryMessage("");
                  setAuthMessage("");
                }}
              >
                Forgot password?
              </button>

              {authMessage && /verif/i.test(authMessage) && (
                <button
                  className="textButton"
                  disabled={recoveryLoading}
                  onClick={resendVerification}
                >
                  {recoveryLoading ? "Sending…" : "Resend verification email"}
                </button>
              )}
            </>
          )}

          <small>Multi-factor verification is required after sign-in.</small>
        </section>
      </div>
    );
  }

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><span className="shield">S</span><div><strong>SecureID</strong><small>Identity wallet</small></div></div><div className="navLabel">YOUR WALLET</div><nav>{navItems.map(([id, label, icon]) => <button key={id} className={page === id ? "navItem active" : "navItem"} onClick={() => setPage(id)}><span>{icon}</span>{label}</button>)}</nav><div className="sideBottom"><div className="privacy"><span>✓</span><div><strong>Privacy first</strong><p>Only share the claims you choose.</p></div></div><button className="signOut" onClick={signOut}>Sign out</button></div></aside>
    <main className="main"><header className="topbar"><div><div className="breadcrumb">SECUREID / {navItems.find(([id]) => id === page)?.[1].toUpperCase()}</div><h1>{page === "identity" ? "My SecureID" : navItems.find(([id]) => id === page)?.[1]}</h1></div><div className="topbarActions"><div className="textSizeControls" role="group" aria-label="Text size controls"><button type="button" className="textSizeButton" aria-label="Decrease text size" disabled={textScale <= 85} onClick={() => setTextScale((size) => Math.max(85, size - 5))}>A−</button><span aria-live="polite">{textScale}%</span><button type="button" className="textSizeButton" aria-label="Increase text size" disabled={textScale >= 125} onClick={() => setTextScale((size) => Math.min(125, size + 5))}>A+</button></div><div className="account"><span className="online" />{sessionUser}<span className="verifiedBadge">{mfaVerified ? "MFA verified" : "MFA pending"}</span></div></div></header>

      {page === "dashboard" && <SecurityDashboard />}

      {page === "documents" && <section className="content"><DocumentVault /></section>}

      {page === "identity" && <section className="content"><div className="functionHero"><div><div className="eyebrow dark">SECUREID SECURITY CENTER</div><h2>Privacy-first identity, protected by design.</h2><p>Keep control of your identity while every important action stays protected.</p></div><FunctionVisual label="SecureID identity protection" /></div><div className="profileGrid"><section className="panel profilePanel"><div className="panelHead"><div><div className="eyebrow dark">IDENTITY PROFILE</div><h2>Your identity profile</h2></div><span className="statusBadge success">✓ Account active</span></div><div className="profile"><div className="avatar">{sessionUser.slice(0, 1).toUpperCase()}</div><div><h3>{sessionUser.split("@")[0]}</h3><p>{sessionUser}</p></div></div><div className="details"><div><span>Identity ID</span><strong>SID-{sessionUser.slice(0, 4).toUpperCase()}-••••</strong></div><div><span>Authentication</span><strong>{mfaVerified ? "MFA verified" : "Verification required"}</strong></div><div><span>Wallet status</span><strong>{wallet.locked ? "Locked" : "Active"}</strong></div></div></section><section className="panel statusPanel"><div className="eyebrow dark">ACCOUNT SECURITY</div><h2>{riskState.label}</h2><div className={`securityIcon ${riskState.tone}`}>{riskState.tone === "success" ? "✓" : riskState.tone === "warning" ? "!" : "!"}</div><p>{riskState.detail}</p><div className="securityRow"><span>MFA</span><strong>{mfaVerified ? "Enabled" : "Required"}</strong></div><div className="securityRow"><span>Wallet</span><strong>{wallet.locked ? "Locked" : "Protected"}</strong></div></section></div><div className="sectionTitle"><div><div className="eyebrow dark">QUICK ACTIONS</div><h2>Manage your identity</h2></div></div><div className="actionGrid"><button className="actionCard" onClick={() => setPage("share")}><span className="actionIcon">↗</span><strong>Share my ID</strong><p>Choose exactly which identity claims to share.</p></button><button className="actionCard" onClick={() => setPage("safety")}><span className="actionIcon">✓</span><strong>Check a website</strong><p>Look for common phishing indicators before signing in.</p></button><button className="actionCard" onClick={() => setPage("lock")}><span className="actionIcon">◆</span><strong>Emergency lock/unlock</strong><p>Pause wallet sharing if you think your account is at risk.</p></button></div><div className="note"><strong>Privacy note</strong><span>Your SecureID wallet keeps sharing selective. A share only includes the claims you explicitly select.</span></div></section>}

      {page === "share" && <section className="content narrow"><div className="functionHero compact"><div><div className="eyebrow dark">SELECTIVE DISCLOSURE</div><h2>Share only what you need.</h2><p>Secure, controlled identity sharing with time-limited access.</p></div><FunctionVisual label="SecureID secure sharing" /></div><section className="panel"><div className="eyebrow dark">SELECTIVE DISCLOSURE</div><h2>Share only what you need</h2><p className="lead">Choose the identity claims you want to include. Your wallet will not create a share while it is locked, and MFA must be verified.</p><div className="claimGrid">{[["name","Name"],["age","Age"],["dateOfBirth","Date of Birth"],["address","Address"],["email","Email"],["phone","Phone Number"],["identityId","Identity ID"],["college","College / Institution"],["studentId","Student ID"],["governmentId","Government ID (masked)"],["verificationStatus","Verification Status"]].map(([key,label]) => <label className={`claim ${wallet.shareData[key] ? "selected" : ""}`} key={key}><input type="checkbox" checked={wallet.shareData[key]} onChange={() => toggleShareData(key)} disabled={wallet.locked} /><span>{label}</span></label>)}</div><label className="shareContextField"><span>Share purpose</span><input maxLength={160} value={shareContext} onChange={(e) => setShareContext(e.target.value)} placeholder="e.g. College verification" disabled={wallet.locked} /><small>Optional: tell the recipient why you are sharing this information.</small></label><label className="shareContextField"><span>Link expires after</span><select value={shareDurationMinutes} onChange={(event) => setShareDurationMinutes(Number(event.target.value))} disabled={wallet.locked}><option value={15}>15 minutes</option><option value={60}>1 hour</option><option value={1440}>24 hours</option></select><small>Choose the shortest time the recipient needs. You can revoke the link sooner.</small></label><label className="shareContextField"><span>Recipient email</span><input type="email" autoComplete="email" maxLength={254} value={shareRecipientEmail} onChange={(e) => setShareRecipientEmail(e.target.value)} placeholder="recipient@example.com" disabled={wallet.locked} required /><small>A one-time code will be sent here before anyone can view the shared claims.</small></label><button className="primary" onClick={generateSecureShare} disabled={wallet.locked || busyAction === "share" || !mfaVerified || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shareRecipientEmail.trim())}>{busyAction === "share" ? "Generating…" : "Generate secure share"}</button>{shareToken && <div className="shareResult"><strong>Secure share created</strong><p>Only the recipient who can access {shareRecipientEmail} can unlock this share. Keep the link private.</p><code>{window.location.origin + "/share/" + shareToken}</code><div className="shareLinkActions"><button className="primary" onClick={shareSecureLink} type="button">Share now</button><button className="textButton" onClick={copySecureLink} type="button">Copy link</button></div><p className="shareHint">The recipient opens this link, requests a one-time email code, then enters it to view the selected claims. They do not need a SecureID account.</p><p className="shareExpiry">{shareRemaining || "Expires soon"} · {shareExpiresAt ? new Date(shareExpiresAt).toLocaleString() : ""}</p><button className="textButton" onClick={revokeSecureShares} disabled={busyAction === "revoke"}>{busyAction === "revoke" ? "Revoking…" : "Revoke active shares"}</button></div>}<SecureShareQR token={shareToken} expiresAt={shareExpiresAt} /></section></section>}

      {page === "safety" && <section className="content narrow"><div className="functionHero compact"><div><div className="eyebrow dark">SECURITY CHECK</div><h2>Check before you trust.</h2><p>Spot common phishing warning signs before you sign in.</p></div><FunctionVisual label="SecureID safety protection" /></div><section className="panel"><div className="eyebrow dark">SAFETY CHECK</div><h2>Check a website before you sign in</h2><p className="lead">This quick check looks for a few common warning signs. It is not a guarantee that a website is safe.</p><div className="urlForm"><input value={phishingUrl} onChange={(e) => setPhishingUrl(e.target.value)} placeholder="example.com" aria-label="Website address" /><button className="primary" onClick={scanPhishingUrl}>Check website</button></div>{phishingResult && <div className={`scanResult ${phishingResult.safe ? "safe" : "warning"}`}><strong>{phishingResult.safe ? "No obvious warning signs" : "Use caution"}</strong><p>{phishingResult.text}</p></div>}<div className="tips"><div><strong>Use HTTPS</strong><span>Check that the address starts with https://.</span></div><div><strong>Check the domain</strong><span>Look closely for extra words, unusual characters or misspellings.</span></div><div><strong>Never share OTPs</strong><span>SecureID verification codes should not be given to another person.</span></div></div></section></section>}

      {page === "activity" && <SecurityActivity />}

      {page === "sessions" && <SecuritySessions />}

      {page === "shares" && <ShareManagement />}

      {page === "account" && <AccountSecurity />}

      {page === "lock" && <section className="content narrow"><div className="functionHero compact"><div><div className="eyebrow dark">EMERGENCY CONTROL</div><h2>Stay in control of access.</h2><p>Pause identity sharing whenever you need extra protection.</p></div><FunctionVisual label="SecureID emergency protection" /></div><section className={`panel lockPanel ${wallet.locked ? "locked" : ""}`}><div className="lockGraphic">{wallet.locked ? "!" : "✓"}</div><div className="eyebrow dark">EMERGENCY ACCESS CONTROL</div><h2>{wallet.locked ? "Your wallet is locked" : "Your wallet is active"}</h2><p className="lead">{wallet.locked ? "Sharing is paused. Restore access when you are ready and have confirmed your account is secure." : "If you suspect unauthorized activity, lock the wallet immediately to pause selective sharing."}</p><button className={wallet.locked ? "primary" : "dangerButton"} onClick={toggleLock} disabled={busyAction === "lock"}>{busyAction === "lock" ? "Updating…" : wallet.locked ? "Restore access" : "Emergency lock"}</button><div className="lockFacts"><span>Current status <strong>{wallet.locked ? "Locked" : "Active"}</strong></span><span>Identity sharing <strong>{wallet.locked ? "Paused" : "Available"}</strong></span></div></section></section>}

      <footer>SecureID · Privacy-first identity wallet <span>Security · Privacy · Trust</span></footer>
    </main>
    {showWelcome && !publicShare && !publicDocumentShare && <WelcomeSplash onClose={() => setShowWelcome(false)} />}
    {mfaRequired && <div className="modalBackdrop"><section className="mfaModal"><div className="modalShield">S</div><div className="eyebrow dark">MULTI-FACTOR VERIFICATION</div><h2>Verify your identity</h2><p>{mfaRecoveryMode ? "Enter one of your one-time recovery codes." : challengeId ? <>Enter the six-digit code sent to <strong>{sessionUser}</strong>.</> : <>A six-digit code will be sent to <strong>{sessionUser}</strong> once email delivery succeeds.</>}</p><form onSubmit={verifyOtp}><input className="otpInput" inputMode={mfaRecoveryMode ? "text" : "numeric"} autoComplete={mfaRecoveryMode ? "off" : "one-time-code"} pattern={mfaRecoveryMode ? "[A-Za-z0-9-]{16,24}" : "[0-9]{6}"} maxLength={mfaRecoveryMode ? 24 : 6} value={otp} onChange={(e) => setOtp(mfaRecoveryMode ? e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") : e.target.value.replace(/\D/g, ""))} placeholder={mfaRecoveryMode ? "AB12-CD34-EF56-7890" : "000000"} required /><button className="primary full" disabled={mfaLoading || (!mfaRecoveryMode && (otp.length !== 6 || !challengeId)) || (mfaRecoveryMode && otp.length < 16)}>{mfaLoading ? "Verifying…" : mfaRecoveryMode ? "Use recovery code" : "Verify MFA"}</button></form>{!mfaRecoveryMode && <label className="trustDeviceRow"><input type="checkbox" checked={trustDevice} onChange={e=>setTrustDevice(e.target.checked)} /> <span><strong>Trust this device for 30 days</strong><small>Only use this on a personal device you control.</small></span></label>}{!mfaRecoveryMode && <button className="textButton" disabled={mfaLoading || resendCooldown > 0} onClick={requestOtp}>{resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : challengeId ? "Resend code" : "Send code"}</button>}<button className="textButton" disabled={mfaLoading} onClick={() => { setMfaRecoveryMode((value) => !value); setOtp(""); setMfaMessage(""); }}>{mfaRecoveryMode ? "Use email verification code" : "Use a recovery code instead"}</button><div className="mfaMessage" role="status" aria-live="polite">{mfaMessage}</div></section></div>}
  </div>;
}

export default App;








