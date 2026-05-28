import * as React from "react";
import { Section, Text } from "@react-email/components";

/**
 * Mocked iOS-style push notification card. Used by Day 4A's
 * "the notification you're working toward" email to give the operator
 * a visual preview of the moment they're driving toward.
 *
 * Format MUST match the real notification produced by
 * dispatchTaskCompleted() at OPS-Web/src/lib/api/services/notification-dispatch.ts:200-201:
 *   title: "Task Completed"
 *   body:  `${completedByName} completed "${taskTitle}" on ${projectTitle}`
 *
 * Stylistic choice: deliberately not pixel-perfect iOS chrome so we
 * don't impersonate Apple UI. Shape is "recognizably a push notification"
 * without copying Apple's exact spec.
 *
 * @template-version 1.0.0
 */
export function MockPushNotification({
  completedByName,
  taskTitle,
  projectTitle,
}: {
  completedByName: string;
  taskTitle: string;
  projectTitle: string;
}) {
  return (
    <Section
      style={{
        maxWidth: "440px",
        margin: "16px auto",
        backgroundColor: "#1c1c1e",
        borderRadius: "14px",
        padding: "12px 16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
      }}
    >
      <table width="100%" style={{ borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td
              style={{
                fontSize: "13px",
                color: "#9a9a9a",
                paddingBottom: "4px",
              }}
            >
              OPS
            </td>
            <td
              style={{
                fontSize: "13px",
                color: "#9a9a9a",
                textAlign: "right",
                paddingBottom: "4px",
              }}
            >
              now
            </td>
          </tr>
        </tbody>
      </table>
      <Text
        style={{
          fontSize: "15px",
          color: "#ffffff",
          fontWeight: 600,
          margin: "0 0 2px 0",
          lineHeight: "20px",
        }}
      >
        Task Completed
      </Text>
      <Text
        style={{
          fontSize: "15px",
          color: "#e5e5e7",
          margin: 0,
          lineHeight: "20px",
        }}
      >
        {`${completedByName} completed "${taskTitle}" on ${projectTitle}`}
      </Text>
    </Section>
  );
}

export const previewProps = {
  completedByName: "Jake",
  taskTitle: "Rail Install",
  projectTitle: "5611 Batu Rd",
};
