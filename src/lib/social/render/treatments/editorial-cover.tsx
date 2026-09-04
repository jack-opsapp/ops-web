import { BodyCopy, Eyebrow, Headline, SocialFrame, type TreatmentProps } from "../frame";
import { SOCIAL_THEME } from "../theme";

export function EditorialCover(props: TreatmentProps) {
  return (
    <SocialFrame treatmentLabel="EDITORIAL COVER" index={props.index} total={props.total} date={props.content.date}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {props.imageDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={props.imageDataUrl}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            width: "100%",
            height: "100%",
            backgroundImage: SOCIAL_THEME.editorialFade,
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "flex-end",
            padding: "0 40px 56px",
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
