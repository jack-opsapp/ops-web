import "server-only";

/** Only used after rail persistence and an exact provider subscription rejection. */
export class NotificationPushUnavailableError extends Error {
  constructor() {
    super(
      "Notification push failed: no subscribed recipients; rail persistence succeeded"
    );
    this.name = "NotificationPushUnavailableError";
  }
}
