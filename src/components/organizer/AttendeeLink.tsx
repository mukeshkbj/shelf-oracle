"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";

export function AttendeeLink({ votingUrl }: { votingUrl: string }) {
  const hostname = new URL(votingUrl).hostname.replace(/\.$/, "");
  const localOnly = hostname === "localhost" || hostname.endsWith(".localhost") || /^127\./.test(hostname) || hostname === "[::1]" || hostname === "0.0.0.0";
  const [image, setImage] = useState("");
  const [copied, setCopied] = useState(false);
  const [qrError, setQrError] = useState(false);
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(votingUrl, { width: 300, margin: 2, errorCorrectionLevel: "M", color: { dark: "#172727", light: "#ffffff" } }).then(data => { if (active) setImage(data); }).catch(() => { if (active) setQrError(true); });
    return () => { active = false; };
  }, [votingUrl]);
  async function copy() {
    try { await navigator.clipboard.writeText(votingUrl); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    catch { setCopied(false); }
  }
  return <div className="so-qr-wrap">{image ? <Image src={image} width={182} height={182} alt={`QR code to join this event at ${votingUrl}`} unoptimized /> : <div className="so-product-placeholder" style={{ width: 182, height: 182 }} aria-label={qrError ? "QR code unavailable; use the voting link instead" : "Generating QR code"}>{qrError ? "QR unavailable" : <span className="so-spinner" />}</div>}<div><h3>Attendee voting QR</h3><p className="so-hint">{localOnly ? "Voting is anonymous. No organizer sign-in required." : "Scan to vote anonymously in this event. No organizer sign-in required. Project this QR, print it, or share the voting link."}</p>{localOnly && <p className="so-alert" role="alert">Local-only voting link. This address uses a loopback host, so attendees cannot reach this event from their phones. Set APP_URL to the public deployment URL before sharing.</p>}<div className="so-link-box">{votingUrl}</div><div className="so-inline-actions"><button type="button" className="so-button so-button-outline" style={{ minHeight: 44 }} onClick={copy}>{copied ? "Copied ✓" : "Copy voting link ↗"}</button><Link href={votingUrl} target="_blank" rel="noopener noreferrer" className="so-button so-button-outline" style={{ minHeight: 44 }}>Open voting page ↗</Link></div></div></div>;
}
