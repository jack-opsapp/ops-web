import "server-only";

import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { SocialSubmission } from "../contract";
import { downloadPublicImage } from "../public-media";
import { storeSocialAsset, type StoreSocialAssetInput } from "../asset-store";
import type { SocialTemplateSelection } from "../template-selector";
import { getSocialTemplate } from "../template-catalog";
import type { RenderedSocialAsset, SocialVisualTreatment } from "../types";
import { loadSocialFonts } from "./fonts";
import type { TreatmentProps } from "./frame";
import { EditorialCover } from "./treatments/editorial-cover";
import { FieldFrame } from "./treatments/field-frame";
import { OperatorBrief } from "./treatments/operator-brief";
import { ProofBoard } from "./treatments/proof-board";
import { RoastFile } from "./treatments/roast-file";
import { SignalGrid } from "./treatments/signal-grid";
import { SplitSignal } from "./treatments/split-signal";

export const SOCIAL_RENDER_VERSION = "social-render-2026-09-01-v1" as const;
const WIDTH = 1080;
const HEIGHT = 1350;

export interface RenderSocialDependencies {
  downloadImage: typeof downloadPublicImage;
  storeAsset: (input: StoreSocialAssetInput) => Promise<RenderedSocialAsset>;
}

const defaultDependencies: RenderSocialDependencies = {
  downloadImage: downloadPublicImage,
  storeAsset: storeSocialAsset,
};

function treatmentElement(treatment: SocialVisualTreatment, props: TreatmentProps) {
  switch (treatment) {
    case "editorial_cover":
      return <EditorialCover {...props} />;
    case "split_signal":
      return <SplitSignal {...props} />;
    case "operator_brief":
      return <OperatorBrief {...props} />;
    case "field_frame":
      return <FieldFrame {...props} />;
    case "proof_board":
      return <ProofBoard {...props} />;
    case "signal_grid":
      return <SignalGrid {...props} />;
    case "roast_file":
      return <RoastFile {...props} />;
  }
}

export async function renderSocialPost(
  {
    postId,
    submission,
    selection,
    renderVersion = SOCIAL_RENDER_VERSION,
  }: {
    postId: string;
    submission: SocialSubmission;
    selection: SocialTemplateSelection;
    renderVersion?: string;
  },
  dependencies: RenderSocialDependencies = defaultDependencies
): Promise<RenderedSocialAsset[]> {
  const slides = submission.content.slides;
  if (selection.postFormat === "single" && slides.length !== 1) {
    throw new Error("Single social format requires exactly one slide");
  }
  if (selection.postFormat === "carousel" && (slides.length < 2 || slides.length > 10)) {
    throw new Error("Carousel social format requires two to ten slides");
  }

  const template = getSocialTemplate(selection.visualTreatment);
  const imageCache = new Map<string, Promise<string>>();
  const fonts = await loadSocialFonts();

  const assets: RenderedSocialAsset[] = [];
  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index];
    const sourceImageUrl =
      slide.image_url ?? submission.media?.[index]?.url ?? submission.media?.[0]?.url;
    let imageDataUrl: string | undefined;

    if (template.imageLed && sourceImageUrl) {
      let cached = imageCache.get(sourceImageUrl);
      if (!cached) {
        cached = dependencies.downloadImage(sourceImageUrl).then(
          (image) => `data:${image.contentType};base64,${image.buffer.toString("base64")}`
        );
        imageCache.set(sourceImageUrl, cached);
      }
      imageDataUrl = await cached;
    }

    if (template.requiresImage && !imageDataUrl) {
      throw new Error(`${selection.visualTreatment} requires a source image`);
    }

    const response = new ImageResponse(
      treatmentElement(selection.visualTreatment, {
        content: submission.content,
        slide,
        imageDataUrl,
        index,
        total: slides.length,
      }),
      {
        width: WIDTH,
        height: HEIGHT,
        fonts,
      }
    );
    const png = Buffer.from(await response.arrayBuffer());
    const jpeg = await sharp(png)
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer();
    const altText = slide.alt_text ?? submission.content.alt_text;

    assets.push(
      await dependencies.storeAsset({
        postId,
        renderVersion,
        order: index + 1,
        buffer: jpeg,
        altText,
        width: WIDTH,
        height: HEIGHT,
      })
    );
  }

  return assets;
}
