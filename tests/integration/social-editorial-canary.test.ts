// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { server } from "../mocks/server";
import { generateEditorial } from "@/lib/social/editorial/generator";
import { renderSocialPost } from "@/lib/social/render/render-social-post";
import { selectSocialTemplate } from "@/lib/social/template-selector";
// Canary isolates provider inference from all application notifications and DB writes.
vi.mock("@/lib/api/services/openai-clients", () => ({
  getOpenAIForWorkload: async () => {
    throw Error("replaced below");
  },
}));
describe.runIf(process.env.OPS_RUN_EDITORIAL_CANARY === "1")(
  "nonpublishing live editorial canary",
  () => {
    it("writes reviewed copy and actual renderer JPEGs only to the local artifact directory", async () => {
      server.close();
      const { default: OpenAI } = await import("openai");
      const { parseEnv: parse } = await import("node:util");
      const env = parse(
        readFileSync(
          "/Users/jacksonsweet/Projects/OPS/ops-web/.env.local",
          "utf8"
        )
      );
      const client = new OpenAI({
        apiKey: env.OPENAI_API_KEY,
        timeout: 65000,
        maxRetries: 0,
      });
      const root = resolve("docs/artifacts/social-editorial");
      mkdirSync(root, { recursive: true });
      const trace: unknown[] = [];
      const source = JSON.parse(readFileSync(root + "/source.json", "utf8"));
      let pack;
      try {
        pack = await generateEditorial(
          source,
          "protocol",
          [],
          new Date(),
          async (request) => {
            const result = await client.chat.completions.parse({
              model: "gpt-5.6-sol",
              store: false,
              service_tier: "default",
              max_completion_tokens: 4000,
              messages: [
                { role: "system", content: request.system },
                { role: "user", content: request.data },
              ],
              response_format: request.response_format,
            });
            trace.push({
              stage: request.stage,
              parsed: result.choices[0]?.message.parsed,
              usage: result.usage,
            });
            writeFileSync(
              root + "/canary-trace.json",
              JSON.stringify(trace, null, 2)
            );
            return {
              value: result.choices[0]?.message.parsed,
              usage: {
                input: result.usage?.prompt_tokens ?? 0,
                output: result.usage?.completion_tokens ?? 0,
              },
            };
          }
        );
      } catch (error) {
        const e = error as {
          code?: string;
          status?: number;
          detail?: unknown;
          name?: string;
          message?: string;
        };
        writeFileSync(
          root + "/canary-result.json",
          JSON.stringify(
            {
              approved: false,
              code: e.code ?? "PROVIDER_OR_VALIDATION_FAILED",
              error_type: e.name,
              validation_code: /^[A-Z_]+$/.test(e.message ?? "")
                ? e.message
                : null,
              http_status: e.status ?? null,
              detail: e.detail ?? null,
            },
            null,
            2
          )
        );
        throw Error(
          "Canary did not produce an approved package. See local sanitized result."
        );
      }
      const selection = selectSocialTemplate({
        submission: pack.submission,
        recentPosts: [],
        idempotencyKey: "cloud-editorial-canary-v1",
      });
      const { downloadPublicImage } = await import("@/lib/social/public-media");
      pack.preview = await renderSocialPost(
        { postId: "editorial-canary", submission: pack.submission, selection },
        {
          downloadImage: downloadPublicImage,
          storeAsset: async (input) => {
            const file = `slide-${input.order}.jpg`;
            writeFileSync(root + "/" + file, input.buffer);
            return {
              order: input.order,
              url: file,
              alt_text: input.altText,
              sha256: createHash("sha256").update(input.buffer).digest("hex"),
              width: 1080,
              height: 1350,
              bytes: input.buffer.length,
              content_type: "image/jpeg",
              storage_key: file,
            };
          },
        }
      );
      writeFileSync(
        root + "/canary-result.json",
        JSON.stringify({ approved: true, selection, package: pack }, null, 2)
      );
      expect(pack.preview.length).toBe(pack.submission.content.slides.length);
    }, 180000);
  }
);
