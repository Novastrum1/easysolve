import { notFound, redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin-dashboard";
import { HttpError, requireAdmin } from "@/lib/security";

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  try {
    const account = await requireAdmin();
    return <AdminDashboard ownerName={account.name} />;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/");
    if (error instanceof HttpError && error.status === 403) notFound();
    throw error;
  }
}
