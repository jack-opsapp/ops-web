import { AdminPageHeader } from "../_components/admin-page-header";
import { FeatureReleasesContent } from "./_components/feature-releases-content";

export default function FeatureReleasesPage() {
  return (
    <div>
      <AdminPageHeader title="Feature Releases" caption="master switches & user overrides" />
      <div className="p-8">
        <FeatureReleasesContent />
      </div>
    </div>
  );
}
