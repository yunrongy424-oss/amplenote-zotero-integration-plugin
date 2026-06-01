import assert from "node:assert/strict";
import test from "node:test";
import pluginFactory from "../src/plugin.js";
import {
  buildZoteroApiUrl,
  dedupeItems,
  formatBibliographyEntry,
  formatCitation,
  parseZoteroInput,
  renderItemNote,
  renderLibraryMarkdown,
} from "../src/zotero.js";

test("parseZoteroInput normalizes Zotero JSON item data", () => {
  const [item] = parseZoteroInput(JSON.stringify({
    data: {
      key: "ABC123",
      itemType: "journalArticle",
      title: "Knowledge Tools",
      date: "2024-03-02",
      publicationTitle: "Journal of Notes",
      DOI: "10.1234/example",
      creators: [{ firstName: "Ada", lastName: "Lovelace", creatorType: "author" }],
      tags: [{ tag: "research" }],
      attachments: [{ data: { key: "PDF1", title: "Full Text PDF", contentType: "application/pdf", url: "https://example.com/paper.pdf" } }],
    },
  }));

  assert.equal(item.key, "ABC123");
  assert.equal(item.creators[0].lastName, "Lovelace");
  assert.equal(item.attachments[0].mimeType, "application/pdf");
  assert.deepEqual(item.tags, ["research"]);
});

test("parseZoteroInput parses BibTeX-ish entries", () => {
  const [item] = parseZoteroInput(`@article{lovelace2024,
    title={Knowledge Tools},
    author={Lovelace, Ada and Hopper, Grace},
    journal={Journal of Notes},
    year={2024},
    doi={10.1234/example}
  }`);

  assert.equal(item.key, "lovelace2024");
  assert.equal(item.title, "Knowledge Tools");
  assert.equal(item.creators.length, 2);
});

test("formatCitation supports author year and locator", () => {
  const citation = formatCitation({
    title: "Knowledge Tools",
    date: "2024",
    creators: [{ firstName: "Ada", lastName: "Lovelace" }, { firstName: "Grace", lastName: "Hopper" }],
  }, { locator: "p. 12" });

  assert.equal(citation, "(Lovelace et al., 2024, p. 12)");
});

test("formatBibliographyEntry prefers DOI links over URL", () => {
  const entry = formatBibliographyEntry({
    title: "Knowledge Tools",
    date: "2024",
    publicationTitle: "Journal of Notes",
    DOI: "10.1234/example",
    url: "https://example.com",
    creators: [{ firstName: "Ada", lastName: "Lovelace" }],
  });

  assert.equal(entry, "Ada Lovelace (2024). Knowledge Tools. Journal of Notes. https://doi.org/10.1234/example");
});

test("dedupeItems merges duplicate items and attachments by DOI", () => {
  const items = dedupeItems(parseZoteroInput(JSON.stringify([
    { key: "A", title: "Same", DOI: "10.1/x", tags: [{ tag: "a" }], attachments: [{ key: "PDF", title: "PDF" }] },
    { key: "B", title: "Same", DOI: "10.1/x", tags: [{ tag: "b" }], attachments: [{ key: "PDF", title: "PDF" }, { key: "SNAP", title: "Snapshot" }] },
  ])));

  assert.equal(items.length, 1);
  assert.deepEqual(items[0].tags, ["a", "b"]);
  assert.equal(items[0].attachments.length, 2);
});

