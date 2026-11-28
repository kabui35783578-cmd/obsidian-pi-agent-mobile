import { build } from "esbuild";
import * as fs from "node:fs/promises";
const marker = "/* Phone companion (source: src/mobile/mobile.css). */";
const styles = await fs.readFile("styles.css", "utf8");
if (!styles.includes(marker)) throw Error("Phone CSS marker missing");
const mobileCss = await fs.readFile("src/mobile/mobile.css", "utf8");
const todayFont = await fs.readFile("src/mobile/assets/dm-sans-latin.woff2");
const todayFontLicense = await fs.readFile("licenses/dm-sans-OFL.txt", "utf8");
const bundledCss = mobileCss.replace(
  'url("./assets/dm-sans-latin.woff2")',
  'url("data:font/woff2;base64,' + todayFont.toString("base64") + '")',
);
await fs.writeFile("styles.css", styles.slice(0, styles.indexOf(marker)) + marker + "\n/*\n" +
  todayFontLicense.replaceAll("*/", "* /").trimEnd() + "\n*/\n" + bundledCss);
const meta = await build({
  entryPoints: ["src/mobile/main.ts"],
  banner: { js: "/*\n" + (await Promise.all(["relay-notices.txt", "office-fflate-MIT.txt", "office-fast-xml-parser-MIT.txt", "office-strnum-MIT.txt", "office-anynum-MIT.txt", "NX_emotion-ball-LICENSE.txt"].map(name => fs.readFile("licenses/" + name, "utf8")))).join("\n\n").replaceAll("*/", "* /") + "\nNX_emotion-ball source: https://github.com/jackyrx/NX_emotion-ball\n*/" },
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
