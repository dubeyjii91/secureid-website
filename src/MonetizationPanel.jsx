import { useEffect, useState } from "react";
import api from "./api.js";

const money = paise => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(paise || 0) / 100);
const date = value => value ? new Date(value).toLocaleString() : "—";

export default function MonetizationPanel() {
  const [overview, setOverview] = useState(null);
  const [entries, setEntries] = useState([]);
  const [sponsorships, setSponsorships] = useState([]);
  const [institutions, setInstitutions] = useState([]);
  const [category, setCategory] = useState("institution_subscription");
  const [amount, setAmount] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [sponsorName, setSponsorName] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    try {
      const [summary, ledger, sponsorData, directory] = await Promise.all([
        api("/api/admin/monetization/overview", { cache: "no-store" }),
        api("/api/admin/monetization/entries", { cache: "no-store" }),
        api("/api/admin/monetization/sponsorships", { cache: "no-store" }),
        api("/api/admin/institutions", { cache: "no-store" })
      ]);
      setOverview(summary);
      setEntries(ledger.entries || []);
      setSponsorships(sponsorData.sponsorships || []);
      setInstitutions(directory.institutions || []);
    } catch (err) { setError(err.message || "Revenue dashboard could not be loaded."); }
  }

  useEffect(() => { load(); }, []);

  async function createEntry(event) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const rupees = Number(amount);
      if (!Number.isFinite(rupees) || rupees <= 0 || rupees > 1000000000) throw new Error("Enter a valid amount in rupees.");
      await api("/api/admin/monetization/entries", {
        method: "POST",
        body: JSON.stringify({
          category, amountPaise: Math.round(rupees * 100), institutionId: institutionId || null,
          reference, description, status: "pending", idempotencyKey: crypto.randomUUID()
        })
      });
      setAmount(""); setReference(""); setDescription("");
      setNotice("Pending ledger entry recorded. No payment was collected.");
      await load();
    } catch (err) { setError(err.message || "Ledger entry could not be saved."); }
    finally { setBusy(false); }
  }

  async function updateEntry(entry, status) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/api/admin/monetization/entries/" + encodeURIComponent(entry.id), { method: "PATCH", body: JSON.stringify({ status }) });
      setNotice(status === "paid" ? "Entry marked as received. This is a manual record, not gateway confirmation." : "Pending entry voided.");
      await load();
    } catch (err) { setError(err.message || "Ledger entry could not be updated."); }
    finally { setBusy(false); }
  }

  async function createSponsorship(event) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await api("/api/admin/monetization/sponsorships", {
        method: "POST",
        body: JSON.stringify({ sponsorName, campaignName, placementLabel: "Sponsored", status: "draft" })
      });
      setSponsorName(""); setCampaignName("");
      setNotice("Sponsorship saved as draft. It is not displayed to users or sold automatically.");
      await load();
    } catch (err) { setError(err.message || "Sponsorship could not be saved."); }
    finally { setBusy(false); }
  }

  async function updateSponsorship(item, status) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/api/admin/monetization/sponsorships/" + encodeURIComponent(item.id), { method: "PATCH", body: JSON.stringify({ status }) });
      setNotice("Sponsorship status updated. Sponsored content delivery is not enabled in this release.");
      await load();
    } catch (err) { setError(err.message || "Sponsorship could not be updated."); }
    finally { setBusy(false); }
  }

  return <section className="panel" aria-labelledby="monetization-heading" style={{ marginTop: 20 }}>
    <div className="eyebrow dark">REVENUE & BUSINESS MANAGEMENT</div>
    <h3 id="monetization-heading">SecureID monetization</h3>
    <p>Owner-only manual revenue records, proposed pricing and sponsorship management. Live payment collection is disabled.</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {overview && <>
      <div className="dashboardGrid">
        <article className="panel"><div className="eyebrow dark">RECEIVED · MANUAL RECORDS</div><h3>{money(overview.totals.paidPaise)}</h3><small>{overview.totals.paidCount} entries marked paid</small></article>
        <article className="panel"><div className="eyebrow dark">PENDING</div><h3>{money(overview.totals.pendingPaise)}</h3><small>Not collected or gateway-confirmed</small></article>
        <article className="panel"><div className="eyebrow dark">DOCUMENT STORAGE</div><h3>{(overview.storage.bytes / (1024 ** 3)).toFixed(3)} GB</h3><small>{overview.storage.documents} active documents · usage only, not a quota</small></article>
        <article className="panel"><div className="eyebrow dark">SPONSORSHIPS</div><h3>{overview.sponsorships.active} active</h3><small>{overview.sponsorships.total} records · delivery not enabled</small></article>
      </div>
      <h4>Proposed institution plans</h4>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
        <thead><tr><th style={{ padding: 8 }}>Plan</th><th style={{ padding: 8 }}>Monthly</th><th style={{ padding: 8 }}>Annual</th><th style={{ padding: 8 }}>State</th></tr></thead>
        <tbody>{overview.plans.map(plan => <tr key={plan.key}><td style={{ padding: 8, borderTop: "1px solid var(--border,#ddd)" }}><strong>{plan.name}</strong><br/><small>{plan.note}</small></td><td style={{ padding: 8, borderTop: "1px solid var(--border,#ddd)" }}>{plan.monthlyPaise === null ? "Custom" : money(plan.monthlyPaise)}</td><td style={{ padding: 8, borderTop: "1px solid var(--border,#ddd)" }}>{plan.annualPaise === null ? "Custom" : money(plan.annualPaise)}</td><td style={{ padding: 8, borderTop: "1px solid var(--border,#ddd)" }}>{plan.status}</td></tr>)}</tbody>
      </table></div>
    </>}
    <h4>Record a subscription or service fee</h4>
    <p><small>Use this only for a fee agreed with the institution or sponsor. Marking an entry paid is a manual accounting action, not payment verification.</small></p>
    <form onSubmit={createEntry} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
      <label>Revenue type<select value={category} onChange={e => setCategory(e.target.value)}><option value="institution_subscription">College subscription</option><option value="admission_service_fee">Admission service fee</option><option value="premium_storage">Premium storage</option><option value="sponsorship">Sponsorship</option><option value="other">Other</option></select></label>
      <label>Amount (₹)<input type="number" min="0.01" max="1000000000" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label>Institution (optional)<select value={institutionId} onChange={e => setInstitutionId(e.target.value)}><option value="">Not linked</option>{institutions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Agreement / admission reference<input maxLength={120} value={reference} onChange={e => setReference(e.target.value)} /></label>
      <label style={{ gridColumn: "1 / -1" }}>Description<input required maxLength={240} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <button className="primary" disabled={busy}>Save pending entry</button>
    </form>
    <h4>Revenue ledger</h4>
    {entries.length === 0 ? <p>No revenue entries recorded.</p> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
      <thead><tr><th style={{ padding: 8 }}>Date / description</th><th style={{ padding: 8 }}>Category</th><th style={{ padding: 8 }}>Amount</th><th style={{ padding: 8 }}>Status</th><th style={{ padding: 8 }}>Action</th></tr></thead>
      <tbody>{entries.map(entry => <tr key={entry.id}><td style={{ padding: 8, borderTop: "1px solid var(--border,#ddd)" }}>{entry.description}<br/><small>{entry.institutionName || "No institution"} · {date(entry.createdAt)}</small></td><td style={{ padding: 8, borderTop: "1px solid var(--border,#ddd)" }}>{entry.category.replaceAll("_", " ")}</td><td style={{ padding: 8, borderTop: "1px solid var(--border,#ddd)" }}>{money(entry.amountPaise)}</td><td style={{ padding: 8, borderTop: "1px solid var(--border,#ddd)" }}>{entry.status}</td><td style={{ padding: 8, borderTop: "1px solid var(--border,#ddd)" }}>{entry.status === "pending" ? <><button className="secondary" disabled={busy} onClick={() => updateEntry(entry, "paid")}>Mark received</button> <button className="secondary" disabled={busy} onClick={() => updateEntry(entry, "void")}>Void</button></> : "—"}</td></tr>)}</tbody>
      </table></div>}
    <h4>Sponsorship management</h4>
    <p><small>Every future placement must be visibly labelled Sponsored. Never target ads using private identity documents or sensitive personal information.</small></p>
    <form onSubmit={createSponsorship} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
      <label>Sponsor name<input required maxLength={120} value={sponsorName} onChange={e => setSponsorName(e.target.value)} /></label>
      <label>Campaign name<input required maxLength={120} value={campaignName} onChange={e => setCampaignName(e.target.value)} /></label>
      <button className="primary" disabled={busy}>Save sponsorship draft</button>
    </form>
    {sponsorships.length > 0 && <div style={{ overflowX: "auto", marginTop: 12 }}><table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
      <thead><tr><th style={{ padding: 8 }}>Sponsor / campaign</th><th style={{ padding: 8 }}>Label</th><th style={{ padding: 8 }}>Status</th><th style={{ padding: 8 }}>Action</th></tr></thead>
      <tbody>{sponsorships.map(item => <tr key={item.id}><td style={{ padding: 8, borderTop: "1px solid var(--border,#ddd)" }}>{item.sponsorName}<br/><small>{item.campaignName}</small></td><td style={{ padding: 8, borderTop: "1px solid var(--border,#ddd)" }}>{item.placementLabel}</td><td style={{ padding: 8, borderTop: "1px solid var(--border,#ddd)" }}>{item.status}</td><td style={{ padding: 8, borderTop: "1px solid var(--border,#ddd)" }}>{item.status === "draft" || item.status === "paused" ? <button className="secondary" disabled={busy} onClick={() => updateSponsorship(item, "active")}>Activate record</button> : item.status === "active" ? <button className="secondary" disabled={busy} onClick={() => updateSponsorship(item, "paused")}>Pause</button> : "—"}</td></tr>)}</tbody>
      </table></div>}
    <p><small>Billing mode: {overview?.billingMode || "loading"} · Live payments: disabled · No external payment provider connected.</small></p>
    <button type="button" className="secondary" onClick={load} disabled={busy}>Refresh revenue data</button>
  </section>;
}
