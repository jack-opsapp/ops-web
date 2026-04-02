import { notFound } from "next/navigation";
import { AdminPageHeader } from "../../../_components/admin-page-header";
import { getShopOrderById } from "@/lib/admin/shop-queries";
import { OrderDetail } from "../_components/order-detail";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OrderDetailPage({ params }: PageProps) {
  const { id } = await params;
  const order = await getShopOrderById(id);
  if (!order) notFound();

  return (
    <div>
      <AdminPageHeader title={order.orderNumber} caption={order.status} />
      <div className="p-8">
        <OrderDetail order={order} />
      </div>
    </div>
  );
}
