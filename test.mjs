import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
const bundle = await fs.readFile("main.js", "utf8");
test("BRAT three-file entry loads with only the Obsidian API", () => {
  const module = { exports: {} };
  const calls = [];
  const api = { Plugin: class {}, Component: class {}, ItemView: class {}, Modal: class {}, PluginSettingTab: class {} };
  runInNewContext(bundle, {
    module, exports: module.exports, crypto: webcrypto, TextEncoder, TextDecoder,
    require(name) { calls.push(name); assert.equal(name, "obsidian"); return api; },
  });
  const plugin = new module.exports.default();
  assert.ok(plugin.client);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((name) => name === "obsidian"));
});
test("all 18 desktop avatars are embedded and need no extra downloaded files", () => {
  const images = [...bundle.matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)];
  assert.equal(images.length, 18);
  for (const [, data] of images) assert.match(Buffer.from(data, "base64").toString(), /^<svg/);
});
test("desktop avatar IDs and task expressions resolve in the phone bundle", async () => {
  const { EMOTION_SHAPE_ORDER, EMOTION_COLORS, resolveEmotionAvatar, emotionForProgress } =
    await import("./src/shared/emotion-ball/index.ts");
  for (const { key: shape } of EMOTION_SHAPE_ORDER) {
    for (const { key } of EMOTION_COLORS) {
      const avatar = resolveEmotionAvatar("builtin:" + shape + ":" + key);
      assert.equal(avatar?.shape, shape);
      assert.equal(avatar?.colorKey, key);
    }
  }
  assert.equal(resolveEmotionAvatar("constructor:blue"), null);
  assert.equal(emotionForProgress({ phase: "tool", toolName: "vault_search" }), "40");
  assert.equal(emotionForProgress({ phase: "responding" }), "39");
  assert.match(bundle, /Copyright \(c\) 2026 sam70361/);
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

// A remote pairing must retain relay information; otherwise the client sends HTTP to the relay.
test("remote pairing preserves and validates its relay details", async () => {
  const { encodePairCode, decodePairCode, remoteId, remoteSecret } = await import("./src/shared/mobile-wire.ts");
  const code = { v: 1, endpoint: "https://relay.example", pairId: remoteId(), hostId: remoteId(), secret: remoteSecret(), expiresAt: Date.now() + 60000, relay: { route: "obot-" + remoteId(), key: "A".repeat(43) + "=" } };
  assert.deepEqual(decodePairCode(encodePairCode(code)).relay, code.relay);
  assert.throws(() => decodePairCode(encodePairCode({ ...code, endpoint: "http://relay.example" })), /远程连接资料无效/);
  assert.throws(() => decodePairCode(encodePairCode({ ...code, relay: { ...code.relay, route: "invalid" } })), /远程连接资料无效/);
});
test("shipped stylesheet includes the current phone styles", async () => {
  const marker = "/* Phone companion (source: src/mobile/mobile.css). */";
  const styles = await fs.readFile("styles.css", "utf8");
  const phone = await fs.readFile("src/mobile/mobile.css", "utf8");
  const shipped = styles.slice(styles.indexOf(marker) + marker.length + 1);
  const font = await fs.readFile("src/mobile/assets/dm-sans-latin.woff2");
  const license = (await fs.readFile("licenses/dm-sans-OFL.txt", "utf8")).trimEnd();
  assert.ok(shipped.startsWith("/*\n" + license + "\n*/\n"));
  const data = shipped.match(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/);
  assert.ok(data);
  assert.deepEqual(Buffer.from(data[1], "base64"), font);
  assert.equal(shipped.slice(shipped.indexOf("*/\n") + 3)
    .replace(data[0], "./assets/dm-sans-latin.woff2"), phone);
});

test("Today timeline titles fit one short line and preserve whole characters", async () => {
  const { shortTodayTimelineTitle } = await import("./src/mobile/today-timeline.ts");
  assert.equal(shortTodayTimelineTitle("小红书发布"), "小红书发布");
  assert.equal(shortTodayTimelineTitle("**今天下班以后剪完门店宣传视频**"), "今天下班…");
  assert.equal(shortTodayTimelineTitle("👩‍💻准备发布公告"), "👩‍💻准备发…");
  assert.equal(shortTodayTimelineTitle(" "), "事项");
});

test("a saved streamed stage clears the mobile buffer before the next reply", async () => {
  const { build } = await import("esbuild");
  const output = await build({
    stdin: {
      contents: 'export { MobileChatView } from "./src/mobile/view.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "browser",
    format: "cjs",
    external: ["obsidian"],
    write: false,
  });
  const module = { exports: {} };
  const api = { Plugin: class {}, Component: class {}, ItemView: class {}, Modal: class {}, PluginSettingTab: class {} };
  runInNewContext(output.outputFiles[0].text, {
    module, exports: module.exports, crypto: webcrypto, TextEncoder, TextDecoder,
    require(name) { assert.equal(name, "obsidian"); return api; },
  });

  const view = Object.create(module.exports.MobileChatView.prototype);
  const id = "chat";
  let visible = "";
  let refreshes = 0;
  Object.assign(view, {
    conversation: { id },
    streams: new Map(),
    streamNodes: new Map(),
    delegationViews: new Map(),
    ensureStreamNode() {},
    flushStreams() { visible = this.streams.get(id)?.text ?? ""; },
    updateResponseStatus() {},
    queueRefresh() { refreshes++; },
  });
  const delta = (text, sequence) => view.onEvent({
    type: "chat.delta", conversationId: id, delta: text, remoteSequence: sequence,
  });
  delta("已保存的阶段回复", 100);
  assert.equal(visible, "已保存的阶段回复");
  view.onEvent({ type: "chat.streamReset", conversationId: id, remoteSequence: 101 });
  assert.equal(visible, "");
  delta("迟到的数据", 100);
  assert.equal(visible, "");
  delta("下一段", 102);
  assert.equal(visible, "下一段");
  assert.equal(refreshes, 1);
});
