import { chromium } from "playwright";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ headless: true });
const state = { submission: null, audit: [] };
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const now = new Date().toISOString();

async function openRole(role) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/auth/csrf" && method === "GET") {
      return route.fulfill({ ...json({ success: true }), headers: { "set-cookie": "secureid.csrf=synthetic-test-token; Path=/; SameSite=Lax" } });
    }
    if (path === "/api/auth/session" && method === "GET") {
      return route.fulfill(json({ user: { email: role === "student" ? "student@secureid.test" : "reviewer@secureid.test", role: "user", mfaVerified: true }, wallet: { risk: 0, locked: false } }));
    }
    if (path === "/api/college-pilot/requests" && method === "GET") return route.fulfill(json({ requests: [] }));
    if (path === "/api/institutions/memberships" && method === "GET") {
      return route.fulfill(json({ memberships: [{ institutionId: "qa-college", institutionName: "SecureID QA Sandbox", role, status: "active", joinedAt: now }] }));
    }
    if (path === "/api/documents" && method === "GET") {
      return route.fulfill(json({ documents: [{ id: "synthetic-doc-1", name: "Synthetic Student ID.pdf", category: "student_id" }] }));
    }
    if (path === "/api/institutions/my-review-submissions" && method === "GET") {
      return route.fulfill(json({ submissions: state.submission ? [{ ...state.submission }] : [] }));
    }
    if (path === "/api/institutions/review-queue" && method === "GET") {
      if (role === "student") return route.fulfill(json({ message: "Forbidden" }, 403));
      const safeSubmission = state.submission ? {
        id: state.submission.id,
        documentName: state.submission.documentName,
        status: state.submission.status,
        institutionName: state.submission.institutionName,
        purpose: state.submission.purpose,
        documentCategory: state.submission.documentCategory,
        studentUserId: state.submission.studentUserId
      } : null;
      return route.fulfill(json({ submissions: safeSubmission ? [safeSubmission] : [] }));
    }
    if (path === "/api/institutions/review-submissions" && method === "POST" && role === "student") {
      const body = request.postDataJSON();
      if (body.consent !== true) return route.fulfill(json({ message: "Consent required" }, 400));
      state.submission = {
        id: "qa-submission-1",
        documentName: "Synthetic Student ID.pdf",
        documentCategory: "student_id",
        studentUserId: "student-test-user",
        institutionName: "SecureID QA Sandbox",
        purpose: body.purpose,
        status: "submitted",
        consentVersion: "college-review-v1",
        consentedAt: now,
        createdAt: now,
        reviewNote: ""
      };
      state.audit.push({ action: "student_submitted", createdAt: now });
      return route.fulfill(json({ submission: state.submission }, 201));
    }
    if (path === "/api/institutions/review-submissions/qa-submission-1" && method === "PATCH" && role === "reviewer") {
      const body = request.postDataJSON();
      if (!["needs_correction", "approved", "rejected"].includes(body.status)) return route.fulfill(json({ message: "Invalid status" }, 400));
      state.submission.status = body.status;
      state.submission.reviewNote = body.reviewNote || "";
      state.audit.push({ action: "review_status_changed", toStatus: body.status, createdAt: now });
      return route.fulfill(json({ submission: state.submission }));
    }
    if (path === "/api/institutions/review-submissions/qa-submission-1/audit" && method === "GET") {
      return route.fulfill(json({ audit: state.audit }));
    }
    return route.fulfill(json({ message: "Unmocked API request in synthetic two-account test: " + method + " " + path }, 404));
  });

  const response = await page.goto(baseURL, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error("Preview homepage did not return HTTP 200.");
  await page.getByRole("button", { name: /Continue securely/i }).click();
  await page.getByRole("button", { name: "College pilot" }).click();
  await page.getByRole("heading", { name: "Your college memberships" }).waitFor();
  return { page, pageErrors };
}

try {
  // Step 1: student account opens the College Workspace.
  const student = await openRole("student");
  await student.page.getByRole("heading", { name: "Submit a document for college review" }).waitFor();

  // Step 2: student selects the active institution and a synthetic Vault document, then gives explicit consent.
  await student.page.getByLabel("Institution", { exact: true }).selectOption("qa-college");
  await student.page.getByLabel("Document from your vault").selectOption("synthetic-doc-1");
  await student.page.getByLabel(/I agree to the college-review-v1 consent text above/i).check();
  await student.page.getByRole("button", { name: "Submit for college review" }).click();
  await student.page.getByText("Your document reference was submitted to the selected college.").waitFor();
  await student.page.getByText("submitted", { exact: true }).waitFor();

  // Step 3: separate reviewer account opens the queue and receives metadata only.
  const reviewer = await openRole("reviewer");
  await reviewer.page.getByRole("heading", { name: "Student submissions" }).waitFor();
  await reviewer.page.getByText("Synthetic Student ID.pdf").waitFor();
  if (JSON.stringify(state.submission).includes("encrypted_path")) throw new Error("Synthetic submission unexpectedly contains a storage path.");

  // Step 4: reviewer records needs-correction, then an approved outcome.
  await reviewer.page.getByLabel("Review note (optional)").fill("Synthetic QA: please upload a clearer test copy.");
  await reviewer.page.getByRole("button", { name: "Needs correction" }).click();
  await reviewer.page.getByText("needs correction", { exact: true }).waitFor();
  await reviewer.page.getByRole("button", { name: "Approve" }).click();
  await reviewer.page.getByText("approved", { exact: true }).waitFor();

  // Step 5: student reloads their own account and sees the final status and note.
  await student.page.reload({ waitUntil: "networkidle" });
  await student.page.getByRole("button", { name: "Continue securely" }).click().catch(() => {});
  await student.page.getByRole("button", { name: "College pilot" }).click();
  await student.page.getByText("approved", { exact: true }).waitFor();
  await student.page.getByText("Synthetic QA: please upload a clearer test copy.").waitFor();

  const errors = [...student.pageErrors, ...reviewer.pageErrors];
  if (errors.length) throw new Error("Browser JavaScript errors: " + errors.join("; "));
  console.log("PASS synthetic two-account College Workspace browser test: student consent/submission, reviewer metadata-only queue, needs-correction and approval, and student status/note visibility. Synthetic data only; not a live-account acceptance test.");
} finally {
  await browser.close();
}
