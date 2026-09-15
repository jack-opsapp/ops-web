// Round 4 of the photograph house-style proof, after Jackson's review of
// round 1 (too saturated, cliché trades dress, wrong house): real residential
// jobs, crews dressed as they really dress, faded matte film grade. Generated
// through the exact production path. About US$0.05 per frame.
//
//   OPENAI_API_KEY=… npx tsx --conditions=react-server \
//     docs/artifacts/journal-editorial/photo-proof-2026-09-15/round-4/generate.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildJournalImagePrompt, generateJournalImage } from "@/lib/journal/editorial/image";
import { openAIJournalImageGenerator } from "@/lib/journal/editorial/runtime";

const here = join(process.cwd(), "docs/artifacts/journal-editorial/photo-proof-2026-09-15/round-4");

const directions: Array<{ name: string; direction: string }> = [
  {
    name: "01-acreage-across-the-valley",
    direction:
      "Seen from across a shallow valley of cut hayfields on a mild September late morning: a modest farmhouse on an acreage, a new deck half-framed on its back, and a work truck tiny in the gravel drive. The house sits small on the lower right third; rolling pale-gold fields lead the eye up to it, and a soft, high, pale sky fills the top two-thirds of the frame. Long lens from far away, everything gently compressed. Warm, calm, muted colour.",
  },
  {
    name: "02-one-roofer-above-the-subdivision",
    direction:
      "From a rise at the edge of a suburb, a long lens looks across a sea of ordinary rooftops toward one house being re-shingled: a single roofer in jeans, t-shirt and ball cap kneels small on the slope, absorbed, with a bundle of shingles beside him. He is barely a figure on the lower left third; the layered rooftops fade into a warm haze and a vast pale sky takes the upper half. Soft midday light, colour pulled back, refined.",
  },
  {
    name: "03-truck-on-the-prairie-road-monochrome",
    direction:
      "Black and white, clean and warm-toned. A long straight rural road runs from the bottom of the frame to a vanishing point, a lone work truck with a ladder on its rack small and alone in the lower third, driving away; flat fields on both sides, a single distant farmhouse, and an enormous bright sky with a few soft clouds taking three-quarters of the frame. Shot from the road's centre with a wide lens. Gentle contrast, fine grain, stillness.",
  },
  {
    name: "04-dock-builder-on-the-lake",
    direction:
      "Early on a still, warm morning at a lakeside cottage: a new dock frame reaches out from the shore and one builder in jeans and a ball cap kneels at its far end fastening a board, a small figure against the water. Shot from up the shoreline with a long lens so the dock runs as a thin line into the frame's lower left, and the calm lake, the far treed shore and a soft hazy sky fill everything else. Warm, muted, refined; the kind of frame that hangs on a wall.",
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
    } catch (error) {
      report.push(`${entry.name}\tFAILED\t${(error as { code?: string }).code ?? String(error)}`);
    }
    console.log(report[report.length - 1]);
  }
  writeFileSync(
    join(here, "prompts.md"),
    [
      "# Photograph proof, round 4 (2026-09-15)",
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
