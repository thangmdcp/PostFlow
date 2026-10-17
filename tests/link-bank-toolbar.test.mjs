import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as imports from "../lib/linkBankImport.ts";
import * as bank from "../lib/linkBank.ts";
import * as jsx from "react/jsx-runtime";

const source = await readFile(new URL("../components/LinkBankPanel.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const url = n => `https://www.facebook.com/reel/${n}`;
const entry = (n, used = false) => ({ id: `entry-${n}`, sourceUrl: url(n), lastUsedAt: used ? "2026-10-16T00:00:00Z" : null, useCount: used ? 1 : 0 });

// Exercise the component's actual handlers/effects against an in-memory API.
// No browser, database, Queue or provider requests are made by these tests.
function fixture({ text = "", saved = "", fail, pendingPick = false } = {}) {
  let cursor = 0, dirty = true, tree, operation = false, endCalls = 0, releasePick;
  const slots = [], effects = [], requests = [], imported = [], storage = new Map([["postflow_selected_link_bank", saved]]);
  let lists = [{ id: "a", name: "Kho A", total: 4, used: 1 }, { id: "b", name: "Kho B", total: 0, used: 0 }];
  const CustomSelect = () => null;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], next => { const value = typeof next === "function" ? next(slots[i]) : next; if (!Object.is(slots[i], value)) { slots[i] = value; dirty = true; } }];
    },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(work, deps) {
      const i = cursor++, prev = slots[i];
      if (!prev || deps.some((dep, index) => !Object.is(dep, prev.deps[index]))) {
        slots[i] = { deps, cleanup: prev?.cleanup };
        effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = work(); });
      }
    },
  };
  const fetchMock = async (path, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    requests.push({ path, method: init?.method || "GET", body });
    if (fail?.(path, init)) return { ok: false, json: async () => ({ error: "Lỗi API thử nghiệm" }) };
    let data;
    if (path.endsWith("/pick")) {
      if (pendingPick) await new Promise(resolve => { releasePick = resolve; });
      data = { entries: [entry(1), entry(2)] };
    } else if (init?.method === "PATCH") {
      const id = path.split("/").at(-1);
      lists = lists.map(l => l.id === id ? { ...l, name: body.name.trim() } : l);
      data = lists.find(l => l.id === id);
    } else if (init?.method === "POST") {
      data = { id: "new", name: body.name, added: body.urls.length, duplicates: 0, invalid: 0, entries: body.urls.map((sourceUrl, i) => ({ ...entry(i + 10), sourceUrl })) };
      lists = [{ id: data.id, name: data.name, total: data.added, used: 0 }, ...lists];
    } else if (path === "/api/link-lists") data = lists;
    else data = { entries: [entry(1), entry(2), entry(3, true)], total: 3 };
    return { ok: true, json: async () => data };
  };
  const documentMock = { body: { style: {}, appendChild() {} }, addEventListener() {}, removeEventListener() {} };
  const requireMock = name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "react-dom") return { createPortal: children => jsx.jsx("portal", { children }) };
    if (name === "lucide-react") return new Proxy({}, { get: (_, key) => key });
    if (name.endsWith("/ui/CustomSelect")) return { CustomSelect };
    if (name.endsWith("/DateRangeFilter")) return { DateRangeFilter: () => null };
    if (name.endsWith("/linkBank")) return bank;
    if (name.endsWith("/linkBankImport")) return imports;
    throw new Error(`Unexpected import ${name}`);
  };
  const exports = {};
  new Function("exports", "require", "fetch", "document", "localStorage", code)(exports, requireMock, fetchMock, documentMock, { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) });
  const props = { connections: [], urlText: text, onImport: (...args) => imported.push(args), beginOperation: () => { if (operation) return false; operation = true; return true; }, endOperation: () => { operation = false; endCalls++; }, children: jsx.jsx("button", { children: "Fetch tất cả" }) };
  function render() { cursor = 0; dirty = false; tree = exports.LinkBankPanel(props); while (effects.length) effects.shift()(); }
  async function settle() { for (let i = 0; i < 24; i++) { if (dirty) render(); await Promise.resolve(); } }
  function nodes(value) {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(nodes);
    return [value, ...nodes(value.props?.children)];
  }
  function label(value) { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(label).join(""); return label(value?.props?.children ?? ""); }
  function find(predicate) { const found = nodes(tree).find(predicate); assert.ok(found, "Expected control not found"); return found.props; }
  const button = name => find(n => n.type === "button" && (n.props["aria-label"] === name || label(n) === name));
  const input = name => find(n => n.type === "input" && n.props["aria-label"] === name);
  const select = name => find(n => n.type === CustomSelect && n.props.ariaLabel === name);
  return { settle, button, input, select, find, requests, imported, storage, props, setDirty: () => { dirty = true; }, get endCalls() { return endCalls; }, get text() { return label(tree); }, release: () => releasePick(), setOperation: value => { operation = value; } };
}

