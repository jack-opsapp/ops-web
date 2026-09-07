import type { CSSProperties, ReactNode } from "react";
import type { SocialContent, SocialSlide } from "../contract";
import {
  SOCIAL_FONTS,
  SOCIAL_RADIUS,
  SOCIAL_SPACE,
  SOCIAL_THEME,
  SOCIAL_TYPE,
  SOCIAL_TYPE_STEPS,
  SOCIAL_LINE,
  SOCIAL_TRACKING,
  SOCIAL_LEADING,
} from "./theme";

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
  fontSize: SOCIAL_TYPE.eyebrow,
  letterSpacing: SOCIAL_TRACKING.label,
  textTransform: "uppercase",
};

const pad = (value: number) => String(value).padStart(2, "0");

/** `01 / 05` — the reader's only positional cue in the artwork. */
export function pageCounter(index: number, total: number): string {
  return `${pad(index + 1)} / ${pad(total)}`;
}

/** Cake Mono is set by size, never by weight, so long copy steps down. */
export function headlineSize(
  headline: string,
  base: number,
  long: number
): number {
  return headline.length > SOCIAL_TYPE_STEPS.headlineLong ? long : base;
}

export function bodySize(body: string): number {
  return body.length > SOCIAL_TYPE_STEPS.bodyLong
    ? SOCIAL_TYPE.bodyLong
    : SOCIAL_TYPE.body;
}

/**
 * The server-owned closing slide prints the bare article URL. It is the one
 * body value that is a machine string rather than prose, so it is set in the
 * mono face at reading size instead of Mohave.
 */
export function isArticleUrl(body: string): boolean {
  return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+\/\S*$/i.test(body.trim());
}

export function SocialFrame({
  children,
  index,
  total,
  date,
}: {
  children: ReactNode;
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
        padding: `${SOCIAL_SPACE.frameTop}px ${SOCIAL_SPACE.frameX}px ${SOCIAL_SPACE.frameBottom}px`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: SOCIAL_SPACE.headerHeight,
          borderBottom: `${SOCIAL_LINE.hairline}px solid ${SOCIAL_THEME.line}`,
          paddingBottom: SOCIAL_SPACE.headerGap,
        }}
      >
        <div style={{ ...monoLabel, display: "flex" }}>// OPS JOURNAL</div>
        {date ? (
          <div
            style={{
              ...monoLabel,
              display: "flex",
              color: SOCIAL_THEME.textMute,
            }}
          >
            {date}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
        {children}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: SOCIAL_SPACE.footerHeight,
          borderTop: `${SOCIAL_LINE.hairline}px solid ${SOCIAL_THEME.line}`,
          paddingTop: SOCIAL_SPACE.footerGap,
        }}
      >
        <div
          style={{
            display: "flex",
            color: SOCIAL_THEME.text,
            fontFamily: SOCIAL_FONTS.display,
            fontSize: SOCIAL_TYPE.mark,
            fontWeight: 300,
            textTransform: "uppercase",
          }}
        >
          OPS
        </div>
        <div
          style={{
            ...monoLabel,
            display: "flex",
            color: SOCIAL_THEME.textMute,
            fontSize: SOCIAL_TYPE.counter,
          }}
        >
          {pageCounter(index, total)}
        </div>
      </div>
    </div>
  );
}

export function Eyebrow({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "tan" | "olive" | "agent";
}) {
  const color =
    tone === "tan"
      ? SOCIAL_THEME.tan
      : tone === "olive"
        ? SOCIAL_THEME.olive
        : tone === "agent"
          ? SOCIAL_THEME.agent
          : SOCIAL_THEME.textTertiary;
  return (
    <div
      style={{
        ...monoLabel,
        display: "flex",
        color,
        marginBottom: SOCIAL_SPACE.eyebrowGap,
      }}
    >
      {children}
    </div>
  );
}

export function Headline({
  children,
  size = SOCIAL_TYPE.coverHeadline,
}: {
  children: ReactNode;
  size?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        color: SOCIAL_THEME.text,
        fontFamily: SOCIAL_FONTS.display,
        fontSize: size,
        fontWeight: 300,
        lineHeight: SOCIAL_LEADING.display,
        letterSpacing: SOCIAL_TRACKING.display,
        textTransform: "uppercase",
        // A single unbroken 100-character token must break, never overflow.
        wordBreak: "break-word",
      }}
    >
      {children}
    </div>
  );
}

export function BodyCopy({
  children,
  size = SOCIAL_TYPE.body,
}: {
  children: ReactNode;
  size?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        color: SOCIAL_THEME.textSecondary,
        fontFamily: SOCIAL_FONTS.body,
        fontSize: size,
        fontWeight: 400,
        lineHeight: SOCIAL_LEADING.body,
        wordBreak: "break-word",
      }}
    >
      {children}
    </div>
  );
}

export function ArticleUrl({ children }: { children: string }) {
  return (
    <div
      style={{
        display: "flex",
        color: SOCIAL_THEME.text,
        fontFamily: SOCIAL_FONTS.mono,
        fontSize:
          children.length <= SOCIAL_TYPE_STEPS.urlWide
            ? SOCIAL_TYPE.urlWide
            : SOCIAL_TYPE.url,
        fontWeight: 400,
        lineHeight: SOCIAL_LEADING.url,
        letterSpacing: SOCIAL_TRACKING.url,
        // `break-word` keeps the line breaker's own opportunities — the slug's
        // hyphens — and only splits inside a token when nothing else fits.
        // `break-all` would cut the slug at an arbitrary character.
        wordBreak: "break-word",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Every treatment renders every slide's body through this. A slide that
 * carries the closing article URL is set in mono; prose is set in Mohave and
 * steps down once it runs long.
 */
export function SlideBody({
  body,
  size,
}: {
  body: string | undefined;
  size?: number;
}) {
  if (!body) return null;
  if (isArticleUrl(body)) return <ArticleUrl>{body}</ArticleUrl>;
  return <BodyCopy size={size ?? bodySize(body)}>{body}</BodyCopy>;
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
        border: `${SOCIAL_LINE.hairline}px solid ${SOCIAL_THEME.line}`,
        borderRadius: SOCIAL_RADIUS.panel,
        background: SOCIAL_THEME.glass,
        ...style,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}
