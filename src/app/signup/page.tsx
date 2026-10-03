import type { Metadata } from "next";
import { AuthForm } from "@/components/organizer/AuthForm";

export const metadata: Metadata = { title: "Create a workspace" };

export default function SignupPage() { return <AuthForm mode="signup" />; }
