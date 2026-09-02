import { BodyCopy, Eyebrow, Headline, ImagePanel, SocialFrame, type TreatmentProps } from "../frame";
import { SOCIAL_THEME } from "../theme";

export function EditorialCover(props: TreatmentProps) {
  return (
    <SocialFrame treatmentLabel="EDITORIAL COVER" index={props.index} total={props.total} date={props.content.date}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "38px 0 34px" }}>
        {props.imageDataUrl ? <ImagePanel src={props.imageDataUrl} style={{ flex: 1 }} /> : null}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: -260,
            padding: "120px 42px 38px",
            background: SOCIAL_THEME.glass,
            border: `1px solid ${SOCIAL_THEME.line}`,
            borderRadius: 10,
          }}
        >
          <Eyebrow>{props.slide.eyebrow ?? "NEW FIELD NOTE"}</Eyebrow>
          <Headline size={76}>{props.slide.headline}</Headline>
          {props.content.subtitle ? (
            <div style={{ display: "flex", marginTop: 28 }}>
              <BodyCopy size={31}>{props.content.subtitle}</BodyCopy>
            </div>
          ) : null}
        </div>
      </div>
    </SocialFrame>
  );
}
