import type { Metadata } from "next";
import { AuthForm } from "@/components/organizer/AuthForm";
import { OrganizerLoginQR } from "@/components/organizer/OrganizerLoginQR";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const viaQr = query.via === "qr";
  const initialError = query.error === "confirmation"
    ? "That email link could not be verified. Request a new link and open it in the same browser on this device, or use your password."
    : query.error === "workspace" ? "Unable to load your workspace. Please try signing in again." : "";
  return <AuthForm mode="login" viaQr={viaQr} initialError={initialError} organizerQR={viaQr ? undefined : <OrganizerLoginQR />} />;
}
