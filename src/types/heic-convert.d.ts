declare module "heic-convert" {
  type HeicOutputFormat = "JPEG" | "PNG";

  interface HeicConvertOptions {
    buffer: ArrayBuffer | Uint8Array | Buffer;
    format: HeicOutputFormat;
    quality?: number;
  }

  interface DeferredHeicImage {
    convert(): Promise<Buffer>;
  }

  interface HeicConvert {
    (options: HeicConvertOptions): Promise<Buffer>;
    all(options: HeicConvertOptions): Promise<DeferredHeicImage[]>;
  }

  const convert: HeicConvert;

  export = convert;
}
