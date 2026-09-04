import { BodyCopy, Eyebrow, Headline, SocialFrame, type TreatmentProps } from "../frame";
import { SOCIAL_FONTS, SOCIAL_THEME } from "../theme";

export function SignalGrid(props: TreatmentProps) {
  return (
    <SocialFrame treatmentLabel="SIGNAL GRID" index={props.index} total={props.total} date={props.content.date}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "54px 24px 42px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <Eyebrow>{props.slide.eyebrow ?? "OPERATOR PROTOCOL"}</Eyebrow>
          <div
            style={{
              display: "flex",
              color: SOCIAL_THEME.textMute,
              fontFamily: SOCIAL_FONTS.mono,
              fontSize: 58,
              lineHeight: 1,
            }}
          >
            {String(props.index + 1).padStart(2, "0")}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
          <Headline size={72}>{props.slide.headline}</Headline>
          <div style={{ display: "flex", width: "100%", borderTop: `1px solid ${SOCIAL_THEME.line}`, margin: "48px 0 38px" }} />
          {props.slide.body ? <BodyCopy size={36}>{props.slide.body}</BodyCopy> : null}
        </div>
      </div>
    </SocialFrame>
  );
}
