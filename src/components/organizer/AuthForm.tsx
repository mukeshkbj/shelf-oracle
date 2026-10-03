"use client";

import { FormEvent, ReactNode, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "./Brand";

export function AuthForm({ mode, viaQr = false, organizerQR, initialError = "" }: {
  mode: "login" | "signup";
  viaQr?: boolean;
  organizerQR?: ReactNode;
  initialError?: string;
}) {
  const router = useRouter();
  const emailInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState<"password" | "email" | null>(null);
  const [error, setError] = useState(initialError);
  const [linkRequested, setLinkRequested] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy("password");
    setError("");
    setLinkRequested(false);
    try {
      const res = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mode === "signup" ? { email: email.trim(), password, orgName: orgName.trim() || undefined } : { email: email.trim(), password }) });
      const data: { ok?: boolean; requiresConfirmation?: boolean; error?: string } = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      if (mode === "signup" && data.requiresConfirmation) {
        setConfirmationEmail(email.trim());
        setPassword("");
        return;
      }
      router.replace("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function requestSignInLink() {
    if (busy || !emailInput.current?.reportValidity()) return;
    setBusy("email");
    setError("");
    setLinkRequested(false);
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data: { ok?: boolean; error?: string } = await res.json();
      if (!res.ok || !data.ok) {
        setError(res.status === 429
          ? "Please wait at least a minute before requesting another link, or use your password."
          : "Unable to request a sign-in link. Try again later or use your password.");
        return;
      }
      setLinkRequested(true);
    } catch {
      setError("Unable to request a sign-in link. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return <main className="so-auth-page" style={viaQr ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}>
    {!viaQr && <aside className="so-auth-aside"><Brand inverse /><div><span className="so-eyebrow so-eyebrow-on-dark"><span className="so-dot" /> AN EXPERIMENT WORTH RUNNING</span><h2>Every product has a story.<br /><em>Find out which ones land.</em></h2><div className="so-auth-shelf" aria-hidden="true"><i /><i /><i /><i /><i /></div></div><div>PREDICTIVE RANGING, TESTED LIVE. / SHELF ORACLE</div></aside>}
    <div className="so-auth-main"><div className="so-auth-form">
      {viaQr && <div style={{ marginBottom: 28 }}><Brand /></div>}
      <span className="so-kicker">{confirmationEmail ? "CONFIRM YOUR EMAIL" : mode === "signup" ? "START A WORKSPACE" : viaQr ? "ORGANIZER SIGN-IN" : "WELCOME BACK"}</span>
      <h1>{confirmationEmail ? "Check your inbox." : mode === "signup" ? "Start something real." : viaQr ? "Sign in on this device." : "Good to see you."}</h1>
      <p>{confirmationEmail ? <>We sent a confirmation link to <strong>{confirmationEmail}</strong>. Open it to activate your account and set up your workspace.</> : mode === "signup" ? "Set up your workspace and make your first tasting event in minutes." : viaQr ? "Verify your email or use your password. Scanning the QR alone does not grant access or sign in another device." : "Log in to pick up where your last panel left off."}</p>
      {confirmationEmail ? <>
        <div className="so-alert so-alert-success" role="status">Your account is waiting for email confirmation. After confirming, you can log in to your workspace.</div>
        <div className="so-auth-switch"><Link href="/login" style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>Go to log in ↗</Link><span style={{ display: "block", marginTop: 14 }}>Wrong email? <button type="button" className="so-icon-button" style={{ minHeight: 44 }} onClick={() => setConfirmationEmail(null)}>Try another address</button></span></div>
      </> : <>
        <form onSubmit={submit} className="so-form-stack" aria-busy={!!busy}>
          {mode === "signup" && <label className="so-field">Workspace name <small>Your team or company name</small><input className="so-input" autoComplete="organization" maxLength={60} placeholder="e.g. The tasting team" value={orgName} onChange={e => setOrgName(e.target.value)} /></label>}
          <label className="so-field">Email address<input ref={emailInput} className="so-input" type="email" autoComplete="email" autoCapitalize="none" maxLength={254} required disabled={!!busy} placeholder="you@company.com" value={email} onChange={e => { setEmail(e.target.value); setLinkRequested(false); }} /></label>
          <label className="so-field">Password<input className="so-input" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 8 : undefined} required placeholder={mode === "signup" ? "At least 8 characters" : "Your password"} value={password} onChange={e => setPassword(e.target.value)} /></label>
          {error && <div className="so-alert" role="alert">{error}</div>}
          <button className="so-button so-button-dark so-button-large" type="submit" disabled={!!busy}>{busy === "password" ? <><span className="so-spinner" /> Please wait</> : <>{mode === "signup" ? "Create workspace" : "Log in"} <span aria-hidden="true">↗</span></>}</button>
          {mode === "login" && <>
            <button className="so-button so-button-outline so-button-large" type="button" disabled={!!busy} aria-describedby="sign-in-link-help" onClick={requestSignInLink}>{busy === "email" ? <><span className="so-spinner" /> Requesting link</> : "Email me a sign-in link"}</button>
            <p id="sign-in-link-help" className="so-hint" style={{ margin: 0 }}>For existing organizer accounts. Open the email link in the same browser on the same device that requested it. If your mail app opens a different browser, copy the link into this one.</p>
            {linkRequested && <div className="so-alert so-alert-success" role="status">If an existing account matches this address, check your inbox for a sign-in link. Check spam too; if no link arrives, wait a minute before trying again or use your password.</div>}
          </>}
        </form>
        <div className="so-auth-switch">{mode === "signup" ? <>Already have an account? <Link href="/login" style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>Log in</Link></> : <>New to Shelf Oracle? <Link href="/signup" style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>Create a workspace</Link></>}</div>
        {mode === "login" && !viaQr && organizerQR}
      </>}
    </div></div>
  </main>;
}
