import { redirect } from "next/navigation";

// Plugins are now "Stack" — each connected tool has its own nav item + page.
export default function PluginsRedirect() {
  redirect("/stack");
}
