# Zotero Integration Amplenote Plugin

Publish-ready local implementation for the Amplenote Zotero Integration bounty.

## Features

- Paste Zotero Web API JSON, regular Zotero JSON exports, or BibTeX-ish entries.
- Fetch public Zotero libraries, or private libraries only when the user supplies a temporary API key for that request.
- Store imported item metadata in Amplenote plugin settings.
- Insert author-year citations from the `zotero` insert-text action.
- Append a bibliography or export a selected item into a rich research note.
- Render item previews in a sidebar embed.
- Deduplicate imported items by DOI/key/title and merge attachments, tags, and notes.

The plugin intentionally does not store Zotero API keys, perform OAuth, publish to Amplenote, submit bounty claims, or use private credentials.

## Build

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/build-plugin-note.mjs
```

Generated Amplenote note:

```text
dist/Zotero Integration Amplenote Plugin.md
```

## Test

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test
```

## Example JSON

```json
{
  "data": {
    "key": "ABC123",
    "itemType": "journalArticle",
    "title": "Knowledge Tools",
    "date": "2024",
    "publicationTitle": "Journal of Notes",
    "DOI": "10.1234/example",
    "creators": [{ "firstName": "Ada", "lastName": "Lovelace" }]
  }
}
```

## Example BibTeX

```bibtex
@article{lovelace2024,
  title={Knowledge Tools},
  author={Lovelace, Ada and Hopper, Grace},
  journal={Journal of Notes},
  year={2024},
  doi={10.1234/example}
}
```

## Official sources used

- Amplenote plugin creation docs: https://www.amplenote.com/help/developing_amplenote_plugins/plugin_creation
- Amplenote plugin actions docs: https://www.amplenote.com/help/developing_amplenote_plugins/actions
- Amplenote app interface docs: https://www.amplenote.com/help/developing_amplenote_plugins/app_interface
- Zotero Web API v3 basics: https://www.zotero.org/support/dev/web_api/v3/basics
- Bounty feature thread: https://amplenoteplugins.featureupvote.com/suggestions/519325/zotero-integration
