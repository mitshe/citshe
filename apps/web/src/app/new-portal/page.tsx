import { AuthGuard } from "@/components/auth";
import { NewPortalPage } from "@/components/new-project/new-portal-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AuthGuard>
      <NewPortalPage />
    </AuthGuard>
  );
}
