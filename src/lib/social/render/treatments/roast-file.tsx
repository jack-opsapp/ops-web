import { BodyCopy, Eyebrow, Headline, SocialFrame, type TreatmentProps } from "../frame";
import { SOCIAL_FONTS, SOCIAL_THEME } from "../theme";

export function RoastFile(props: TreatmentProps) {
  return (
    <SocialFrame treatmentLabel="ROAST FILE" index={props.index} total={props.total} date={props.content.date}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "54px 24px 42px", justifyContent: "center" }}>
        <Eyebrow tone="agent">{props.slide.eyebrow ?? "ROAST FILE // ARCHETYPE"}</Eyebrow>
        <Headline size={78}>{props.slide.headline}</Headline>
        {props.slide.body ? (
          <div style={{ display: "flex", marginTop: 48, padding: "34px 0", borderTop: `1px solid ${SOCIAL_THEME.line}`, borderBottom: `1px solid ${SOCIAL_THEME.line}` }}>
            <BodyCopy size={36}>{props.slide.body}</BodyCopy>
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            marginTop: 34,
            color: SOCIAL_THEME.textTertiary,
            fontFamily: SOCIAL_FONTS.mono,
            fontSize: 22,
            letterSpacing: "0.12em",
          }}
        >
          VERDICT :: THE PATTERN IS THE PROBLEM
        </div>
      </div>
    </SocialFrame>
  );
}
