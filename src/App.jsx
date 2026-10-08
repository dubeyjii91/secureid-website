import "./document-vault.css";
import DocumentVault from "./DocumentVault.jsx";
import "./secureid-font-clean.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import "./secureid-redesign.css";
const defaultShare = { name: true, age: false, dateOfBirth: false, identityId: true, verificationStatus: false, email: false, phone: false, address: false, college: false, studentId: false, governmentId: false };
const defaultWallet = { risk: 18, locked: false, shareData: defaultShare };

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Request failed.");
    error.status = response.status;
    error.retryAfter = Number(data.retryAfter || response.headers.get("Retry-After") || 0);
    throw error;
  }
  return data;
}

const navItems = [
  ["identity", "My identity", "â–£"],
  ["share", "Share ID", "â†—"],
  ["safety", "Safety check", "âœ“"],
  ["lock", "Emergency lock/unlock", "â–£"],
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
  const [page, setPage] = useState("identity");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaVerified, setMfaVerified] = useState(false);
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [mfaMessage, setMfaMessage] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [phishingUrl, setPhishingUrl] = useState("");
  const [phishingResult, setPhishingResult] = useState(null);
  const [shareToken, setShareToken] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [recoveryMode, setRecoveryMode] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");

  const riskState = useMemo(() => {
    if (wallet.locked) return { label: "Action needed", tone: "danger", detail: "Your wallet is locked." };
    if (wallet.risk >= 70) return { label: "Action needed", tone: "danger", detail: "Review recent activity and verify MFA." };
    if (wallet.risk >= 40) return { label: "Review recommended", tone: "warning", detail: "Some activity may need your attention." };
    return { label: "Protected", tone: "success", detail: "No immediate action is required." };
  }, [wallet]);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const applySession = useCallback((result) => {
    setIsAuthenticated(true);
    setSessionUser(result.user.email);
    setMfaVerified(Boolean(result.user.mfaVerified));
    setMfaRequired(!result.user.mfaVerified);
    if (result.wallet) setWallet(result.wallet);
  }, []);

  const requestOtp = useCallback(async () => {
    setMfaLoading(true);
    setMfaMessage("Sending a verification codeâ€¦");
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

      applySession({ ...result, wallet: defaultWallet });
      setAuthPassword("");
      setWallet(defaultWallet);
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
    if (otp.length !== 6 || !challengeId || mfaLoading) return;
    setMfaLoading(true);
    setMfaMessage("Verifying your codeâ€¦");
    try {
      const result = await api("/api/mfa/verify", { method: "POST", body: JSON.stringify({ challengeId, code: otp }) });
      setMfaVerified(true);
      setMfaRequired(false);
      setChallengeId("");
      setOtp("");
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
      const result = await api("/api/wallet/share", { method: "POST", body: JSON.stringify(wallet.shareData) });
      setWallet(result.wallet);
      setShareToken(result.shareToken);
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

  if (sessionLoading) return <div className="loadingPage"><div className="spinner" /><span>Checking your SecureID sessionâ€¦</span></div>;

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

          <small>Multi-factor verification is required after sign-in.</small>
        </section>
      </div>
    );
  }

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><span className="shield">S</span><div><strong>SecureID</strong><small>Identity wallet</small></div></div><div className="navLabel">YOUR WALLET</div><nav>{navItems.map(([id, label, icon]) => <button key={id} className={page === id ? "navItem active" : "navItem"} onClick={() => setPage(id)}><span>{icon}</span>{label}</button>)}</nav><div className="sideBottom"><div className="privacy"><span>âœ“</span><div><strong>Privacy first</strong><p>Only share the claims you choose.</p></div></div><button className="signOut" onClick={signOut}>Sign out</button></div></aside>
    <DocumentVault /><main className="main"><header className="topbar"><div><div className="breadcrumb">SECUREID / {navItems.find(([id]) => id === page)?.[1].toUpperCase()}</div><h1>{page === "identity" ? "My SecureID" : navItems.find(([id]) => id === page)?.[1]}</h1></div><div className="account"><span className="online" />{sessionUser}<span className="verifiedBadge">{mfaVerified ? "Verified" : "MFA pending"}</span></div></header>

      {page === "identity" && <section className="content"><div className="profileGrid"><section className="panel profilePanel"><div className="panelHead"><div><div className="eyebrow dark">IDENTITY PROFILE</div><h2>Your verified identity</h2></div><span className="statusBadge success">âœ“ Verified</span></div><div className="profile"><div className="avatar">{sessionUser.slice(0, 1).toUpperCase()}</div><div><h3>{sessionUser.split("@")[0]}</h3><p>{sessionUser}</p></div></div><div className="details"><div><span>Identity ID</span><strong>SID-{sessionUser.slice(0, 4).toUpperCase()}-â€¢â€¢â€¢â€¢</strong></div><div><span>Authentication</span><strong>{mfaVerified ? "MFA verified" : "Verification required"}</strong></div><div><span>Wallet status</span><strong>{wallet.locked ? "Locked" : "Active"}</strong></div></div></section><section className="panel statusPanel"><div className="eyebrow dark">ACCOUNT SECURITY</div><h2>{riskState.label}</h2><div className={`securityIcon ${riskState.tone}`}>{riskState.tone === "success" ? "âœ“" : riskState.tone === "warning" ? "!" : "!"}</div><p>{riskState.detail}</p><div className="securityRow"><span>MFA</span><strong>{mfaVerified ? "Enabled" : "Required"}</strong></div><div className="securityRow"><span>Wallet</span><strong>{wallet.locked ? "Locked" : "Protected"}</strong></div></section></div><div className="sectionTitle"><div><div className="eyebrow dark">QUICK ACTIONS</div><h2>Manage your identity</h2></div></div><div className="actionGrid"><button className="actionCard" onClick={() => setPage("share")}><span className="actionIcon">â†—</span><strong>Share my ID</strong><p>Choose exactly which identity claims to share.</p></button><button className="actionCard" onClick={() => setPage("safety")}><span className="actionIcon">âœ“</span><strong>Check a website</strong><p>Look for common phishing indicators before signing in.</p></button><button className="actionCard" onClick={() => setPage("lock")}><span className="actionIcon">â–£</span><strong>Emergency lock/unlock</strong><p>Pause wallet sharing if you think your account is at risk.</p></button></div><div className="note"><strong>Privacy note</strong><span>Your SecureID wallet keeps sharing selective. A share only includes the claims you explicitly select.</span></div></section>}

      {page === "share" && <section className="content narrow"><section className="panel"><div className="eyebrow dark">SELECTIVE DISCLOSURE</div><h2>Share only what you need</h2><p className="lead">Choose the identity claims you want to include. Your wallet will not create a share while it is locked, and MFA must be verified.</p><div className="claimGrid">{[["name","Name"],["age","Age"],["dateOfBirth","Date of Birth"],["address","Address"],["email","Email"],["phone","Phone Number"],["identityId","Identity ID"],["college","College / Institution"],["studentId","Student ID"],["governmentId","Government ID (masked)"],["verificationStatus","Verification Status"]].map(([key,label]) => <label className={`claim ${wallet.shareData[key] ? "selected" : ""}`} key={key}><input type="checkbox" checked={wallet.shareData[key]} onChange={() => toggleShareData(key)} disabled={wallet.locked} /><span>{label}</span></label>)}</div><button className="primary" onClick={generateSecureShare} disabled={wallet.locked || busyAction === "share" || !mfaVerified}>{busyAction === "share" ? "Generatingâ€¦" : "Generate secure share"}</button>{shareToken && <div className="shareResult"><strong>Secure share created</strong><p>Keep this token private and only provide it to the intended recipient.</p><code>{shareToken}</code></div>}</section></section>}

      {page === "safety" && <section className="content narrow"><section className="panel"><div className="eyebrow dark">SAFETY CHECK</div><h2>Check a website before you sign in</h2><p className="lead">This quick check looks for a few common warning signs. It is not a guarantee that a website is safe.</p><div className="urlForm"><input value={phishingUrl} onChange={(e) => setPhishingUrl(e.target.value)} placeholder="example.com" aria-label="Website address" /><button className="primary" onClick={scanPhishingUrl}>Check website</button></div>{phishingResult && <div className={`scanResult ${phishingResult.safe ? "safe" : "warning"}`}><strong>{phishingResult.safe ? "No obvious warning signs" : "Use caution"}</strong><p>{phishingResult.text}</p></div>}<div className="tips"><div><strong>Use HTTPS</strong><span>Check that the address starts with https://.</span></div><div><strong>Check the domain</strong><span>Look closely for extra words, unusual characters or misspellings.</span></div><div><strong>Never share OTPs</strong><span>SecureID verification codes should not be given to another person.</span></div></div></section></section>}

      {page === "lock" && <section className="content narrow"><section className={`panel lockPanel ${wallet.locked ? "locked" : ""}`}><div className="lockGraphic">{wallet.locked ? "!" : "âœ“"}</div><div className="eyebrow dark">EMERGENCY ACCESS CONTROL</div><h2>{wallet.locked ? "Your wallet is locked" : "Your wallet is active"}</h2><p className="lead">{wallet.locked ? "Sharing is paused. Restore access when you are ready and have confirmed your account is secure." : "If you suspect unauthorized activity, lock the wallet immediately to pause selective sharing."}</p><button className={wallet.locked ? "primary" : "dangerButton"} onClick={toggleLock} disabled={busyAction === "lock"}>{busyAction === "lock" ? "Updatingâ€¦" : wallet.locked ? "Restore access" : "Emergency lock"}</button><div className="lockFacts"><span>Current status <strong>{wallet.locked ? "Locked" : "Active"}</strong></span><span>Identity sharing <strong>{wallet.locked ? "Paused" : "Available"}</strong></span></div></section></section>}

      <footer>SecureID Â· Privacy-first identity wallet <span>Security Â· Privacy Â· Trust</span></footer>
    </main>
    {mfaRequired && <div className="modalBackdrop"><section className="mfaModal"><div className="modalShield">S</div><div className="eyebrow dark">MULTI-FACTOR VERIFICATION</div><h2>Verify your identity</h2><p>Enter the six-digit code sent to <strong>{sessionUser}</strong>.</p><form onSubmit={verifyOtp}><input className="otpInput" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="000000" required /><button className="primary full" disabled={mfaLoading || otp.length !== 6 || !challengeId}>{mfaLoading ? "Verifyingâ€¦" : "Verify MFA"}</button></form><button className="textButton" disabled={mfaLoading || resendCooldown > 0} onClick={requestOtp}>{resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}</button><div className="mfaMessage">{mfaMessage}</div></section></div>}
  </div>;
}

export default App;








