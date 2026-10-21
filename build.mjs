import { build } from "esbuild";
import * as fs from "node:fs/promises";
const meta = await build({
  entryPoints: ["src/mobile/main.ts"],
  bundle: true,
  outfile: "main.js",
  platform: "browser",
  format: "cjs",
  target: "es2022",
  external: ["obsidian"],
  metafile: true,
  logLevel: "info",
});
for (const input of Object.keys(meta.metafile.inputs))
  if (/^src\/(runner|core|remote)\//.test(input) || input === "src/plugin/main.ts")
    throw Error("Desktop code leaked into mobile: " + input);
for (const output of Object.values(meta.metafile.outputs))
  if (output.imports.some((item) => item.path !== "obsidian"))
    throw Error("Mobile bundle must only import Obsidian");
await fs.mkdir(".artifacts", { recursive: true });
await fs.writeFile(".artifacts/build-meta.json", JSON.stringify(meta.metafile, null, 2));
