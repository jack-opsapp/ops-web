declare module "jsdom" {
  export class JSDOM {
    constructor(
      html?: string,
      options?: {
        readonly contentType?: string;
      }
    );

    readonly window: Window & typeof globalThis;
  }
}
