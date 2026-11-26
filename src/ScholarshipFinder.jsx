import { useMemo, useState } from "react";

const VERIFIED_ON = "26 November 2026";

const portals = [
  {
    id: "bihar-pms",
    title: "Bihar Post-Matric Scholarship",
    shortTitle: "Bihar PMS",
    authority: "Education Department, Government of Bihar",
    scope: "Bihar",
    levels: ["11-12", "undergraduate", "postgraduate", "technical"],
    category: "State post-matric",
    status: "Applications reopened",
    statusTone: "open",
    deadline: "30 November 2026",
    update: "The official portal notice says AY 2026–27 registration and application finalisation reopened on 12 November and closes on 30 November 2026.",
    description: "The BC-EBC student portal is available here. The official page also provides a separate SC-ST portal route. Check the category-specific notice before applying.",
    workflow: "The student registers, completes the application and finalises it. The institution then verifies the application, followed by district and state processing.",
    url: "https://pmsonline.bihar.gov.in/2026-27/pms/pms_online/Default.aspx",
    secondaryUrl: "https://pmsonline.bihar.gov.in/",
    secondaryLabel: "Official PMS homepage",
    sourceLabel: "Official Bihar PMS portal"
  },
  {
    id: "jharkhand-ekalyan",
    title: "Jharkhand e-Kalyan Scholarships",
    shortTitle: "Jharkhand e-Kalyan",
    authority: "Department of ST, SC, Minority and Backward Class Welfare, Government of Jharkhand",
    scope: "Jharkhand",
    levels: ["school", "11-12", "undergraduate", "postgraduate", "technical"],
    category: "Pre-matric and post-matric",
    status: "2026–27 notices published",
    statusTone: "notice",
    deadline: "Check scheme schedule",
    update: "The official e-Kalyan notice board lists 2026–27 pre-matric and post-matric registration notices. A single common closing date is not shown here; verify the applicable schedule on the portal.",
    description: "For eligible Jharkhand-domicile students. The portal provides separate student and institution logins and publishes scheme rules, notices and application instructions.",
    workflow: "The student registers, selects the scheme and submits the application. The school or college verifies the student and institutional details when required.",
    url: "https://ekalyan.cgg.gov.in/",
    secondaryUrl: "https://www.cgg.gov.in/it_project/e-kalyan-government-of-jharkhand/",
    secondaryLabel: "About the official e-Kalyan system",
    sourceLabel: "Official Jharkhand e-Kalyan portal"
  },
  {
    id: "national-nsp",
    title: "National Scholarship Portal (NSP)",
    shortTitle: "National Scholarship Portal",
    authority: "Government of India · National e-Governance Division",
    scope: "All India",
    levels: ["school", "11-12", "undergraduate", "postgraduate", "technical"],
    category: "Central and state-linked schemes",
    status: "AY 2026–27 scheme listings live",
    statusTone: "notice",
    deadline: "Varies by scheme",
    update: "The official portal lists AY 2026–27 schemes. Closing dates differ by scheme and verification level; several current listings show 30 November 2026, while others have different dates.",
    description: "Explore central and state schemes, read scheme specifications and FAQs, generate the required One Time Registration (OTR), then apply through the student login.",
    workflow: "The student uses the required OTR to apply. The institution and designated officers complete their own verification stages where the scheme requires them.",
    url: "https://scholarships.gov.in/All-Scholarships",
    secondaryUrl: "https://scholarships.gov.in/Students",
    secondaryLabel: "Student login and OTR",
    sourceLabel: "Official National Scholarship Portal"
  }
];

const checklistItems = [
  { id: "profile", title: "Personal and academic details", note: "Name, date of birth, course, year and institution details must match official records." },
  { id: "registration", title: "Portal registration / OTR", note: "Create or retrieve the official portal registration or NSP OTR, where required." },
  { id: "domicile", title: "Domicile and category certificates", note: "Keep only the certificates required by your selected scheme." },
  { id: "income", title: "Income certificate", note: "Check the scheme's issuing-authority and validity rules." },
  { id: "bonafide", title: "Bonafide and fee details", note: "Request these from your school or college if the portal asks for them." },
  { id: "marksheet", title: "Previous examination marksheet", note: "Use the result and academic year requested by the scheme." },
  { id: "photo", title: "Photograph and signature", note: "Prepare a clear passport-size photo and signature image only in the size and format required by the official portal." },
  { id: "bank", title: "Bank / DBT readiness", note: "Check account and Aadhaar seeding only as required by the official scheme. Never enter banking credentials or OTPs in SecureID." }
];

