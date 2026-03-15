/**
 * OPS Web - Root Providers
 *
 * Wraps the application with:
 * - TanStack Query for server state management
 * - Auth state hydration
 * - Global 401 auto-logout
 */

"use client";

import { useState, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { getQueryClient, setOnUnauthorized } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";
import { useSignOutStore } from "@/stores/signout-store";
import { LanguageProvider } from "@/i18n/client";
import type { Locale } from "@/i18n/types";

interface ProvidersProps {
  locale: Locale;
  children: React.ReactNode;
}

export function Providers({ locale, children }: ProvidersProps) {
  // Create a stable query client instance per component lifecycle
  const [queryClient] = useState(() => getQueryClient());
  const beginSignOut = useSignOutStore((s) => s.begin);

  // Register global 401 handler — forces logout + redirect via sign-out animation
  useEffect(() => {
    setOnUnauthorized(() => {
      const user = useAuthStore.getState().currentUser;
      beginSignOut(user?.firstName || "", user?.lastName || "");
    });
  }, [beginSignOut]);

  return (
    <LanguageProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        {children}
        {process.env.NODE_ENV === "development" && (
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
        )}
      </QueryClientProvider>
    </LanguageProvider>
  );
}

export default Providers;
