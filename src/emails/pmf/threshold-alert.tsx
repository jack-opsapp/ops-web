/**
 * OPS Web — PMF Threshold Alert email template.
 *
 * Fired when a marker flips state or a notable context event occurs
 * (e.g. `marker_1_green`, `churn_red`). Rendered via `@react-email/render`
 * and dispatched through `sendPmfNotification` (Task 24).
 *
 * Styling is inline-only (no CSS files) to survive email clients. See
 * `./_shared.ts` for the shared style constants and URL sanitizer.
 * `backdrop-filter: blur()` is not portable, so the glass surface uses
 * the darker opaque `rgba(10,10,10,0.70)` variant rather than the
 * web-UI glass spec `rgba(18,18,20,0.58)`.
 */
import React from 'react';
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import {
  ACCENT,
  CANVAS,
  CAKE_DISPLAY,
  GLASS_SINGLE,
  MONO11,
  sanitizeDashboardUrl,
} from './_shared';

export interface ThresholdAlertProps {
  trigger: string;
  messageBody: string;
  context?: Record<string, string | number>;
  dashboardUrl?: string;
}

export function ThresholdAlertEmail({
  trigger,
  messageBody,
  context,
  dashboardUrl,
}: ThresholdAlertProps) {
  const safeUrl = sanitizeDashboardUrl(dashboardUrl);
  return (
    <Html>
      <Head />
      <Preview>{messageBody}</Preview>
      <Body style={CANVAS}>
        <Container style={GLASS_SINGLE}>
          <Text style={MONO11}>// PMF ALERT · {trigger.toUpperCase()}</Text>
          <Text style={{ ...CAKE_DISPLAY, marginTop: 16 }}>{messageBody}</Text>
          {context && (
            <Section style={{ marginTop: 24 }}>
              {Object.entries(context).map(([k, v]) => (
                <Text
                  key={k}
                  style={{ ...MONO11, color: '#B5B5B5', marginBottom: 4 }}
                >
                  {k.toUpperCase()}: {String(v)}
                </Text>
              ))}
            </Section>
          )}
          {safeUrl && (
            <Text style={{ ...MONO11, marginTop: 24 }}>
              <a
                href={safeUrl}
                style={{ color: ACCENT, textDecoration: 'none' }}
              >
                → VIEW DECK
              </a>
            </Text>
          )}
        </Container>
      </Body>
    </Html>
  );
}
