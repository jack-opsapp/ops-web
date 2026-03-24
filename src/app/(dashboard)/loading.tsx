import { OpsLoadingScreen } from "@/components/ops/ops-loading-screen";

export default function DashboardLoading() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-4rem)]">
      <OpsLoadingScreen />
    </div>
  );
}
