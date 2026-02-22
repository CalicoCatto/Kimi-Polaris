// Kimi Polaris — content script

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────────

  let navEl     = null;
  let previewEl = null;
  let navItems  = [];
  let rebuildTimer     = null;
  let hidePreviewTimer = null;
  let cachedScrollEl   = null; // the element that actually scrolls the chat

  const DEBOUNCE_MS        = 600;
  const PREVIEW_HIDE_DELAY = 800;

  // ─── Bootstrap ──────────────────────────────────────────────────────────────

  function init() {
    chrome.storage.local.get({ kimiPolarisEnabled: true }, ({ kimiPolarisEnabled }) => {
      if (kimiPolarisEnabled) enable();
    });
  }

  function enable() {
    buildUI();
    scan();
    observeDOM();
    attachScrollListeners();
  }

  // ─── Build UI ───────────────────────────────────────────────────────────────

  function buildUI() {
    if (!document.getElementById('kimi-polaris-nav')) {
      navEl = document.createElement('div');
      navEl.id = 'kimi-polaris-nav';
      navEl.innerHTML = '<div class="kp-track"></div>';
      document.body.appendChild(navEl);
    } else {
      navEl = document.getElementById('kimi-polaris-nav');
    }

    if (!document.getElementById('kimi-polaris-preview')) {
      previewEl = document.createElement('div');
      previewEl.id = 'kimi-polaris-preview';
      previewEl.innerHTML =
        '<div class="kpp-badge"></div>' +
        '<div class="kpp-title"></div>' +
        '<div class="kpp-body"></div>';
      document.body.appendChild(previewEl);
    } else {
      previewEl = document.getElementById('kimi-polaris-preview');
    }
  }

  // ─── Scroll helpers ─────────────────────────────────────────────────────────

  // Walk up the DOM from a chat item to find the element that actually scrolls.
  // Kimi renders chat in an inner scrollable div, not window.
  function findChatScrollContainer() {
    if (cachedScrollEl && document.body.contains(cachedScrollEl)) {
      return cachedScrollEl;
    }

    // Start from a real chat item so we walk the right branch of the tree
    const anchor = document.querySelector('.chat-content-item');
    if (anchor) {
      let el = anchor.parentElement;
      while (el && el !== document.documentElement) {
        const s = getComputedStyle(el);
        if (
          (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 10
        ) {
          cachedScrollEl = el;
          return el;
        }
        el = el.parentElement;
      }
    }

    // Named-selector fallbacks (from the known Kimi DOM structure)
    for (const sel of ['.chat-detail-main', '.layout-content-main', '#chat-container']) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight + 10) {
        cachedScrollEl = el;
        return el;
      }
    }

    return null;
  }

  // Custom rAF-driven scroll — bypasses browser smooth-scroll which Kimi's Vue
  // event listeners cancel mid-flight on downward navigation.
  function animateScrollTo(container, to) {
    const from  = container.scrollTop;
    const delta = to - from;
    if (Math.abs(delta) < 2) return;
    // Scale duration with distance, clamped to 200–500 ms
    const duration = Math.min(500, Math.max(200, Math.abs(delta) * 0.3));
    let startTs = null;
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function step(ts) {
      if (!startTs) startTs = ts;
      const progress = Math.min((ts - startTs) / duration, 1);
      container.scrollTop = from + delta * easeOutCubic(progress);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // Scroll the target element to the top of the chat viewport.
  function scrollToTarget(target) {
    const container = findChatScrollContainer();

    if (container) {
      const containerRect = container.getBoundingClientRect();
      const targetRect    = target.getBoundingClientRect();
      const destination   = Math.max(
        0,
        container.scrollTop + (targetRect.top - containerRect.top) - 16
      );
      animateScrollTo(container, destination);
    } else {
      // Fallback: standard scrollIntoView (works when the page itself scrolls)
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ─── Collect anchors ────────────────────────────────────────────────────────
  //
  // One nav item per conversation turn — NOT per heading within a turn.
  //   user turn  → label = first 30 chars of question text
  //   assistant  → label = first heading or first paragraph summary

  function getHeadingPreview(headingEl) {
    const MAX = 260;
    let text = '';
    let node = headingEl.nextElementSibling;
    while (node && text.length < MAX) {
      if (['H1', 'H2', 'H3', 'H4'].includes(node.tagName)) break;
      const t = node.textContent?.trim();
      if (t) text += (text ? ' ' : '') + t;
      node = node.nextElementSibling;
    }
    return text.slice(0, MAX) + (text.length > MAX ? '…' : '');
  }

  function getParagraphPreview(paraEl) {
    const MAX = 260;
    let text = paraEl.textContent.trim();
    let node = paraEl.nextElementSibling;
    let count = 0;
    while (node && count < 3 && text.length < MAX) {
      const t = node.textContent?.trim();
      if (t) text += ' ' + t;
      count++;
      node = node.nextElementSibling;
    }
    return text.slice(0, MAX) + (text.length > MAX ? '…' : '');
  }

  function truncate(s, n) {
    s = s.trim();
    return s.slice(0, n) + (s.length > n ? '…' : '');
  }

  function collectAnchors() {
    const anchors = [];

    // Walk every top-level chat item in document order
    const items = document.querySelectorAll('.chat-content-item');
    items.forEach((item) => {

      // ── User question ──────────────────────────────────────────────────────
      if (item.classList.contains('chat-content-item-user')) {
        const uc = item.querySelector('.user-content');
        if (!uc) return;
        const text = uc.textContent.trim();
        if (!text) return;

        anchors.push({
          el:          item,
          type:        'user',
          text:        truncate(text, 30),
          previewBody: truncate(text, 320),
        });

      // ── Assistant reply ────────────────────────────────────────────────────
      } else if (item.classList.contains('chat-content-item-assistant')) {
        // Target only the main response markdown, not thinking/toolcall blocks
        const md = item.querySelector(
          '.markdown-container:not(.toolcall-content-text) .markdown'
        );
        if (!md) return;

        // Always start from the very first text node in the reply,
        // regardless of whether there are headings.
        const firstPara = md.querySelector('.paragraph, p, li');
        if (!firstPara) return;
        const raw = firstPara.textContent.trim();
        if (!raw) return;

        anchors.push({
          el:          item,
          type:        'assistant',
          text:        truncate(raw, 30),
          previewBody: getParagraphPreview(firstPara),
        });
      }
    });

    return anchors;
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  function scan() {
    if (!navEl) return;
    renderNav(collectAnchors());
    updateActive();
  }

  function renderNav(anchors) {
    const track = navEl.querySelector('.kp-track');
    track.innerHTML = '';
    navItems = [];

    if (anchors.length === 0) {
      navEl.dataset.empty = '';
      return;
    }
    delete navEl.dataset.empty;

    anchors.forEach(({ el, type, text, previewBody }) => {
      const item = document.createElement('div');
      item.className = `kp-item kp-${type}`;
      item.innerHTML =
        '<span class="kp-dot"></span>' +
        `<span class="kp-label">${escapeHtml(text)}</span>`;

      item.addEventListener('click', () => {
        scrollToTarget(el);
      });

      item.addEventListener('mouseenter', () => {
        clearTimeout(hidePreviewTimer);
        showPreview(item, { type, title: text, body: previewBody });
      });

      item.addEventListener('mouseleave', () => {
        hidePreviewTimer = setTimeout(hidePreview, PREVIEW_HIDE_DELAY);
      });

      track.appendChild(item);
      navItems.push({ dotEl: item, target: el });
    });
  }

  // ─── Preview card ────────────────────────────────────────────────────────────

  function showPreview(itemEl, { type, title, body }) {
    previewEl.dataset.type = type;
    previewEl.querySelector('.kpp-badge').textContent = type === 'user' ? '✦' : '🌙';
    previewEl.querySelector('.kpp-title').textContent = title;
    previewEl.querySelector('.kpp-body').textContent  = body || '';

    previewEl.classList.add('kpp-visible');
    const cardH = previewEl.offsetHeight;
    const rect  = itemEl.getBoundingClientRect();
    const ideal = rect.top + rect.height / 2 - cardH / 2;
    const top   = Math.max(12, Math.min(window.innerHeight - cardH - 12, ideal));
    previewEl.style.top = top + 'px';
  }

  function hidePreview() {
    previewEl.classList.remove('kpp-visible');
  }

  // ─── Active highlight ────────────────────────────────────────────────────────

  function updateActive() {
    if (!navItems.length) return;
    const trigger = window.innerHeight * 0.35;
    let activeIdx = 0;
    navItems.forEach(({ target }, i) => {
      if (target.getBoundingClientRect().top < trigger) activeIdx = i;
    });
    navItems.forEach(({ dotEl }, i) => {
      dotEl.classList.toggle('kp-active', i === activeIdx);
    });
  }

  // ─── Scroll ──────────────────────────────────────────────────────────────────

  function attachScrollListeners() {
    const onScroll = () => requestAnimationFrame(updateActive);

    // Always cover window scroll as a fallback
    window.addEventListener('scroll', onScroll, { passive: true });

    // Attach to the real inner scroll container once it's available.
    // Retry a few times in case the SPA hasn't mounted yet.
    let attempts = 0;
    function tryAttach() {
      const container = findChatScrollContainer();
      if (container) {
        container.addEventListener('scroll', onScroll, { passive: true });
      } else if (attempts++ < 5) {
        setTimeout(tryAttach, 800);
      }
    }
    setTimeout(tryAttach, 800);
  }

  // ─── MutationObserver ────────────────────────────────────────────────────────

  function observeDOM() {
    const observer = new MutationObserver((mutations) => {
      let dirty = false;
      for (const m of mutations) {
        if (m.type !== 'childList') continue;
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (
            node.matches?.('.chat-content-item') ||
            node.querySelector?.('.chat-content-item') ||
            // Streaming: content being added inside existing assistant messages
            node.closest?.('.markdown') ||
            node.matches?.('.paragraph, h1, h2, h3')
          ) {
            dirty = true;
            break;
          }
        }
        if (dirty) break;
      }
      if (dirty) {
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(scan, DEBOUNCE_MS);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Utils ───────────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ─── Popup messaging ─────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== 'kp-toggle') return;
    if (msg.enabled) {
      if (!navEl) buildUI();
      navEl.style.display     = '';
      previewEl.style.display = '';
      scan();
    } else {
      if (navEl)     navEl.style.display     = 'none';
      if (previewEl) previewEl.style.display = 'none';
    }
  });

  // ─── Entry ───────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 800));
  } else {
    setTimeout(init, 800);
  }
})();
