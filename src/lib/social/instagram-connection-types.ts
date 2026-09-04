export type InstagramConnectionStatus =
  | {
      connected: false;
      username?: string;
      reason: "not_connected" | "expired";
      needsReconnect: boolean;
    }
  | {
      connected: true;
      username: string;
      connectedAt: string;
      tokenExpiresAt: string;
      lastRefreshedAt: string | null;
      needsReconnect: false;
    };
