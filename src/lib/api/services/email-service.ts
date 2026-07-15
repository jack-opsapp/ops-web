/**
 * Server email service.
 *
 * Connection persistence lives in the provider-agnostic client-safe module.
 * This server boundary adds only the provider factory used by sync/routes.
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
