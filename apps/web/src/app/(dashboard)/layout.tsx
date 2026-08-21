import { AuthGuard } from "@/components/auth";
import { DashboardShell } from "@/components/shell/app-shell";
import { CommandPalette } from "@/components/shell/command-palette";

export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <DashboardShell>{children}</DashboardShell>
      <CommandPalette />
    </AuthGuard>
  );
}
