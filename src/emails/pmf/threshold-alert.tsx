/**
 * OPS Web — PMF Threshold Alert email template.
 *
 * Fired when a marker flips state or a notable context event occurs
 * (e.g. `marker_1_green`, `churn_red`). Rendered via `@react-email/render`
 * and dispatched through `sendPmfNotification` (Task 24).
 *
 * Styling is inline-only (no CSS files) to survive email clients. Backdrop
 * blur is not portable, so the glass surface uses the darker opaque
 * `rgba(10,10,10,0.70)` variant rather than the web-UI glass spec
 * `rgba(18,18,20,0.58)` — this is a deliberate divergence from spec v2.
 * Accent `#6F94B0`, canvas `#000000`, text ladder `#EDEDED`/`#B5B5B5`/`#8A8A8A`
 * are current (2026-04-21) and used as specified.
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

export interface ThresholdAlertProps {
  trigger: string;
  messageBody: string;
  context?: Record<string, string | number>;
  dashboardUrl?: string;
}

const CANVAS: React.CSSProperties = {
  background: '#000000',
  margin: 0,
  padding: '24px',
  fontFamily: "'Mohave', sans-serif",
  color: '#EDEDED',
};

const GLASS: React.CSSProperties = {
  background: 'rgba(10,10,10,0.70)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 5,
  padding: 24,
};

const MONO: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: '#8A8A8A',
};

const CAKE: React.CSSProperties = {
  fontFamily: "'Cake Mono', sans-serif",
  fontWeight: 300,
  fontSize: 18,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#EDEDED',
};

export function ThresholdAlertEmail({
  trigger,
  messageBody,
  context,
  dashboardUrl,
}: ThresholdAlertProps) {
  return (
    <Html>
      <Head />
      <Preview>{messageBody}</Preview>
      <Body style={CANVAS}>
        <Container style={GLASS}>
          <Text style={MONO}>// PMF ALERT · {trigger.toUpperCase()}</Text>
          <Text style={{ ...CAKE, marginTop: 16 }}>{messageBody}</Text>
          {context && (
            <Section style={{ marginTop: 24 }}>
              {Object.entries(context).map(([k, v]) => (
                <Text
                  key={k}
                  style={{ ...MONO, color: '#B5B5B5', marginBottom: 4 }}
                >
                  {k.toUpperCase()}: {String(v)}
                </Text>
              ))}
            </Section>
          )}
          {dashboardUrl && (
            <Text style={{ ...MONO, marginTop: 24 }}>
              <a
                href={dashboardUrl}
                style={{ color: '#6F94B0', textDecoration: 'none' }}
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
