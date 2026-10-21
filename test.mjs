import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
const bundle = await fs.readFile("main.js", "utf8");
test("BRAT three-file entry loads with only the Obsidian API", () => {
  const module = { exports: {} };
  const calls = [];
  const api = { Plugin: class {}, ItemView: class {}, Modal: class {}, PluginSettingTab: class {} };
  runInNewContext(bundle, {
    module, exports: module.exports, crypto: webcrypto,
    require(name) { calls.push(name); assert.equal(name, "obsidian"); return api; },
  });
  const plugin = new module.exports.default();
  assert.ok(plugin.client);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((name) => name === "obsidian"));
});
test("six default avatars are embedded and need no extra downloaded files", () => {
  const images = [...bundle.matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)];
  assert.equal(images.length, 6);
  for (const [, data] of images) assert.match(Buffer.from(data, "base64").toString(), /^<svg/);
});
test("mobile manifest and release metadata agree", async () => {
  const manifest = JSON.parse(await fs.readFile("manifest.json", "utf8"));
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
  const versions = JSON.parse(await fs.readFile("versions.json", "utf8"));
  assert.equal(manifest.id, "pi-agent-mobile");
  assert.equal(manifest.isDesktopOnly, false);
  assert.equal(manifest.version, pkg.version);
  assert.equal(versions[manifest.version], manifest.minAppVersion);
});