test("toolbar loads banks before opening management and restores the selected bank", async () => {
  const f = fixture({ saved: "b" }); await f.settle();
  assert.equal(f.select("Chọn kho link").value, "b");
  assert.equal(f.input("Số link nhập").value, "20");
  assert.match(f.text, /Còn chỗ cho 200 link/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.button("Nhập link").disabled, false);
});

test("create and rename work inline without opening management or creating a batch", async () => {
  const f = fixture(); await f.settle();
  f.button("Tạo kho").onClick(); await f.settle();
  f.input("Tên kho mới").onChange({ target: { value: "Kho C" } }); await f.settle();
  // Creation is submitted through the inline form (Enter or submit button).
  await f.find(n => n.type === "form").onSubmit({ preventDefault() {} }); await f.settle();
  assert.equal(f.select("Chọn kho link").value, "new");
  assert.equal(f.storage.get("postflow_selected_link_bank"), "new");
  f.button("Đổi tên kho").onClick(); await f.settle();
  f.input("Tên kho").onChange({ target: { value: "Kho C đã đổi" } }); await f.settle();
  f.find(n => n.type === "form").onSubmit({ preventDefault() {} }); await f.settle();
  assert.match(f.select("Chọn kho link").options[0].label, /Kho C đã đổi/);
  assert.equal(f.requests.filter(r => r.method === "POST").length, 1);
  assert.equal(f.requests.filter(r => r.method === "PATCH").length, 1);
  assert.equal(f.requests.some(r => r.path.includes("/api/batches")), false);
});

test("save composer binds provenance and quantity import excludes existing links", async () => {
  const f = fixture({ text: url(1) }); await f.settle();
  f.button("Tạo kho").onClick(); await f.settle();
  f.input("Tên kho mới").onChange({ target: { value: "Kho từ ô nhập" } }); await f.settle();
  await f.button("Lưu ô nhập thành kho").onClick(); await f.settle();
  assert.deepEqual(f.imported[0], [[], [{ entryId: "entry-10", url: url(1), allowUsed: false }], true]);
  f.input("Số link nhập").onChange({ target: { value: "3" } }); await f.settle();
  await f.button("Nhập link").onClick(); await f.settle();
  const request = f.requests.find(r => r.path.endsWith("/pick"));
  assert.deepEqual(request.body, { count: 3, includeUsed: false, excludeUrls: [url(1)] });
  assert.deepEqual(f.imported[1][0], [url(2)]);
  assert.match(f.text, /Chỉ nhập được 1\/3/);
});

test("double click shares an operation lock with Fetch and errors retain the composer", async () => {
  const f = fixture({ text: url(9), pendingPick: true }); await f.settle();
  const click = f.button("Nhập link").onClick;
  const first = click(); const second = click(); await f.settle();
  assert.equal(f.requests.filter(r => r.path.endsWith("/pick")).length, 1);
  assert.equal(f.button("Nhập link").disabled, true);
  f.release(); await Promise.all([first, second]); await f.settle();
  assert.equal(f.endCalls, 1);
  f.setOperation(true); await f.button("Nhập link").onClick(); await f.settle();
  assert.equal(f.requests.filter(r => r.path.endsWith("/pick")).length, 1);
  const failed = fixture({ text: url(9), fail: path => path.endsWith("/pick") }); await failed.settle();
  await failed.button("Nhập link").onClick(); await failed.settle();
  assert.equal(failed.props.urlText, url(9)); assert.equal(failed.imported.length, 0);
  assert.match(failed.text, /Lỗi API thử nghiệm/); assert.equal(failed.endCalls, 1);
});

test("management and toolbar share selection and native selects are removed", async () => {
  const f = fixture(); await f.settle();
  f.button("Quản lý").onClick(); await f.settle();
  f.select("Chọn kho trong quản lý").onChange("b"); await f.settle();
  assert.equal(f.select("Chọn kho link").value, "b");
  assert.equal(f.imported.length, 0);
  assert.doesNotMatch(source, /<select\b/);
  assert.match(source, /createPortal\([\s\S]*document\.body\)/);
  assert.match(source, /max-h-\[calc\(100dvh-2rem\)\]/);
});

test("quantity validation and entry selection retain order, provenance and explicit reuse", () => {
  assert.throws(() => imports.quantityImportRequest(url(1), "0", false));
  assert.throws(() => imports.quantityImportRequest(url(1), "1.5", false));
  assert.throws(() => imports.quantityImportRequest(url(1), "200", false));
  assert.equal(imports.quantityImportRequest("", "200", false).count, 200);
  const rows = [entry(1), entry(2), entry(2), entry(3, true)];
  assert.deepEqual(imports.bankEntriesImport(url(1), rows, false), { urls:[url(2)], selections:[{ entryId:"entry-2",url:url(2),allowUsed:false }] });
  assert.deepEqual(imports.bankEntriesImport(url(1), rows, true).urls, [url(2),url(3)]);
  assert.equal(imports.bankEntriesImport("", [entry(3,true)], true).selections[0].allowUsed, true);
});
