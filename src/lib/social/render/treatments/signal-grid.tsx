import {
  Eyebrow,
  Headline,
  SlideBody,
  SocialFrame,
  headlineSize,
  pageCounter,
  type TreatmentProps,
} from "../frame";
import {
  SOCIAL_FONTS,
  SOCIAL_LINE,
  SOCIAL_SPACE,
  SOCIAL_LEADING,
  SOCIAL_THEME,
  SOCIAL_TYPE,
} from "../theme";

export function SignalGrid(props: TreatmentProps) {
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
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <Eyebrow>{props.slide.eyebrow ?? "OPERATOR PROTOCOL"}</Eyebrow>
            <div
              style={{
                display: "flex",
                color: SOCIAL_THEME.textMute,
                fontFamily: SOCIAL_FONTS.mono,
                fontSize: SOCIAL_TYPE.coverHeadlineLong,
                lineHeight: SOCIAL_LEADING.flush,
              }}
            >
              {pageCounter(props.index, props.total).split(" / ")[0]}
            </div>
          </div>
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
              width: "100%",
              borderTop: `${SOCIAL_LINE.hairline}px solid ${SOCIAL_THEME.line}`,
              margin: `${SOCIAL_SPACE.ruleGap}px 0`,
            }}
          />
          <SlideBody body={props.slide.body} />
        </div>
      </div>
    </SocialFrame>
  );
}
