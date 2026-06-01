import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const zoteroPath = resolve(root, "src", "zotero.js");
const pluginPath = resolve(root, "src", "plugin.js");
const outputPath = resolve(root, "dist", "Zotero Integration Amplenote Plugin.md");

const metadata = `# Zotero Integration

| Metadata | Value |
| --- | --- |
| Name | Zotero Integration |
| Description | Import Zotero items, insert citations, export rich research notes, and optionally fetch public/API-key Zotero library data without storing private keys. |
| Author | Bounty implementation |
| Version | 0.1.0 |
| setting | Zotero Imported Items |
| setting | Zotero Library Type |
| setting | Zotero Library ID |

`;

const zotero = (await readFile(zoteroPath, "utf8")).replace(/^export /gm, "");
const plugin = (await readFile(pluginPath, "utf8"))
  .replace(/import[\s\S]*?from "\.\/zotero\.js";\n\n/, "")
  .replace(/\nexport default pluginFactory;\n?$/, "");

const code = `(() => {
${zotero}

${plugin}

return pluginFactory();
})()`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${metadata}\`\`\`js\n${code}\n\`\`\`\n`);
console.log(outputPath);
