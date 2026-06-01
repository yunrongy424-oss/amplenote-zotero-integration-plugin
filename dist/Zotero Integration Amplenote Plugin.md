# Zotero Integration

| Metadata | Value |
| --- | --- |
| Name | Zotero Integration |
| Description | Import Zotero items, insert citations, export rich research notes, and optionally fetch public/API-key Zotero library data without storing private keys. |
| Author | Bounty implementation |
| Version | 0.1.0 |
| setting | Zotero Imported Items |
| setting | Zotero Library Type |
| setting | Zotero Library ID |

```js
(() => {
const URL_RE = /^https?:\/\//i;

function parseZoteroInput(input) {
  const text = String(input || "").trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) return parseZoteroJson(text);
  return parseBibtex(text);
}

function parseZoteroJson(text) {
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : parsed.items || parsed.results || [parsed];
  return rows
    .map((row) => normalizeZoteroItem(row))
    .filter(Boolean);
}

function normalizeZoteroItem(row) {
  const data = row.data || row;
  if (!data || data.itemType === "attachment") return null;
  const item = {
    key: data.key || row.key || stableKey(data),
    itemType: data.itemType || data.type || "document",
    title: clean(data.title || data.shortTitle || "Untitled"),
    creators: normalizeCreators(data.creators || data.author || data.authors || []),
    date: clean(data.date || data.year || data.issued || ""),
    publicationTitle: clean(data.publicationTitle || data.journalAbbreviation || data.bookTitle || data.publisher || ""),
    abstractNote: clean(data.abstractNote || data.abstract || ""),
    url: clean(data.url || data.DOI && `https://doi.org/${data.DOI}` || ""),
    doi: clean(data.DOI || data.doi || ""),
    tags: normalizeTags(data.tags || []),
    collections: Array.isArray(data.collections) ? data.collections : [],
    attachments: dedupeAttachments(normalizeAttachments(data.attachments || row.attachments || [])),
    notes: normalizeNotes(data.notes || row.notes || []),
    raw: data,
  };
  return item;
}

