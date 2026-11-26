function parseOcrCandidates(text) {
  const source = String(text || "").replace(/\u0000/g, "");
  const candidates = {};
  const add = (key, value) => {
    const cleaned = String(value || "").replace(/\s+/g, " ").trim().replace(/[|;]+$/, "");
    if (cleaned && cleaned.length <= 500 && !candidates[key]) candidates[key] = cleaned;
  };

  const email = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) add("contact.email", email[0]);

  const pan = source.match(/\b[A-Z]{5}\d{4}[A-Z]\b/i);
  if (pan) add("identity.pan", pan[0].toUpperCase());

  const aadhaar = source.match(/(?:aadhaar|aadhar|uid(?:ai)?)\D{0,24}(\d{4}[ -]?\d{4}[ -]?\d{4})/i);
  if (aadhaar) add("identity.aadhaar", aadhaar[1].replace(/\D/g, ""));

  const phone = source.replace(aadhaar?.[1] || "", "").match(/\b(?:\+91[ -]?)?([6-9]\d{9})\b/);
  if (phone) add("contact.phone", phone[1]);

  const birth = source.match(/(?:dob|date of birth|birth date|जन्म तिथि)\s*[:\-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/i);
  if (birth) {
    const raw = birth[1];
    const normalized = raw.includes("-") && /^\d{4}-/.test(raw)
      ? raw
      : raw.split(/[/-]/).map(part => part.padStart(2, "0")).reverse().join("-");
    const date = new Date(normalized + "T00:00:00.000Z");
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === normalized) {
      add("personal.date_of_birth", normalized);
    }
  }

  const fullName = source.match(/(?:full name|applicant name|name|नाम)\s*[:\-]\s*([^\r\n]+)/i);
  if (fullName && fullName[1].trim().length <= 70) add("personal.full_name", fullName[1]);

  const studentId = source.match(/(?:student id|roll number|enrollment (?:no|number)|registration (?:no|number))\s*[:\-]\s*([A-Z0-9/-]{3,30})/i);
  if (studentId) add("education.roll_number", studentId[1]);

  const address = source.match(/(?:address|पता)\s*[:\-]\s*([^\r\n]{4,120})/i);
  if (address) add("address.full", address[1]);

  return candidates;
}

export { parseOcrCandidates };
