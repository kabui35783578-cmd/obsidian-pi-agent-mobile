import { build } from "esbuild";
import * as fs from "node:fs/promises";
const marker = "/* Phone companion (source: src/mobile/mobile.css). */";
const styles = await fs.readFile("styles.css", "utf8");
if (!styles.includes(marker)) throw Error("Phone CSS marker missing");
await fs.writeFile("styles.css", styles.slice(0, styles.indexOf(marker)) + marker + "\n" + await fs.readFile("src/mobile/mobile.css", "utf8"));
const meta = await build({
  entryPoints: ["src/mobile/main.ts"],
  banner: { js: "/*\n" + (await fs.readFile("licenses/relay-notices.txt", "utf8")).replaceAll("*/", "* /") + "\n*/" },
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
