import { AdminPageHeader } from "../../_components/admin-page-header";
import { getShopShippingMethods } from "@/lib/admin/shop-queries";
import { safe } from "@/lib/utils/safe";
import { ShippingTable } from "./_components/shipping-table";

export default async function ShopShippingPage() {
  const methods = await safe(getShopShippingMethods(), []);

  return (
    <div>
      <AdminPageHeader
        title="Shop: Shipping"
        caption={`${methods.length} method${methods.length !== 1 ? "s" : ""}`}
      />
      <div className="p-8">
        <ShippingTable methods={methods} />
      </div>
    </div>
  );
}
