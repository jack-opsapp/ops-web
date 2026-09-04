import { BodyCopy, Eyebrow, Headline, ImagePanel, SocialFrame, type TreatmentProps } from "../frame";

export function SplitSignal(props: TreatmentProps) {
  return (
    <SocialFrame treatmentLabel="SPLIT SIGNAL" index={props.index} total={props.total} date={props.content.date}>
      <div style={{ display: "flex", flex: 1, gap: 34, padding: "42px 0 38px" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1.15, justifyContent: "center" }}>
          <Eyebrow>{props.slide.eyebrow ?? "OPERATING SIGNAL"}</Eyebrow>
          <Headline size={66}>{props.slide.headline}</Headline>
          {props.slide.body ? (
            <div style={{ display: "flex", marginTop: 38 }}>
              <BodyCopy size={30}>{props.slide.body}</BodyCopy>
            </div>
          ) : null}
        </div>
        {props.imageDataUrl ? (
          <ImagePanel src={props.imageDataUrl} style={{ flex: 0.85, margin: "74px 0" }} />
        ) : null}
      </div>
    </SocialFrame>
  );
}
