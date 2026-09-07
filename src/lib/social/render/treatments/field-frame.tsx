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

export function FieldFrame(props: TreatmentProps) {
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
          padding: `${SOCIAL_SPACE.panelTop}px 0 ${SOCIAL_SPACE.panelBottom}px`,
        }}
      >
        {props.imageDataUrl ? (
          <ImagePanel src={props.imageDataUrl} style={{ flex: 1.15 }} />
        ) : null}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            paddingTop: SOCIAL_SPACE.headlineGap,
          }}
        >
          <Eyebrow tone="olive">
            {props.slide.eyebrow ?? "FIELD DISPATCH"}
          </Eyebrow>
          <Headline
            size={headlineSize(
              props.slide.headline,
              SOCIAL_TYPE.fieldHeadline,
              SOCIAL_TYPE.fieldHeadlineLong
            )}
          >
            {props.slide.headline}
          </Headline>
          <div style={{ display: "flex", marginTop: SOCIAL_SPACE.eyebrowGap }}>
            <SlideBody body={props.slide.body} size={SOCIAL_TYPE.bodyLong} />
          </div>
        </div>
      </div>
    </SocialFrame>
  );
}