function parseBibtex(text) {
  const entries = [];
  const regex = /@(\w+)\s*\{\s*([^,]+)\s*,([\s\S]*?)(?=\n@|\s*$)/g;
  let match;
  while ((match = regex.exec(text))) {
    const [, itemType, key, body] = match;
    const fields = {};
    for (const field of body.matchAll(/(\w+)\s*=\s*(?:\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|"([^"]*)")\s*,?/g)) {
      fields[field[1].toLowerCase()] = cleanBibtex(field[2] || field[3] || "");
    }
    entries.push(normalizeZoteroItem({
      key,
      itemType,
      title: fields.title,
      creators: parseBibtexCreators(fields.author || fields.editor || ""),
      date: fields.year || fields.date,
      publicationTitle: fields.journal || fields.booktitle || fields.publisher,
      abstractNote: fields.abstract,
      url: fields.url,
      DOI: fields.doi,
      tags: fields.keywords ? fields.keywords.split(/[,;]/).map((tag) => ({ tag: tag.trim() })) : [],
    }));
  }
  return entries.filter(Boolean);
}

function formatCitation(item, options = {}) {
  const normalized = normalizeZoteroItem(item);
  const author = shortAuthor(normalized.creators);
  const year = publicationYear(normalized.date) || "n.d.";
  const locator = options.locator ? `, ${options.locator}` : "";
  return `(${author}, ${year}${locator})`;
}

function formatBibliographyEntry(item) {
  const normalized = normalizeZoteroItem(item);
  const authors = normalized.creators.length
    ? normalized.creators.map(formatCreator).join(", ")
    : "Unknown author";
  const year = publicationYear(normalized.date) || "n.d.";
  const title = normalized.title.endsWith(".") ? normalized.title : `${normalized.title}.`;
  const container = normalized.publicationTitle ? ` ${normalized.publicationTitle}.` : "";
  const doi = normalized.doi ? ` https://doi.org/${normalized.doi.replace(/^https?:\/\/doi\.org\//i, "")}` : "";
  const url = !doi && normalized.url ? ` ${normalized.url}` : "";
  return `${authors} (${year}). ${title}${container}${doi}${url}`.replace(/\s+/g, " ").trim();
}

function renderItemNote(item) {
  const normalized = normalizeZoteroItem(item);
  const lines = [
    `# ${normalized.title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Citation | ${escapeTable(formatCitation(normalized))} |`,
    `| Bibliography | ${escapeTable(formatBibliographyEntry(normalized))} |`,
    `| Type | ${escapeTable(normalized.itemType)} |`,
    `| Authors | ${escapeTable(normalized.creators.map(formatCreator).join("; ") || "Unknown author")} |`,
    `| Date | ${escapeTable(normalized.date || "n.d.")} |`,
    `| Publication | ${escapeTable(normalized.publicationTitle || "")} |`,
    `| DOI | ${escapeTable(normalized.doi || "")} |`,
    `| URL | ${normalized.url ? `[Open source](${normalized.url})` : ""} |`,
    "",
    "## Abstract",
    "",
    normalized.abstractNote || "_No abstract imported._",
    "",
    "## Attachments",
    "",
  ];
  if (normalized.attachments.length) {
    for (const attachment of normalized.attachments) {
      const target = attachment.url || attachment.path || "";
      lines.push(`- ${target && URL_RE.test(target) ? `[${attachment.title}](${target})` : attachment.title}${attachment.mimeType ? ` _${attachment.mimeType}_` : ""}`);
    }
  } else {
    lines.push("_No attachments imported._");
  }
  lines.push("", "## Notes", "");
  if (normalized.notes.length) {
    normalized.notes.forEach((note) => lines.push(`- ${note}`));
  } else {
    lines.push("_No Zotero notes imported._");
  }
  lines.push("", "## Tags", "", normalized.tags.length ? normalized.tags.map((tag) => `#${slugTag(tag)}`).join(" ") : "_No tags imported._");
  return lines.join("\n");
}

function renderLibraryMarkdown(items) {
  const normalized = dedupeItems(items.map(normalizeZoteroItem).filter(Boolean));
  const lines = ["# Zotero Library Import", ""];
  for (const item of normalized) {
    lines.push(`- ${formatCitation(item)} [[${safeWikiTitle(item.title)}]]`);
    if (item.url || item.doi) lines.push(`  - Source: ${item.url || `https://doi.org/${item.doi}`}`);
    if (item.tags.length) lines.push(`  - Tags: ${item.tags.map((tag) => `#${slugTag(tag)}`).join(" ")}`);
  }
  return lines.join("\n");
}

function dedupeItems(items) {
  const seen = new Map();
  for (const item of items.filter(Boolean)) {
    const key = [item.doi.toLowerCase(), item.key, item.title.toLowerCase()].find(Boolean);
    if (!seen.has(key)) seen.set(key, item);
    else {
      const existing = seen.get(key);
      existing.attachments = dedupeAttachments(existing.attachments.concat(item.attachments || []));
      existing.notes = [...new Set(existing.notes.concat(item.notes || []))];
      existing.tags = [...new Set(existing.tags.concat(item.tags || []))];
    }
  }
  return [...seen.values()];
}

function buildZoteroApiUrl(settings = {}, path = "items") {
  const libraryType = settings.libraryType || "users";
  const libraryId = settings.libraryId || "";
  if (!libraryId) throw new Error("Zotero library id is required");
  const cleanPath = String(path).replace(/^\/+/, "");
  return `https://api.zotero.org/${libraryType}/${encodeURIComponent(libraryId)}/${cleanPath}`;
}

function normalizeCreators(creators) {
  const list = Array.isArray(creators) ? creators : String(creators).split(/\s+and\s+/i);
  return list.map((creator) => {
    if (typeof creator === "string") {
      const parts = creator.split(",").map((part) => part.trim());
      return parts.length > 1 ? { firstName: parts.slice(1).join(" "), lastName: parts[0] } : { firstName: "", lastName: creator.trim() };
    }
    return {
      firstName: clean(creator.firstName || creator.given || ""),
      lastName: clean(creator.lastName || creator.family || creator.name || ""),
      creatorType: creator.creatorType || "author",
    };
  }).filter((creator) => creator.firstName || creator.lastName);
}

function parseBibtexCreators(value) {
  return String(value || "").split(/\s+and\s+/i).filter(Boolean).map((name) => {
    const [lastName, firstName = ""] = name.split(",").map((part) => part.trim());
    return { firstName, lastName };
  });
}

function normalizeAttachments(attachments) {
  return attachments.map((attachment) => {
    const data = attachment.data || attachment;
    return {
      key: data.key || attachment.key || stableKey(data),
      title: clean(data.title || data.filename || "Attachment"),
      mimeType: clean(data.contentType || data.mimeType || ""),
      url: clean(data.url || ""),
      path: clean(data.path || data.filename || ""),
    };
  });
}

function dedupeAttachments(attachments) {
  const seen = new Map();
  for (const attachment of attachments) {
    const key = attachment.key || attachment.url || attachment.path || attachment.title;
    if (!seen.has(key)) seen.set(key, attachment);
  }
  return [...seen.values()];
}

function normalizeNotes(notes) {
  const list = Array.isArray(notes) ? notes : [notes];
  return list.map((note) => clean(typeof note === "string" ? note : note.note || note.data?.note || "")).filter(Boolean);
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags).split(/[,;]/);
  return list.map((tag) => clean(typeof tag === "string" ? tag : tag.tag || tag.name || "")).filter(Boolean);
}

function shortAuthor(creators) {
  if (!creators.length) return "Unknown";
  const first = creators[0].lastName || creators[0].firstName || "Unknown";
  return creators.length > 1 ? `${first} et al.` : first;
}

function formatCreator(creator) {
  const first = creator.firstName ? `${creator.firstName} ` : "";
  return `${first}${creator.lastName}`.trim() || "Unknown author";
}

function publicationYear(value) {
  const match = String(value || "").match(/\d{4}/);
  return match ? match[0] : "";
}

function clean(value) {
  return String(value || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function cleanBibtex(value) {
  return clean(value.replace(/[{}]/g, ""));
}

function stableKey(value) {
  return JSON.stringify(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32) || "item";
}

function escapeTable(value) {
  return String(value || "").replace(/\|/g, "\\|");
}

function safeWikiTitle(value) {
  return clean(value).replace(/\]/g, "");
}

function slugTag(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}


const LIBRARY_SETTING = "Zotero Imported Items";
const LIBRARY_TYPE_SETTING = "Zotero Library Type";
const LIBRARY_ID_SETTING = "Zotero Library ID";

function pluginFactory() {
  return {
    appOption: {
      "Zotero: paste import": async function(app) {
        await importPastedItems(app);
      },
      "Zotero: fetch public/API-key library": async function(app) {
        await fetchZoteroItems(app);
      },
      "Zotero: open library preview": async function(app) {
        if (app.openSidebarEmbed) {
          const opened = await app.openSidebarEmbed(1.2, { id: "zotero-library" });
          if (opened === false && app.openEmbed) await app.openEmbed({ id: "zotero-library" });
        } else if (app.openEmbed) {
          await app.openEmbed({ id: "zotero-library" });
        }
      },
    },

    noteOption: {
      "Zotero: export item note here": async function(app, noteUUID) {
        const item = await chooseItem(app);
        if (!item) return;
        await app.insertNoteContent({ uuid: noteUUID }, `${renderItemNote(item)}\n`, { atEnd: true });
      },
      "Zotero: append bibliography here": async function(app, noteUUID) {
        await app.insertNoteContent({ uuid: noteUUID }, `${renderLibraryMarkdown(readItems(app))}\n`, { atEnd: true });
      },
    },

    insertText: {
      check() {
        return "zotero";
      },
      async run(app) {
        const item = await chooseItem(app);
        if (!item) return "";
        const response = await app.prompt("Optional locator for the citation", {
          inputs: [{ type: "text", label: "Locator, e.g. p. 42" }],
        });
        const locator = Array.isArray(response) ? response[0] : response;
        return formatCitation(item, { locator });
      },
    },

    async renderEmbed(app) {
      return renderLibraryPreview(readItems(app), app.context?.lightDarkMode === "dark");
    },

    async onEmbedCall(app, action, payload = {}) {
      if (action === "pasteImport") {
        await importPastedItems(app);
        await rerender(app);
        return { ok: true };
      }
      if (action === "fetchItems") {
        await fetchZoteroItems(app);
        await rerender(app);
        return { ok: true };
      }
      if (action === "exportItem") {
        const item = readItems(app).find((candidate) => candidate.key === payload.key);
        if (item) await exportItemAsNote(app, item);
        return { ok: true };
      }
      return { ok: false, error: `Unknown action: ${action}` };
    },

    validateSettings(app, settings) {
      const raw = settings[LIBRARY_SETTING];
      if (!raw) return null;
      try {
        JSON.parse(raw);
        return null;
      } catch {
        return [`${LIBRARY_SETTING} must be valid JSON.`];
      }
    },
  };
}

function readItems(app) {
  try {
    const raw = app.settings?.[LIBRARY_SETTING];
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeItems(app, items) {
  await app.setSetting(LIBRARY_SETTING, JSON.stringify(dedupeItems(items)));
}

async function importPastedItems(app) {
  const response = await app.prompt("Paste Zotero JSON export, Zotero Web API item JSON, or BibTeX metadata.", {
    inputs: [{ type: "text", label: "Zotero items" }],
    primaryAction: { icon: "library_books", label: "Import" },
  });
  const text = Array.isArray(response) ? response[0] : response;
  if (!text) return [];
  const imported = parseZoteroInput(text);
  await writeItems(app, readItems(app).concat(imported));
  await app.alert(`Imported ${imported.length} Zotero item${imported.length === 1 ? "" : "s"}.`);
  return imported;
}

async function fetchZoteroItems(app) {
  const response = await app.prompt("Fetch Zotero items. Public groups need no key; private libraries require a user-provided Zotero API key for this request.", {
    inputs: [
      {
        type: "select",
        label: "Library type",
        options: [
          { label: "Group", value: "groups" },
          { label: "User", value: "users" },
        ],
        value: app.settings?.[LIBRARY_TYPE_SETTING] || "groups",
      },
      { type: "text", label: "Library ID", value: app.settings?.[LIBRARY_ID_SETTING] || "" },
      { type: "text", label: "Temporary API key (optional; not stored)" },
    ],
    primaryAction: { icon: "cloud_download", label: "Fetch" },
  });
  if (!response) return [];
  const [libraryType, libraryId, apiKey] = response;
  await app.setSetting(LIBRARY_TYPE_SETTING, libraryType);
  await app.setSetting(LIBRARY_ID_SETTING, libraryId);
  const url = buildZoteroApiUrl({ libraryType, libraryId }, "items?format=json&include=data&limit=100");
  const headers = apiKey ? { "Zotero-API-Key": apiKey } : {};
  const fetched = await fetch(url, { headers });
  if (!fetched.ok) throw new Error(`Zotero API request failed: ${fetched.status}`);
  const imported = parseZoteroInput(await fetched.text());
  await writeItems(app, readItems(app).concat(imported));
  await app.alert(`Fetched ${imported.length} Zotero item${imported.length === 1 ? "" : "s"}.`);
  return imported;
}

async function chooseItem(app) {
  const items = readItems(app);
  if (!items.length) {
    await app.alert("No Zotero items imported yet.");
    return null;
  }
  const response = await app.prompt("Choose a Zotero item", {
    inputs: [
      {
        type: "select",
        label: "Item",
        options: items.map((item) => ({
          label: `${formatCitation(item)} ${item.title}`,
          value: item.key,
        })),
      },
    ],
    primaryAction: { icon: "format_quote", label: "Choose" },
  });
  const key = Array.isArray(response) ? response[0] : response;
  return items.find((item) => item.key === key) || null;
}

async function exportItemAsNote(app, item) {
  const tags = ["zotero"].concat(item.tags || []);
  const noteHandle = await createNote(app, item.title, tags);
  await app.insertNoteContent(noteHandle, `${renderItemNote(item)}\n`, { atEnd: true });
  const url = await app.getNoteURL(noteHandle);
  if (url) await app.navigate(url);
  return noteHandle;
}

async function createNote(app, title, tags) {
  if (app.notes?.create) return await app.notes.create(title, tags);
  const uuid = await app.createNote(title, tags);
  return { uuid };
}

async function rerender(app) {
  if (app.context?.renderEmbed) await app.context.renderEmbed();
}

function renderLibraryPreview(items, darkMode) {
  const normalized = dedupeItems(items);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${previewCss(darkMode)}</style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Zotero Library</h1>
        <p>${normalized.length} imported item${normalized.length === 1 ? "" : "s"}</p>
      </div>
      <div class="actions">
        <button data-action="pasteImport">Paste import</button>
        <button data-action="fetchItems">Fetch Zotero</button>
      </div>
    </header>
    <section class="items">
      ${normalized.length ? normalized.map(renderItemCard).join("") : `<p class="empty">Paste Zotero JSON/BibTeX or fetch a public Zotero library to begin.</p>`}
    </section>
  </main>
  <script>
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      button.disabled = true;
      await window.callAmplenotePlugin(button.dataset.action, { key: button.dataset.key });
      button.disabled = false;
    });
  </script>
</body>
</html>`;
}

function renderItemCard(item) {
  return `<article>
    <div>
      <h2>${escapeHtml(item.title)}</h2>
      <p>${escapeHtml(formatCitation(item))}</p>
      <small>${escapeHtml(item.publicationTitle || item.itemType)}${item.doi ? ` - DOI ${escapeHtml(item.doi)}` : ""}</small>
    </div>
    <button data-action="exportItem" data-key="${escapeHtml(item.key)}">Export note</button>
  </article>`;
}

function previewCss(darkMode) {
  const bg = darkMode ? "#101217" : "#f7f8fb";
  const fg = darkMode ? "#e6edf3" : "#172033";
  const panel = darkMode ? "#191d24" : "#ffffff";
  const border = darkMode ? "#303846" : "#dce3ee";
  return `
    *{box-sizing:border-box}body{margin:0;background:${bg};color:${fg};font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
    main{padding:18px;max-width:980px;margin:0 auto}header{display:flex;justify-content:space-between;gap:14px;align-items:center}h1,h2,p{margin:0}p,small,.empty{color:#718096}
    .actions{display:flex;gap:8px;flex-wrap:wrap}button{border:1px solid ${border};background:${panel};color:${fg};border-radius:8px;padding:8px 12px;cursor:pointer}button:hover{border-color:#2f80ed}
    .items{display:grid;gap:10px;margin-top:16px}article{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;background:${panel};border:1px solid ${border};border-radius:8px;padding:14px}
    h2{font-size:16px;margin-bottom:4px}@media(max-width:680px){header,article{flex-direction:column;align-items:stretch}}
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


return pluginFactory();
})()
```