const studyLevels = [
  ["all", "All study levels"],
  ["school", "School · Classes 1–10"],
  ["11-12", "Class 11–12"],
  ["undergraduate", "Undergraduate / Diploma"],
  ["postgraduate", "Postgraduate / Research"],
  ["technical", "Technical / Professional"]
];

export default function ScholarshipFinder() {
  const [state, setState] = useState("all");
  const [level, setLevel] = useState("all");
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState([]);
  const [showChecklist, setShowChecklist] = useState(true);

  const filteredPortals = useMemo(() => {
    const term = query.trim().toLowerCase();
    return portals.filter((portal) => {
      const stateMatch = state === "all" || portal.scope === "All India" || portal.scope === state;
      const levelMatch = level === "all" || portal.levels.includes(level);
      const text = [portal.title, portal.shortTitle, portal.authority, portal.category, portal.description].join(" ").toLowerCase();
      return stateMatch && levelMatch && (!term || text.includes(term));
    });
  }, [level, query, state]);

  const readiness = Math.round((checked.length / checklistItems.length) * 100);

  function toggleChecklistItem(id) {
    setChecked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <section className="content scholarshipFinder">
      <div className="scholarshipHero">
        <div className="scholarshipHeroCopy">
          <div className="eyebrow">STUDENT SUPPORT · OFFICIAL PORTALS</div>
          <h2>Find scholarships. Prepare once. Apply on the right portal.</h2>
          <p>Discover relevant government scholarship portals, understand who does what, and prepare your documents before you open the official application.</p>
          <span className="scholarshipTrustLabel">Government applications are submitted on their official websites — not inside SecureID.</span>
        </div>
        <aside className="scholarshipHeroAside">
          <span className="scholarshipAsideIcon">✓</span>
          <strong>Official destination first</strong>
          <p>SecureID helps you discover opportunities and get application-ready. The government or scheme owner remains responsible for eligibility, verification and award decisions.</p>
          <small>Portal details checked {VERIFIED_ON}</small>
        </aside>
      </div>

      <section className="panel scholarshipFilters" aria-labelledby="scholarship-filter-title">
        <div className="scholarshipSectionHead">
          <div>
            <div className="eyebrow">DISCOVER</div>
            <h2 id="scholarship-filter-title">Find an official scholarship portal</h2>
            <p className="lead">Filter by domicile and study level. Always confirm the final eligibility and deadline on the scheme's official page.</p>
          </div>
          <span className="scholarshipResultCount">{filteredPortals.length} {filteredPortals.length === 1 ? "portal" : "portals"} found</span>
        </div>
        <div className="scholarshipFilterGrid">
          <label>
            Domicile state
            <select value={state} onChange={(event) => setState(event.target.value)}>
              <option value="all">All states / national schemes</option>
              <option value="Bihar">Bihar</option>
              <option value="Jharkhand">Jharkhand</option>
              <option value="Other">Other state</option>
            </select>
          </label>
          <label>
            Current study level
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              {studyLevels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Search portals or schemes
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Bihar, NSP, post-matric…" />
          </label>
        </div>
        <button type="button" className="secondary scholarshipReset" onClick={() => { setState("all"); setLevel("all"); setQuery(""); }}>Reset filters</button>
      </section>

      <section className="scholarshipPortalGrid" aria-label="Official scholarship portals">
        {filteredPortals.map((portal) => (
          <article className="panel scholarshipPortalCard" key={portal.id}>
            <div className="scholarshipPortalTopline">
              <span className="scholarshipCategory">{portal.category}</span>
              <span className={"scholarshipStatus scholarshipStatus-" + portal.statusTone}>{portal.status}</span>
            </div>
            <div className="eyebrow">{portal.scope === "All India" ? "NATIONAL SCHEME DIRECTORY" : portal.scope.toUpperCase() + " STATE PORTAL"}</div>
            <h3>{portal.title}</h3>
            <p className="scholarshipAuthority">{portal.authority}</p>
            <p>{portal.description}</p>
            <div className="scholarshipDeadline">
              <span>Application deadline</span>
              <strong>{portal.deadline}</strong>
            </div>
            <p className="scholarshipUpdate">{portal.update}</p>
            <div className="scholarshipWorkflow">
              <strong>Who completes the application?</strong>
              <p>{portal.workflow}</p>
            </div>
            <div className="scholarshipPortalActions">
              <a className="scholarshipPrimaryLink" href={portal.url} target="_blank" rel="noopener noreferrer">
                Open official portal <span aria-hidden="true">↗</span>
              </a>
              <a className="scholarshipSecondaryLink" href={portal.secondaryUrl} target="_blank" rel="noopener noreferrer">{portal.secondaryLabel}</a>
            </div>
            <small className="scholarshipSourceNote">{portal.sourceLabel} · Checked {VERIFIED_ON}</small>
          </article>
        ))}
        {filteredPortals.length === 0 && (
          <div className="panel scholarshipEmpty">
            <h3>No matching portal in this starter directory</h3>
            <p>Try another study level or choose all states. This does not mean that no scholarship exists for you; schemes can be published by your state, institution or a private sponsor.</p>
            <button type="button" className="secondary" onClick={() => { setState("all"); setLevel("all"); setQuery(""); }}>Show all official portals</button>
          </div>
        )}
      </section>

      <section className="panel scholarshipHowItWorks">
        <div className="eyebrow">CLEAR RESPONSIBILITIES</div>
        <h2>What SecureID does — and what your college does</h2>
        <div className="scholarshipRoleGrid">
          <article>
            <span className="scholarshipRoleNumber">01</span>
            <h3>Student applies</h3>
            <p>You register, fill and finally submit the application on the scheme's official portal. Save the official application/reference number there.</p>
          </article>
          <article>
            <span className="scholarshipRoleNumber">02</span>
            <h3>SecureID prepares</h3>
            <p>Use your identity details and Vault checklist to reduce repeated preparation. SecureID does not submit the external form or handle your portal password, OTP or bank credentials.</p>
          </article>
          <article>
            <span className="scholarshipRoleNumber">03</span>
            <h3>Institution verifies</h3>
            <p>Your school or college may confirm enrolment, course, fee details or bonafide documents. It does not normally fill the student's government application in their place.</p>
          </article>
        </div>
        <p className="scholarshipLimitNote">A SecureID document, membership or status is not government verification and does not guarantee scholarship eligibility or payment.</p>
      </section>

      <section className="panel scholarshipChecklist">
        <div className="scholarshipSectionHead">
          <div>
            <div className="eyebrow">APPLICATION READINESS</div>
            <h2>Prepare your document checklist</h2>
            <p className="lead">Requirements vary by scheme. Tick items as you prepare them; this checklist stays only in this open page and is not submitted anywhere.</p>
          </div>
          <button type="button" className="secondary" onClick={() => setShowChecklist((value) => !value)}>{showChecklist ? "Hide checklist" : "Show checklist"}</button>
        </div>
        <div className="scholarshipReadiness">
          <div><strong>{checked.length} of {checklistItems.length} ready</strong><span>{readiness}% prepared</span></div>
          <div className="scholarshipProgress" role="progressbar" aria-valuenow={readiness} aria-valuemin="0" aria-valuemax="100" aria-label="Document checklist readiness"><span style={{ width: readiness + "%" }} /></div>
        </div>
        {showChecklist && (
          <div className="scholarshipChecklistGrid">
            {checklistItems.map((item) => (
              <label className={checked.includes(item.id) ? "scholarshipChecklistItem isReady" : "scholarshipChecklistItem"} key={item.id}>
                <input type="checkbox" checked={checked.includes(item.id)} onChange={() => toggleChecklistItem(item.id)} />
                <span><strong>{item.title}</strong><small>{item.note}</small></span>
              </label>
            ))}
          </div>
        )}
        <div className="scholarshipChecklistActions">
          <button type="button" className="secondary scholarshipVaultLink" onClick={() => window.dispatchEvent(new CustomEvent("secureid:navigate", { detail: "documents" }))}>Open Document Vault</button>
          <button type="button" className="secondary" onClick={() => setChecked([])} disabled={checked.length === 0}>Clear checklist</button>
          <span>Only upload or share documents when the official scheme asks for them and you understand why they are needed.</span>
        </div>
      </section>

      <section className="panel scholarshipPartnerNote">
        <div className="eyebrow">PRIVATE / INSTITUTION SCHOLARSHIPS</div>
        <h2>Scholarships published by a school, college or sponsor</h2>
        <p>These are different from government schemes. A verified institution, NGO, trust or company may publish its own scholarship on SecureID only after a real partnership is established. Students can apply there when an eligible partner program is actually available.</p>
        <p className="scholarshipLimitNote">No government scholarship is represented as a SecureID-hosted application. The existing institution workspace is reserved for institution-funded partner programs, not e-Kalyan, Bihar PMS or NSP applications.</p>
      </section>
    </section>
  );
}
