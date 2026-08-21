import { AuthGuard } from "@/components/auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { CommandPalette } from "@/components/command-palette";

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
