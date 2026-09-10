import { readFileSync } from "node:fs";
export function nativeDrawing(producer = "ops-ios") {
  return JSON.parse(readFileSync(`${process.cwd()}/src/lib/agent-control-plane/services/p2/deck-design/__fixtures__/${producer}/native-optional-lower-edge.json`, "utf8")).drawing_data;
}
