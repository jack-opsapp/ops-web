import type { SocialStoryType, SocialVisualTreatment } from "./types";

export interface SocialTemplateDefinition {
  treatment: SocialVisualTreatment;
  storyTypes: readonly SocialStoryType[];
  requiresImage: boolean;
  imageLed: boolean;
  minimumTitleLength?: number;
  maximumTitleLength?: number;
}

export const SOCIAL_TEMPLATE_CATALOG: readonly SocialTemplateDefinition[] = [
  {
    treatment: "editorial_cover",
    storyTypes: ["blog_signal", "release_note"],
    requiresImage: true,
    imageLed: true,
    maximumTitleLength: 52,
  },
  {
    treatment: "split_signal",
    storyTypes: ["blog_signal", "field_dispatch", "performance_proof", "release_note"],
    requiresImage: true,
    imageLed: true,
    minimumTitleLength: 33,
    maximumTitleLength: 88,
  },
  {
    treatment: "operator_brief",
    storyTypes: ["blog_signal", "operator_protocol", "release_note"],
    requiresImage: false,
    imageLed: false,
    maximumTitleLength: 140,
  },
  {
    treatment: "field_frame",
    storyTypes: ["field_dispatch", "performance_proof"],
    requiresImage: true,
    imageLed: true,
    maximumTitleLength: 100,
  },
  {
    treatment: "proof_board",
    storyTypes: ["performance_proof", "release_note"],
    requiresImage: false,
    imageLed: false,
    maximumTitleLength: 100,
  },
  {
    treatment: "signal_grid",
    storyTypes: ["blog_signal", "operator_protocol", "release_note"],
    requiresImage: false,
    imageLed: false,
    maximumTitleLength: 100,
  },
  {
    treatment: "roast_file",
    storyTypes: ["roast_card"],
    requiresImage: false,
    imageLed: false,
    maximumTitleLength: 100,
  },
] as const;

export function getSocialTemplate(treatment: SocialVisualTreatment): SocialTemplateDefinition {
  const template = SOCIAL_TEMPLATE_CATALOG.find((candidate) => candidate.treatment === treatment);
  if (!template) throw new Error(`Unknown social treatment: ${treatment}`);
  return template;
}
