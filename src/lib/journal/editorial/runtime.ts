import "server-only";
import { randomUUID } from "node:crypto";
import { getEditorialOperator } from "../../social/editorial/operator";
import { renderJournalHero } from "./hero";
import { storeJournalHero } from "./hero-store";
import { sendJournalNewsletter } from "./newsletter";
import { runJournalTick } from "./worker";
import { createJournalWorkerRepository } from "./worker-repository";

/** A preview is only promised once its image answers publicly as an image. */
export async function heroIsPublic(url: string): Promise<boolean> {
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

// Composition root for the hourly journal tick.
export async function runJournalEditorial() {
  return await runJournalTick({
    now: () => new Date(),
    // Trimmed and validated: production operator values carry trailing
    // whitespace, and an untrimmed company id fails the notifications check.
    operator: getEditorialOperator(process.env),
    repository: createJournalWorkerRepository(),
    renderHero: (heroLine) => renderJournalHero({ heroLine }),
    storeHero: (identity, hero) => storeJournalHero(identity, hero),
    heroReadable: heroIsPublic,
    sendNewsletter: sendJournalNewsletter,
    newToken: () => randomUUID(),
  });
}
