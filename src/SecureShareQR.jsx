import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import "./secure-share-qr.css";

export default function SecureShareQR({ token, expiresAt }) {
  const canvasRef = useRef(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const link = token ? new URL("/share/" + token, window.location.origin).toString() : "";

  useEffect(() => {
    let active = true;
    if (!canvasRef.current || !link) return;
    QRCode.toCanvas(canvasRef.current, link, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 220,
      color: { dark: "#101828", light: "#ffffff" }
    }).catch(() => active && setMessage("QR code could not be generated."));
    return () => { active = false; };
  }, [link]);

  const download = () => {
    if (!canvasRef.current || !token) return;
    const anchor = document.createElement("a");
    anchor.download = "secureid-share-qr.png";
    anchor.href = canvasRef.current.toDataURL("image/png");
    anchor.click();
  };

  const share = async () => {
    if (!link || busy) return;
    setBusy(true);
    try {
      if (navigator.share) {
        await navigator.share({ title: "SecureID secure share", text: "Scan this QR code to view the secure identity share.", url: link });
        setMessage("Secure share opened in your device share menu.");
      } else {
        await navigator.clipboard?.writeText(link);
        setMessage("Share link copied.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") setMessage("Could not open the share menu.");
    } finally {
      setBusy(false);
    }
  };

  if (!token) return null;

  return <div className="secureQrCard">
    <div className="secureQrHeader">
      <div><div className="eyebrow dark">QR SECURE SHARE</div><h3>Scan to open this share</h3><p>Anyone with this QR code can access the same time-limited secure share.</p></div>
      <span className="qrBadge">QR</span>
    </div>
    <div className="secureQrBody">
      <div className="qrCanvasWrap"><canvas ref={canvasRef} aria-label="QR code for SecureID secure share" /></div>
      <div className="secureQrActions">
        <strong>SecureID share QR</strong>
        <small>Expires {expiresAt ? new Date(expiresAt).toLocaleString() : "soon"}.</small>
        <button className="primary" type="button" onClick={share} disabled={busy}>{busy ? "Opening…" : "Share QR / link"}</button>
        <button className="textButton" type="button" onClick={download}>Save QR image</button>
        {message && <span className="qrMessage">{message}</span>}
      </div>
    </div>
  </div>;
}
