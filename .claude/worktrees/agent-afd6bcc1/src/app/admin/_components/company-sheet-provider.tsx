"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { CompanySheet } from "./company-sheet";

interface CompanySheetContextValue {
  openCompany: (id: string) => void;
}

const CompanySheetContext = createContext<CompanySheetContextValue>({
  openCompany: () => {},
});

export function useCompanySheet() {
  return useContext(CompanySheetContext);
}

export function CompanySheetProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const openCompany = useCallback((id: string) => {
    setOpenId(id);
  }, []);

  const handleClose = useCallback(() => {
    setOpenId(null);
  }, []);

  return (
    <CompanySheetContext.Provider value={{ openCompany }}>
      {children}
      <CompanySheet companyId={openId} onClose={handleClose} />
    </CompanySheetContext.Provider>
  );
}
