import { chromium } from "playwright";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ headless: true });
const now = Date.now();
const state = {
  institutions: [],
  memberships: [],
  audit: [],
  users: [{ id: "student-1", email: "student@secureid.test", role: "user", createdAt: now, status: "active" }]
};
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  const apiTrace = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) apiTrace.push("-> " + request.method() + " " + new URL(request.url()).pathname); });
  page.on("response", response => { if (new URL(response.url()).pathname.startsWith("/api/")) apiTrace.push("<- " + response.status() + " " + new URL(response.url()).pathname); });

  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/auth/csrf" && method === "GET") {
      return route.fulfill({ ...json({ success: true }), headers: { "set-cookie": "secureid.csrf=synthetic-test-token; Path=/; SameSite=Lax" } });
    }
    if (path === "/api/auth/session" && method === "GET") {
      return route.fulfill(json({ user: { email: "owner@secureid.test", role: "owner", mfaVerified: true }, wallet: { risk: 0, locked: false } }));
    }
    if (path === "/api/securecloud/overview" && method === "GET") return route.fulfill(json({ projects: 0, services: 0, deployments: 0, workerConfigured: false }));
    if (path === "/api/securecloud/projects" && method === "GET") return route.fulfill(json({ projects: [] }));
    if (path === "/api/admin/health" && method === "GET") {
      return route.fulfill(json({ status: "ready", service: "SecureID API", database: "ok", emailDelivery: { configured: true, provider: "test" }, backup: { enabled: true, lastSuccessAt: now }, timestamp: now }));
    }
    if (path === "/api/admin/users" && method === "GET") {
      return route.fulfill(json({ users: state.users, total: state.users.length, active: state.users.length, suspended: 0 }));
    }
    if (path === "/api/admin/activity" && method === "GET") return route.fulfill(json({ events: [] }));
    if (path === "/api/admin/notifications" && method === "GET") return route.fulfill(json({ notifications: [], totals: { total: 0, pending: 0, sent: 0, failed: 0 } }));
    if (path === "/api/admin/institutions" && method === "GET") return route.fulfill(json({ institutions: state.institutions, memberships: state.memberships }));
    if (path === "/api/admin/institutions/institution-1/subscription" && method === "GET") return route.fulfill(json({ subscription: { planKey: "pilot", status: "pilot", features: ["hostel","scholarship","student_submissions"], startsAt: null, endsAt: null } }));
    if (path === "/api/admin/institutions/institution-1/partnership" && method === "GET") return route.fulfill(json({
      institution: { id: "institution-1", name: "SecureID Browser Test College" },
      profile: { aisheCode: "", institutionType: "", affiliation: "", officialWebsite: "", officialEmailDomain: "", address: "", representativeName: "", representativeTitle: "", representativeEmail: "", agreementReference: "", identityStatus: "pending", representativeStatus: "pending", agreementStatus: "draft", paymentStatus: "not_required", paymentReference: "", paymentAmountPaise: null, connectionMode: "dashboard", connectionStatus: "not_connected", notes: "" },
      subscription: { planKey: "pilot", status: "pilot", startsAt: null, endsAt: null },
      members: { total: state.memberships.length, active: state.memberships.filter(item => item.status === "active").length },
      readiness: { identityVerified: false, representativeVerified: false, agreementSigned: false, subscriptionCleared: true, canConnect: false, connected: false },
      evidence: [], audit: []
    }));
    if (path === "/api/admin/institutions" && method === "POST") {
      const body = request.postDataJSON();
      const institution = { id: "institution-1", name: body.name };
      state.institutions = [institution];
      state.audit.push({ action: "institution_created", createdAt: now });
      return route.fulfill(json({ institution }, 201));
    }
    if (path === "/api/admin/institutions/institution-1/memberships" && method === "POST") {
      const body = request.postDataJSON();
      state.memberships = [{ id: "membership-1", institutionId: "institution-1", email: "student@secureid.test", role: body.role, status: "active" }];
      state.audit.push({ action: "membership_provisioned", targetEmail: "student@secureid.test", toRole: body.role, createdAt: now });
      return route.fulfill(json({ membership: state.memberships[0] }, 201));
    }
    if (path === "/api/admin/institutions/institution-1/audit" && method === "GET") return route.fulfill(json({ audit: state.audit }));
    if (path === "/api/admin/institutions/institution-1/memberships/membership-1" && method === "PATCH") {
      const body = request.postDataJSON();
      state.memberships[0].status = body.status;
      state.audit.push({ action: "membership_status_changed", targetEmail: "student@secureid.test", toStatus: body.status, createdAt: now });
      return route.fulfill(json({ membership: state.memberships[0] }));
    }
    return route.fulfill(json({ message: "Unmocked API request in browser smoke test: " + method + " " + path }, 404));
  });

  const response = await page.goto(baseURL, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error("Preview homepage did not return HTTP 200.");
  await page.getByRole("button", { name: /Continue securely/i }).click();
  await page.locator(".sidebar .navItem").filter({ hasText: "Owner / Admin" }).click();
  await page.getByRole("heading", { name: /SecureID owner console/i }).waitFor();

  await page.getByPlaceholder("New college / institution name").fill("SecureID Browser Test College");
  await page.getByRole("button", { name: "Create institution" }).click();
  await page.getByText("Institution created. Provision staff and student memberships explicitly.").waitFor({ timeout: 5000 });
  // Reload to verify the created institution is returned by the directory endpoint,
  // rather than relying only on the create-success toast.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Continue securely/i }).click();
  await page.locator(".sidebar .navItem").filter({ hasText: "Owner / Admin" }).click();
  await page.getByRole("heading", { name: /SecureID owner console/i }).waitFor();
  try { await page.locator('select option[value="institution-1"]').waitFor({ state: "attached", timeout: 5000 }); }
  catch { throw new Error("Created institution did not reappear after reload. Alert=" + await page.getByRole("alert").allTextContents() + "; Mock state=" + JSON.stringify(state) + "; API trace=" + apiTrace.join(" | ")); }
  // Institution selectors intentionally stay empty after reload; choose the institution explicitly.
  await page.locator("form").filter({ has: page.getByRole("button", { name: "Provision membership" }) }).locator("label").first().locator("select").selectOption("institution-1");

  await page.getByLabel("Institution role").selectOption("reviewer");
  await page.getByRole("button", { name: "Provision membership" }).click();
  await page.getByText("Institution membership provisioned and audit entry recorded.").waitFor();

  await page.getByRole("button", { name: "View selected institution audit" }).click();
  await page.getByText("membership provisioned").waitFor();

  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Suspend" }).last().click();
  await page.getByText("Institution membership status updated and audit entry recorded.").waitFor();

  if (pageErrors.length) throw new Error("Browser JavaScript errors: " + pageErrors.join("; "));
  console.log("PASS owner console browser smoke: owner-only navigation, institution creation, reviewer provisioning, audit display, and membership suspension UI.");
} finally {
  await browser.close();
}
