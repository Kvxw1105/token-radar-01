# Token Radar 前端呈现打磨结果（AGY_FE_RESULT）

## 一、改动文件

本次仅修改 `dashboard/` 下 2 个文件（未触碰 `dashboard/index.html`、`lib/`、`main.ts` 及任何数据/判定逻辑，未引入任何外部资源，未改动配色体系）：

- `dashboard/app.css`
- `dashboard/app.js`

---

## 二、每处改动前后对比

### 1. 已知问题一：榜单滚动定位被 sticky 横幅压住一半

- **改前**：`.banner` 设置了 `position: sticky; top: 0; z-index: 5`（高约 36px），但文档未设 `scroll-padding-top`，导致通过 `scrollIntoView({ block: 'start' })` 定位到 `#pre-controls` / `#tabs` / `#boardwrap` 时，目标顶部落在 `y = 0`，直接钻到置顶横幅背后；排序/筛选行被横幅截去上半部分，且横幅圆角与下方间隙处会露出上方元素的残影。
- **改后**：
  - 在 `html` 上增加 `scroll-padding-top: 40px`，让所有滚动定位自动落在置顶横幅下方、留出清晰呼吸间距。
  - 微调 `.banner` 高度与遮罩阴影（`padding: 5px 10px; margin: 4px 0 6px; box-shadow: 0 5px 0 0 var(--bg), 0 -4px 0 4px var(--bg)`），在不改变配色的前提下消除圆角与间隙处的内容透底。
  - **实测验证**（720×400 @2x 无头 Chrome 截图）：滚动定位到 `#pre-controls`（`scrollY=308`）与 `#tabs`（`scrollY=272`）时，排序/筛选行、表头及 11–13 行数据均完整可见，无任何遮挡或透底。

### 2. 已知问题二：详情视图（`#plan=nonce-capital`）版式问题

- **定位的最扎眼问题**：卡片网格孤立留白 + 内边距过挤 + 横幅错位到底部。
  - **原因**：`nonce-capital`（及全部 107 条 SKIP 计划）共 3 个步骤，`.plan-grid` 固定 2 列（`repeat(2, minmax(0, 1fr))`），导致最长的「步骤 3 闭环测算」（半宽下折成 6 行）孤零零悬在左下角，右下角空出整块 50% 宽度的视觉黑洞；同时 `.plan-step` 仅有 `padding: 1px 6px; line-height: 1.22`、`gap: 1px 6px`，文字紧贴边框，而视口底部却大面积留空；此外 `app.js` 将 `.plan` 插入在 `.head` 之后、`.banner` 之前，使三泳道盘点横幅在详情视图中掉到了最底部，与其他视图层级不一致。
- **改后**：
  - `.plan-step:last-child:nth-child(odd) { grid-column: 1 / -1; }`：奇数步数的最后一张总结卡（闭环测算）自动通栏占满两列（偶数步数保持对称 2 列），彻底消除右侧 50% 空白黑洞，并将步骤 3 压缩至 3 行易读排版。
  - 给 `.plan` 区块建立合理留白与行高节奏（`.plan-grid` `gap: 8px 10px; margin-top: 8px`，`.plan-step` `padding: 7px 10px; font-size: 11.5px; line-height: 1.45`，`.plan-head`/`.plan-chips`/`.plan-conf`/`.plan-counter` 统一 `6–8px` 垂直间距）。
  - `app.js` 改为将 `.plan` 插入在 `#banner` 之后，使所有视图保持一致的 `标题 → 三泳道横幅 → 主体内容` 信息层级。
  - **实测验证**：`#plan=nonce-capital` 在 `720×400 @2x` 首屏内完整呈现（`scrollY=0`），上下均衡、无溢出、无孤立空洞。

### 3. 自主修复一：「已发币对照」Tab 切换失效（CSS 覆盖 `[hidden]` 属性）

