// Proof of the journal photograph house style against the real image model:
// three art directions written to the brief's rules, generated through the
// exact production path (openAIJournalImageGenerator → generateJournalImage),
// saved here for review. Runs on OPS's OpenAI key; about US$0.05 per frame.
//
//   OPENAI_API_KEY=… npx tsx --conditions=react-server \
//     docs/artifacts/journal-editorial/photo-proof-2026-09-15/generate.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildJournalImagePrompt, generateJournalImage } from "@/lib/journal/editorial/image";
import { openAIJournalImageGenerator } from "@/lib/journal/editorial/runtime";

const here = join(process.cwd(), "docs/artifacts/journal-editorial/photo-proof-2026-09-15");

const directions: Array<{ name: string; direction: string }> = [
  {
    name: "01-job-costing-adjacent",
    direction:
      "Late afternoon in a small deck builder's open garage bay in early autumn. In the sharp foreground a folded, creased bid sheet and a carpenter's pencil rest on the edge of a plywood workbench dusted with sawdust; behind them, softer, a stack of cedar decking and the open bay door framing a work truck backed into low western sun. The bench edge runs as a leading line from the lower left toward the truck. The sheet sits on the left third; the upper right of the frame is soft, empty, warm light. Available light only, muted warmth, fine grain. Nobody in the frame.",
  },
  {
    name: "02-framer-candid",
    direction:
      "First light on a half-sheathed roof deck. A framer in a worn canvas jacket and a hard hat kneels near the eave, a chalk line stretched taut between his hands, head down and absorbed in snapping it. Shot from the far end of the deck with a long lens so the trusses behind him stack into layers and the ridge line runs across the frame. He holds the right third; the empty overcast sky takes the left two-thirds. Cool grey dawn, muted colour, restrained contrast. He never looks toward the camera.",
  },
  {
    name: "03-service-road-monochrome",
    direction:
      "Black and white. A gravel service road curves through a cut in a Fraser Valley hillside in autumn fog, a single work truck small at the bend on the lower left third, its lights off, a line of power poles marching into the mist as a leading line toward the upper right. Composed as a landscape: dry grass in the foreground, the road in the mid-ground, the ridge dissolving into fog behind. Soft flat light, deep detailed greys, no crushed blacks.",
  },
];

async function main() {
  const generate = openAIJournalImageGenerator();
  const report: string[] = [];
  for (const entry of directions) {
    const started = Date.now();
    try {
      const image = await generateJournalImage(entry.direction, generate);
      const file = `${entry.name}.jpg`;
      writeFileSync(join(here, file), image.buffer);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      report.push(`${file}\t${image.width}x${image.height}\t${image.buffer.byteLength} bytes\t${seconds}s\t${image.model}`);
      console.log(report[report.length - 1]);
    } catch (error) {
      const code = (error as { code?: string }).code ?? String(error);
      report.push(`${entry.name}\tFAILED\t${code}`);
      console.log(report[report.length - 1]);
    }
  }
  writeFileSync(
    join(here, "prompts.md"),
    [
      "# Photograph proof prompts (2026-09-15)",
      "",
      "Each prompt below is exactly what OPS sent: the writer's art direction, then the fixed house style.",
      "",
      ...directions.flatMap((entry) => [`## ${entry.name}`, "", "```text", buildJournalImagePrompt(entry.direction), "```", ""]),
      "## Results",
      "",
      "```text",
      ...report,
      "```",
      "",
    ].join("\n")
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
