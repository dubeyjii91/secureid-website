import { useCallback, useEffect, useState } from "react";
import api from "./api.js";

const CONFIRMATION_PHRASE = "DELETE TEST DATA FOR RVS AND SECUREID TEST COLLEGE";

export default function OwnerTestInstitutionCleanup() {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api("/api/admin/test-institution-cleanup/preview");
      setPreview(result);
      setConfirmationPhrase("");
      setAcknowledged(false);
    } catch (requestError) {
      setError(requestError.message || "Could not load the test-data inventory.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  async function executeCleanup(event) {
    event.preventDefault();
    if (!preview?.previewHash || !acknowledged || confirmationPhrase !== CONFIRMATION_PHRASE) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api("/api/admin/test-institution-cleanup/execute", {
        method: "POST",
        body: JSON.stringify({
          confirmationEmail,
          confirmationPhrase,
          previewHash: preview.previewHash,
          testDataConfirmed: acknowledged
        })
      });
      setNotice(
        "Cleanup complete: " + result.deletedRows + " database records removed across " +
        result.deletedInstitutions.length + " institutions. " + result.encryptedFilesRemoved +
        " unshared encrypted document files removed. Fresh backup and isolated restore verified: " +
        result.backupFile + "."
      );
      setPreview(null);
      setConfirmationPhrase("");
      setAcknowledged(false);
      await loadPreview();
    } catch (requestError) {
      setError(requestError.message || "Cleanup did not complete. No success is assumed.");
      await loadPreview();
    } finally {
      setBusy(false);
    }
  }

  const blocked = Boolean(
    !preview || preview.loading || preview.missingTargets?.length ||
    preview.unsupportedRelationships?.length || !preview.institutions?.length
  );

  return (
    <div className="panel" style={{border:"1px solid #b7791f",marginBottom:20}}>
      <div className="eyebrow dark">OWNER ONLY · TEST DATA CLEANUP</div>
      <h3>Fresh-start cleanup · approved test institutions</h3>
      <p>Recursive inventory includes institution-linked records and indirect children such as test payments, fees, memberships, document reviews, hostel history, scholarships and audit rows. It does not delete any user account, the configured Owner account, shared plan catalogues or unrelated institutions.</p>
      {error && <p role="alert" style={{color:"#b42318"}}>{error}</p>}
      {notice && <p role="status" style={{color:"#067647"}}>{notice}</p>}
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",margin:"12px 0"}}>
        <button type="button" className="secondary" onClick={loadPreview} disabled={loading || busy}>{loading ? "Refreshing inventory…" : "Refresh exact inventory"}</button>
        {preview && <strong>{preview.totalRecords} database records inventoried</strong>}
      </div>
      {preview && (
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12,margin:"12px 0"}}>
            {preview.institutions.map((institution) => (
              <div key={institution.id} style={{border:"1px solid var(--border,#ddd)",borderRadius:10,padding:12}}>
                <strong>{institution.name}</strong>
                <div style={{fontSize:13,marginTop:5}}>Institution ID: {institution.id}</div>
                <div style={{fontSize:14,fontWeight:700,marginTop:8}}>{institution.totalRecords} linked records</div>
                {institution.categories?.length > 0 && <div style={{fontSize:12,marginTop:5}}>{institution.categories.map((item) => item.category + ": " + item.count).join(" · ")}</div>}
                {institution.tables?.length > 0 && <details style={{marginTop:8}}><summary style={{cursor:"pointer"}}>View table-wise counts</summary><ul>{institution.tables.map((item) => <li key={item.table}>{item.table}: {item.count}</li>)}</ul></details>}
              </div>
            ))}
          </div>
          {preview.tableCounts?.length > 0 ? (
            <div style={{overflowX:"auto",maxHeight:260,margin:"12px 0"}}>
              <table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}>
                <thead><tr><th style={{padding:8}}>Database table</th><th style={{padding:8}}>Records</th></tr></thead>
                <tbody>{preview.tableCounts.map((item) => (
                  <tr key={item.table}><td style={{padding:8,borderTop:"1px solid var(--border,#ddd)"}}>{item.table}</td><td style={{padding:8,borderTop:"1px solid var(--border,#ddd)"}}>{item.count}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p>No linked records were found for the approved institutions.</p>}
          {preview.categories?.length > 0 && <p>{preview.categories.map((item) => item.category + ": " + item.count).join(" · ")}</p>}
          {preview.missingTargets?.length > 0 && <p role="alert">Missing approved institution(s): {preview.missingTargets.join(", ")}</p>}
          {preview.unsupportedRelationships?.length > 0 && <p role="alert">Cleanup blocked until these relationships are reviewed: {preview.unsupportedRelationships.join("; ")}</p>}
          <p><strong>Backup safety:</strong> before deleting anything, the server creates a fresh encrypted database + document backup, decrypts it into an isolated temporary SQLite database, and verifies SQLite integrity and foreign-key consistency. If any step fails, deletion is blocked.</p>
          <form onSubmit={executeCleanup} style={{display:"grid",gap:10,borderTop:"1px solid var(--border,#ddd)",paddingTop:14}}>
            <label>Configured Owner email
              <input type="email" value={confirmationEmail} onChange={(event) => setConfirmationEmail(event.target.value)} placeholder="Enter Owner email" required autoComplete="email" />
            </label>
            <label>Exact confirmation phrase
              <input value={confirmationPhrase} onChange={(event) => setConfirmationPhrase(event.target.value)} placeholder={CONFIRMATION_PHRASE} required />
            </label>
            <label style={{display:"flex",gap:8,alignItems:"flex-start"}}>
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              I confirm the RVS College and SecureID Test College records in this preview are test data and authorize deleting their institution-linked records, including fake/manual payment entries.
            </label>
            <button className="primary" type="submit" disabled={busy || blocked || !confirmationEmail.trim() || confirmationPhrase !== CONFIRMATION_PHRASE || !acknowledged}>
              {busy ? "Creating backup, verifying and cleaning…" : "Create verified backup and delete approved test data"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
