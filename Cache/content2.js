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

  let folderData     = [];
  let kpDragState    = null;
  let folderObserver = null;

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
    setTimeout(initFolders, 300);
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

  function findChatScrollContainer() {
    if (cachedScrollEl && document.body.contains(cachedScrollEl)) {
      return cachedScrollEl;
    }

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

    for (const sel of ['.chat-detail-main', '.layout-content-main', '#chat-container']) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight + 10) {
        cachedScrollEl = el;
        return el;
      }
    }

    return null;
  }

  function animateScrollTo(container, to) {
    const from  = container.scrollTop;
    const delta = to - from;
    if (Math.abs(delta) < 2) return;
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
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ─── Collect anchors ────────────────────────────────────────────────────────

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
    const items = document.querySelectorAll('.chat-content-item');
    items.forEach((item) => {
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
      } else if (item.classList.contains('chat-content-item-assistant')) {
        const md = item.querySelector(
          '.markdown-container:not(.toolcall-content-text) .markdown'
        );
        if (!md) return;

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
    window.addEventListener('scroll', onScroll, { passive: true });

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

  // ─── Folder Manager ──────────────────────────────────────────────────────────

  function initFolders() {
    chrome.storage.local.get({ kpFolders: [] }, ({ kpFolders }) => {
      folderData = kpFolders;
      let attempts = 0;
      function retry() {
        if (tryInjectPanel()) return;
        if (attempts++ < 10) setTimeout(retry, 300);
      }
      retry();
      watchSidebarForFolders();
    });
  }

  function tryInjectPanel() {
    if (document.getElementById('kp-folder-panel')) return true;
    const historyPart = document.querySelector('.history-part');
    if (!historyPart) return false;
    const panel = document.createElement('div');
    panel.id = 'kp-folder-panel';
    historyPart.parentElement.insertBefore(panel, historyPart);
    renderFolderPanel();
    makeChatsDraggable();
    return true;
  }

  function renderFolderPanel() {
    const panel = document.getElementById('kp-folder-panel');
    if (!panel) return;
    panel.innerHTML = '';

    const titleRow = document.createElement('div');
    titleRow.className = 'kp-fp-title-row';

    const title = document.createElement('span');
    title.className = 'kp-fp-title';
    title.textContent = '文件夹';

    const newBtn = document.createElement('button');
    newBtn.className = 'kp-fp-new-btn';
    newBtn.title = '新建文件夹';
    newBtn.textContent = '+';
    newBtn.addEventListener('click', createFolder);

    titleRow.appendChild(title);
    titleRow.appendChild(newBtn);
    panel.appendChild(titleRow);

    const list = document.createElement('div');
    list.className = 'kp-fp-list';
    folderData.forEach(folder => {
      list.appendChild(buildFolderEl(folder, null));
    });
    panel.appendChild(list);
  }

  function buildFolderEl(folder, parentId) {
    const wrap = document.createElement('div');
    wrap.className = 'kp-fp-folder';

    const row = document.createElement('div');
    row.className = 'kp-fp-row';

    const toggle = document.createElement('span');
    toggle.className = 'kp-fp-toggle';
    toggle.textContent = folder.open ? '▾' : '▸';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'kp-fp-name';
    nameSpan.dataset.folderId = folder.id;
    nameSpan.textContent = folder.name;
    nameSpan.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRenameFolder(nameSpan, folder);
    });

    const btns = document.createElement('span');
    btns.className = 'kp-fp-btns';

    if (!parentId) {
      const subBtn = document.createElement('button');
      subBtn.className = 'kp-fp-btn kp-fp-sub';
      subBtn.title = '新建子文件夹';
      subBtn.textContent = '+';
      subBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        createSub(folder.id);
      });
      btns.appendChild(subBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'kp-fp-btn kp-fp-del';
    delBtn.title = '删除';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteFolder(folder.id, parentId);
    });
    btns.appendChild(delBtn);

    row.appendChild(toggle);
    row.appendChild(nameSpan);
    row.appendChild(btns);

    row.addEventListener('click', () => {
      folder.open = !folder.open;
      saveFolders();
      renderFolderPanel();
    });

    setupDrop(row, folder.id, parentId);
    wrap.appendChild(row);

    if (folder.open) {
      const body = document.createElement('div');
      body.className = 'kp-fp-body';

      if (!parentId && folder.subs && folder.subs.length > 0) {
        folder.subs.forEach(sub => {
          body.appendChild(buildFolderEl(sub, folder.id));
        });
      }

      if (folder.chats && folder.chats.length > 0) {
        folder.chats.forEach(chat => {
          body.appendChild(buildChatEl(chat, folder.id, parentId));
        });
      }

      const dropzone = document.createElement('div');
      dropzone.className = 'kp-fp-dropzone';
      dropzone.textContent = '拖放会话到此处';
      setupDrop(dropzone, folder.id, parentId);
      body.appendChild(dropzone);

      wrap.appendChild(body);
    }

    return wrap;
  }

  function buildChatEl(chat, folderId, parentFolderId) {
    const a = document.createElement('a');
    a.className = 'kp-fp-chat';
    a.href = '/chat/' + chat.id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'kp-fp-chat-name';
    nameSpan.textContent = chat.name;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'kp-fp-btn kp-fp-del';
    removeBtn.title = '从文件夹移除';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeChatFromFolder(chat.id, folderId, parentFolderId);
    });

    a.appendChild(nameSpan);
    a.appendChild(removeBtn);
    return a;
  }

  function setupDrop(el, folderId, parentFolderId) {
    el.addEventListener('dragover', (e) => {
      if (!kpDragState) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      el.classList.add('kp-fp-drag-over');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('kp-fp-drag-over');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('kp-fp-drag-over');
      if (!kpDragState) return;
      addChatToFolder(kpDragState.id, kpDragState.name, folderId, parentFolderId);
    });
  }

  function saveFolders() {
    chrome.storage.local.set({ kpFolders: folderData });
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function createFolder() {
    const folder = { id: genId(), name: '新文件夹', open: true, chats: [], subs: [] };
    folderData.push(folder);
    saveFolders();
    renderFolderPanel();
    const panel = document.getElementById('kp-folder-panel');
    if (!panel) return;
    const nameEl = panel.querySelector(`.kp-fp-name[data-folder-id="${folder.id}"]`);
    if (nameEl) startRenameFolder(nameEl, folder);
  }

  function createSub(parentId) {
    const parent = folderData.find(f => f.id === parentId);
    if (!parent) return;
    if (!parent.subs) parent.subs = [];
    const sub = { id: genId(), name: '新子文件夹', open: true, chats: [] };
    parent.subs.push(sub);
    parent.open = true;
    saveFolders();
    renderFolderPanel();
    const panel = document.getElementById('kp-folder-panel');
    if (!panel) return;
    const nameEl = panel.querySelector(`.kp-fp-name[data-folder-id="${sub.id}"]`);
    if (nameEl) startRenameFolder(nameEl, sub);
  }

  function deleteFolder(id, parentId) {
    if (parentId) {
      const parent = folderData.find(f => f.id === parentId);
      if (parent) parent.subs = parent.subs.filter(s => s.id !== id);
    } else {
      folderData = folderData.filter(f => f.id !== id);
    }
    saveFolders();
    renderFolderPanel();
  }

  function addChatToFolder(chatId, chatName, folderId, parentFolderId) {
    const folder = findFolder(folderId, parentFolderId);
    if (!folder) return;
    if (!folder.chats) folder.chats = [];
    if (folder.chats.some(c => c.id === chatId)) return;
    folder.chats.push({ id: chatId, name: chatName });
    folder.open = true;
    saveFolders();
    renderFolderPanel();
  }

  function removeChatFromFolder(chatId, folderId, parentFolderId) {
    const folder = findFolder(folderId, parentFolderId);
    if (!folder) return;
    folder.chats = folder.chats.filter(c => c.id !== chatId);
    saveFolders();
    renderFolderPanel();
  }

  function findFolder(folderId, parentFolderId) {
    if (parentFolderId) {
      const parent = folderData.find(f => f.id === parentFolderId);
      return parent ? (parent.subs || []).find(s => s.id === folderId) || null : null;
    }
    return folderData.find(f => f.id === folderId) || null;
  }

  function startRenameFolder(nameEl, folderObj) {
    const input = document.createElement('input');
    input.className = 'kp-fp-rename-input';
    input.type = 'text';
    input.value = folderObj.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    function commit() {
      if (done) return;
      done = true;
      const val = input.value.trim();
      if (val) folderObj.name = val;
      saveFolders();
      renderFolderPanel();
    }
    function cancel() {
      if (done) return;
      done = true;
      renderFolderPanel();
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { cancel(); }
    });
  }

  // 👇【核心修复逻辑在这里】👇
  function makeChatsDraggable() {
    document.querySelectorAll('.sidebar-nav .chat-info-item:not([data-kp-drag])').forEach(item => {
      item.setAttribute('data-kp-drag', '1');
      item.draggable = true;

      // 强行覆盖网页自带的 CSS 禁用拖拽规则
      item.style.setProperty('-webkit-user-drag', 'element', 'important');
      item.style.setProperty('user-drag', 'element', 'important');

      item.addEventListener('dragstart', (e) => {
        const href = item.getAttribute('href') || '';
        const match = href.match(/\/chat\/([^/?#]+)/);
        const chatId = match ? match[1] : '';
        const nameEl = item.querySelector('.chat-name');
        const chatName = nameEl ? nameEl.textContent.trim() : chatId;
        kpDragState = { id: chatId, name: chatName };
        e.dataTransfer.setData('text/plain', chatId);
        e.dataTransfer.effectAllowed = 'copy';
        item.classList.add('kp-fp-dragging');
      });
      
      item.addEventListener('dragend', () => {
        kpDragState = null;
        item.classList.remove('kp-fp-dragging');
      });
    });
  }

  function watchSidebarForFolders() {
    if (folderObserver) return;
    folderObserver = new MutationObserver((mutations) => {
      if (!document.getElementById('kp-folder-panel')) {
        setTimeout(tryInjectPanel, 100);
        return;
      }
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.closest?.('.sidebar-nav') || node.querySelector?.('.chat-info-item')) {
            makeChatsDraggable();
            return;
          }
        }
      }
    });
    folderObserver.observe(document.body, { childList: true, subtree: true });
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