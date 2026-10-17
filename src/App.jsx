import "./document-vault.css";
import DocumentVault from "./DocumentVault.jsx";
import SecurityActivity from "./SecurityActivity.jsx";
import SecuritySessions from "./SecuritySessions.jsx";
import ShareManagement, { IdentityProfileEditor } from "./ShareManagement.jsx";
import AccountSecurity from "./AccountSecurity.jsx";
import SecurityDashboard from "./SecurityDashboard.jsx";
import SecureShareQR from "./SecureShareQR.jsx";
import "./secureid-font-clean.css";
import { Component, useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import "./secureid-redesign.css";
import "./secureid-polish.css";
import "./secureid-layout-fixes.css";
const defaultShare = { name: true, age: false, dateOfBirth: false, identityId: false, verificationStatus: false, email: false, phone: false, address: false, college: false, studentId: false, governmentId: false };
const defaultWallet = { risk: 18, locked: false, shareData: defaultShare };
const shareClaimLabels = { name: "Name", age: "Age", dateOfBirth: "Date of birth", address: "Address", email: "Email", phone: "Phone number", identityId: "Identity ID", college: "College / institution", studentId: "Student ID", governmentId: "Government ID", verificationStatus: "Verification status" };

function WelcomeSplash({ onClose }) {
  return <div className="welcomeSplash" role="dialog" aria-label="Welcome to SecureID">
    <div className="welcomeGlow" />
    <div className="welcomeCard">
      <img className="welcomeGif" src="/secureid-welcome.svg" alt="SecureID security animation" />
      <div className="eyebrow">SECUREID</div>
      <h2>Welcome to SecureID! ✨</h2>
      <p>Well wishes for a safer digital identity journey — private, secure and always in your control.</p>
      <section className="mfaChoices" aria-label="SecureID verification methods">
        <h3>🔐 Verification options</h3>
        <div className="mfaChoice active"><span className="mfaChoiceIcon">✉️</span><span><strong>Email OTP</strong><small>Available now · Gmail addresses work too</small></span><b>✓</b></div>
        <div className="mfaChoice"><span className="mfaChoiceIcon">📱</span><span><strong>Phone / SMS OTP</strong><small>Requires SMS provider setup</small></span><small className="mfaUnavailable">Not enabled</small></div>
        <div className="mfaChoice"><span className="mfaChoiceIcon"></span><span><strong>Apple / Google sign-in</strong><small>Separate identity-provider setup required</small></span><small className="mfaUnavailable">Not enabled</small></div>
        <p className="mfaNote">After signing in, SecureID asks for an email verification code. The website can be opened on iPhone, iPad, Android and desktop; native app-store launch still needs an app build.</p>
      </section>
      <button className="primary" onClick={onClose}>Continue securely</button>
    </div>
  </div>;
}


function InstallSecureIDButton() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
    setInstalled(Boolean(standalone));
    const onBeforeInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setMessage("SecureID is installed on this device.");
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) {
      setMessage("Open your browser menu and choose Install app or Add to Home Screen.");
      return;
    }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setMessage(choice?.outcome === "accepted"
        ? "SecureID installation started."
        : "Installation was cancelled. You can install SecureID later from the browser menu.");
    } catch {
      setMessage("Use your browser menu to install SecureID or add it to your Home Screen.");
    } finally {
      setInstallPrompt(null);
    }
  };

  return <div className="installAppWrap">
    <button type="button" className="installAppButton" onClick={install} disabled={installed}>
      {installed ? "✓ App installed" : "⬇ Install app"}
    </button>
    {message && <span className="installAppMessage" role="status">{message}</span>}
  </div>;
}

function FunctionVisual({ label }) {
  const visual = /identity/i.test(label) ? "🪪" : /sharing/i.test(label) ? "🔗" : /safety|phishing/i.test(label) ? "🛡️" : /privacy/i.test(label) ? "🔐" : /responsible use/i.test(label) ? "📋" : /emergency/i.test(label) ? "🚨" : /document/i.test(label) ? "📁" : "🔒";
  return <div className="functionVisual" aria-label={label}><span className="functionEmoji" aria-hidden="true">{visual}</span><img src="/secureid-welcome.svg" alt="" /></div>;
}

