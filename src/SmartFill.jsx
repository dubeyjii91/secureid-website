import { useEffect, useMemo, useState } from "react";
import api from "./api.js";
import "./smartfill.css";

const labels = {
  "personal.full_name": "Full name",
  "personal.date_of_birth": "Date of birth",
  "personal.age": "Age",
  "contact.email": "Email",
  "contact.phone": "Phone",
  "address.full": "Full address",
  "address.line1": "Address line 1",
  "address.line2": "Address line 2",
  "address.city": "City",
  "address.state": "State",
  "address.postal_code": "Postal code",
  "address.country": "Country",
  "identity.aadhaar": "Aadhaar number",
  "identity.pan": "PAN number",
  "identity.passport": "Passport number",
  "identity.student_id": "Student ID",
  "identity.identity_id": "SecureID",
  "identity.government_id": "Government ID",
  "education.institution": "Institution",
  "education.course": "Course",
  "education.department": "Department",
  "education.roll_number": "Roll number",
  "education.admission_year": "Admission year",
  "education.graduation_year": "Graduation year",
  "professional.job_title": "Job title",
  "professional.employer": "Employer",
  "professional.experience": "Experience",
};

const sensitiveControl = /otp|one.?time|password|passcode|(^|[^a-z])pin([^a-z]|$)|captcha|cvv|security.?code|verification.?code/i;
const pageFormIds = {
  college: "college-admissions",
  parent: "parent-portal",
  identity: "identity-workspace",
  documents: "document-vault",
  scholarship: "scholarship-forms",
};

function getPageRoot(page) {
  return Array.from(document.querySelectorAll("main[data-smartfill-page]"))
    .find((element) => element.getAttribute("data-smartfill-page") === page) || null;
}

