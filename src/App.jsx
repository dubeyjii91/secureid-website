import { useEffect, useState } from "react";

function App() {
  const [risk, setRisk] = useState(18);
  const [locked, setLocked] = useState(false);

  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaVerified, setMfaVerified] = useState(false);
  const [otp, setOtp] = useState("");
  const [mfaMessage, setMfaMessage] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionUser, setSessionUser] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timeout = window.setTimeout(() => setResendCooldown((remaining) => Math.max(0, remaining - 1)), 1000);
    return () => window.clearTimeout(timeout);
  }, [resendCooldown]);

  useEffect(() => {
    sessionStorage.removeItem("secureid-token");
    sessionStorage.removeItem("secureid-email");
    fetch("/api/auth/session", { credentials: "include" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => {
        if (result?.user?.email) {
          setSessionUser(result.user.email);
          setIsAuthenticated(true);
          setMfaVerified(Boolean(result.user.mfaVerified));
        }
      })
      .catch(() => {})
      .finally(() => setSessionLoading(false));
  }, []);
const [shareData, setShareData] = useState({
  name: true,
  age: false,
  address: false,
  identityId: true,
});

const [shareGenerated, setShareGenerated] = useState(false);
const [phishingUrl, setPhishingUrl] = useState("");
const [phishingResult, setPhishingResult] = useState("");
  const riskLevel =
    risk < 30 ? "LOW RISK" : risk < 70 ? "MEDIUM RISK" : "HIGH RISK";

  const requestOtp = async () => {
    if (mfaLoading || resendCooldown > 0) return;
    setMfaLoading(true);
    setMfaMessage("Sending a verification email…");
    try {
      const response = await fetch("/api/mfa/challenge", {
        method: "POST",
        credentials: "include",
      });
      const result = await response.json();
      if (!response.ok) {
        const retryAfter = Number(result.retryAfter || response.headers.get("Retry-After") || 0);
        if (retryAfter > 0) setResendCooldown(retryAfter);
        throw new Error(result.message || "Could not send a verification email.");
      }
      setChallengeId(result.challengeId);
      setOtp("");
      setResendCooldown(result.resendAvailableIn || 60);
      setMfaMessage("A verification code was sent to your registered email address.");
    } catch (error) {
      setMfaMessage(error.message || "The verification service is unavailable.");
    } finally {
      setMfaLoading(false);
    }
  };

  const raiseRisk = () => {
    const newRisk = Math.min(risk + 28, 92);
    setRisk(newRisk);
    if (newRisk >= 70 && !mfaVerified) {
      setMfaRequired(true);
      setMfaMessage("High-risk activity detected. MFA verification required.");
      if (!mfaRequired) void requestOtp();
    }
  };

  const resetRisk = (cancelRemote = true) => {
    if (cancelRemote && isAuthenticated) void fetch("/api/mfa/cancel", { method: "POST", credentials: "include" }).catch(() => {});
    setRisk(18);
    setMfaRequired(false);
    setMfaVerified(false);
    setOtp("");
    setChallengeId("");
    setResendCooldown(0);
    setMfaMessage("");
  };
const verifyOTP = async (event) => {
  event.preventDefault();
  if (!challengeId || otp.length !== 6 || mfaLoading) return;
  setMfaLoading(true);
  setMfaMessage("Verifying your code…");
  try {
    const response = await fetch("/api/mfa/verify", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId, code: otp }),
    });
    const result = await response.json();
      if (!response.ok) {
        if (response.status === 410 || response.status === 429) {
          setChallengeId("");
        }
      throw new Error(result.message || "Could not verify this code.");
    }
    setMfaVerified(true);
    setMfaRequired(false);
    setMfaMessage(result.message);
    setChallengeId("");
  } catch (error) {
    setMfaMessage(error.message || "The verification service is unavailable.");
  } finally {
    setMfaLoading(false);
  }
};
const submitAuth = async (event) => {
  event.preventDefault();
  if (authLoading) return;
  setAuthLoading(true);
  setAuthMessage("");
  try {
    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: authEmail, password: authPassword }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Could not authenticate.");
    setIsAuthenticated(true);
    setSessionUser(result.user.email);
    setAuthPassword("");
    setRisk(18);
  } catch (error) {
    setAuthMessage(error.message || "The authentication service is unavailable.");
  } finally {
    setAuthLoading(false);
  }
};
const signOut = async () => {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
  setIsAuthenticated(false);
  setSessionUser("");
  setAuthMode("login");
  setAuthMessage("");
  resetRisk(false);
};
const toggleShareData = (field) => {
  setShareData((prev) => ({
    ...prev,
    [field]: !prev[field],
  }));

  setShareGenerated(false);
};

