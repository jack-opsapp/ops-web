"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Truck, CheckCircle, XCircle, RotateCcw, ExternalLink } from "lucide-react";
import { OrderStatusBadge } from "./order-status-badge";
import type { ShopOrderWithItems } from "@/lib/admin/shop-types";

interface OrderDetailProps {
  order: ShopOrderWithItems;
}

export function OrderDetail({ order }: OrderDetailProps) {
  const router = useRouter();
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? "");
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl ?? "");
  const [notes, setNotes] = useState(order.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [showShipForm, setShowShipForm] = useState(false);

  async function action(endpoint: string, body?: Record<string, unknown>) {
    setSaving(true);
    const res = await fetch(`/api/admin/shop/orders/${order.id}/${endpoint}`, {
      method: endpoint === "notes" ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Request failed" }));
      alert(data.error || "Action failed");
      return;
    }
    router.refresh();
  }

  async function handleShip() {
    if (!trackingNumber) return;
    await action("ship", { trackingNumber, trackingUrl });
    setShowShipForm(false);
  }

  async function handleRefund() {
    if (!confirm(`Refund $${(order.totalCents / 100).toFixed(2)} to ${order.email}? This will call Stripe to reverse the charge.`)) return;
    await action("refund");
  }

  async function handleCancel() {
    if (!confirm(`Cancel order ${order.orderNumber}? This will release reserved inventory.${order.status === "paid" ? " A refund will also be issued." : ""}`)) return;
    await action("cancel");
  }

  // Build timeline from timestamps
  const timeline: { time: string; label: string }[] = [];
  timeline.push({ time: order.createdAt, label: "Order placed" });
  if (order.paidAt) timeline.push({ time: order.paidAt, label: "Payment confirmed" });
  if (order.shippedAt) timeline.push({ time: order.shippedAt, label: `Shipped — ${order.trackingNumber ?? ""}` });
  if (order.status === "delivered") timeline.push({ time: order.updatedAt, label: "Delivered" });
  if (order.status === "cancelled") timeline.push({ time: order.updatedAt, label: "Cancelled" });
  if (order.status === "refunded") timeline.push({ time: order.updatedAt, label: "Refund issued" });

  const addr = order.shippingAddress;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/admin/shop/orders"
          className="flex items-center gap-2 font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
        >
          <ArrowLeft size={14} /> Back to Orders
        </Link>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-8 mb-8">
        {/* Left — Items + Totals */}
        <div>
          <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
            Items
          </p>
          <div className="space-y-3 mb-6">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 border border-white/[0.06] rounded-sm p-3">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="w-12 h-12 rounded-sm object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-sm bg-white/[0.04]" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-mohave text-[13px] text-[#E5E5E5]">{item.productName}</p>
                  <p className="font-mohave text-[11px] text-[#6B6B6B]">{item.variantLabel} · {item.sku}</p>
                </div>
                <p className="font-mohave text-[12px] text-[#6B6B6B]">x{item.quantity}</p>
                <p className="font-mohave text-[13px] text-[#E5E5E5]">
                  ${((item.unitPriceCents * item.quantity) / 100).toFixed(2)}
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-1 border-t border-white/[0.08] pt-4">
            <div className="flex justify-between font-mohave text-[13px]">
              <span className="text-[#6B6B6B]">Subtotal</span>
              <span className="text-[#E5E5E5]">${(order.subtotalCents / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-mohave text-[13px]">
              <span className="text-[#6B6B6B]">Shipping{order.shippingMethodName ? ` (${order.shippingMethodName})` : ""}</span>
              <span className="text-[#E5E5E5]">${(order.shippingCents / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-mohave text-[13px]">
              <span className="text-[#6B6B6B]">Tax</span>
              <span className="text-[#E5E5E5]">${(order.taxCents / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-mohave text-[15px] font-semibold border-t border-white/[0.08] pt-2 mt-2">
              <span className="text-[#E5E5E5]">Total</span>
              <span className="text-[#E5E5E5]">${(order.totalCents / 100).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Right — Customer + Payment */}
        <div className="space-y-6">
          <div>
            <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
              Customer
            </p>
            <p className="font-mohave text-[13px] text-[#E5E5E5]">{order.email}</p>
          </div>

          <div>
            <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
              Shipping Address
            </p>
            <div className="font-mohave text-[13px] text-[#E5E5E5] space-y-0.5">
              <p>{addr.firstName} {addr.lastName}</p>
              <p>{addr.line1}</p>
              {addr.line2 && <p>{addr.line2}</p>}
              <p>{addr.city}, {addr.state} {addr.zip}</p>
              <p>{addr.country}</p>
            </div>
          </div>

          <div>
            <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
              Payment
            </p>
            <a
              href={`https://dashboard.stripe.com/payments/${order.stripePaymentIntentId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 font-mohave text-[13px] text-[#597794] hover:underline"
            >
              View in Stripe <ExternalLink size={12} />
            </a>
            {order.paidAt && (
              <p className="font-mohave text-[12px] text-[#6B6B6B] mt-1">
                Paid {new Date(order.paidAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="border-t border-white/[0.08] pt-6 mb-6">
        <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
          Actions
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {order.status === "paid" && (
            <button
              onClick={() => setShowShipForm(true)}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#597794] rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-white hover:bg-[#597794]/80 transition-colors disabled:opacity-50"
            >
              <Truck size={12} /> Mark Shipped
            </button>
          )}
          {order.status === "shipped" && (
            <button
              onClick={() => action("deliver")}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-white hover:bg-emerald-600/80 transition-colors disabled:opacity-50"
            >
              <CheckCircle size={12} /> Mark Delivered
            </button>
          )}
          {["paid", "shipped"].includes(order.status) && (
            <button
              onClick={handleRefund}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-red-500/20 rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <RotateCcw size={12} /> Refund
            </button>
          )}
          {["pending", "paid"].includes(order.status) && (
            <button
              onClick={handleCancel}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.12] rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-red-400 hover:border-red-500/20 transition-colors disabled:opacity-50"
            >
              <XCircle size={12} /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* Ship form */}
      {showShipForm && (
        <div className="border border-[#597794]/30 rounded-sm p-4 mb-6 bg-[#597794]/5">
          <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
            Shipping Details
          </p>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className="block font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B] mb-1">
                Tracking Number *
              </label>
              <input
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B] mb-1">
                Tracking URL
              </label>
              <input
                type="url"
                value={trackingUrl}
                onChange={(e) => setTrackingUrl(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleShip}
              disabled={!trackingNumber || saving}
              className="px-4 py-1.5 bg-[#597794] rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-white hover:bg-[#597794]/80 transition-colors disabled:opacity-50"
            >
              Confirm Ship
            </button>
            <button
              onClick={() => setShowShipForm(false)}
              className="px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="border-t border-white/[0.08] pt-6 mb-6">
        <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
          Internal Notes
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => action("notes", { notes })}
          rows={3}
          placeholder="Add internal notes..."
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:border-[#597794] focus:outline-none resize-none"
        />
      </div>

      {/* Timeline */}
      <div className="border-t border-white/[0.08] pt-6">
        <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
          Timeline
        </p>
        <div className="space-y-3">
          {timeline.map((t, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#597794] mt-1.5 flex-shrink-0" />
              <div>
                <p className="font-mohave text-[12px] text-[#6B6B6B]">
                  {new Date(t.time).toLocaleString()}
                </p>
                <p className="font-mohave text-[13px] text-[#E5E5E5]">{t.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
