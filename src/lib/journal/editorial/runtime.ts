import "server-only";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { getEditorialOperator } from "../../social/editorial/operator";
import {
  generateJournalImage,
  JOURNAL_IMAGE_MODEL,
  JOURNAL_IMAGE_REQUEST,
  JournalImageError,
  journalImageErrorFrom,
  type JournalImageGenerator,
} from "./image";
import { storeJournalImage } from "./image-store";
import { sendJournalNewsletter } from "./newsletter";
import { fulfilJournalImageRequest, runJournalTick, type JournalTickDependencies } from "./worker";
import { createJournalWorkerRepository } from "./worker-repository";

/** A photograph is only shown to anyone once its URL answers publicly as an image. */
export async function imageIsPublic(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok && (response.headers.get("content-type") ?? "").startsWith("image/");
  } catch {
    return false;
  }
}

// OPS's own OpenAI key, server-side only. A complex image can take two minutes,
// so the request gets 150 s and one retry inside the five-minute function.
export function openAIJournalImageGenerator(env: NodeJS.ProcessEnv = process.env): JournalImageGenerator {
  return async (prompt) => {
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new JournalImageError("IMAGE_NOT_CONFIGURED");
    const client = new OpenAI({ apiKey, timeout: 150_000, maxRetries: 1 });
    try {
      const result = await client.images.generate({
        model: JOURNAL_IMAGE_MODEL,
        prompt,
        n: 1,
        ...JOURNAL_IMAGE_REQUEST,
      });
      const encoded = result.data?.[0]?.b64_json;
      if (!encoded) throw new JournalImageError("IMAGE_FAILED");
      return Buffer.from(encoded, "base64");
    } catch (error) {
      throw journalImageErrorFrom(error);
    }
  };
}

function dependencies(): JournalTickDependencies {
  const generator = openAIJournalImageGenerator();
  return {
    now: () => new Date(),
    // Trimmed and validated: production operator values carry trailing
    // whitespace, and an untrimmed company id fails the notifications check.
    operator: getEditorialOperator(process.env),
    repository: createJournalWorkerRepository(),
    generateImage: (artDirection) => generateJournalImage(artDirection, generator),
    storeImage: (identity, image) => storeJournalImage(identity, image),
    imageReadable: imageIsPublic,
    sendNewsletter: sendJournalNewsletter,
    newToken: () => randomUUID(),
  };
}

// Composition root for the hourly journal tick.
export async function runJournalEditorial() {
  return await runJournalTick(dependencies());
}

/** The Blog hub's NEW PHOTO: fulfils the request just opened, in the same request. */
export async function fulfilJournalImageRequestNow(id: string) {
  const d = dependencies();
  const [row] = (await d.repository.listImageRequests(20)).filter((entry) => entry.id === id);
  if (!row) return null;
  return await fulfilJournalImageRequest(d, row);
}
