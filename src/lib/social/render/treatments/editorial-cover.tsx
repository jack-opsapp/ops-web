import {
  BodyCopy,
  Eyebrow,
  Headline,
  SlideBody,
  SocialFrame,
  headlineSize,
  type TreatmentProps,
} from "../frame";
import { SOCIAL_LINE, SOCIAL_SPACE, SOCIAL_THEME, SOCIAL_TYPE } from "../theme";

/**
 * Slide 0 carries the article image, the hook and the article title, so the
 * reader knows which piece this is. Every later slide is a clean canvas text
 * slide — reusing the cover art there taught the reader nothing.
 */
function Cover(props: TreatmentProps) {
  return (
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
          padding: `0 ${SOCIAL_SPACE.coverX}px ${SOCIAL_SPACE.coverBottom}px`,
        }}
      >
        <Eyebrow>{props.slide.eyebrow ?? "NEW FIELD NOTE"}</Eyebrow>
        <Headline
          size={headlineSize(
            props.slide.headline,
            SOCIAL_TYPE.coverHeadline,
            SOCIAL_TYPE.coverHeadlineLong
          )}
        >
          {props.slide.headline}
        </Headline>
        {props.content.subtitle ? (
          <div style={{ display: "flex", marginTop: SOCIAL_SPACE.eyebrowGap }}>
            <BodyCopy size={SOCIAL_TYPE.subtitle}>
              {props.content.subtitle}
            </BodyCopy>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TextSlide(props: TreatmentProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        justifyContent: "center",
        padding: `${SOCIAL_SPACE.slideTop}px ${SOCIAL_SPACE.slideX}px ${SOCIAL_SPACE.slideBottom}px`,
      }}
    >
      {props.slide.eyebrow ? <Eyebrow>{props.slide.eyebrow}</Eyebrow> : null}
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
          borderTop: `${SOCIAL_LINE.rule}px solid ${SOCIAL_THEME.line}`,
          margin: `${SOCIAL_SPACE.ruleGap}px 0`,
        }}
      />
      <SlideBody body={props.slide.body} />
    </div>
  );
}

export function EditorialCover(props: TreatmentProps) {
  return (
    <SocialFrame
      index={props.index}
      total={props.total}
      date={props.content.date}
    >
      {props.index === 0 ? <Cover {...props} /> : <TextSlide {...props} />}
    </SocialFrame>
  );
}
