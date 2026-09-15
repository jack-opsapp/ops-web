// Round 2 of the photograph house-style proof, after Jackson's review of
// round 1 (too saturated, cliché trades dress, wrong house): real residential
// jobs, crews dressed as they really dress, faded matte film grade. Generated
// through the exact production path. About US$0.05 per frame.
//
//   OPENAI_API_KEY=… npx tsx --conditions=react-server \
//     docs/artifacts/journal-editorial/photo-proof-2026-09-15/round-2/generate.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildJournalImagePrompt, generateJournalImage } from "@/lib/journal/editorial/image";
import { openAIJournalImageGenerator } from "@/lib/journal/editorial/runtime";

const here = join(process.cwd(), "docs/artifacts/journal-editorial/photo-proof-2026-09-15/round-2");

const directions: Array<{ name: string; direction: string }> = [
  {
    name: "01-backyard-deck-through-the-door",
    direction:
      "Overcast late-September morning behind an ordinary 1970s split-level. Seen from inside the dim kitchen through the open sliding door, so the door frame and a curtain edge frame the scene: a half-framed backyard deck of new joists, and one builder in faded jeans, a plain grey t-shirt and a worn ball cap kneeling on the joists driving a screw, back three-quarters to the camera, absorbed. He sits on the right third; the flat grey sky and the neighbour's cedar fence take the rest. Faded matte film look, lifted blacks, muted greens and warm greys, a little haze.",
  },
  {
    name: "02-truck-on-the-cul-de-sac-after-rain",
    direction:
      "A well-used work truck parked on a quiet suburban cul-de-sac at dusk after rain, ladder on the rack, tailgate down with a coiled hose and a five-gallon bucket on it, nobody around. The houses behind are ordinary; one has fresh plywood over a front window. Shot from across the street at knee height so the wet asphalt reflects the last light; the truck holds the right third, the empty wet road the left. Cool faded film grade, low contrast, foggy, porch lights just coming on as small warm points.",
  },
  {
    name: "03-primer-through-the-plastic-monochrome",
    direction:
      "Black and white. Inside a gutted living room of a small bungalow, a doorway hung with translucent plastic sheeting glows with soft north window light from the room beyond. Through the plastic, blurred and small, a painter in a dusty hoodie and ball cap rolls primer onto the far wall, mid-stroke. The plastic fills the centre of the frame and softens everything behind it; a bare subfloor and a paint tray sit sharp in the near foreground. Grainy medium-format film, milky highlights, soft blacks.",
  },
  {
    name: "04-lumber-on-the-front-lawn-in-fog",
    direction:
      "Early morning fog on a suburban street. Stacks of pressure-treated lumber and a wheelbarrow sit on the front lawn of a modest two-storey house, sprinkler mist drifting across; nobody in the frame. Composed low from the sidewalk so the lumber stack runs as a diagonal from the lower left toward the front steps, the house dissolving into fog in the upper half. Faded pastel greens and greys, lifted blacks, fine grain, very little contrast.",
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
      "# Photograph proof, round 2 (2026-09-15)",
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
