/** A user-selected on-screen element attached to a bug report (custom_metadata.elementReferences). */
export interface ElementReference {
  id: string;
  label: string;
  role: string;
  tag: string;
  selector: string;
  classes: string;
  testId: string | null;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  page: { x: number; y: number };
  viewport: { width: number; height: number };
  componentChain: string[];
  capturedAt: string;
  attachmentIndex: number | null;
}

export const MAX_ELEMENT_REFERENCES = 3;
export const ELEMENT_CROP_PADDING_PX = 24;
