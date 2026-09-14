// Focused semantic check: includes real dependency types, but checks only the
// changed vertical. The repository-wide tsc exhausted its 4 GB heap.
import ts from "typescript";
import { execFileSync } from "node:child_process";
import path from "node:path";

const base = process.argv[2] ?? "HEAD";
const changed = [
  ...new Set([
    ...execFileSync("git", ["diff", "--name-only", base], {
      encoding: "utf8",
    })
      .trim()
      .split("\n"),
    ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n"),
  ]),
].filter((file) => /\.(ts|tsx)$/.test(file));
if (!changed.length)
  throw new Error(
    "No changed sources. Pass the repair's base commit to check committed changes."
  );
const configFile = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  process.cwd()
);
const program = ts.createProgram([...changed, "tests/setup.ts"], {
  ...config.options,
  incremental: false,
});
const diagnostics = [
  ...program.getOptionsDiagnostics(),
  ...changed.flatMap((file) => {
    const source = program.getSourceFile(path.resolve(file));
    if (!source) throw new Error(`Missing changed source: ${file}`);
    return [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ];
  }),
];
if (diagnostics.length) {
  process.stdout.write(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => process.cwd(),
      getCanonicalFileName: (name) => name,
      getNewLine: () => "\n",
    })
  );
}
process.stdout.write(
  `Checked ${changed.length} changed TypeScript files: ${diagnostics.length} diagnostics.\n`
);
process.exitCode = diagnostics.length ? 1 : 0;
