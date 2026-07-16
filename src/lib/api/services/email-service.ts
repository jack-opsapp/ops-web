/**
 * Server email service.
 *
 * Credential-bearing connection persistence and provider construction are
 * server-only. Browser code uses email-connection-browser-service instead.
 */

import type { EmailProviderInterface } from "./email-provider";
import { EmailConnectionService } from "./email-connection-service";
import { GmailProvider } from "./providers/gmail-provider";
import { Microsoft365Provider } from "./providers/microsoft365-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

export const EmailService = {
  ...EmailConnectionService,

  getProvider(connection: EmailConnection): EmailProviderInterface {
    switch (connection.provider) {
      case "gmail":
        return new GmailProvider(connection);
      case "microsoft365":
        return new Microsoft365Provider(connection);
      default: {
        const exhaustiveProvider: never = connection.provider;
        throw new Error(`Unknown provider: ${exhaustiveProvider}`);
      }
    }
  },
};
