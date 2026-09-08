import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { CreateWizard } from "@/components/CreateWizard";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage() {
  if (!(await getCurrentUser())) redirect("/login");
  return <CreateWizard />;
}
