"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "./Brand";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
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
      setBusy(false);
    }
  }

  return <main className="so-auth-page">
    <aside className="so-auth-aside"><Brand inverse /><div><span className="so-eyebrow so-eyebrow-on-dark"><span className="so-dot" /> AN EXPERIMENT WORTH RUNNING</span><h2>Every product has a story.<br /><em>Find out which ones land.</em></h2><div className="so-auth-shelf" aria-hidden="true"><i /><i /><i /><i /><i /></div></div><div>PREDICTIVE RANGING, TESTED LIVE. / SHELF ORACLE</div></aside>
    <div className="so-auth-main"><div className="so-auth-form"><span className="so-kicker">{confirmationEmail ? "CONFIRM YOUR EMAIL" : mode === "signup" ? "START A WORKSPACE" : "WELCOME BACK"}</span><h1>{confirmationEmail ? "Check your inbox." : mode === "signup" ? "Start something real." : "Good to see you."}</h1><p>{confirmationEmail ? <>We sent a confirmation link to <strong>{confirmationEmail}</strong>. Open it to activate your account and set up your workspace.</> : mode === "signup" ? "Set up your workspace and make your first tasting event in minutes." : "Log in to pick up where your last panel left off."}</p>
      {confirmationEmail ? <><div className="so-alert so-alert-success" role="status">Your account is waiting for email confirmation. After confirming, you can log in to your workspace.</div><div className="so-auth-switch"><Link href="/login">Go to log in ↗</Link><span style={{ display: "block", marginTop: 14 }}>Wrong email? <button type="button" className="so-icon-button" onClick={() => setConfirmationEmail(null)}>Try another address</button></span></div></> : <><form onSubmit={submit} className="so-form-stack">
        {mode === "signup" && <label className="so-field">Workspace name <small>Your team or company name</small><input className="so-input" autoComplete="organization" maxLength={60} placeholder="e.g. The tasting team" value={orgName} onChange={e => setOrgName(e.target.value)} /></label>}
        <label className="so-field">Email address<input className="so-input" type="email" autoComplete="email" required placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="so-field">Password<input className="so-input" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 8 : undefined} required placeholder={mode === "signup" ? "At least 8 characters" : "Your password"} value={password} onChange={e => setPassword(e.target.value)} /></label>
        {error && <div className="so-alert" role="alert">{error}</div>}
        <button className="so-button so-button-dark so-button-large" type="submit" disabled={busy}>{busy ? <><span className="so-spinner" /> Please wait</> : <>{mode === "signup" ? "Create workspace" : "Log in"} <span aria-hidden="true">↗</span></>}</button>
      </form>
      <div className="so-auth-switch">{mode === "signup" ? <>Already have an account? <Link href="/login">Log in</Link></> : <>New to Shelf Oracle? <Link href="/signup">Create a workspace</Link></>}</div></>}
    </div></div>
  </main>;
}