- **改前**：`app.js` 切换 Tab 时通过设置 `#pre-controls.hidden = true` 和 `#boardwrap.hidden = true` 隐藏未发币榜单，但 `app.css` 中的 `.controls { display: flex }` 与 `.board { display: grid }` 优先级高于浏览器默认 UA 样式 `[hidden] { display: none }`。结果点击「已发币对照」后，未发币筛选条和 680px 高的未发币榜单依然占据屏幕，真正的 128 行对照表被挤到 730px 以下不可见。
- **改后**：
  - 在 `app.css` 顶部补充 `[hidden] { display: none !important; }`，恢复原生 `hidden` 语义。
  - 在 `renderLive()` 中将协议名称与 Symbol 合并至同一行（`Rain RAIN`、`OKX OKB`），使行高紧凑一致，单屏可见 11 行对照样本。
  - **实测验证**：点击「已发币对照」并滚动至 `#tabs` 后，未发币筛选条与榜单正确隐藏，`#live-note` 下方立即呈现 128 条已发币对照表。

### 4. 自主修复二：双表格列对齐错位与窄视口核心估值列截断

- **改前**：
  - `app.css` 中的 `.ltable th/td:nth-child(...)` 列对齐规则是在新增「状态」（第 4 列）与「vs TVL」（第 11 列）之前写的，且未区分主榜（11 列）与已发币对照表（5 列）：导致主榜中「链数」右对齐紧贴 TVL、「隐含估值」居中、「置信」右对齐、「拥挤度 / vs TVL」左对齐；同时泄漏到已发币对照表，令「名称 / Symbol」居中、「TVL」左对齐、「市值」居中。
  - 在 720px 截图宽度下，主榜第 1 列 `1（P10–P90：1–30）` 占宽过大且单元格内边距宽松，导致产品最核心的「隐含估值（P25–P75）」「置信」「拥挤度」三列被完全挤出右侧视口之外。
- **改后**：
  - 将列对齐分别限定到 `#boardwrap .ltable`（第 1–3 列左对齐，第 4/5/9 列居中，第 6/7/8/10/11 列数值右对齐）与 `#livewrap .ltable`（第 1–2 列左对齐，第 3–5 列数值右对齐），并给数据单元格设置 `white-space: nowrap; vertical-align: middle`。
  - 保留 `（P10–P90：a–b）` 完整文案不删减，将名次数字 `.rkn` 提亮加粗、区间 `.rkb` 弱化缩小以建立主次层级，并在 `@media (max-width: 960px)` 下收紧主榜字号、内边距与截断上限（`Risk Curators` 等主要类别完整不截断），使「隐含估值（P25–P75）」「置信」「拥挤度」三列在 720px 视口内完整入画。

---

## 三、构建与校验结果

- **构建命令**：
  ```bash
  MAKEFUN_OUTPUT_DIR=out-agy node main.ts --input ./snapshot-dev.json --dev-no-shots
  ```
- **构建结果**：**成功（exit code 0）**
  - `board.json sha256`: `9547be915f49b0dbc825e7aef96362c1836d8c363733b70d55dab655faba9cab`
  - `758 protocols, watchlist 40/40, 178 board rows (138 early, farm steps 3-8 each)`
  - `wrote board.json (506930 bytes), data.js (504726 bytes), dashboard/ (4 files, 52559 bytes)`
- **外部资源检查**：`dashboard/index.html`、`dashboard/app.css`、`dashboard/app.js` 零外链 / 零 CDN / 零外链字体图片。
- **视觉自验**：使用 `tmp-chrome/shoot.mjs` + 本机 `chrome-headless-shell` 在 `720×400 @2x`（输出 `1440×800`）下实拍验证了榜单滚动态（`#pre-controls` 与 `#tabs`）、详情视图（`#plan=nonce-capital`）及「已发币对照」Tab 视图，全部达标。

---

## 四、文件字节数统计

| 文件 | 字节数 |
| --- | ---: |
| `dashboard/index.html` | 6,154 B |
| `dashboard/app.css` | 13,481 B |
| `dashboard/app.js` | 29,843 B |
| **三文件总计** | **49,478 B**（≤ 63,000 B） |
| `dashboard/` 目录全量（含 `MODEL_CARD.md` 3,081 B） | **52,559 B**（≤ 61,440 B / 63,000 B） |
