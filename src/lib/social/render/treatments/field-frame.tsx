import { BodyCopy, Eyebrow, Headline, ImagePanel, SocialFrame, type TreatmentProps } from "../frame";

export function FieldFrame(props: TreatmentProps) {
  return (
    <SocialFrame treatmentLabel="FIELD FRAME" index={props.index} total={props.total} date={props.content.date}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "34px 0 36px" }}>
        {props.imageDataUrl ? <ImagePanel src={props.imageDataUrl} style={{ flex: 1.15 }} /> : null}
        <div style={{ display: "flex", flexDirection: "column", paddingTop: 34 }}>
          <Eyebrow tone="olive">{props.slide.eyebrow ?? "FIELD DISPATCH"}</Eyebrow>
          <Headline size={57}>{props.slide.headline}</Headline>
          {props.slide.body ? (
            <div style={{ display: "flex", marginTop: 24 }}>
              <BodyCopy size={28}>{props.slide.body}</BodyCopy>
            </div>
          ) : null}
        </div>
      </div>
    </SocialFrame>
  );
}