export default function SmartFill({ page }) {
  const [open, setOpen] = useState(false);
  const [formContext, setFormContext] = useState("");
  const [manualKey, setManualKey] = useState("address.line1");
  const [customKey, setCustomKey] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [fields, setFields] = useState([
    "personal.full_name",
    "personal.date_of_birth",
    "contact.email",
    "contact.phone",
    "address.full",
    "education.institution",
  ]);
  const [sources, setSources] = useState(["identity", "manual"]);
  const [consent, setConsent] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [targets, setTargets] = useState({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const defaultFormId = pageFormIds[page] || ("custom-" + String(page || "workspace"));
  const formId = formContext.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "-").slice(0, 100) || defaultFormId;

  const controls = useMemo(() => {
    if (!open || typeof document === "undefined") return [];
    const root = getPageRoot(page);
    if (!root) return [];

    return Array.from(root.querySelectorAll(
      'form input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="password"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), form textarea, form select',
    )).filter((element) => {
      const context = [
        element.name,
        element.id,
        element.getAttribute("aria-label"),
        element.getAttribute("autocomplete"),
      ].join(" ");
      return !element.disabled &&
        !element.readOnly &&
        !element.closest(".smartfillDock") &&
        element.getAttribute("autocomplete") !== "one-time-code" &&
        !sensitiveControl.test(context);
    });
  }, [open, page]);

  useEffect(() => {
    const root = getPageRoot(page);
    if (!root) return undefined;

    const isBlocked = (form) =>
      Boolean(form && form.dataset.smartfillFormId && !form.dataset.smartfillReviewToken);

    const showReviewRequired = () => {
      setOpen(true);
      setReviewAcknowledged(false);
      setStatus("Review the applied SmartFill values before submitting this form.");
    };

    const guard = (event) => {
      if (!isBlocked(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showReviewRequired();
    };

    const invalidate = (event) => {
      const form = event.target?.closest?.("form[data-smartfill-form-id]");
      if (!form) return;
      if (form.dataset.smartfillReviewToken) {
        delete form.dataset.smartfillReviewToken;
        setReviewAcknowledged(false);
        setStatus("The form changed. Review the updated values again before submitting.");
      }
    };

    const patchedForms = [];
    root.querySelectorAll("form").forEach((form) => {
      const originalSubmitDescriptor = Object.getOwnPropertyDescriptor(form, "submit");
      const originalRequestSubmitDescriptor = Object.getOwnPropertyDescriptor(form, "requestSubmit");
      const originalSubmit = form.submit;
      const originalRequestSubmit = form.requestSubmit;

      form.submit = function submitWithSmartFillReview(...args) {
        if (isBlocked(form)) {
          showReviewRequired();
          return undefined;
        }
        return originalSubmit.apply(this, args);
      };

      if (typeof originalRequestSubmit === "function") {
        form.requestSubmit = function requestSubmitWithSmartFillReview(...args) {
          if (isBlocked(form)) {
            showReviewRequired();
            return undefined;
          }
          return originalRequestSubmit.apply(this, args);
        };
      }

      patchedForms.push(() => {
        if (originalSubmitDescriptor) Object.defineProperty(form, "submit", originalSubmitDescriptor);
        else delete form.submit;
        if (originalRequestSubmitDescriptor) {
          Object.defineProperty(form, "requestSubmit", originalRequestSubmitDescriptor);
        } else {
          delete form.requestSubmit;
        }
      });
    });

    root.addEventListener("submit", guard, true);
    root.addEventListener("input", invalidate, true);
    root.addEventListener("change", invalidate, true);

    return () => {
      root.removeEventListener("submit", guard, true);
      root.removeEventListener("input", invalidate, true);
      root.removeEventListener("change", invalidate, true);
      patchedForms.forEach((restore) => restore());
    };
  }, [page]);

  const toggle = (setValue, key) => {
    setValue((current) => current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key]);
  };

  async function saveManual() {
    if (!manualValue.trim()) {
      setStatus("Enter a value to save.");
      return;
    }
    try {
      await api("/api/smartfill/data", {
        method: "PUT",
        body: JSON.stringify({ fields: { [manualKey]: manualValue.trim() } }),
      });
      setManualValue("");
      setStatus("Encrypted manual detail saved to your private SmartFill vault.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function prepare() {
    if (!consent || !fields.length || !sources.length) {
      setStatus("Select fields and sources, then confirm consent.");
      return;
    }

    setBusy(true);
    setReviewAcknowledged(false);
    setSuggestions([]);
    const root = getPageRoot(page);
    root?.querySelectorAll("form[data-smartfill-form-id]").forEach((form) => {
      delete form.dataset.smartfillFormId;
      delete form.dataset.smartfillReviewToken;
    });

    try {
      await api("/api/smartfill/consent", {
        method: "POST",
        body: JSON.stringify({ formId, fields, sources, consent: true }),
      });
      const result = await api("/api/smartfill/suggestions?formId=" + encodeURIComponent(formId));
      const nextSuggestions = result.suggestions || [];
      setSuggestions(nextSuggestions);

      const automatic = {};
      nextSuggestions.forEach((item) => {
        const index = controls.findIndex((element) =>
          [element.getAttribute("data-smartfill-field"), element.name, element.id].includes(item.fieldKey),
        );
        if (index >= 0) automatic[item.fieldKey] = String(index);
      });
      setTargets(automatic);
      setStatus(nextSuggestions.length
        ? "Map the suggestions you need, apply them, and review the completed form."
        : "No saved values were found for the selected fields.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  function apply(item) {
    const target = controls[targets[item.fieldKey]];
    if (!target || !target.closest("form")) {
      setStatus("Choose a target field inside the form first.");
      return;
    }

    let nextValue = item.value;
    if (target instanceof HTMLSelectElement) {
      const match = Array.from(target.options).find((option) =>
        option.value === item.value ||
        option.textContent.trim().toLowerCase() === String(item.value).trim().toLowerCase(),
      );
      if (!match) {
        setStatus("That value is not an available option in the selected form field.");
        return;
      }
      nextValue = match.value;
    }

    const form = target.closest("form");
    form.dataset.smartfillFormId = formId;
    delete form.dataset.smartfillReviewToken;

    const prototype = target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : target instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) {
      setStatus("This form field cannot be filled safely.");
      return;
    }

    setter.call(target, nextValue);
    setReviewAcknowledged(false);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    setStatus("Value applied. Review the completed form before submitting.");
  }

  async function reviewed() {
    try {
      const result = await api("/api/smartfill/review", {
        method: "POST",
        body: JSON.stringify({
          formId,
          fieldKeys: suggestions.map((item) => item.fieldKey),
          action: "reviewed",
        }),
      });

      if (!result.reviewToken) {
        throw new Error("The review token was not issued. Prepare the suggestions again.");
      }

      const root = getPageRoot(page);
      root?.querySelectorAll("form[data-smartfill-form-id]").forEach((form) => {
        if (form.dataset.smartfillFormId === formId) {
          form.dataset.smartfillReviewToken = result.reviewToken;
        }
      });
      setReviewAcknowledged(true);
      setStatus("Review recorded. The mapped form can now be submitted; SmartFill never submits it for you.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function revokeConsent() {
    try {
      await api("/api/smartfill/consent/" + encodeURIComponent(formId), { method: "DELETE" });
      getPageRoot(page)?.querySelectorAll("form[data-smartfill-form-id]").forEach((form) => {
        if (form.dataset.smartfillFormId === formId) {
          delete form.dataset.smartfillReviewToken;
          delete form.dataset.smartfillFormId;
        }
      });
      setSuggestions([]);
      setReviewAcknowledged(false);
      setStatus("This form's SmartFill consent has been revoked.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <section className="smartfillDock">
      <button className="smartfillLauncher" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        ✦ SmartFill <span>Universal form assistant</span>
      </button>

      {open && (
        <div className="smartfillPanel">
          <header className="smartfillHead">
            <div>
              <span>SECUREID UNIVERSAL</span>
              <h2>Fill with your approved data</h2>
              <p>Choose exactly what this form may use. Nothing is submitted automatically.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close SmartFill">×</button>
          </header>

          <label className="smartfillContext">
            Form context / consent ID
            <input
              value={formContext}
              onChange={(event) => setFormContext(event.target.value)}
              maxLength={100}
              placeholder={defaultFormId}
            />
            <small>Use a different ID when working with a separate form or workflow.</small>
          </label>

          <div className="smartfillSources">
            <b>Allowed sources</b>
            {[["identity", "My Identity"], ["manual", "Your saved manual details"]].map(([key, label]) => (
              <label key={key}>
                <input type="checkbox" checked={sources.includes(key)} onChange={() => toggle(setSources, key)} />
                {label}
              </label>
            ))}
          </div>

          <div className="smartfillManual">
            <b>Save a manual detail</b>
            <div>
              <input value={manualKey} onChange={(event) => setManualKey(event.target.value)} placeholder="Stable field key" aria-label="Manual field key" />
              <input value={manualValue} onChange={(event) => setManualValue(event.target.value)} maxLength={500} placeholder="Enter your detail" aria-label="Manual field value" />
              <button type="button" onClick={saveManual}>Save securely</button>
            </div>
          </div>

          <div className="smartfillCustom">
            <b>Custom field key</b>
            <div>
              <input value={customKey} onChange={(event) => setCustomKey(event.target.value)} placeholder="custom.guardian_name" aria-label="Custom field key" />
              <button type="button" onClick={() => {
                const key = customKey.trim();
                if (/^custom\.[a-z0-9_.-]{1,70}$/i.test(key)) {
                  setFields((current) => current.includes(key) ? current : [...current, key]);
                  setManualKey(key);
                  setCustomKey("");
                } else {
                  setStatus("Use a key such as custom.guardian_name.");
                }
              }}>Add custom field</button>
            </div>
          </div>

          <div className="smartfillFields">
            <b>Fields to use</b>
            <div>
              {[...Object.entries(labels), ...fields.filter((key) => !labels[key]).map((key) => [key, key])]
                .map(([key, label]) => (
                  <label key={key}>
                    <input type="checkbox" checked={fields.includes(key)} onChange={() => toggle(setFields, key)} />
                    {label}
                  </label>
                ))}
            </div>
          </div>

          <label className="smartfillConsent">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            I explicitly allow use of only these selected fields and sources for this form. I will review values before submission.
          </label>

          <button type="button" className="smartfillPrimary" disabled={busy} onClick={prepare}>
            {busy ? "Preparing…" : "Get suggestions"}
          </button>

          {suggestions.length > 0 && (
            <div className="smartfillResults">
              <b>Review suggestions</b>
              {suggestions.map((item) => (
                <article key={item.fieldKey}>
                  <div>
                    <strong>{labels[item.fieldKey] || item.fieldKey}</strong>
                    <span>{item.source.replaceAll("_", " ")} · {item.status} · {Math.round(item.confidence * 100)}% confidence</span>
                    <p>{["identity.aadhaar", "identity.government_id"].includes(item.fieldKey)
                      ? item.value.replace(/.(?=.{4})/g, "•")
                      : item.value}</p>
                    <small>{item.note}</small>
                  </div>
                  <select
                    aria-label={"Map " + item.fieldKey + " to form field"}
                    value={targets[item.fieldKey] ?? ""}
                    onChange={(event) => setTargets((current) => ({ ...current, [item.fieldKey]: event.target.value }))}
                  >
                    <option value="">Choose target field…</option>
                    {controls.map((element, index) => {
                      const formHeading = element.closest("form")?.querySelector("h1,h2,h3,legend")?.textContent?.trim()
                        || element.closest("form")?.getAttribute("aria-label")
                        || "Form";
                      const label = element.labels?.[0]?.textContent?.trim()
                        || element.closest("label")?.textContent?.trim()
                        || element.placeholder
                        || element.name
                        || element.id
                        || ("Field " + (index + 1));
                      return (
                        <option
                          key={index}
                          value={index}
                          disabled={Object.entries(targets).some(([key, value]) => key !== item.fieldKey && value === String(index))}
                        >
                          {formHeading + " — " + label}
                        </option>
                      );
                    })}
                  </select>
                  <button type="button" disabled={item.status === "ambiguous" || !item.eligible} onClick={() => apply(item)}>
                    Apply
                  </button>
                </article>
              ))}
              <button type="button" className="smartfillReview" onClick={reviewed}>
                {reviewAcknowledged ? "Review acknowledged — refresh acknowledgement" : "I've reviewed these suggestions"}
              </button>
              <button type="button" className="smartfillRevoke" onClick={revokeConsent}>Revoke this form's consent</button>
            </div>
          )}

          {status && <p className="smartfillStatus" role="status">{status}</p>}
          <small className="smartfillFoot">
            Document OCR suggestions are not enabled until SecureID has a user-scoped extraction and review service.
          </small>
        </div>
      )}
    </section>
  );
}
