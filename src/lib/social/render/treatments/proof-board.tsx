import {
  Eyebrow,
  Headline,
  SlideBody,
  SocialFrame,
  headlineSize,
  type TreatmentProps,
} from "../frame";
import {
  SOCIAL_FONTS,
  SOCIAL_LINE,
  SOCIAL_SPACE,
  SOCIAL_THEME,
  SOCIAL_TRACKING,
  SOCIAL_TYPE,
} from "../theme";

export function ProofBoard(props: TreatmentProps) {
  return (
    <SocialFrame
      index={props.index}
      total={props.total}
      date={props.content.date}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: `${SOCIAL_SPACE.slideTop}px ${SOCIAL_SPACE.proofX}px ${SOCIAL_SPACE.slideBottom}px`,
        }}
      >
        <Eyebrow tone="olive">
          {props.slide.eyebrow ?? "OBSERVED CHANGE"}
        </Eyebrow>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            borderTop: `${SOCIAL_LINE.hairline}px solid ${SOCIAL_THEME.line}`,
            borderBottom: `${SOCIAL_LINE.hairline}px solid ${SOCIAL_THEME.line}`,
            padding: `${SOCIAL_SPACE.ruleGap}px 0`,
          }}
        >
          <Headline
            size={headlineSize(
              props.slide.headline,
              SOCIAL_TYPE.slideHeadline,
              SOCIAL_TYPE.slideHeadlineLong
            )}
          >
            {props.slide.headline}
          </Headline>
          <div style={{ display: "flex", marginTop: SOCIAL_SPACE.headlineGap }}>
            <SlideBody body={props.slide.body} />
          </div>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: SOCIAL_SPACE.headlineGap,
            color: SOCIAL_THEME.textTertiary,
            fontFamily: SOCIAL_FONTS.mono,
            fontSize: SOCIAL_TYPE.eyebrow,
            letterSpacing: SOCIAL_TRACKING.labelTight,
          }}
        >
          SOURCE :: VERIFIED OPS RECORD
        </div>
      </div>
    </SocialFrame>
  );
}
