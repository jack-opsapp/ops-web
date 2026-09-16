import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { journalFeedFetcher } from "@/lib/journal/editorial/radar/fetch";
import { scanJournalRadar, isJournalRadarDegraded } from "@/lib/journal/editorial/radar/scan";
import { selectClaimSignals } from "@/lib/journal/editorial/radar/signals";

async function main() {
  const now = new Date();
  const started = Date.now();
  const scan = await scanJournalRadar(journalFeedFetcher(), now);
  const ms = Date.now() - started;
  const rows = scan.signals.map((signal) => ({ ...signal, id: randomUUID() }));
  const claim = selectClaimSignals(rows, now);
  writeFileSync(process.argv[2], JSON.stringify({ scanned_at: now.toISOString(), ms, sources: scan.sources, signals: scan.signals.length, rows, claim }, null, 2));
  console.log(`scan ${ms} ms, ${scan.sources.filter((s) => s.ok).length}/${scan.sources.length} feeds ok, ${scan.signals.length} signals, claim carries ${claim.length}, degraded=${isJournalRadarDegraded(scan.sources)}`);
  for (const source of scan.sources) console.log(`${source.ok ? "OK  " : "FAIL"} ${source.sphere.padEnd(10)} ${source.name.padEnd(24)} items=${source.items} ${source.code ?? ""}`);
  console.log("--- strongest videos by momentum");
  for (const s of [...claim].filter((x) => x.kind === "video").sort((a, b) => (b.momentum ?? 0) - (a.momentum ?? 0)).slice(0, 12))
    console.log(`${String(s.momentum).padStart(6)}x  ${String(s.views).padStart(8)} views  ${s.source.padEnd(20)} ${s.title.slice(0, 80)}`);
  console.log("--- loudest threads");
  for (const s of claim.filter((x) => x.kind === "thread").slice(0, 6)) console.log(`${String(s.replies).padStart(4)} replies  ${s.title.slice(0, 90)}`);
}
main().catch((error) => { console.error(error); process.exit(1); });
