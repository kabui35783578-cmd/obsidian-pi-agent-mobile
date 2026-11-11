import test from "node:test";
import assert from "node:assert/strict";
import { readPhoneFile } from "./local-file.ts";

test("reads supported UTF-8 files and images", async () => {
  assert.deepEqual(await readPhoneFile(new File(["你好"], "note.md")), { kind: "text", name: "note.md", text: "你好" });
  assert.deepEqual(await readPhoneFile(new File([new Uint8Array([1, 2, 3])], "photo.png")), { kind: "image", name: "photo.png", data: "AQID" });
  assert.equal((await readPhoneFile(new File([new Uint8Array([251, 255])], "photo.jpg")) as any).data, "+/8=");
});

test("rejects unsupported, oversized and invalid files without silently truncating", async () => {
  await assert.rejects(readPhoneFile(new File(["hi"], "book.pdf")), /暂支持/);
  await assert.rejects(readPhoneFile(new File(["a".repeat(80001)], "note.txt")), /80000/);
  await assert.rejects(readPhoneFile(new File([new Uint8Array(1024 * 1024 + 1)], "large.png")), /1 MiB/);
  await assert.rejects(readPhoneFile(new File([new Uint8Array([255])], "bad.txt")));
});
