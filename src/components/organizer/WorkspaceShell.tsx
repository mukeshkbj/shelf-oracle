"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Brand } from "./Brand";

type Workspace = { org_id: string; role: "owner" | "member"; org: { id: string; name: string } };
const WorkspaceContext = createContext<{ orgId: string; orgs: Workspace[] }>({ orgId: "", orgs: [] });
export function useWorkspace() { return useContext(WorkspaceContext); }

export function WorkspaceShell({ children, email, orgs }: { children: React.ReactNode; email: string; orgs: Workspace[] }) {
  const [orgId, setOrgId] = useState(orgs[0]?.org_id ?? "");
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  async function logout() {
    setSigningOut(true);
    setError("");
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error("Could not log out. Please try again.");
      router.replace("/login");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log out.");
      setSigningOut(false);
    }
  }
  return <WorkspaceContext.Provider value={{ orgId, orgs }}><div className="so-app">
    <aside className="so-sidebar" aria-label="Organizer navigation">
      <Brand />
      <div className="so-sidebar-label">WORKSPACE</div>
      <label className="so-sidebar-workspace"><span>Current workspace</span><select aria-label="Current workspace" value={orgId} onChange={e => setOrgId(e.target.value)}>{orgs.map(o => <option key={o.org_id} value={o.org_id}>{o.org.name}</option>)}</select></label>
      <nav className="so-sidebar-nav" aria-label="Workspace"><Link href="/app" aria-current={pathname === "/app" ? "page" : undefined}><span aria-hidden="true">▦</span> All events</Link><Link href="/app/new" aria-current={pathname === "/app/new" ? "page" : undefined}><span aria-hidden="true">＋</span> New event</Link></nav>
      <div className="so-sidebar-bottom"><p title={email}>{email}</p><button type="button" onClick={logout} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out ↗"}</button>{error && <div className="so-alert" role="alert">{error}</div>}</div>
    </aside>
    <div className="so-app-main"><header className="so-app-topbar"><span>ORGANIZER WORKSPACE / {orgs.find(o => o.org_id === orgId)?.org.name.toUpperCase() || "SHELF ORACLE"}</span><Link href="/">shelforacle. ↗</Link></header>{children}</div>
  </div></WorkspaceContext.Provider>;
}
