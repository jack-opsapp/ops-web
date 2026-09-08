import {
  Eyebrow,
  Headline,
  ImagePanel,
  SlideBody,
  SocialFrame,
  headlineSize,
  type TreatmentProps,
} from "../frame";
import { SOCIAL_SPACE, SOCIAL_TYPE } from "../theme";

export function SplitSignal(props: TreatmentProps) {
  return (
    <SocialFrame
      index={props.index}
      total={props.total}
      date={props.content.date}
    >
      <div
        style={{
          display: "flex",
          flex: 1,
          gap: SOCIAL_SPACE.splitGap,
          padding: `${SOCIAL_SPACE.splitTop}px 0 ${SOCIAL_SPACE.splitBottom}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1.15,
            justifyContent: "center",
          }}
        >
          <Eyebrow>{props.slide.eyebrow ?? "OPERATING SIGNAL"}</Eyebrow>
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
            <SlideBody body={props.slide.body} size={SOCIAL_TYPE.bodyLong} />
          </div>
        </div>
        {props.imageDataUrl ? (
          <ImagePanel
            src={props.imageDataUrl}
            style={{
              flex: 0.85,
              margin: `${SOCIAL_SPACE.splitPanelInset}px 0`,
            }}
          />
        ) : null}
      </div>
    </SocialFrame>
  );
}
