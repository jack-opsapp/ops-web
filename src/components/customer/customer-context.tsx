"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CustomerCopy } from "@/lib/customer-identity/hosted-format";

export interface CustomerHostedValue {
  /** The company's public handle — the only company identifier the browser holds. */
  handle: string;
  companyName: string;
  copy: CustomerCopy;
}

const CustomerHostedContext = createContext<CustomerHostedValue | null>(null);

export function CustomerHostedProvider({
  value,
  children,
}: {
  value: CustomerHostedValue;
  children: ReactNode;
}) {
  return (
    <CustomerHostedContext.Provider value={value}>
      {children}
    </CustomerHostedContext.Provider>
  );
}

export function useCustomerHosted(): CustomerHostedValue {
  const value = useContext(CustomerHostedContext);
  if (!value) {
    throw new Error("useCustomerHosted must be used inside CustomerHostedProvider");
  }
  return value;
}
