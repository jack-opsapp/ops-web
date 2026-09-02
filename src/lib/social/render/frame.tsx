import type { CSSProperties, ReactNode } from "react";
import type { SocialContent, SocialSlide } from "../contract";
import { SOCIAL_FONTS, SOCIAL_THEME } from "./theme";

export interface TreatmentProps {
  content: SocialContent;
  slide: SocialSlide;
  imageDataUrl?: string;
  index: number;
  total: number;
}

const monoLabel: CSSProperties = {
  color: SOCIAL_THEME.textTertiary,
  fontFamily: SOCIAL_FONTS.mono,
  fontSize: 22,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
};

export function SocialFrame({
  children,
  treatmentLabel,
  index,
  total,
  date,
}: {
  children: ReactNode;
  treatmentLabel: string;
  index: number;
  total: number;
  date?: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        background: SOCIAL_THEME.canvas,
        color: SOCIAL_THEME.text,
        padding: "58px 62px 48px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 48,
          borderBottom: `1px solid ${SOCIAL_THEME.line}`,
          paddingBottom: 20,
        }}
      >
        <div style={{ ...monoLabel, display: "flex" }}>// OPS FIELD INTELLIGENCE</div>
        <div style={{ ...monoLabel, display: "flex", color: SOCIAL_THEME.textMute }}>
          {date ?? "OPS // SOCIAL"}
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>{children}</div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 50,
          borderTop: `1px solid ${SOCIAL_THEME.line}`,
          paddingTop: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            color: SOCIAL_THEME.text,
            fontFamily: SOCIAL_FONTS.display,
            fontSize: 26,
            fontWeight: 300,
            textTransform: "uppercase",
          }}
        >
          OPS
        </div>
        <div style={{ ...monoLabel, display: "flex", color: SOCIAL_THEME.textMute }}>
          {treatmentLabel} · {String(index + 1).padStart(2, "0")}/{String(total).padStart(2, "0")}
        </div>
      </div>
    </div>
  );
}

export function Eyebrow({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "tan" | "olive" | "agent" }) {
  const color =
    tone === "tan"
      ? SOCIAL_THEME.tan
      : tone === "olive"
        ? SOCIAL_THEME.olive
        : tone === "agent"
          ? SOCIAL_THEME.agent
          : SOCIAL_THEME.textTertiary;
  return (
    <div style={{ ...monoLabel, display: "flex", color, marginBottom: 28 }}>{children}</div>
  );
}

export function Headline({ children, size = 82 }: { children: ReactNode; size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        color: SOCIAL_THEME.text,
        fontFamily: SOCIAL_FONTS.display,
        fontSize: size,
        fontWeight: 300,
        lineHeight: 0.98,
        letterSpacing: "-0.025em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

export function BodyCopy({ children, size = 34 }: { children: ReactNode; size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        color: SOCIAL_THEME.textSecondary,
        fontFamily: SOCIAL_FONTS.body,
        fontSize: size,
        fontWeight: 400,
        lineHeight: 1.25,
      }}
    >
      {children}
    </div>
  );
}

export function ImagePanel({
  src,
  style,
}: {
  src: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        overflow: "hidden",
        border: `1px solid ${SOCIAL_THEME.line}`,
        borderRadius: 10,
        background: SOCIAL_THEME.glass,
        ...style,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  );
}
