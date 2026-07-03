import assert from "node:assert/strict";
import fs from "node:fs";
import * as XLSX from "xlsx";

XLSX.set_fs(fs);

function readTemplate(file) {
  const workbook = XLSX.readFile(file, { raw: true });
  const matrix = XLSX.utils.sheet_to_json(
    workbook.Sheets[workbook.SheetNames[0]],
    { header: 1, defval: "", raw: true, blankrows: false },
  );
  return { headers: matrix[0], row: matrix[1] };
}

const video = readTemplate("export_20260612_1020.xlsx");
const status = readTemplate("export_20260612_1448.xlsx");
const index = Object.fromEntries(status.headers.map((header, position) => [header, position]));

assert.deepEqual(status.headers, video.headers);
assert.equal(status.headers.length, 457);
assert.equal(status.row[index["Creative Type"]], "Status Page Post Ad");
assert.equal(status.row[index["Video ID"]], "");
assert.match(String(status.row[index.Permalink]), /\/posts\/pfbid/i);
assert.ok(status.row[index["Story ID"]]);

console.log("Verified: image/carousel template has 457 matching columns and no Video ID.");
