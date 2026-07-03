import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";

XLSX.set_fs(fs);

const source = XLSX.readFile("export_20260612_1020.xlsx", { raw: true });
const sheetName = source.SheetNames[0];
const matrix = XLSX.utils.sheet_to_json(source.Sheets[sheetName], {
  header: 1,
  defval: "",
  raw: true,
  blankrows: false,
});

const headers = matrix[0];
const template = matrix[1];
const index = Object.fromEntries(headers.map((header, position) => [header, position]));

function makeRow({ name, permalink, storyId, ageMax, budget }) {
  const row = [...template];
  while (row.length < headers.length) row.push("");
  const postId = permalink.match(/\/reel\/(\d+)/)?.[1] || "";

  const values = {
    "Ad Name": name,
    "Ad Status": "PAUSED",
    "Ad Set Name": name,
    "Ad Set Run Status": "PAUSED",
    "Age Min": 18,
    "Age Max": ageMax,
    "Campaign ID": "",
    "Campaign Name": "Test Traffic 2026",
    "Campaign Status": "PAUSED",
    "Campaign Daily Budget": budget,
    Permalink: permalink,
    "Video ID": `v:${postId}`,
    "Story ID": `s:${storyId}`,
    "Preview Link": "",
    "Instagram Preview Link": "",
  };

  for (const [header, value] of Object.entries(values)) row[index[header]] = value;
  return row;
}

const outputRows = [
  makeRow({
    name: "Test Reel 01",
    permalink: "https://www.facebook.com/reel/1571158507913865/",
    storyId: "122298607982194212",
    ageMax: 45,
    budget: 50000,
  }),
  makeRow({
    name: "Test Reel 02",
    permalink: "https://www.facebook.com/reel/992458136983395/",
    storyId: "122298607766194212",
    ageMax: 45,
    budget: 50000,
  }),
];

const outputBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  outputBook,
  XLSX.utils.aoa_to_sheet([headers, ...outputRows]),
  sheetName,
);

const outputPath = path.join(os.tmpdir(), "meta-ads-export-verification.xlsx");
XLSX.writeFile(outputBook, outputPath, { compression: true });

const resultBook = XLSX.readFile(outputPath, { raw: true });
const result = XLSX.utils.sheet_to_json(resultBook.Sheets[sheetName], {
  header: 1,
  defval: "",
  raw: true,
  blankrows: false,
});

assert.equal(result[0].length, 457);
assert.equal(result.length, 3);
assert.equal(result[1][index["Campaign ID"]], "");
assert.equal(result[1][index["Campaign Daily Budget"]], 50000);
assert.equal(result[1][index["Age Min"]], 18);
assert.equal(result[1][index["Age Max"]], 45);
assert.equal(result[1][index["Video ID"]], "v:1571158507913865");
assert.equal(result[2][index["Video ID"]], "v:992458136983395");
assert.equal(
  result[1][index["Story ID"]],
  "s:122298607982194212",
);
assert.equal(result[1][index["Link Object ID"]], template[index["Link Object ID"]]);
assert.equal(
  result[1][index["Instagram Account ID"]],
  template[index["Instagram Account ID"]],
);

fs.rmSync(outputPath);
console.log("Verified: 457 headers, 2 ads, IDs cleared, editable fields updated.");
