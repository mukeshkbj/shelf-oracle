import Image from "next/image";
import QRCode from "qrcode";
import { siteUrl } from "@/lib/site-url";

export async function OrganizerLoginQR() {
  let url: string;
  try {
    url = siteUrl("/login?via=qr");
  } catch {
    return <div className="so-auth-switch"><p className="so-hint">Organizer QR is unavailable. You can still sign in using the form above.</p></div>;
  }

  let image: string | undefined;
  try {
    image = await QRCode.toDataURL(url, { width: 300, margin: 2, errorCorrectionLevel: "M", color: { dark: "#172727", light: "#ffffff" } });
  } catch {
    image = undefined;
  }

  return <section className="so-auth-switch" aria-labelledby="organizer-qr-heading">
    <h2 id="organizer-qr-heading" style={{ fontSize: 18, color: "var(--so-ink)", margin: "0 0 8px" }}>Organizer QR: sign in on your phone</h2>
    <p className="so-hint">Scan to open sign-in on your phone, then verify your email or enter your password. This QR does not grant access or sign in this browser.</p>
    <div className="so-qr-wrap" style={{ justifyContent: "center" }}>
      {image ? <Image src={image} width={182} height={182} alt="Organizer QR code to open sign-in on your phone" unoptimized /> : <p className="so-hint">QR unavailable. Open the sign-in link instead.</p>}
    </div>
    <a href={url} className="so-link-box" style={{ display: "flex", alignItems: "center", minHeight: 44, marginTop: 16 }} aria-label={`Open organizer sign-in: ${url}`}>{url}</a>
  </section>;
}
