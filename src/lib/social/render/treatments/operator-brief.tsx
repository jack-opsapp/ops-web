import {
  Eyebrow,
  Headline,
  SlideBody,
  SocialFrame,
  headlineSize,
  type TreatmentProps,
} from "../frame";
import { SOCIAL_LINE, SOCIAL_SPACE, SOCIAL_THEME, SOCIAL_TYPE } from "../theme";

export function OperatorBrief(props: TreatmentProps) {
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
          padding: `${SOCIAL_SPACE.slideTop}px ${SOCIAL_SPACE.slideX}px ${SOCIAL_SPACE.slideBottom}px`,
          justifyContent: "center",
        }}
      >
        <Eyebrow tone="tan">
          {props.slide.eyebrow ?? "// OPERATOR BRIEF"}
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
            width: SOCIAL_SPACE.ruleWidth,
            borderTop: `${SOCIAL_LINE.rule}px solid ${SOCIAL_THEME.tan}`,
            margin: `${SOCIAL_SPACE.ruleGap}px 0`,
          }}
        />
        <SlideBody body={props.slide.body} />
      </div>
    </SocialFrame>
  );
}
