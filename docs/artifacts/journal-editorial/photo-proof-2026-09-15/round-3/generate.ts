// Round 3 of the photograph house-style proof, after Jackson's review of
// round 1 (too saturated, cliché trades dress, wrong house): real residential
// jobs, crews dressed as they really dress, faded matte film grade. Generated
// through the exact production path. About US$0.05 per frame.
//
//   OPENAI_API_KEY=… npx tsx --conditions=react-server \
//     docs/artifacts/journal-editorial/photo-proof-2026-09-15/round-3/generate.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildJournalImagePrompt, generateJournalImage } from "@/lib/journal/editorial/image";
import { openAIJournalImageGenerator } from "@/lib/journal/editorial/runtime";

const here = join(process.cwd(), "docs/artifacts/journal-editorial/photo-proof-2026-09-15/round-3");

const directions: Array<{ name: string; direction: string }> = [
  {
    name: "01-backyard-deck-through-the-door",
    direction:
      "Soft late-morning daylight on a pleasant September day behind an ordinary 1970s split-level. Seen from inside the bright kitchen through the open sliding door, so the door frame and a linen curtain edge frame the scene: a half-framed backyard deck of new joists, and one builder in faded jeans, a plain grey t-shirt and a worn ball cap kneeling on the joists driving a screw, back three-quarters to the camera, absorbed. He sits on the right third; the pale sky, a maple just turning and the neighbour's cedar fence take the rest. Warm, calm, gently desaturated, clean matte light.",
  },
  {
    name: "02-truck-at-the-curb-midday",
    direction:
      "A well-used work truck parked at the curb of a quiet, tidy suburban street at midday, ladder on the rack, tailgate down with a coiled hose and a five-gallon bucket, nobody around. Tree-lined street, trimmed lawns, an ordinary well-kept house behind. Shot from across the street at knee height with a long lens; the truck holds the right third, the empty sunlit road and a tree's shade take the left. Warm, refined daylight, soft contrast, colour pulled back, the calm of a street where work is quietly getting done.",
  },
  {
    name: "03-primer-in-the-front-room",
    direction:
      "Inside the front room of a small bungalow being repainted, big daylight from a bay window on the left. A painter in a dusty hoodie and ball cap rolls warm cream primer onto the far wall, mid-stroke, seen from behind and a little below, small on the right third. A canvas drop cloth covers the oak floor and a paint tray and roller sit sharp in the near foreground; the window light lays a soft warm shape across the cloth. Gently desaturated, warm, calm, a refined editorial interior.",
  },
  {
    name: "04-lumber-on-the-driveway-monochrome",
    direction:
      "Black and white, clean and warm-toned. Late-afternoon sun rakes across a stack of new lumber and a wheelbarrow on the driveway of a modest two-storey house, long soft shadows running toward the garage; nobody in the frame. Composed low from the sidewalk so the stack runs as a diagonal from the lower left toward the open garage door, the house clean and ordinary in the upper half against a bright sky. Fine grain, gentle contrast, a still, curated frame.",
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
      "# Photograph proof, round 3 (2026-09-15)",
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
