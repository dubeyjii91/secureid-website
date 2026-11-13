import { useCallback, useEffect, useState } from "react";
import api from "./api.js";

const CONFIRMATION_PHRASE = "DELETE TEST DATA FOR RVS AND SECUREID TEST COLLEGE";

export default function OwnerTestInstitutionCleanup() {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const loadPreview = useCallback(async ({ afterCleanupResult = null } = {}) => {
    setLoading(true);
    if (!afterCleanupResult) {
      setStatus({ type: "info", message: "Refreshing the approved-institution inventory…" });
    }
    try {
      const result = await api("/api/admin/test-institution-cleanup/preview");
      setPreview(result);
      setConfirmationPhrase("");
      setAcknowledged(false);
      const missing = Array.isArray(result?.missingTargets) ? result.missingTargets : [];
      const unsupported = Array.isArray(result?.unsupportedRelationships) ? result.unsupportedRelationships : [];
      const institutions = Array.isArray(result?.institutions) ? result.institutions : [];
      const totalRecords = Number(result?.totalRecords || 0);

      if (afterCleanupResult) {
        // Once a verified cleanup commits, the two approved institutions are
        // expected to be absent from the refreshed inventory. Do not mistake
        // that successful post-delete state for a pre-delete safety blocker.
        const bothTargetsAbsent = missing.length === 2 && institutions.length === 0;
        if (bothTargetsAbsent && unsupported.length === 0 && totalRecords === 0) {
          setStatus({
            type: "success",
            message: "Cleanup complete and independently verified by a fresh inventory. " +
              afterCleanupResult.deletedRows + " database records removed across " +
              afterCleanupResult.deletedInstitutions.length + " approved institutions; " +
              afterCleanupResult.encryptedFilesRemoved + " unshared encrypted document files removed. " +
              "Fresh encrypted backup and isolated restore verified: " + afterCleanupResult.backupFile +
              ". Post-cleanup inventory: 0 approved institutions and 0 linked records. Owner, user accounts and shared plans preserved."
          });
        } else {
          setStatus({
            type: "error",
            message: "The cleanup endpoint reported success, but the fresh post-cleanup inventory needs review. " +
              "Remaining approved institutions: " + institutions.length +
              "; linked records: " + totalRecords +
              "; missing targets: " + missing.length +
              "; unsupported relationships: " + unsupported.length +
              ". Do not run cleanup again. Contact the SecureID maintainer and retain the backup."
          });
        }
      } else if (missing.length || unsupported.length || !institutions.length) {
        const reasons = [];
        if (missing.length) reasons.push("Missing approved institution(s): " + missing.join(", "));
        if (unsupported.length) reasons.push("Unsupported relationships: " + unsupported.join("; "));
        if (!institutions.length) reasons.push("No approved institution inventory is available.");
        setStatus({ type: "error", message: "Cleanup is safely blocked. " + reasons.join(" | ") + " No records were changed." });
      } else {
        setStatus({ type: "success", message: "Inventory refreshed. Review the counts and complete all Owner confirmations before proceeding." });
      }
    } catch (requestError) {
      setStatus({ type: "error", message: requestError.message || "Could not load the test-data inventory." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  async function executeCleanup() {
    setStatus({ type: "info", message: "Delete button click received. Checking the preview and Owner confirmations…" });

    const missing = Array.isArray(preview?.missingTargets) ? preview.missingTargets : [];
    const unsupported = Array.isArray(preview?.unsupportedRelationships) ? preview.unsupportedRelationships : [];
    const institutions = Array.isArray(preview?.institutions) ? preview.institutions : [];

    if (!preview?.previewHash) {
      setStatus({ type: "error", message: "Cleanup blocked: the inventory preview or preview hash is missing. Refresh the inventory before continuing. No records were changed." });
      return;
    }
    if (missing.length || unsupported.length || !institutions.length) {
      const reasons = [];
      if (missing.length) reasons.push("Missing approved institution(s): " + missing.join(", "));
      if (unsupported.length) reasons.push("Unsupported relationships: " + unsupported.join("; "));
      if (!institutions.length) reasons.push("No approved institution inventory is available.");
      setStatus({ type: "error", message: "Cleanup remains safely blocked. " + reasons.join(" | ") + " No records were changed." });
      return;
    }
    if (confirmationPhrase.trim() !== CONFIRMATION_PHRASE) {
      setStatus({ type: "error", message: "Cleanup blocked: enter the exact confirmation phrase shown in the field. No records were changed." });
      return;
    }
    if (!acknowledged) {
      setStatus({ type: "error", message: "Cleanup blocked: tick the test-data confirmation checkbox. No records were changed." });
      return;
    }
    if (!confirmationEmail.trim()) {
      setStatus({ type: "error", message: "Cleanup blocked: enter the configured Owner email. No records were changed." });
      return;
    }

    setBusy(true);
    setStatus({ type: "info", message: "Safety checks passed. Sending the authenticated cleanup request…" });
    try {
      const result = await api("/api/admin/test-institution-cleanup/execute", {
        method: "POST",
        body: JSON.stringify({
          confirmationEmail: confirmationEmail.trim(),
          confirmationPhrase: confirmationPhrase.trim(),
          previewHash: preview.previewHash,
          testDataConfirmed: acknowledged
        })
      });
      // Keep the success response and validate it against a fresh read-only
      // inventory. loadPreview distinguishes the expected empty post-cleanup
      // state from a pre-cleanup missing-target safety blocker.
      await loadPreview({ afterCleanupResult: result });
    } catch (requestError) {
      setStatus({ type: "error", message: (requestError.message || "Cleanup did not complete. No success is assumed.") +
        (requestError.requestId ? " Request ID: " + requestError.requestId : "") });
      await loadPreview();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{border:"1px solid #b7791f",marginBottom:20}}>
      <div className="eyebrow dark">OWNER ONLY · TEST DATA CLEANUP</div>
      <h3>Fresh-start cleanup · approved test institutions</h3>
      <p>Recursive inventory includes institution-linked records and indirect children such as test payments, fees, memberships, document reviews, hostel history, scholarships and audit rows. It does not delete any user account, the configured Owner account, shared plan catalogues or unrelated institutions.</p>
      {status && (
        <div role={status.type === "error" ? "alert" : "status"} aria-live="polite" style={{
          display:"block",visibility:"visible",opacity:1,margin:"12px 0",padding:"14px 16px",
          border:"2px solid " + (status.type === "error" ? "#b42318" : status.type === "success" ? "#067647" : "#175cd3"),
          borderRadius:10,background:status.type === "error" ? "#fff1f0" : status.type === "success" ? "#ecfdf3" : "#eff8ff",
          color:status.type === "error" ? "#912018" : status.type === "success" ? "#05603a" : "#1849a9",
          fontWeight:700,lineHeight:1.5,whiteSpace:"pre-wrap"
        }}>{status.message}</div>
      )}
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
          {preview.missingTargets?.length > 0 && <p role="alert">Missing approved institution(s): {preview.missingTargets.join(", ")}</p>}
          {preview.unsupportedRelationships?.length > 0 && <p role="alert">Cleanup blocked until these relationships are reviewed: {preview.unsupportedRelationships.join("; ")}</p>}
          <p><strong>Backup safety:</strong> before deleting anything, the server creates a fresh encrypted database + document backup, decrypts it into an isolated temporary SQLite database, and verifies SQLite integrity and foreign-key consistency. If any step fails, deletion is blocked.</p>
          <div style={{display:"grid",gap:10,borderTop:"1px solid var(--border,#ddd)",paddingTop:14}}>
            <label>Configured Owner email
              <input type="email" value={confirmationEmail} onChange={(event) => setConfirmationEmail(event.target.value)} placeholder="Enter Owner email" required autoComplete="email" />
            </label>
            <label>Exact confirmation phrase
              <input value={confirmationPhrase} onChange={(event) => setConfirmationPhrase(event.target.value)} placeholder={CONFIRMATION_PHRASE} required />
            </label>
            <div style={{display:"flex",gap:10,alignItems:"flex-start",padding:"12px 14px",border:"1px solid var(--border,#8293aa)",borderRadius:10,background:"rgba(0,217,255,.06)"}}>
              <input
                id="test-data-cleanup-acknowledgement"
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.currentTarget.checked)}
                style={{width:20,height:20,minWidth:20,margin:"2px 0 0",accentColor:"#00bfe8",cursor:"pointer",pointerEvents:"auto",opacity:1}}
              />
              <label htmlFor="test-data-cleanup-acknowledgement" style={{display:"block",cursor:"pointer",lineHeight:1.55,margin:0}}>
                I confirm the RVS College and SecureID Test College records in this preview are test data and authorize deleting their institution-linked records, including fake/manual payment entries.
              </label>
            </div>
            <button
              className="primary"
              type="button"
              onClick={executeCleanup}
              disabled={busy || loading}
              aria-disabled={busy || loading}
              title={busy || loading ? "Please wait for the inventory or cleanup operation to finish." : "Click to validate the confirmation details and show any safety blocker."}
              style={{cursor: busy || loading ? "not-allowed" : "pointer"}}
            >
              {busy ? "Creating backup, verifying and cleaning…" : "Create verified backup and delete approved test data"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
