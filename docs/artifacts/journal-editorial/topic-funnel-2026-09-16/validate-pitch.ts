import { readFileSync, writeFileSync } from "node:fs";
import { JournalPitchError, prepareJournalPitch } from "@/lib/journal/editorial/pitch";
import { trendSignalRow } from "@/lib/journal/editorial/radar/signals";

// Runs a rehearsal pitch through OPS's own pitch validation against the live
// radar rows it was chosen from, exactly as the pitch route would.
const [pitchFile, scanFile, contextFile, outFile] = process.argv.slice(2);
const scan = JSON.parse(readFileSync(scanFile, "utf8"));
const context = JSON.parse(readFileSync(contextFile, "utf8"));
const rows = (scan.rows as Array<Record<string, unknown>>).map((row) => trendSignalRow(row));
try {
  const pitch = prepareJournalPitch(JSON.parse(readFileSync(pitchFile, "utf8")), {
    signals: new Map(rows.map((row) => [row.id, row])),
    radarSignalsAvailable: rows.length,
    radarScannedAt: scan.scanned_at,
    livePosts: context.recent_posts,
    now: new Date(),
  });
  writeFileSync(outFile, JSON.stringify(pitch, null, 2));
  console.log(`ACCEPTED ${pitch.headline} · ${pitch.signals.length} signals · ${pitch.chatter.length} search results · ${pitch.hooks_considered.length} headlines weighed · ${pitch.runners_up.length} runners-up`);
} catch (error) {
  if (error instanceof JournalPitchError) console.log("REJECTED", error.code, JSON.stringify(error.issues, null, 2));
  else throw error;
}
