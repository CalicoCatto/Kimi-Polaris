# Kimi Polaris — CLAUDE.md

Chrome MV3 content-script extension. Injects a floating timeline nav + hover-preview card into **https://www.kimi.com/\*** only.

---

## Architecture rules (do not break)

- **One nav item per `.chat-content-item` turn** — never split one reply by its internal h2/h3 headings.
- Label text always starts from the first word of the reply (first `.paragraph / p / li`), not from a heading.
- Scroll via **`animateScrollTo` (rAF + direct `scrollTop`)** — never use `container.scrollTo({ behavior:'smooth' })` or `scrollIntoView`, Kimi's Vue listeners cancel those downward.
- The inner scroll container is detected by DOM-walk from `.chat-content-item`; result is cached in `cachedScrollEl`.

---

## Kimi DOM selectors

```
.chat-content-item                          // one per conversation turn
.chat-content-item-user   .user-content     // user question text
.chat-content-item-assistant
  .markdown-container:not(.toolcall-content-text) .markdown   // reply body
.markdown-container.toolcall-content-text   // thinking block — always exclude
.markdown .paragraph / p / li              // rendered text nodes
```

Scroll container fallback selectors (in order): `.chat-detail-main`, `.layout-content-main`, `#chat-container`.

---

## Key files

| File | Role |
|---|---|
| `content.js` | All runtime logic (scan, render, scroll, observe) |
| `styles.css` | Nav strip + preview card; full dark-mode support |
| `popup.html/js` | Toggle switch; writes `kimiPolarisEnabled` to `chrome.storage.local` |
| `manifest.json` | MV3; permissions: `["storage"]` only |

---

## Visual tokens

- User dot: 8 px amber circle `#f59e0b`, moonlight glow via double `box-shadow`
- Assistant dot: 12 px indigo circle `#6366f1`, same glow pattern
- Nav strip: `right: 24px`, `width: 40px`, `border-radius: 14px 0 0 14px`
- Preview card: `right: 72px`, `width: 300px`
