import { useEffect, useState } from "react";
import "./digilocker-connect.css";

function csrfToken() {
  const match = document.cookie.match(/(?:^|; )(?:__Host-secureid\\.csrf|secureid\\.csrf)=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export default function DigiLockerConnect() {
  const [status, setStatus] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function loadStatus() {
    setLoading(true);
    try {
      const response = await fetch("/api/digilocker/status", { credentials: "include", cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to check DigiLocker connection.");
      setStatus(data);
      const params = new URLSearchParams(window.location.search);
      if (params.get("digilocker") === "connected") setMessage("DigiLocker account connected successfully.");
      else if (params.get("digilocker")) setMessage("DigiLocker could not complete the connection. Check partner configuration and try again.");
      if (params.has("digilocker")) window.history.replaceState({}, document.title, window.location.pathname);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadStatus(); }, []);

  async function loadDocuments() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/digilocker/issued-documents", { credentials: "include", cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to retrieve issued documents.");
      setDocuments(data.documents || []);
      setMessage((data.documents || []).length ? "Issued document list retrieved from DigiLocker." : "No issued documents were returned, or the connected account has none available.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect DigiLocker from SecureID? This removes the saved connection from SecureID.")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/digilocker/disconnect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(csrfToken() ? { "X-CSRF-Token": csrfToken() } : {}) },
        body: "{}"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to disconnect DigiLocker.");
      setDocuments([]);
      setMessage("DigiLocker connection removed from SecureID.");
      await loadStatus();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="content narrow">
    <div className="functionHero compact">
      <div><div className="eyebrow dark">OFFICIAL DOCUMENT CONNECTION</div><h2>Connect DigiLocker</h2><p>Bring your issuer-provided document list into one place while keeping authorization under your control.</p></div>
      <div className="digilockerMark" aria-hidden="true">DL</div>
    </div>
    <section className="panel digilockerPanel">
      <div className="panelHead"><div><div className="eyebrow dark">ACCOUNT CONNECTION</div><h2>{status?.connected ? "DigiLocker connected" : "Connect an existing account"}</h2></div><span className={status?.connected ? "statusBadge success" : "statusBadge"}>{loading ? "Checking…" : status?.connected ? "Connected" : "Not connected"}</span></div>
      <p className="lead">SecureID uses the official DigiLocker authorization flow only when partner credentials are configured. Your DigiLocker password is never requested or stored by SecureID.</p>
      {message && <div className="vaultMessage" role="status">{message}</div>}
      {status && !status.enabled && <div className="digilockerNotice"><strong>Integration setup is required</strong><p>Live connection stays disabled until SecureID is approved for partner API access and the registered callback URL and encryption key are configured on the server.</p><a href="https://partners.apisetu.gov.in/" target="_blank" rel="noreferrer">Open official partner portal ↗</a><span>After approval, add the client ID, client secret, exact callback URL and a 32-byte base64 encryption key to the deployment secret manager. Never put these values in frontend code or GitHub.</span></div>}
      <div className="digilockerActions">
        {!status?.connected && <button className="primary" disabled={loading || !status?.enabled || busy} onClick={() => { window.location.href = "/api/digilocker/connect"; }}>{busy ? "Please wait…" : "Connect DigiLocker securely"}</button>}
        {status?.connected && <><button className="primary" disabled={busy} onClick={loadDocuments}>{busy ? "Loading…" : "Fetch issued documents"}</button><button className="textDangerButton" disabled={busy} onClick={disconnect}>Disconnect</button></>}
        <a href="https://apisetu.gov.in/digilocker" target="_blank" rel="noreferrer">Official API documentation ↗</a>
      </div>
      {status?.connected && <div className="digilockerDocumentList"><div className="eyebrow dark">ISSUED DOCUMENTS</div><h3>From your DigiLocker account</h3>{documents.length === 0 ? <p className="lead">Select “Fetch issued documents” to request the current list. This only displays returned metadata; it does not mark a document as verified by SecureID.</p> : documents.map((doc, index) => <article className="digilockerDocument" key={doc.uri || doc.name + index}><span className="digilockerDocIcon">✓</span><div><strong>{doc.name}</strong><span>{doc.issuer || "Issuer not specified"}{doc.issuedOn ? " · " + doc.issuedOn : ""}</span><small>{doc.type || "Issued document"}</small></div></article>)}</div>}
      <p className="digilockerFootnote">Security note: a document uploaded manually to SecureID is not the same as an issuer-issued DigiLocker document. SecureID will not display a “verified” badge based solely on a filename or upload.</p>
    </section>
  </section>;
}