test("renderItemNote creates an Amplenote-ready rich research note", () => {
  const markdown = renderItemNote({
    title: "Knowledge Tools",
    date: "2024",
    abstractNote: "A paper about notes.",
    creators: [{ firstName: "Ada", lastName: "Lovelace" }],
    tags: [{ tag: "research" }],
    attachments: [{ title: "PDF", url: "https://example.com/paper.pdf", mimeType: "application/pdf" }],
  });

  assert.match(markdown, /^# Knowledge Tools/);
  assert.match(markdown, /\| Citation \| \(Lovelace, 2024\) \|/);
  assert.match(markdown, /\[PDF\]\(https:\/\/example.com\/paper.pdf\)/);
  assert.match(markdown, /#research/);
});

test("renderLibraryMarkdown lists citation links for deduped items", () => {
  const markdown = renderLibraryMarkdown(parseZoteroInput(JSON.stringify([
    { title: "Alpha", date: "2024", creators: [{ firstName: "Ada", lastName: "Lovelace" }] },
    { title: "Alpha", date: "2024", creators: [{ firstName: "Ada", lastName: "Lovelace" }] },
  ])));

  assert.equal(markdown.match(/\[\[Alpha\]\]/g).length, 1);
});

test("buildZoteroApiUrl builds public or authenticated Zotero API paths without storing secrets", () => {
  assert.equal(
    buildZoteroApiUrl({ libraryType: "groups", libraryId: "12345" }, "items?format=json"),
    "https://api.zotero.org/groups/12345/items?format=json",
  );
  assert.throws(() => buildZoteroApiUrl({}, "items"), /library id/);
});

test("open library preview uses the Amplenote sidebar embed signature with fallback", async () => {
  const plugin = pluginFactory();
  let sidebarArgs;
  let embedArgs;

  await plugin.appOption["Zotero: open library preview"]({
    async openSidebarEmbed(...args) {
      sidebarArgs = args;
      return false;
    },
    async openEmbed(args) {
      embedArgs = args;
    },
  });

  assert.deepEqual(sidebarArgs, [1.2, { id: "zotero-library" }]);
  assert.deepEqual(embedArgs, { id: "zotero-library" });
});

test("fetch public/API-key library sends temporary key without storing it", async () => {
  const plugin = pluginFactory();
  const settings = {};
  const settingWrites = [];
  const originalFetch = globalThis.fetch;
  let fetchRequest;

  globalThis.fetch = async (url, options) => {
    fetchRequest = { url, options };
    return {
      ok: true,
      async text() {
        return JSON.stringify([{ key: "FETCHED1", title: "Fetched Paper", creators: [] }]);
      },
    };
  };

  try {
    await plugin.appOption["Zotero: fetch public/API-key library"]({
      settings,
      async prompt() {
        return ["users", "42", "runtime-api-key"];
      },
      async setSetting(key, value) {
        settings[key] = value;
        settingWrites.push([key, value]);
      },
      async alert() {},
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchRequest.url, "https://api.zotero.org/users/42/items?format=json&include=data&limit=100");
  assert.equal(fetchRequest.options.headers["Zotero-API-Key"], "runtime-api-key");
  assert.equal(settings["Zotero Library Type"], "users");
  assert.equal(settings["Zotero Library ID"], "42");
  assert.match(settings["Zotero Imported Items"], /Fetched Paper/);
  assert.equal(JSON.stringify(settings).includes("runtime-api-key"), false);
  assert.equal(settingWrites.some(([key]) => key.toLowerCase().includes("api")), false);
});

test("rendered preview exposes import, fetch, and export actions", async () => {
  const plugin = pluginFactory();
  const html = await plugin.renderEmbed({
    settings: {
      "Zotero Imported Items": JSON.stringify([{
        key: "A1",
        itemType: "journalArticle",
        title: "Previewed Paper",
        creators: [],
        date: "",
        publicationTitle: "Journal",
        abstractNote: "",
        url: "",
        doi: "",
        tags: [],
        attachments: [],
        notes: [],
      }]),
    },
    context: { lightDarkMode: "light" },
  });

  assert.match(html, /data-action="pasteImport"/);
  assert.match(html, /data-action="fetchItems"/);
  assert.match(html, /data-action="exportItem"/);
  assert.doesNotMatch(html, /\u8def DOI/);
});

test("plugin opens sidebar preview with documented args and full-embed fallback", async () => {
  const plugin = pluginFactory();
  const calls = [];
  const app = {
    async openSidebarEmbed(aspectRatio, args) {
      calls.push(["sidebar", aspectRatio, args]);
      return false;
    },
    async openEmbed(args) {
      calls.push(["embed", args]);
    },
  };

  await plugin.appOption["Zotero: open library preview"](app);

  assert.deepEqual(calls, [
    ["sidebar", 1.2, { id: "zotero-library" }],
    ["embed", { id: "zotero-library" }],
  ]);
});

test("fetchZoteroItems uses temporary API key without storing it", async () => {
  const plugin = pluginFactory();
  const settings = {};
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return { ok: true, async text() { return "[]"; } };
  };
  const app = {
    settings,
    async prompt() {
      return ["users", "12345", "secret-key"];
    },
    async setSetting(key, value) {
      settings[key] = value;
    },
    async alert() {},
  };

  try {
    await plugin.appOption["Zotero: fetch public/API-key library"](app);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls[0].options.headers["Zotero-API-Key"], "secret-key");
  assert.equal(settings["Zotero Library Type"], "users");
  assert.equal(settings["Zotero Library ID"], "12345");
  assert.equal(Object.values(settings).includes("secret-key"), false);
});