function csrfToken(){
  const match=document.cookie.match(/(?:^|; )(?:__Host-secureid\.csrf|secureid\.csrf)=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}
async function api(path, options = {}) {
  const method=String(options.method || "GET").toUpperCase();
  const mutating=["POST","PUT","PATCH","DELETE"].includes(method);
  let csrf=csrfToken();
  if(mutating && !csrf){
    const bootstrap=await fetch("/api/auth/csrf",{credentials:"include",cache:"no-store"});
    if(!bootstrap.ok) throw new Error("Could not initialize secure request protection. Please refresh and try again.");
    csrf=csrfToken();
    if(!csrf) throw new Error("Secure request token was not received. Please refresh and try again.");
  }
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(mutating&&csrf ? {"X-CSRF-Token":csrf} : {}), ...(options.headers || {}) },
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : null;
  if (!response.ok) {
    const error = new Error(data?.message || "Request failed.");
    error.status = response.status;
    error.retryAfter = Number(data?.retryAfter || response.headers.get("Retry-After") || 0);
    throw error;
  }
  if (contentType.includes("application/json")) return data;
  return response;
}

const navItems = [
  ["dashboard", "Dashboard", "🏠"],
  ["identity", "My identity", "🪪"],
  ["documents", "Document vault", "📁"],
  ["share", "Share ID", "🔗"],
  ["safety", "Safety check", "🛡️"],
  ["lock", "Emergency lock/unlock", "🚨"],
  ["activity", "Security activity", "📊"],
  ["sessions", "Active sessions", "💻"],
  ["shares", "Share management", "🔐"],
  ["account", "Account security", "⚙️"],
  ["privacy", "Privacy center", "🕵️"],
  ["terms", "Terms & use", "📜"],
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
  const [shareRemaining, setShareRemaining] = useState("");
  const [shareContext, setShareContext] = useState("");
  const [publicShare, setPublicShare] = useState(null);
  const [publicDocumentShare, setPublicDocumentShare] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [recoveryMode, setRecoveryMode] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [showWelcome, setShowWelcome] = useState(true);
  const [textScale, setTextScale] = useState(100);
  const [proofCategory, setProofCategory] = useState("student_id");
  const [proofFile, setProofFile] = useState(null);
  const [proofStatus, setProofStatus] = useState(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [proofMessage, setProofMessage] = useState("");

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
    if (!shareExpiresAt) { setShareRemaining(""); return undefined; }
    const tick=()=>{ const ms=Date.parse(shareExpiresAt)-Date.now(); if(ms<=0){setShareRemaining("Expired");return;} const s=Math.floor(ms/1000); setShareRemaining(`Expires in ${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`); };
    tick(); const id=window.setInterval(tick,1000); return()=>window.clearInterval(id);
  }, [shareExpiresAt]);

  const applySession = useCallback((result) => {
    setIsAuthenticated(true);
    setSessionUser(result.user.email);
    setMfaVerified(Boolean(result.user.mfaVerified));
    setMfaRequired(!result.user.mfaVerified);
    if (result.wallet) setWallet(result.wallet);
  }, []);

  const requestOtp = useCallback(async () => {
    setMfaLoading(true);
    setMfaMessage("Sending a verification code…");
    try {
      const result = await api("/api/mfa/challenge", { method: "POST" });
      setChallengeId(result.challengeId);
      setOtp("");
      setResendCooldown(result.resendAvailableIn || 60);
      setMfaMessage("Verification code sent to your registered email.");
    } catch (error) {
      if (error.retryAfter) setResendCooldown(error.retryAfter);
      setMfaMessage(error.message);
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
      setVerificationPending(true);
      setVerificationMessage("Verifying your email address…");
      api(`/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`)
        .then((result) => {
          setVerificationMessage(result.message || "Your email has been verified. You can sign in now.");
          setAuthMode("login");
        })
        .catch((error) => {
          setVerificationMessage(error.message || "Email verification failed.");
        })
        .finally(() => {
          setVerificationPending(false);
          window.history.replaceState({}, document.title, window.location.pathname);
        });
    }

    if (passwordToken) {
      setResetToken(passwordToken);
      setRecoveryMode("reset");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const documentMatch = window.location.pathname.match(/^\/document-share\/([A-Za-z0-9_-]{30,100})$/);
    if (documentMatch) {
      setSessionLoading(true);
      fetch("/api/document-share/" + documentMatch[1], { credentials: "omit" })
        .then(async (response) => {
          const contentType = response.headers.get("content-type") || "";
          if (!response.ok) {
            const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : {};
            throw new Error(data.message || "This secure document share is no longer available.");
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
      api("/api/share/" + match[1])
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

  // Student/college preset: disclose only the claims commonly needed for a
  // student-status check. This is a convenience preset, not institutional verification.
  const applyCollegeVerificationPreset = () => {
    const allowedClaims = new Set(["name", "college", "studentId", "verificationStatus"]);
    setWallet((current) => ({
      ...current,
      shareData: Object.fromEntries(
        Object.keys(current.shareData).map((key) => [key, allowedClaims.has(key)])
      ),
    }));
    setShareContext("College / institution verification");
    setShareToken("");
    setShareExpiresAt("");
    setMfaMessage("College verification preset applied. Review the selected claims before creating a link.");
  };

  useEffect(() => {
    if (page !== "share" || !isAuthenticated || !mfaVerified) return;
    let active = true;
    api("/api/identity/verification-status")
      .then((result) => { if (active) setProofStatus(result); })
      .catch((error) => { if (active) setProofMessage(error.message); });
    return () => { active = false; };
  }, [page, isAuthenticated, mfaVerified]);

  const submitIdentityProof = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!proofFile || !mfaVerified || wallet.locked) return;
    setProofBusy(true);
    setProofMessage("");
    try {
      const form = new FormData();
      form.append("category", proofCategory);
      form.append("document", proofFile);
      const csrf = csrfToken();
      const response = await fetch("/api/identity/proof", {
        method: "POST",
        credentials: "include",
        headers: csrf ? { "X-CSRF-Token": csrf } : {},
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Proof upload failed.");
      setProofFile(null);
      formElement.reset();
      setProofMessage("Proof uploaded securely. It is submitted for review, not independently verified.");
      const status = await api("/api/identity/verification-status");
      setProofStatus(status);
    } catch (error) {
      setProofMessage(error.message || "Proof upload failed.");
    } finally {
      setProofBusy(false);
    }
  };

  const generateSecureShare = async () => {
    const sensitiveClaims = [
      ["dateOfBirth", "Date of birth"],
      ["address", "Address"],
      ["email", "Email"],
      ["phone", "Phone number"],
      ["identityId", "Identity ID"],
      ["governmentId", "Masked government ID"],
    ].filter(([key]) => wallet.shareData[key]).map(([, label]) => label);
    if (sensitiveClaims.length) {
      const confirmed = window.confirm(
        `Privacy check: you selected sensitive information: ${sensitiveClaims.join(", ")}.\n\nOnly continue if the recipient needs these details and you trust them. The share link can be forwarded until it expires or you revoke it. Create this share?`
      );
      if (!confirmed) {
        setMfaMessage("Share cancelled. Review your selected claims before creating a link.");
        return;
      }
    }
    setBusyAction("share");
    try {
      const result = await api("/api/wallet/share", { method: "POST", body: JSON.stringify({ ...wallet.shareData, contextLabel: shareContext, share_reason: shareContext }) });
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
      const suspicious = url.protocol !== "https:" || labels.length > 4 || /[^\x00-\x7F]/.test(hostname) || /(^|[-.])(secureid-login|verify-account|account-security)([-.]|$)/.test(hostname);
      setPhishingResult(suspicious ? { safe: false, text: "Suspicious indicators found. Do not enter passwords or verification codes on this site." } : { safe: true, text: "No obvious phishing indicators detected. Still verify the site before entering sensitive information." });
    } catch {
      setPhishingResult({ safe: false, text: "Invalid website address." });
    }
  };

  if (sessionLoading) return <div className="loadingPage"><div className="spinner" /><span>Loading SecureID share…</span></div>;

  if (publicDocumentShare) {
    if (!publicDocumentShare.success) return <div className="authShell"><div className="authBrand"><span className="shield">S</span><span>SecureID</span></div><section className="authCard"><div className="eyebrow">SECURE DOCUMENT SHARE</div><h1>Document unavailable</h1><p>{publicDocumentShare.message || "This secure document share has expired or was revoked."}</p><a className="textButton" href="/">Open SecureID</a></section></div>;
    const mime = publicDocumentShare.mimeType || "";
    return <div className="authShell"><div className="authBrand"><span className="shield">S</span><span>SecureID</span></div><section className="authCard publicDocumentCard"><div className="eyebrow">SECURE DOCUMENT SHARE</div><h1>Shared document</h1><p>This document was shared through a time-limited SecureID link.</p>{publicDocumentShare.purpose && <div className="shareContextPublic"><strong>Share purpose</strong><span>{publicDocumentShare.purpose}</span></div>}{mime === "application/pdf" ? <iframe className="sharedDocumentFrame" src={publicDocumentShare.url} title="Shared SecureID document" /> : mime.startsWith("image/") ? <img className="sharedDocumentImage" src={publicDocumentShare.url} alt="Shared SecureID document" /> : <a className="primary" href={publicDocumentShare.url} target="_blank" rel="noreferrer">Open document</a>}<a className="textButton" href="/">Open SecureID</a></section></div>;
  }

  if (publicShare) {
    if (!publicShare.success) return <div className="authShell"><div className="authBrand"><span className="shield">S</span><span>SecureID</span></div><section className="authCard"><div className="eyebrow">SECURE SHARE</div><h1>Share unavailable</h1><p>{publicShare.message || "This secure share is no longer available."}</p><a className="textButton" href="/">Open SecureID</a></section></div>;
    const claims = publicShare.claims || {};
    return <div className="authShell"><div className="authBrand"><span className="shield">S</span><span>SecureID</span></div><section className="authCard"><div className="eyebrow">SECURE SHARE</div><h1>Shared identity</h1>{publicShare.verificationBadge?.verified && <div className="verificationBadge" title="This badge is issued by SecureID for a valid share created after MFA verification."><span>✓</span><div><strong>{publicShare.verificationBadge.label || "SecureID Verified Share"}</strong><small>{publicShare.verificationBadge.assurance || "MFA-authenticated at creation"}</small></div></div>}<p>This page contains only the identity claims selected by the account owner.</p>{publicShare.contextLabel && <div className="shareContextPublic"><strong>Share purpose</strong><span>{publicShare.contextLabel}</span></div>}<div className="sharePublicGrid">{Object.entries(claims).filter(([, value]) => String(value ?? "").trim() !== "").map(([key,value]) => <div className="sharePublicItem" key={key}><span>{shareClaimLabels[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (m) => m.toUpperCase())}</span><strong>{String(value)}</strong></div>)}</div>{!Object.values(claims).some((value) => String(value ?? "").trim() !== "") && <div className="sharePublicEmpty" role="status"><strong>No identity details were included in this share.</strong><span>Ask the account owner to update the identity profile and create a new share with the required details selected.</span></div>}<p className="shareExpiry">Expires {publicShare.expiresAt ? new Date(publicShare.expiresAt).toLocaleString() : "soon"}.</p></section></div>;
  }

  if (!isAuthenticated && (page === "privacy" || page === "terms")) {
    const isPrivacy = page === "privacy";
    return <div className="authShell"><div className="authBrand"><span className="shield">S</span><span>SecureID</span></div><section className="authCard legalPublic"><div className="eyebrow">{isPrivacy ? "PRIVACY CENTER" : "TERMS & RESPONSIBLE USE"}</div><h1>{isPrivacy ? "Privacy notice" : "Service-use summary"}</h1>{isPrivacy ? <><p>SecureID processes account email, authentication/MFA and session metadata, identity profile fields, uploaded documents, share records, and security activity as needed to operate the wallet and protect accounts.</p><p>When you create a share, the claims you select are available to someone with the link until the share expires or is revoked. Check the selected claims and share links only with the intended recipient.</p><p>Before using real documents, the service operator should publish complete retention periods, provider details, a verified privacy contact, backup/restore practices, and incident-response information.</p></> : <><p>Use a unique password, keep MFA and recovery codes private, and sign out on devices you do not control.</p><p>Upload only documents you have the right to store and share. Review every selected identity claim before generating a link.</p><p>Website checks and verification indicators do not guarantee that a website, recipient, document, or external decision is safe or officially accepted.</p><p>The service operator must review and publish complete legal terms, operator identity, contact details, dispute process, and governing law before launch.</p></>}<button className="textButton" type="button" onClick={() => setPage("dashboard")}>Back to sign in</button></section></div>;
  }

  if (!isAuthenticated) {
    if (verificationPending) {
      return (
        <div className="authShell">
          <div className="authBrand"><span className="shield">S</span><span>SecureID</span></div>
          <section className="authCard">
            <div className="eyebrow">EMAIL VERIFICATION</div>
            <h1>Verify your email</h1>
            <p>We're confirming your SecureID email address.</p>
            <div className="authMessage">{verificationMessage}</div>
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
      <div className="authShell">
        <div className="authBrand"><span className="shield">S</span><span>SecureID</span></div>

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

          <small>Multi-factor verification is required after sign-in.</small><div className="authLegalLinks"><button className="textButton" type="button" onClick={() => setPage("privacy")}>Privacy notice</button><button className="textButton" type="button" onClick={() => setPage("terms")}>Terms & use</button></div>
        </section>
        {showWelcome && <WelcomeSplash onClose={() => setShowWelcome(false)} />}
      </div>
    );
  }

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><span className="shield">S</span><div><strong>SecureID</strong><small>Identity wallet</small></div></div><div className="navLabel">YOUR WALLET</div><nav>{navItems.map(([id, label, icon]) => <button key={id} className={page === id ? "navItem active" : "navItem"} onClick={() => setPage(id)}><span>{icon}</span>{label}</button>)}</nav><div className="sideBottom"><div className="privacy"><span>✓</span><div><strong>Privacy first</strong><p>Only share the claims you choose.</p></div></div><button className="signOut" onClick={signOut}>Sign out</button></div></aside>
    <main className="main"><header className="topbar"><div><div className="breadcrumb">SECUREID / {navItems.find(([id]) => id === page)?.[1].toUpperCase()}</div><h1>{page === "identity" ? "My SecureID" : navItems.find(([id]) => id === page)?.[1]}</h1></div><div className="topbarActions"><InstallSecureIDButton /><div className="textSizeControls" role="group" aria-label="Text size controls"><button type="button" className="textSizeButton" aria-label="Decrease text size" disabled={textScale <= 85} onClick={() => setTextScale((size) => Math.max(85, size - 5))}>A−</button><span aria-live="polite">{textScale}%</span><button type="button" className="textSizeButton" aria-label="Increase text size" disabled={textScale >= 125} onClick={() => setTextScale((size) => Math.min(125, size + 5))}>A+</button></div><div className="account"><span className="online" />{sessionUser}<span className="verifiedBadge">{mfaVerified ? "MFA verified" : "MFA pending"}</span></div></div></header>

      {page === "dashboard" && <SecurityDashboard />}

      {page === "documents" && <section className="content"><DocumentVault /></section>}

      {page === "identity" && <section className="content"><div className="functionHero"><div><div className="eyebrow dark">SECUREID SECURITY CENTER</div><h2>Privacy-first identity, protected by design.</h2><p>Keep control of your identity while every important action stays protected.</p></div><FunctionVisual label="SecureID identity protection" /></div><div className="profileGrid"><section className="panel profilePanel"><div className="panelHead"><div><div className="eyebrow dark">IDENTITY PROFILE</div><h2>Your identity profile</h2></div><span className="statusBadge success">✓ Account active</span></div><div className="profile"><div className="avatar">{sessionUser.slice(0, 1).toUpperCase()}</div><div><h3>{sessionUser.split("@")[0]}</h3><p>{sessionUser}</p></div></div><div className="details"><div><span>Identity ID</span><strong>SID-{sessionUser.slice(0, 4).toUpperCase()}-••••</strong></div><div><span>Authentication</span><strong>{mfaVerified ? "MFA verified" : "Verification required"}</strong></div><div><span>Wallet status</span><strong>{wallet.locked ? "Locked" : "Active"}</strong></div></div></section><section className="panel statusPanel"><div className="eyebrow dark">ACCOUNT SECURITY</div><h2>{riskState.label}</h2><div className={`securityIcon ${riskState.tone}`}>{riskState.tone === "success" ? "✓" : riskState.tone === "warning" ? "!" : "!"}</div><p>{riskState.detail}</p><div className="securityRow"><span>MFA</span><strong>{mfaVerified ? "Enabled" : "Required"}</strong></div><div className="securityRow"><span>Wallet</span><strong>{wallet.locked ? "Locked" : "Protected"}</strong></div></section></div><IdentityProfileEditor/><div className="note"><strong>Privacy note</strong><span>Your SecureID wallet keeps sharing selective. A share only includes the claims you explicitly select.</span></div></section>}

      {page === "share" && <section className="content narrow"><div className="functionHero compact"><div><div className="eyebrow dark">SELECTIVE DISCLOSURE</div><h2>Share only what you need.</h2><p>Secure, controlled identity sharing with time-limited access.</p></div><FunctionVisual label="SecureID secure sharing" /></div><section className="panel studentProofPanel"><div className="eyebrow dark">STUDENT PROOF SUBMISSION</div><h2>Submit student / institution proof</h2><p className="lead">Upload a student ID or institution document for a future independent review. SecureID currently records proof submission only; it does not certify your enrollment or identity.</p><form onSubmit={submitIdentityProof} className="studentProofForm"><label><span>Proof type</span><select value={proofCategory} onChange={(event) => setProofCategory(event.target.value)} disabled={proofBusy || wallet.locked}><option value="student_id">Student ID</option><option value="institution_proof">College / institution proof</option></select></label><label><span>PDF or image (max 10 MB)</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setProofFile(event.target.files?.[0] || null)} disabled={proofBusy || wallet.locked} required /></label><button className="primary" type="submit" disabled={!proofFile || proofBusy || wallet.locked || !mfaVerified}>{proofBusy ? "Uploading securely…" : "Upload proof"}</button></form>{proofStatus && <div className="studentProofStatus"><strong>Submission status: {proofStatus.status}</strong><span>Student ID proof: {proofStatus.proofs?.studentId ? "Submitted" : "Not submitted"}</span><span>Institution proof: {proofStatus.proofs?.institution ? "Submitted" : "Not submitted"}</span></div>}{proofMessage && <p className="studentProofMessage" role="status">{proofMessage}</p>}<p className="studentSharePrivacyNote">Upload only documents you are authorized to store. Submitted proof is not the same as college approval or government verification.</p></section><section className="panel"><div className="eyebrow dark">SELECTIVE DISCLOSURE</div><h2>Share only what you need</h2><p className="lead">Choose the identity claims you want to include. Your wallet will not create a share while it is locked, and MFA must be verified.</p><div className="studentSharePreset"><div><strong>STUDENT / COLLEGE VERIFICATION</strong><p>Start with only Name, College, Student ID and Verification Status. You can change every selection before sharing.</p></div><button type="button" className="secondary" onClick={applyCollegeVerificationPreset} disabled={wallet.locked}>Use college preset</button></div><p className="studentSharePrivacyNote">Privacy by default: do not include Aadhaar, PAN, address, date of birth, phone or email unless the recipient specifically needs them. A SecureID share proves that the link was created after MFA; it does not mean your college has verified the claims.</p><div className="claimGrid">{[["name","Name"],["age","Age"],["dateOfBirth","Date of Birth"],["address","Address"],["email","Email"],["phone","Phone Number"],["identityId","Identity ID"],["college","College / Institution"],["studentId","Student ID"],["governmentId","Government ID (masked)"],["verificationStatus","Verification Status"]].map(([key,label]) => <label className={`claim ${wallet.shareData[key] ? "selected" : ""}`} key={key}><input type="checkbox" checked={wallet.shareData[key]} onChange={() => toggleShareData(key)} disabled={wallet.locked} /><span>{label}</span></label>)}</div><label className="shareContextField"><span>Share purpose</span><input maxLength={160} value={shareContext} onChange={(e) => setShareContext(e.target.value)} placeholder="e.g. College verification" disabled={wallet.locked} /><small>Optional: tell the recipient why you are sharing this information.</small></label><button className="primary" onClick={generateSecureShare} disabled={wallet.locked || busyAction === "share" || !mfaVerified}>{busyAction === "share" ? "Generating…" : "Generate secure share"}</button>{shareToken && <div className="shareResult"><strong>Secure share created</strong><p>Keep this token private and only provide it to the intended recipient.</p><code>{window.location.origin + "/share/" + shareToken}</code><div className="shareLinkActions"><button className="primary" onClick={shareSecureLink} type="button">Share now</button><button className="textButton" onClick={copySecureLink} type="button">Copy link</button></div><p className="shareHint">Send this link through WhatsApp, email, SMS, or any app you normally use. The recipient does not need a SecureID account.</p><p className="shareExpiry">{shareRemaining || "Expires soon"} · {shareExpiresAt ? new Date(shareExpiresAt).toLocaleString() : ""}</p><button className="textButton" onClick={revokeSecureShares} disabled={busyAction === "revoke"}>{busyAction === "revoke" ? "Revoking…" : "Revoke active shares"}</button></div>}<SecureShareQR token={shareToken} expiresAt={shareExpiresAt} /></section></section>}

      {page === "safety" && <section className="content narrow"><div className="functionHero compact"><div><div className="eyebrow dark">SECURITY CHECK</div><h2>Check before you trust.</h2><p>Spot common phishing warning signs before you sign in.</p></div><FunctionVisual label="SecureID safety protection" /></div><section className="panel"><div className="eyebrow dark">SAFETY CHECK</div><h2>Check a website before you sign in</h2><p className="lead">This quick check looks for a few common warning signs. It is not a guarantee that a website is safe.</p><div className="urlForm"><input value={phishingUrl} onChange={(e) => setPhishingUrl(e.target.value)} placeholder="example.com" aria-label="Website address" /><button className="primary" onClick={scanPhishingUrl}>Check website</button></div>{phishingResult && <div className={`scanResult ${phishingResult.safe ? "safe" : "warning"}`}><strong>{phishingResult.safe ? "No obvious warning signs" : "Use caution"}</strong><p>{phishingResult.text}</p></div>}<div className="tips"><div><strong>Use HTTPS</strong><span>Check that the address starts with https://.</span></div><div><strong>Check the domain</strong><span>Look closely for extra words, unusual characters or misspellings.</span></div><div><strong>Never share OTPs</strong><span>SecureID verification codes should not be given to another person.</span></div></div></section></section>}

      {page === "activity" && <SecurityActivity />}

      {page === "sessions" && <SecuritySessions />}

      {page === "shares" && <ShareManagement />}

      {page === "account" && <AccountSecurity />}

      {page === "privacy" && <section className="content narrow"><div className="functionHero compact"><div><div className="eyebrow dark">PRIVACY CENTER</div><h2>Your identity stays under your control.</h2><p>Review what SecureID handles and how to use its privacy controls.</p></div><FunctionVisual label="SecureID privacy protection" /></div><section className="panel"><h2>Privacy notice</h2><p className="lead">SecureID is an identity-wallet application. The information below describes the categories of data used by the current product features; it is not a substitute for a full legal review.</p><div className="tips"><div><strong>Account and security data</strong><span>Your account email, authentication and MFA state, session/device metadata, and security activity may be processed to operate and protect your account.</span></div><div><strong>Identity and documents</strong><span>Identity profile fields and documents you choose to add are used to provide wallet and document-vault features.</span></div><div><strong>Selective sharing</strong><span>When you create a share, the selected claims are made available to someone who has the share link until it expires or is revoked. Only share links with the intended recipient.</span></div><div><strong>Account controls</strong><span>Use the Account security area to review available account controls. Data retention periods, service-provider details, and a verified privacy contact should be confirmed by the service operator before public launch.</span></div></div><div className="note"><strong>Before using real documents</strong><span>Do not upload highly sensitive documents until the operator has published complete retention, contact, backup/restore, and incident-response details.</span></div></section></section>}

      {page === "terms" && <section className="content narrow"><div className="functionHero compact"><div><div className="eyebrow dark">TERMS & RESPONSIBLE USE</div><h2>Use SecureID carefully.</h2><p>Important usage guidance for the identity wallet and sharing features.</p></div><FunctionVisual label="SecureID responsible use" /></div><section className="panel"><h2>Service-use summary</h2><p className="lead">This is a plain-language usage summary, not a final legal agreement. The service operator should review and publish complete terms before launch.</p><div className="tips"><div><strong>Protect your account</strong><span>Use a unique password, complete MFA, keep recovery codes private, and sign out on devices you do not control.</span></div><div><strong>Share responsibly</strong><span>Check every selected identity claim and the purpose before generating a link. A recipient with the link may view the selected information while the share is valid.</span></div><div><strong>Upload only what you need</strong><span>Upload documents only when you have the right to store and share them. Do not upload someone else's identity documents without permission.</span></div><div><strong>No guarantee of external decisions</strong><span>SecureID's website checks and verification indicators do not guarantee that a website, recipient, document, or external decision is safe or officially accepted.</span></div><div><strong>Operator details still required</strong><span>Before launch, publish the operator's legal identity, contact details, full terms, dispute process, governing law, and applicable service limitations.</span></div></div></section></section>}

      {page === "lock" && <section className="content narrow"><div className="functionHero compact"><div><div className="eyebrow dark">EMERGENCY CONTROL</div><h2>Stay in control of access.</h2><p>Pause identity sharing whenever you need extra protection.</p></div><FunctionVisual label="SecureID emergency protection" /></div><section className={`panel lockPanel ${wallet.locked ? "locked" : ""}`}><div className="lockGraphic">{wallet.locked ? "!" : "✓"}</div><div className="eyebrow dark">EMERGENCY ACCESS CONTROL</div><h2>{wallet.locked ? "Your wallet is locked" : "Your wallet is active"}</h2><p className="lead">{wallet.locked ? "Sharing is paused. Restore access when you are ready and have confirmed your account is secure." : "If you suspect unauthorized activity, lock the wallet immediately to pause selective sharing."}</p><button className={wallet.locked ? "primary" : "dangerButton"} onClick={toggleLock} disabled={busyAction === "lock"}>{busyAction === "lock" ? "Updating…" : wallet.locked ? "Restore access" : "Emergency lock"}</button><div className="lockFacts"><span>Current status <strong>{wallet.locked ? "Locked" : "Active"}</strong></span><span>Identity sharing <strong>{wallet.locked ? "Paused" : "Available"}</strong></span></div></section></section>}

      <footer>SecureID · Privacy-first identity wallet <span><button type="button" className="footerLink" onClick={() => setPage("privacy")}>Privacy center</button> · <button type="button" className="footerLink" onClick={() => setPage("terms")}>Terms & use</button> · Security · Privacy · Trust</span></footer>
    </main>
    {showWelcome && !publicShare && !publicDocumentShare && <WelcomeSplash onClose={() => setShowWelcome(false)} />}
    {mfaRequired && <div className="modalBackdrop"><section className="mfaModal"><div className="modalShield">S</div><div className="eyebrow dark">MULTI-FACTOR VERIFICATION</div><h2>Verify your identity</h2><p>{mfaRecoveryMode ? "Enter one of your one-time recovery codes." : <>Enter the six-digit code sent to <strong>{sessionUser}</strong>.</>}</p><form onSubmit={verifyOtp}><input className="otpInput" inputMode={mfaRecoveryMode ? "text" : "numeric"} autoComplete={mfaRecoveryMode ? "off" : "one-time-code"} pattern={mfaRecoveryMode ? "[A-Za-z0-9-]{16,24}" : "[0-9]{6}"} maxLength={mfaRecoveryMode ? 24 : 6} value={otp} onChange={(e) => setOtp(mfaRecoveryMode ? e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") : e.target.value.replace(/\D/g, ""))} placeholder={mfaRecoveryMode ? "AB12-CD34-EF56-7890" : "000000"} required /><button className="primary full" disabled={mfaLoading || (!mfaRecoveryMode && (otp.length !== 6 || !challengeId)) || (mfaRecoveryMode && otp.length < 16)}>{mfaLoading ? "Verifying…" : mfaRecoveryMode ? "Use recovery code" : "Verify MFA"}</button></form>{!mfaRecoveryMode && <label className="trustDeviceRow"><input type="checkbox" checked={trustDevice} onChange={e=>setTrustDevice(e.target.checked)} /> <span><strong>Trust this device for 30 days</strong><small>Only use this on a personal device you control.</small></span></label>}{!mfaRecoveryMode && <button className="textButton" disabled={mfaLoading || resendCooldown > 0} onClick={requestOtp}>{resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}</button>}<button className="textButton" disabled={mfaLoading} onClick={() => { setMfaRecoveryMode((value) => !value); setOtp(""); setMfaMessage(""); }}>{mfaRecoveryMode ? "Use email verification code" : "Use a recovery code instead"}</button><div className="mfaMessage">{mfaMessage}</div></section></div>}
  </div>;
}

class SecureIDErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error) {
    console.error("SecureID interface error:", error);
  }
  render() {
    if (this.state.hasError) {
      return <main className="appErrorFallback" role="alert">
        <div className="appErrorIcon">🛡️</div>
        <h1>SecureID is temporarily unavailable</h1>
        <p>Your account data has not been intentionally changed. Reload the page to try again.</p>
        <button className="primary" onClick={() => window.location.reload()}>Reload SecureID</button>
      </main>;
    }
    return this.props.children;
  }
}

export default function SecureIDApp() {
  return <SecureIDErrorBoundary><App /></SecureIDErrorBoundary>;
}








