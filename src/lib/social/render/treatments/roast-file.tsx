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

export function RoastFile(props: TreatmentProps) {
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
          padding: `${SOCIAL_SPACE.slideTop}px ${SOCIAL_SPACE.roastX}px ${SOCIAL_SPACE.slideBottom}px`,
          justifyContent: "center",
        }}
      >
        <Eyebrow tone="agent">
          {props.slide.eyebrow ?? "ROAST FILE // ARCHETYPE"}
        </Eyebrow>
        <Headline
          size={headlineSize(
            props.slide.headline,
            SOCIAL_TYPE.slideHeadline,
            SOCIAL_TYPE.slideHeadlineLong
          )}
        >
          {props.slide.headline}
        </Headline>
        <div
          style={{
            display: "flex",
            marginTop: SOCIAL_SPACE.ruleGap,
            padding: `${SOCIAL_SPACE.headlineGap}px 0`,
            borderTop: `${SOCIAL_LINE.hairline}px solid ${SOCIAL_THEME.line}`,
            borderBottom: `${SOCIAL_LINE.hairline}px solid ${SOCIAL_THEME.line}`,
          }}
        >
          <SlideBody body={props.slide.body} />
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
          VERDICT :: THE PATTERN IS THE PROBLEM
        </div>
      </div>
    </SocialFrame>
  );
}
