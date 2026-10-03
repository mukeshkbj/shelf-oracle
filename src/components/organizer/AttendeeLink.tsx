"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";

export function AttendeeLink({ slug }: { slug: string }) {
  const path = `/e/${encodeURIComponent(slug)}/v`;
  const [image, setImage] = useState("");
  const [url, setUrl] = useState(path);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    const destination = new URL(path, window.location.origin).toString();
    QRCode.toDataURL(destination, { width: 300, margin: 2, errorCorrectionLevel: "M", color: { dark: "#172727", light: "#ffffff" } }).then(data => { if (active) { setImage(data); setUrl(destination); } });
    return () => { active = false; };
  }, [path]);
  async function copy() {
    try { await navigator.clipboard.writeText(new URL(path, window.location.origin).toString()); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    catch { setCopied(false); }
  }
  return <div className="so-qr-wrap">{image ? <Image src={image} width={182} height={182} alt={`QR code to join this event at ${url}`} unoptimized /> : <div className="so-product-placeholder" style={{ width: 182, height: 182 }} aria-label="Generating QR code"><span className="so-spinner" /></div>}<div><h3>Bring the room in.</h3><p className="so-hint">Project this QR, print it, or send the link. Every vote stays with this event.</p><div className="so-link-box">{url}</div><div className="so-inline-actions"><button type="button" className="so-button so-button-outline" onClick={copy}>{copied ? "Copied ✓" : "Copy voting link ↗"}</button><Link href={path} target="_blank" rel="noopener noreferrer" className="so-button so-button-outline">Open page ↗</Link></div></div></div>;
}
