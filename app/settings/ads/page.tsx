import { redirect } from "next/navigation";

export default function LegacyAdSettingsPage() {
  redirect("/settings/connections");
}
