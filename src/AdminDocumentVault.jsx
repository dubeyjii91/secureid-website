import { useEffect, useState } from "react";
import api from "./api.js";

const categories = [
  ["", "All categories"],
  ["general", "General"],
  ["aadhaar", "Aadhaar"],
  ["pan", "PAN"],
  ["passport", "Passport"],
  ["voter_id", "Voter ID"],
  ["driving_licence", "Driving licence"],
  ["student_id", "Student ID"],
  ["institution_proof", "Institution proof"]
];

function formatDate(value) {
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function safeFilename(value) {
  return String(value || "secureid-document").replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 180) || "secureid-document";
}

export default function AdminDocumentVault() {
  const [documents, setDocuments] = useState([]);
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(nextOffset = offset) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50", offset: String(nextOffset) });
      if (search.trim()) params.set("search", search.trim());
      if (category) params.set("category", category);
      const [result, audit] = await Promise.all([
        api("/api/admin/documents?" + params.toString()),
        api("/api/admin/document-access-audit?limit=20").catch(() => ({ events: [] }))
      ]);
      setDocuments(result.documents || []);
      setTotal(Number(result.total || 0));
      setOffset(nextOffset);
      setEvents(audit.events || []);
    } catch (e) {
      setError(e?.message || "Admin document list could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(0); }, []);

  async function download(document) {
    if (downloading) return;
    setDownloading(document.id);
    setError("");
    setNotice("");
    try {
      const response = await api("/api/admin/documents/" + encodeURIComponent(document.id) + "/download");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = safeFilename(document.name);
      anchor.rel = "noopener";
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice("Download started. The access was recorded in the audit history.");
      await load(offset);
    } catch (e) {
      setError(e?.message || "Document download failed.");
    } finally {
      setDownloading("");
    }
  }

  return <div className="content">
    <section className="panel">
      <div className="sectionHeading">
        <div><div className="eyebrow">RESTRICTED OWNER ACCESS</div><h2>All user documents</h2></div>
        <span className="verifiedBadge">{total} documents</span>
      </div>
      <p>Private documents are encrypted at rest. Only the authenticated Owner role with a verified MFA session can view this list or download a file. Every list and download request is audited.</p>
      <form className="formGrid" onSubmit={(event) => { event.preventDefault(); load(0); }}>
        <label>Search by user email, filename, or document ID<input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={160} /></label>
        <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="formActions"><button type="submit" disabled={loading}>{loading ? "Loading…" : "Search documents"}</button><button type="button" className="secondaryButton" disabled={loading} onClick={() => { setSearch(""); setCategory(""); setOffset(0); setTimeout(() => load(0), 0); }}>Reset</button></div>
      </form>
      {error && <p role="alert" className="errorMessage">{error}</p>}
      {notice && <p role="status" className="successMessage">{notice}</p>}
      <div className="tableWrap"><table><thead><tr><th>Document</th><th>Owner</th><th>Category</th><th>Size</th><th>Uploaded</th><th>Action</th></tr></thead>
        <tbody>{documents.map((document) => <tr key={document.id}>
          <td><strong>{document.name}</strong><small>{document.id}</small></td>
          <td>{document.ownerEmail}<small>{document.ownerUserId}</small></td>
          <td>{String(document.category || "general").replaceAll("_", " ")}</td>
          <td>{Math.max(1, Math.round(Number(document.sizeBytes || 0) / 1024))} KB</td>
          <td>{formatDate(document.createdAt)}</td>
          <td><button type="button" disabled={Boolean(downloading)} onClick={() => download(document)}>{downloading === document.id ? "Preparing…" : "Download"}</button></td>
        </tr>)}
        {!documents.length && <tr><td colSpan="6">{loading ? "Loading documents…" : "No documents found."}</td></tr>}</tbody>
      </table></div>
      <div className="formActions"><button type="button" className="secondaryButton" disabled={loading || offset <= 0} onClick={() => load(Math.max(0, offset - 50))}>Previous</button><span>Showing {total ? offset + 1 : 0}–{Math.min(offset + documents.length, total)} of {total}</span><button type="button" className="secondaryButton" disabled={loading || offset + documents.length >= total} onClick={() => load(offset + 50)}>Next</button></div>
    </section>
    <section className="panel">
      <div className="sectionHeading"><div><div className="eyebrow">SECURITY AUDIT</div><h2>Recent document access history</h2></div><button type="button" className="secondaryButton" disabled={loading} onClick={() => load(offset)}>Refresh</button></div>
      <div className="tableWrap"><table><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Document ID</th><th>Result</th></tr></thead><tbody>
        {events.map((event) => <tr key={event.id}><td>{formatDate(event.createdAt)}</td><td>{event.actorEmail || event.actorUserId || "Unknown"}</td><td>{String(event.action || "").replaceAll("_", " ")}</td><td>{event.documentId || "—"}</td><td>{event.outcome}</td></tr>)}
        {!events.length && <tr><td colSpan="5">No access events recorded yet.</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
