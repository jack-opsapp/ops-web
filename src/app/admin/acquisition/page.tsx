import {
  defaultGrowthFilters,
  getCachedGrowthHealth,
  getCachedGrowthOverview,
  getCachedGrowthSearchReport,
} from "@/lib/admin/growth-analytics-queries";
import { GrowthOverview } from "./_components/growth-overview";

export default async function AcquisitionPage() {
  const filters = defaultGrowthFilters();
  const [overview, search, health] = await Promise.all([
    getCachedGrowthOverview(filters),
    getCachedGrowthSearchReport(filters),
    getCachedGrowthHealth(filters),
  ]);

  return (
    <GrowthOverview
      initialFilters={filters}
      initialHealth={health}
      initialOverview={overview}
      initialSearch={search}
    />
  );
}
