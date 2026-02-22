# Kimi Polaris — CLAUDE.md

Chrome MV3 content-script extension that enhances **https://www.kimi.com/\*** with two features:
1. **Right-side timeline nav** — floating strip to jump between conversation turns
2. **Left-side folder manager** — organize conversations into custom folders via drag-and-drop

---

## Architecture rules (do not break)

### Timeline nav
- **One nav item per `.chat-content-item` turn** — never split one reply by its internal h2/h3 headings.
- Label text always starts from the first word of the reply (first `.paragraph / p / li`), not from a heading.
- Scroll via **`animateScrollTo` (rAF + direct `scrollTop`)** — never use `container.scrollTo({ behavior:'smooth' })` or `scrollIntoView`; Kimi's Vue listeners cancel those on downward scroll.
- The inner scroll container is detected by DOM-walk from `.chat-content-item`; result is cached in `cachedScrollEl`.

### Folder manager
- Folder panel is injected **before** `.history-part` in the left sidebar; retry every 300 ms (up to 10 attempts) because the sidebar loads asynchronously.
- All folder state is persisted to `chrome.storage.local` under key `kpFolders` on every mutation.
- Chat items are made draggable by marking `.sidebar-nav .chat-info-item` elements with `draggable="true"`; `kpDragState` holds `{ chatId, chatName }` during a drag.
- Drop targets call `addChatToFolder(folderId, parentFolderId)` and re-render the panel.

---

## Kimi DOM selectors

### Timeline nav
```
.chat-content-item                          // one per conversation turn
.chat-content-item-user   .user-content     // user question text
.chat-content-item-assistant
  .markdown-container:not(.toolcall-content-text) .markdown   // reply body
.markdown-container.toolcall-content-text   // thinking block — always exclude
.markdown .paragraph / p / li              // rendered text nodes
```

Scroll container fallback selectors (in order): `.chat-detail-main`, `.layout-content-main`, `#chat-container`.

### Folder manager
```
.history-part                               // left sidebar section; panel injected before this
.sidebar-nav .chat-info-item                // individual conversation entries (made draggable)
#kp-folder-panel                            // injected folder panel root
.kp-fp-folder                               // one folder row
.kp-fp-drop-zone                            // drop target inside each folder
.kp-fp-drag-over                            // class added on dragover for visual feedback
```

---

## Storage format

### `kimiPolarisEnabled` (Boolean)
Whether the extension is active; toggled by the popup switch.

### `kpFolders` (Array)
```json
[
  {
    "id": 1700000000000,
    "name": "文件夹名",
    "open": true,
    "chats": [
      { "id": "chat-abc123", "name": "会话标题" }
    ],
    "subs": [
      {
        "id": 1700000000001,
        "name": "子文件夹",
        "open": false,
        "chats": []
      }
    ]
  }
]
```

---

## Key files

| File | Role |
|---|---|
| `content.js` | All runtime logic: timeline scan/render/scroll, folder inject/render/drag-drop, DOM observation |
| `styles.css` | Timeline strip + preview card + folder panel; full dark-mode support |
| `popup.html/js` | Toggle switch; writes `kimiPolarisEnabled` to `chrome.storage.local` |
| `manifest.json` | MV3; permissions: `["storage"]` only |

---

## Visual tokens

### Timeline nav
- User dot: `✦` star symbol, 8 px, amber glow `#f59e0b` via `text-shadow`
- Assistant dot: `🌙` moon emoji, 12 px, indigo glow `#6366f1` via `text-shadow`
- Nav strip: `right: 24px`, `width: 40px`, `border-radius: 14px 0 0 14px`
- Preview card: `right: 72px`, `width: 300px`, glassmorphism (`rgba(10,10,22,0.93)` + `backdrop-filter: blur(20px)`)
- Preview auto-hides 800 ms after mouse leaves

### Folder manager
- Panel background: matches sidebar; indigo accent `#6366f1` for hover/active states
- Drag-over highlight: indigo border + background tint (`.kp-fp-drag-over`)
- Drop zone placeholder text: `拖放会话到此处`
- Folder expand/collapse indicators: `▸` (collapsed) / `▾` (expanded)
