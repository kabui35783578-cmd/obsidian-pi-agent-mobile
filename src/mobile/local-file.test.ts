import test from "node:test";
import assert from "node:assert/strict";
import { readPhoneFile } from "./local-file.ts";
import { zipSync, strToU8 } from "fflate";

test("reads Office documents using the desktop extraction rules", async () => {
  const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries({"[Content_Types].xml": "<Types/>", ...files}).map(([k,v]) => [k, strToU8(v)])));
  const cases: [string, Record<string, string>, string][] = [
    ["a.docx", {"word/document.xml": "<document><p><r><t>Word 内容</t></r></p></document>"}, "Word 内容"],
    ["a.xlsx", {"xl/workbook.xml": "<workbook><sheets><sheet name=\"表一\" id=\"r1\"/></sheets></workbook>", "xl/_rels/workbook.xml.rels": "<Relationships><Relationship Id=\"r1\" Target=\"worksheets/sheet1.xml\"/></Relationships>", "xl/worksheets/sheet1.xml": "<worksheet><row><c r=\"A1\"><v>42</v></c></row></worksheet>"}, "42"],
    ["a.pptx", {"ppt/presentation.xml": "<presentation><sldId id=\"r1\"/></presentation>", "ppt/_rels/presentation.xml.rels": "<Relationships><Relationship Id=\"r1\" Target=\"slides/slide1.xml\"/></Relationships>", "ppt/slides/slide1.xml": "<slide><p><r><t>幻灯片</t></r></p></slide>"}, "幻灯片"],
  ];
  for (const [name, files, expected] of cases) {
    const result = await readPhoneFile(new File([new Uint8Array(zip(files)).buffer], name));
    assert.equal(result.kind, "text");
    assert.match((result as {text:string}).text, new RegExp(expected));
  }
  await assert.rejects(readPhoneFile(new File(["bad"], "bad.docx")));
  await assert.rejects(readPhoneFile(new File(["old"], "old.doc")), /另存为/);
});

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