const generateSecureShare = () => {
  setShareGenerated(true);
};


  const scanPhishingUrl = () => {
  const value = phishingUrl.trim();

  if (!value) {
    setPhishingResult("Enter a URL to scan.");
    return;
  }

  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    const hostname = url.hostname.toLowerCase();

    const suspicious =
      hostname.includes("secureid-login") ||
      hostname.includes("verify-account") ||
      hostname.includes("account-security") ||
      hostname.split(".").length > 4 ||
      /[^\x00-\x7F]/.test(hostname);

    setPhishingResult(
      suspicious
        ? "⚠️ Suspicious link detected. Do not enter passwords or verification codes."
        : "✓ No obvious phishing indicators detected. Stay cautious with unexpected links."
    );
  } catch {
    setPhishingResult("Invalid URL. Please enter a valid website address.");
  }
};

  return (
    <div className="app">
      <style>{`
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background: #070b14;
          color: white;
        }

        button {
          font-family: inherit;
        }

        .app {
          min-height: 100vh;
          background:
            radial-gradient(circle at 10% 10%, rgba(0, 220, 255, .12), transparent 30%),
            radial-gradient(circle at 90% 20%, rgba(120, 70, 255, .14), transparent 30%),
            #070b14;
        }

        .navbar {
          height: 72px;
          padding: 0 6%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid rgba(255,255,255,.08);
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 21px;
          font-weight: bold;
        }

        .logo {
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          border-radius: 12px;
          background: linear-gradient(135deg,#00d9ff,#6655ff);
        }

        .status {
          color: #9ba6ba;
          font-size: 13px;
        }

        .dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          background: #35e59a;
          border-radius: 50%;
          margin-right: 8px;
        }

        .container {
          width: 90%;
          max-width: 1180px;
          margin: auto;
          padding: 55px 0 80px;
        }

        .hero {
          display: grid;
          grid-template-columns: 1.5fr 1fr;
          gap: 30px;
          align-items: center;
        }

        .eyebrow {
          color: #00d9ff;
          font-size: 13px;
          font-weight: bold;
          letter-spacing: 2px;
          margin-bottom: 18px;
        }

        h1 {
          font-size: 64px;
          line-height: 1;
          margin: 0;
          letter-spacing: -3px;
        }

        .gradient {
          background: linear-gradient(90deg,#00d9ff,#8b72ff);
          -webkit-background-clip: text;
          color: transparent;
        }

        .subtitle {
          color: #9ba6ba;
          max-width: 600px;
          font-size: 17px;
          line-height: 1.7;
          margin-top: 25px;
        }

        .card {
          background: linear-gradient(145deg,#141d30,#0c111e);
          border: 1px solid rgba(255,255,255,.09);
          border-radius: 25px;
          padding: 28px;
        }

        .cardTop {
          display: flex;
          justify-content: space-between;
        }

        .label {
          color: #78849a;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 1.5px;
        }

        .verified {
          color: #35e59a;
          font-size: 13px;
          font-weight: bold;
        }

        .identity {
          display: flex;
          align-items: center;
          gap: 15px;
          margin: 30px 0;
        }

        .avatar {
          width: 60px;
          height: 60px;
          display: grid;
          place-items: center;
          border-radius: 18px;
          background: linear-gradient(135deg,#17334a,#30276b);
          font-size: 25px;
        }

        .identity h3 {
          margin: 0 0 5px;
        }

        .identity p {
          margin: 0;
          color: #78849a;
          font-size: 13px;
        }

        .scoreBox {
          padding: 18px;
          border-radius: 18px;
          background: rgba(255,255,255,.04);
        }

        .scoreRow {
          display: flex;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        .score {
          color: #35e59a;
          font-weight: bold;
        }

        .bar {
          height: 8px;
          background: #20283a;
          border-radius: 20px;
        }

        .barFill {
          width: 91%;
          height: 100%;
          border-radius: 20px;
          background: linear-gradient(90deg,#35e59a,#00d9ff);
        }

        .title {
          margin: 65px 0 20px;
          font-size: 25px;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(3,1fr);
          gap: 18px;
        }

        .feature {
          padding: 24px;
          border-radius: 22px;
          background: rgba(15,22,37,.8);
          border: 1px solid rgba(255,255,255,.07);
        }

        .featureIcon {
          font-size: 25px;
          margin-bottom: 15px;
        }

        .feature h3 {
          margin: 0 0 8px;
        }

        .feature p {
          color: #7f8ba0;
          line-height: 1.6;
          font-size: 14px;
        }

        .riskPanel {
          margin-top: 45px;
          padding: 28px;
          border-radius: 25px;
          background: linear-gradient(135deg,#141d30,#0e1322);
          border: 1px solid rgba(255,255,255,.08);
        }

        .riskHeader {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .riskNumber {
          font-size: 40px;
          font-weight: bold;
          margin-top: 8px;
        }

        .riskLevel {
          color: #35e59a;
          font-weight: bold;
        }

        .riskBar {
          height: 12px;
          background: #20283a;
          border-radius: 20px;
          margin-top: 20px;
          overflow: hidden;
        }

        .riskFill {
          height: 100%;
          background: linear-gradient(90deg,#35e59a,#ffc857,#ff5577);
          transition: .4s;
        }

        .actions {
          display: flex;
          gap: 12px;
          margin-top: 22px;
          flex-wrap: wrap;
        }

        .btn {
          border: 0;
          padding: 13px 18px;
          border-radius: 12px;
          color: white;
          font-weight: bold;
          cursor: pointer;
          background: linear-gradient(135deg,#006dff,#664fff);
        }

        .secondary {
          background: rgba(255,255,255,.06);
        }

        .danger {
          background: linear-gradient(135deg,#ff4268,#9f315d);
        }

        .footer {
          margin-top: 70px;
          padding-top: 25px;
          border-top: 1px solid rgba(255,255,255,.07);
          color: #68758b;
          display: flex;
          justify-content: space-between;
          font-size: 13px;
        }

        .authPage {
          min-height: calc(100vh - 72px);
          display: grid;
          place-items: center;
          padding: 40px 20px;
        }

        .authCard {
          width: min(100%, 440px);
          padding: 32px;
          border-radius: 24px;
          background: linear-gradient(145deg,#141d30,#0c111e);
          border: 1px solid rgba(255,255,255,.09);
        }

        .authCard h1 {
          font-size: 32px;
          letter-spacing: -1px;
          margin: 12px 0;
        }

        .authTabs { display: flex; gap: 10px; margin: 24px 0; }
        .authField { display: grid; gap: 8px; margin: 16px 0; text-align: left; color: #9ba6ba; font-size: 13px; }
        .authField input { width: 100%; padding: 13px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,.15); background: #080d18; color: white; }
        .authMessage { min-height: 22px; margin-top: 14px; color: #ffb86b; font-size: 14px; }
        .navAccount { display: flex; align-items: center; gap: 14px; color: #9ba6ba; font-size: 13px; }

        @media(max-width:800px) {
          .hero,.grid {
            grid-template-columns: 1fr;
          }

          h1 {
            font-size: 45px;
          }
        }
      `}</style>

      <nav className="navbar">
        <div className="brand">
          <div className="logo">🛡️</div>
          SecureID
        </div>

        <div className="status">
          <span className="dot"></span>
          Wallet Protected
        </div>
        {isAuthenticated && <div className="navAccount"><span>{sessionUser}</span><button type="button" className="btn secondary" onClick={signOut}>Sign out</button></div>}
      </nav>

      {sessionLoading ? (
        <main className="authPage"><div className="authCard" role="status">Checking your session…</div></main>
      ) : !isAuthenticated ? (
        <main className="authPage">
          <section className="authCard">
            <div className="eyebrow">SECUREID WALLET</div>
            <h1>{authMode === "register" ? "Create your account" : "Welcome back"}</h1>
            <p className="subtitle" style={{ margin: "12px 0" }}>Sign in to access your identity wallet and security controls.</p>
            <div className="authTabs">
              <button type="button" className={`btn ${authMode !== "login" ? "secondary" : ""}`} onClick={() => { setAuthMode("login"); setAuthMessage(""); }}>Sign in</button>
              <button type="button" className={`btn ${authMode !== "register" ? "secondary" : ""}`} onClick={() => { setAuthMode("register"); setAuthMessage(""); }}>Create account</button>
            </div>
            <form onSubmit={submitAuth}>
              <label className="authField">Email address
                <input type="email" autoComplete="email" required maxLength={254} value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} />
              </label>
              <label className="authField">Password
                <input type="password" autoComplete={authMode === "register" ? "new-password" : "current-password"} required minLength={12} maxLength={72} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
              </label>
              <button className="btn" style={{ width: "100%", marginTop: "8px" }} disabled={authLoading}>
                {authLoading ? "Please wait…" : authMode === "register" ? "Create account" : "Sign in"}
              </button>
            </form>
            <div className="authMessage" role="alert" aria-live="polite">{authMessage}</div>
          </section>
        </main>
      ) : (
      <main className="container">

        <section className="hero">

          <div>
            <div className="eyebrow">
              SECURE DIGITAL IDENTITY
            </div>

            <h1>
              Your identity.
              <br />
              <span className="gradient">
                Protected by design.
              </span>
            </h1>

            <p className="subtitle">
              A privacy-first digital identity wallet combining
              passwordless authentication, risk-based security,
              MFA and selective data sharing.
            </p>
          </div>

          <div className="card">

            <div className="cardTop">
              <span className="label">
                Identity Wallet
              </span>

              <span className="verified">
                ● VERIFIED
              </span>
            </div>

            <div className="identity">

              <div className="avatar">
                👤
              </div>

              <div>
                <h3>{sessionUser}</h3>
                <p>SecureID • Digital Identity</p>
              </div>

            </div>

            <div className="scoreBox">

              <div className="scoreRow">
                <span className="label">
                  Security Score
                </span>

                <span className="score">
                  91 / 100
                </span>
              </div>
<div
  style={{
    marginTop: "15px",
    padding: "12px",
    borderRadius: "12px",
    background: mfaRequired
      ? "rgba(255,85,119,.1)"
      : "rgba(53,229,154,.08)",
    color: mfaRequired
      ? "#ff6b88"
      : "#35e59a",
    fontSize: "13px",
    fontWeight: "bold",
  }}
>
  {mfaRequired
    ? "⚠️ MFA VERIFICATION REQUIRED"
    : mfaVerified
    ? "✓ MFA VERIFIED"
    : "🛡️ MFA PROTECTION ACTIVE"}
</div>
              <div className="bar">
                <div className="barFill"></div>
              </div>

            </div>

          </div>

        </section>

        <h2 className="title">
          Security Layers
        </h2>

        <section className="grid">

          <div className="feature">
            <div className="featureIcon">🔐</div>
            <h3>Passwordless</h3>
            <p>
              Authenticate without relying on reusable passwords.
            </p>
          </div>

          <div className="feature">
            <div className="featureIcon">🧠</div>
            <h3>Risk Engine</h3>
            <p>
              Continuously evaluate device, location and behavior signals.
            </p>
          </div>

          <div className="feature">
            <div className="featureIcon">🛡️</div>
            <h3>MFA Protection</h3>
            <p>
              Add another verification layer when risk increases.
            </p>
          </div>

<div className="feature">
  <div className="featureIcon">🎣</div>
  <h3>Phishing Defense</h3>
  <p>
    Scan a suspicious website before entering sensitive information.
  </p>

  <input
    value={phishingUrl}
    onChange={(e) => setPhishingUrl(e.target.value)}
    placeholder="https://example.com"
    style={{
      width: "100%",
      marginTop: "12px",
      padding: "10px",
      borderRadius: "8px",
      border: "1px solid rgba(255,255,255,.12)",
      background: "#0b1220",
      color: "white",
    }}
  />

  <button
    onClick={scanPhishingUrl}
    style={{
      marginTop: "10px",
      padding: "10px 14px",
      borderRadius: "8px",
      border: "none",
      cursor: "pointer",
    }}
  >
    Scan Link
  </button>

  {phishingResult && (
    <p style={{ marginTop: "12px" }}>
      {phishingResult}
    </p>
  )}
</div>

          <div className="feature">
            <div className="featureIcon">🔏</div>
            <h3>Selective Sharing</h3>
            <p>
              Share only the identity claim that a verifier actually needs.
            </p>
          </div>

          <div className="feature">
            <div className="featureIcon">🚨</div>
            <h3>Emergency Lock</h3>
            <p>
              Quickly freeze identity access during a security incident.
            </p>
          </div>

        </section>
<section className="riskPanel">

  <div className="label">
    SELECTIVE DATA SHARING
  </div>

  <h2 style={{ margin: "10px 0" }}>
    Share only what is needed
  </h2>

  <p
    style={{
      color: "#7f8ba0",
      lineHeight: "1.6",
      maxWidth: "650px",
    }}
  >
    Choose exactly which identity information a verifier can access.
    Your complete identity stays private.
  </p>

  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
      gap: "12px",
      marginTop: "22px",
    }}
  >

    <label
      style={{
        padding: "16px",
        borderRadius: "14px",
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.08)",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={shareData.name}
        onChange={() => toggleShareData("name")}
      />
      {" "}👤 Full Name
    </label>

    <label
      style={{
        padding: "16px",
        borderRadius: "14px",
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.08)",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={shareData.age}
        onChange={() => toggleShareData("age")}
      />
      {" "}🎂 Age
    </label>

    <label
      style={{
        padding: "16px",
        borderRadius: "14px",
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.08)",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={shareData.address}
        onChange={() => toggleShareData("address")}
      />
      {" "}🏠 Address
    </label>

    <label
      style={{
        padding: "16px",
        borderRadius: "14px",
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.08)",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={shareData.identityId}
        onChange={() => toggleShareData("identityId")}
      />
      {" "}🪪 Identity ID
    </label>

  </div>

  <div className="actions">

    <button
      className="btn"
      onClick={generateSecureShare}
    >
      🔐 Generate Secure Share
    </button>

  </div>

  {shareGenerated && (
    <div className="message">

      <strong>✓ Secure Share Generated</strong>

      <div style={{ marginTop: "10px" }}>
        Shared claims:
      </div>

      <div style={{ marginTop: "8px" }}>
        {shareData.name && "👤 Name  "}
        {shareData.age && "🎂 Age  "}
        {shareData.address && "🏠 Address  "}
        {shareData.identityId && "🪪 Identity ID"}
      </div>

    </div>
  )}

</section>
        <section className="riskPanel">

          <div className="riskHeader">

            <div>
              <div className="label">
                LIVE RISK ENGINE
              </div>

              <div className="riskNumber">
                {risk}%
              </div>
            </div>

            <div className="riskLevel">
              {locked ? "🔒 WALLET LOCKED" : riskLevel}
            </div>

          </div>

          <div className="riskBar">
            <div
              className="riskFill"
              style={{ width: `${risk}%` }}
            ></div>
          </div>

          <div className="actions">

            <button
              className="btn"
              onClick={raiseRisk}
            >
              ⚠️ Simulate New Device
            </button>

            <button
              className="btn secondary"
              onClick={resetRisk}
            >
              Reset Risk
            </button>

            <button
              className="btn danger"
              onClick={() => setLocked(!locked)}
            >
              {locked
                ? "🔓 Restore Access"
                : "🔒 Emergency Lock"}
            </button>

          </div>

        </section>

        <footer className="footer">
          <span>
            SECUREID • IDENTITY WALLET
          </span>

          <span>
            SECURITY • PRIVACY • TRUST
          </span>
        </footer>
        {mfaRequired && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.75)",
              backdropFilter: "blur(8px)",
              display: "grid",
              placeItems: "center",
              zIndex: 1000,
              padding: "20px",
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="mfa-title"
              style={{
                width: "100%",
                maxWidth: "420px",
                padding: "32px",
                borderRadius: "25px",
                background:
                  "linear-gradient(145deg,#141d30,#0c111e)",
                border: "1px solid rgba(0,217,255,.25)",
                textAlign: "center",
                boxShadow: "0 25px 80px rgba(0,0,0,.6)",
              }}
            >
              <div style={{ fontSize: "45px", marginBottom: "15px" }}>
                🔐
              </div>

              <h2 id="mfa-title">Multi-Factor Authentication</h2>

              <p
                style={{
                  color: "#9ba6ba",
                  lineHeight: "1.6",
                }}
              >
                High-risk activity detected.
                <br />
                Verify your identity using the OTP.
              </p>

              <form onSubmit={verifyOTP}>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  aria-label="Six-digit verification code"
                  placeholder="Enter 6-digit OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  style={{
                    width: "100%",
                    padding: "15px",
                    margin: "15px 0",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,.15)",
                    background: "#080d18",
                    color: "white",
                    textAlign: "center",
                    fontSize: "22px",
                    letterSpacing: "6px",
                    outline: "none",
                  }}
                />
                <button className="btn" style={{ width: "100%" }} disabled={mfaLoading || otp.length !== 6 || !challengeId}>
                  {mfaLoading ? "Please wait…" : "✓ Verify MFA"}
                </button>
              </form>

              <p style={{ color: "#68758b", fontSize: "12px", marginTop: "18px" }}>
                Enter the verification code sent to your registered email address.
              </p>
              <button type="button" className="btn secondary" disabled={mfaLoading || resendCooldown > 0} onClick={requestOtp}>
                {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Resend code"}
              </button>

              {mfaMessage && (
                <div
                  style={{
                    marginTop: "15px",
                    color: mfaMessage.includes("successful") || mfaMessage.includes("ready") || mfaMessage.includes("sent") ? "#35e59a" : "#ffb86b",
                    fontSize: "14px",
                  }}
                  role="status"
                  aria-live="polite"
                >
                  {mfaMessage}
                </div>
              )}
            </div>
          </div>
          )}
      </main>
      )}
    </div>
  );
}

export default App;
