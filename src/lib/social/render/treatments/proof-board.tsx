import { BodyCopy, Eyebrow, Headline, SocialFrame, type TreatmentProps } from "../frame";
import { SOCIAL_FONTS, SOCIAL_THEME } from "../theme";

export function ProofBoard(props: TreatmentProps) {
  return (
    <SocialFrame treatmentLabel="PROOF BOARD" index={props.index} total={props.total} date={props.content.date}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "58px 26px 48px" }}>
        <Eyebrow tone="olive">{props.slide.eyebrow ?? "OBSERVED CHANGE"}</Eyebrow>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            borderTop: `1px solid ${SOCIAL_THEME.line}`,
            borderBottom: `1px solid ${SOCIAL_THEME.line}`,
            padding: "48px 0",
          }}
        >
          <Headline size={74}>{props.slide.headline}</Headline>
          {props.slide.body ? (
            <div style={{ display: "flex", marginTop: 40, maxWidth: 820 }}>
              <BodyCopy size={34}>{props.slide.body}</BodyCopy>
            </div>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 32,
            color: SOCIAL_THEME.textTertiary,
            fontFamily: SOCIAL_FONTS.mono,
            fontSize: 22,
            letterSpacing: "0.12em",
          }}
        >
          SOURCE :: VERIFIED OPS RECORD
        </div>
      </div>
    </SocialFrame>
  );
}
