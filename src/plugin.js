import {
  buildZoteroApiUrl,
  dedupeItems,
  formatCitation,
  parseZoteroInput,
  renderItemNote,
  renderLibraryMarkdown,
} from "./zotero.js";

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

export default pluginFactory;
