"use client";

import { useState, createContext, useContext, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PortalSession } from "@/lib/types/portal";
import { LanguageProvider } from "@/i18n/client";
import { defaultLocale, supportedLocales, COOKIE_NAME } from "@/i18n/config";
import type { Locale } from "@/i18n/types";

// ─── Portal Session Context ─────────────────────────────────────────────────

interface PortalSessionContextValue {
  session: PortalSession | null;
  isLoading: boolean;
}

const PortalSessionContext = createContext<PortalSessionContextValue>({
  session: null,
  isLoading: true,
});

export function usePortalSession() {
  return useContext(PortalSessionContext);
}

// ─── Providers ───────────────────────────────────────────────────────────────

function createPortalQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function getClientLocale(): Locale {
  if (typeof document === "undefined") return defaultLocale;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  const raw = match?.[1];
  if (raw && supportedLocales.includes(raw as Locale)) return raw as Locale;
  // Auto-detect from browser language for portal visitors
  if (typeof navigator !== "undefined" && navigator.language.startsWith("es")) return "es";
  return defaultLocale;
}

export function PortalProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createPortalQueryClient());
  const [session, setSession] = useState<PortalSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [locale] = useState<Locale>(() => getClientLocale());

  // Hydrate session from API on mount
  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch("/api/portal/data", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setSession({
            id: "",
            portalTokenId: "",
            sessionToken: "",
            email: data.client?.email ?? "",
            companyId: data.company?.id ?? "",
            clientId: data.client?.id ?? "",
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            createdAt: new Date(),
          });
        }
      } catch {
        // Session invalid or expired — middleware will redirect
      } finally {
        setIsLoading(false);
      }
    }
    loadSession();
  }, []);

  return (
    <LanguageProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        <PortalSessionContext.Provider value={{ session, isLoading }}>
          {children}
        </PortalSessionContext.Provider>
      </QueryClientProvider>
    </LanguageProvider>
  );
}
