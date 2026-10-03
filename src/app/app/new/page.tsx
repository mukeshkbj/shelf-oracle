import type { Metadata } from "next";
import { NewEventWizard } from "@/components/organizer/NewEventWizard";

export const metadata: Metadata = { title: "New event" };

export default function NewEventPage() { return <NewEventWizard />; }
