const MSG91_SEND_URL = "https://control.msg91.com/api/v5/otp";
const MSG91_VERIFY_URL = "https://control.msg91.com/api/v5/otp/verify";

export function normalizeMsg91Phone(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 32) return null;
  let digits = raw.replace(/[\s()+.-]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 10) {
    if (!/^[6-9]\\d{9}$/.test(digits)) return null;
    digits = "91" + digits;
  }
  if (digits.length < 11 || digits.length > 15 || digits.startsWith("0")) return null;
  if (digits.startsWith("91") && digits.length === 12 && !/^[6-9]\\d{9}$/.test(digits.slice(2))) return null;
  return digits;
}

function configuration() {
  const authKey = String(process.env.MSG91_AUTH_KEY || "").trim();
  const templateId = String(process.env.MSG91_OTP_TEMPLATE_ID || "").trim();
  if (!authKey || !templateId) {
    const error = new Error("SMS verification is not configured yet. Add MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID to the deployment secrets.");
    error.statusCode = 503;
    error.code = "SMS_NOT_CONFIGURED";
    throw error;
  }
  return { authKey, templateId };
}

async function requestJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("MSG91 could not complete the SMS verification request.");
      error.statusCode = 503;
      error.code = "SMS_PROVIDER_FAILED";
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.statusCode) throw error;
    const failure = new Error("MSG91 could not be reached. Please try again shortly.");
    failure.statusCode = 503;
    failure.code = "SMS_PROVIDER_FAILED";
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMsg91Otp(phone) {
  const { authKey, templateId } = configuration();
  const url = new URL(MSG91_SEND_URL);
  url.searchParams.set("template_id", templateId);
  url.searchParams.set("mobile", phone);
  const data = await requestJson(url, {
    method: "POST",
    headers: { authkey: authKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({})
  });
  const message = String(data?.message || "").toLowerCase();
  if (String(data?.type || "").toLowerCase() !== "success" && !message.includes("success")) {
    const error = new Error("MSG91 did not accept the SMS OTP request. Check your template, DLT and account configuration.");
    error.statusCode = 503;
    error.code = "SMS_PROVIDER_REJECTED";
    throw error;
  }
  return true;
}

export async function verifyMsg91Otp(phone, otp) {
  const { authKey } = configuration();
  const url = new URL(MSG91_VERIFY_URL);
  url.searchParams.set("mobile", phone);
  url.searchParams.set("otp", otp);
  const data = await requestJson(url, {
    method: "GET",
    headers: { authkey: authKey, accept: "application/json" }
  });
  const message = String(data?.message || "").toLowerCase();
  return String(data?.type || "").toLowerCase() === "success" ||
    message.includes("otp verified success") ||
    message.includes("number_verified_successfully");
}
