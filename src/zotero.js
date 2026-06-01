const URL_RE = /^https?:\/\//i;

export function parseZoteroInput(input) {
  const text = String(input || "").trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) return parseZoteroJson(text);
  return parseBibtex(text);
}

export function parseZoteroJson(text) {
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : parsed.items || parsed.results || [parsed];
  return rows
    .map((row) => normalizeZoteroItem(row))
    .filter(Boolean);
}

export function normalizeZoteroItem(row) {
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

export function parseBibtex(text) {
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

export function formatCitation(item, options = {}) {
  const normalized = normalizeZoteroItem(item);
  const author = shortAuthor(normalized.creators);
  const year = publicationYear(normalized.date) || "n.d.";
  const locator = options.locator ? `, ${options.locator}` : "";
  return `(${author}, ${year}${locator})`;
}

export function formatBibliographyEntry(item) {
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

export function renderItemNote(item) {
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

export function renderLibraryMarkdown(items) {
  const normalized = dedupeItems(items.map(normalizeZoteroItem).filter(Boolean));
  const lines = ["# Zotero Library Import", ""];
  for (const item of normalized) {
    lines.push(`- ${formatCitation(item)} [[${safeWikiTitle(item.title)}]]`);
    if (item.url || item.doi) lines.push(`  - Source: ${item.url || `https://doi.org/${item.doi}`}`);
    if (item.tags.length) lines.push(`  - Tags: ${item.tags.map((tag) => `#${slugTag(tag)}`).join(" ")}`);
  }
  return lines.join("\n");
}

export function dedupeItems(items) {
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

export function buildZoteroApiUrl(settings = {}, path = "items") {
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
