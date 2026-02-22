# Kimi Polaris — Progress Log

## v0.1.0 — 初始搭建

**目标：** 从零创建 Chrome MV3 扩展骨架，实现长文时间线导航 MVP。

**创建文件：**
- `manifest.json` — MV3，目标 `https://kimi.moonshot.cn/*`，仅 `storage` 权限
- `content.js` — 注入逻辑（扫描 DOM、渲染导航条、MutationObserver、滚动）
- `styles.css` — 导航条（右侧固定浮层）+ 预览卡片样式
- `popup.html` / `popup.js` — 工具栏弹出面板，功能开关

**初始设计：**
- 以每个 `.chat-content-item` 为单位收集锚点（user + assistant）
- 点击导航项跳转到对应聊天条目
- MutationObserver debounce 600 ms 后重建导航
- scroll 事件实时高亮当前可视项

---

## Patch 1 — 目标域名修正

**问题：** kimi.moonshot.cn 已停用，实际地址为 www.kimi.com。

**修改：**
- `manifest.json` `matches` 改为 `https://www.kimi.com/*`
- `popup.html` footer 文案同步更新

---

## Patch 2 — 导航条放大 + hover 预览卡片

**需求：** 导航条太小不显眼；hover 时应显示对应消息的摘要预览。

**修改：**
- 加大导航条尺寸与间距
- 新增 `#kimi-polaris-preview` 预览卡片（`position: fixed; right: 72px; width: 300px`）
- 卡片含 badge（提问 / 回复）、title、body 三段
- hover 进入 dot → 卡片渐显并垂直居中对齐当前 dot
- 离开后延迟 800 ms 淡出
- 左侧彩色 accent bar 随类型变化（琥珀 / 靛蓝）
- 创建 `claude.md` 记录项目信息

---

## Patch 3 — 架构修正：一轮对话 = 一个导航项

**问题（用户反馈）：**
1. 代码以 h2/h3 标题分段，一条 Kimi 回复被拆成多个导航项
2. 用户提问未被收录进时间线

**根本原因：** `collectAnchors()` 遍历的是 `.markdown h1/h2/h3` 而非 `.chat-content-item`。

**修改：**
- `collectAnchors()` 改为遍历所有 `.chat-content-item`，每个元素恰好产生一个锚点
- 用户项（`.chat-content-item-user`）：取 `.user-content` 文本，截取 30 字为标签
- 助手项（`.chat-content-item-assistant`）：取 `.markdown-container:not(.toolcall-content-text) .markdown` 内容，标题仅作标签文本，不再用于分段
- 思考块（`.toolcall-content-text`）始终排除

---

## Patch 4 — 滚动可靠性修复

**问题（用户反馈）：** 点击导航项有时无法跳转，视图卡在原位。

**根本原因：** `scrollIntoView({ behavior: 'smooth' })` 在 Kimi SPA 内无法定位到正确的滚动容器（Kimi 使用内层 div 滚动，而非 window）。

**修改：**
- 新增 `findChatScrollContainer()`：从 `.chat-content-item` 向上遍历 DOM，找到第一个 `overflowY: auto/scroll` 且 `scrollHeight > clientHeight` 的祖先，结果缓存到 `cachedScrollEl`；备用选择器：`.chat-detail-main`、`.layout-content-main`、`#chat-container`
- `scrollToTarget()` 改用 `container.scrollTop + getBoundingClientRect()` 计算偏移量，调用 `container.scrollTo({ behavior: 'smooth' })`
- `attachScrollListeners()` 以 800 ms 间隔最多重试 5 次，等待 SPA 完成挂载

---

## Patch 5 — 视觉精调：首字开始 + 圆形 dot + 月光光晕 + 位置左移

**需求（用户反馈）：**
1. 助手回复标签应从第一个字开始，而非从第一个标题开始
2. 导航条与浏览器滚动条重叠
3. 两种 dot 均改为圆形，颜色区分，加微弱月光发光效果

**修改：**

`content.js`：
- `collectAnchors()` 助手分支：移除 `firstHeading` 逻辑，始终取 `firstPara`（`.paragraph, p, li`）的文本作为标签和预览

`styles.css`：
- `#kimi-polaris-nav` 改为 `right: 24px`（避开浏览器滚动条）
- `#kimi-polaris-preview` 改为 `right: 72px`（= nav 40px + right 24px + gap 8px）
- `.kp-user .kp-dot`：`8px` 圆形，`border-radius: 50%`，琥珀色 + 双层 `box-shadow` 月光光晕
- `.kp-assistant .kp-dot`：`12px` 圆形，靛蓝色 + 同款光晕
- hover / active 状态放大并加深光晕
- 暗色模式同步更新

---

## Patch 6 — 方向性滚动失效修复（当前版本）

**问题（用户反馈）：** 从页面顶部向下导航（点击时间线靠后的项目）有时卡住无法跳转；从底部向上导航一般正常。

**根本原因：** `container.scrollTo({ behavior: 'smooth' })` 是浏览器原生异步动画，Kimi 的 Vue 滚动事件监听器在向下滚动时会拦截并取消该动画（触发了 Vue 的某种滚动锁定逻辑），向上滚动则通常不受影响。

**修改：**
- 新增 `animateScrollTo(container, to)`：用 `requestAnimationFrame` 驱动、直接写 `container.scrollTop`，完全绕过浏览器 smooth scroll 系统
- 缓动函数：`easeOutCubic(t) = 1 - (1-t)³`，时长 200–500 ms（按距离线性插值）
- `scrollToTarget()` 改为调用 `animateScrollTo` 替代 `container.scrollTo`

---

## 当前状态（v0.1.0）

| 功能 | 状态 |
|---|---|
| 时间线导航条（右侧固定浮层） | ✅ 完成 |
| 用户提问 + Kimi 回复交替显示 | ✅ 完成 |
| hover 预览卡片 | ✅ 完成 |
| 点击跳转（双向可靠） | ✅ 完成 |
| 流式回复实时更新 | ✅ 完成 |
| 暗色模式适配 | ✅ 完成 |
| popup 开关 | ✅ 完成 |

---

## 后续计划

- [ ] 导航条顶部显示「第 N / 共 M 轮」计数
- [ ] 关键词搜索与高亮
- [ ] 一键复制单条回复内容
- [ ] 导出当前对话为 Markdown / PDF
- [ ] 思维导图模式
