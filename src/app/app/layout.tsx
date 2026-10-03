import { redirect } from "next/navigation";
import { getUser, userOrgs } from "@/lib/auth";
import { WorkspaceShell } from "@/components/organizer/WorkspaceShell";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const user = await getUser();
  if (!user) redirect("/login");
  const orgs = await userOrgs(user.id);
  return <WorkspaceShell email={user.email} orgs={orgs}>{children}</WorkspaceShell>;
}
