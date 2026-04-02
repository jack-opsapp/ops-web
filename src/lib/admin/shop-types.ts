/**
 * OPS Admin — Shop Type Definitions
 *
 * Matches the shop_* Supabase tables. All IDs are UUIDs (strings).
 */

export interface ShopCategory {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  createdAt: string;
}

export interface ShopProduct {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string | null;
  priceCents: number;
  images: string[];
  isFeatured: boolean;
  isActive: boolean;
  archivedAt: string | null;
  taxCode: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Product with joined data for the products list table */
export interface ShopProductListItem extends ShopProduct {
  categoryName: string;
  variantCount: number;
  totalStock: number;
  totalReserved: number;
}

export interface ShopProductOption {
  id: string;
  productId: string;
  name: string;
  sortOrder: number;
  values: ShopProductOptionValue[];
}

export interface ShopProductOptionValue {
  id: string;
  optionId: string;
  value: string;
  sortOrder: number;
}

export interface ShopVariant {
  id: string;
  productId: string;
  sku: string;
  priceCents: number;
  stockQuantity: number;
  reservedQuantity: number;
  isActive: boolean;
  sortOrder: number;
  optionValues: Record<string, string>; // e.g., { "Size": "M", "Color": "Black" }
}

export interface ShopShippingMethod {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  minOrderCents: number | null;
  isActive: boolean;
  sortOrder: number;
}

export interface ShopOrder {
  id: string;
  orderNumber: string;
  email: string;
  shippingAddress: {
    firstName: string;
    lastName: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  shippingMethodId: string | null;
  shippingMethodName?: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  stripePaymentIntentId: string;
  stripeTaxCalculationId: string | null;
  status: "pending" | "paid" | "shipped" | "delivered" | "cancelled" | "refunded";
  paidAt: string | null;
  shippedAt: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShopOrderItem {
  id: string;
  orderId: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  variantLabel: string;
  sku: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  optionValues: Record<string, string> | null;
}

export interface ShopOrderWithItems extends ShopOrder {
  items: ShopOrderItem[];
}

/** Payload for creating/updating a product */
export interface ShopProductPayload {
  name: string;
  slug: string;
  description?: string;
  categoryId: string;
  priceCents: number;
  images: string[];
  isFeatured: boolean;
  isActive: boolean;
  taxCode: string;
  options: {
    id?: string; // existing option ID, omit for new
    name: string;
    values: { id?: string; value: string }[];
  }[];
  variants: {
    id?: string; // existing variant ID, omit for new
    sku: string;
    priceCents: number;
    stockQuantity: number;
    isActive: boolean;
    optionValues: Record<string, string>;
  }[];
}
