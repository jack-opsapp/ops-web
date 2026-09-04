import { BodyCopy, Eyebrow, Headline, SocialFrame, type TreatmentProps } from "../frame";
import { SOCIAL_FONTS, SOCIAL_THEME } from "../theme";

export function OperatorBrief(props: TreatmentProps) {
  return (
    <SocialFrame treatmentLabel="OPERATOR BRIEF" index={props.index} total={props.total} date={props.content.date}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "54px 34px 44px", justifyContent: "center" }}>
        <Eyebrow tone="tan">{props.slide.eyebrow ?? "// OPERATOR BRIEF"}</Eyebrow>
        <Headline size={props.slide.headline.length > 84 ? 57 : 68}>{props.slide.headline}</Headline>
        <div style={{ display: "flex", width: 170, borderTop: `3px solid ${SOCIAL_THEME.tan}`, margin: "42px 0 36px" }} />
        {props.slide.body ? <BodyCopy size={34}>{props.slide.body}</BodyCopy> : null}
        <div
          style={{
            display: "flex",
            marginTop: 48,
            color: SOCIAL_THEME.textMute,
            fontFamily: SOCIAL_FONTS.mono,
            fontSize: 21,
            letterSpacing: "0.12em",
          }}
        >
          [READ · DECIDE · MOVE]
        </div>
      </div>
    </SocialFrame>
  );
}
