import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../components/BatchImportClient.tsx", import.meta.url),
  "utf8",
);

test("batch composer renders one textarea bound directly to the full draft", () => {
  const composerStart = source.indexOf("{/* Batch composer stays focused on source links. */}");
  const composerEnd = source.indexOf("</div>\n      </div>\n    );", composerStart);
  const composer = source.slice(composerStart, composerEnd);

  assert.match(composer, /value=\{urlText\}/);
  assert.match(composer, /setUrlText\(event\.target\.value\)/);
  assert.equal((composer.match(/<textarea/g) ?? []).length, 1);
  assert.doesNotMatch(composer, /Nhóm \{/);
});

test("batch composer height is capped and long lists scroll internally", () => {
  assert.match(source, /Math\.min\(22, Math\.max\(10, lineCount \+ 2\)\)/);
  assert.match(source, /rows=\{composerRows\}/);
  assert.match(source, /overflow-y-auto/);
  assert.doesNotMatch(source, /LINES_PER_COL|handleColChange|colLines|gridCls/);
});
