# POLISH_RESULT.md — 打磨轮 B（含 A 轮）结果（2026-11-21）

执行：OpenCode CLI，`opencode-go/deepseek-v4.1-flash`，工作目录 `token-radar-work`。范围严格按 `POLISH_CLI_B.md` 三项：计划字号、观感收尾、截图与全门复验；A 轮两项（估值带校准、结论条 Top3 估值带）作为已完成前置一并汇总。未换主题、未加新功能。

## 一、四项改进前后对比（含 A 轮两项）

| # | 改进项 | 改动前 | 改动后 | 证据 |
|---|---|---|---|---|
| 1 | A1 估值带校准 | P25–P75 带实测覆盖率 **44.0%**（理论 50%） | **50.0%**（n=50 留出影子回测重跑） | 校准系数 **s=1.1510**，由留出残差 IQR ÷ 训练带内宽拟合，无手填常数；方法论区披露方法与前后覆盖率 |
| 2 | A2 结论条 Top3 估值带 | 单行 Top3，仅点估计 | 三行逐条显示点估计 + 各自 P25–P75 带（如 Nonce Capital $74.0M / P25 $20.6M – P75 $252.1M） | dashboard 40,171B → **40,836B**（≤60KB）；榜单仍 178 行、排序不变 |
| 3 | B1 农场计划字号 | `#plan` 步卡 **10px**，最坏 8 步计划会溢出 | 步卡 **11px**（名称/摘要/置信统一 11px 字阶），专用 `.plan` 两列紧凑布局 | 7 步 nonce-capital 计划底边 **370.7 CSS px**；最坏 8 步 mystic-finance-lending 底边 **378.1 px**（均 <400，步骤、闭环行、反证行全部在屏内）；dashboard 41,120B |
| 4 | B2 观感收尾 | 主界面存在 10/10.5px 小字；默认榜首行底边 **412.8px**（被 400px 视口裁掉） | 主界面 11px 字阶下限（SVG 坐标刻度除外）；热力格 16→15px、表头/单元格横距 6→5px；数值列右对齐、名次/链数/置信居中 | 默认榜首行底边 **412.8 → 395.4px**（完整入屏，含右侧拥挤度列）；hero 102.1→98.8、热力图 114→109.1、控制条 60→57px；组合视图免责行底边 397.5px；dashboard **41,686B**（≤60KB） |

模型与榜单数据在 B 轮零改动：board.json 仍 474,354B / sha256 `68b01181…`，data.js 仍 517,753B / `651cfd17…`，178 行、watchlist 40/40、农场步 6–8。

## 二、三张截图（本地 out/dashboard，720×400 CSS @2x → 1440×800）

| 文件 | 视图 | 尺寸 | 字节 | 内容 |
|---|---|---|---|---|
| `screenshots/1-board.png` | 默认榜 | 1440×800 | **344,624** | 40/40 徽标、结论条 Top3（含估值带）、链×类别热力图、榜单首行完整 |
| `screenshots/2-detail.png` | `#plan=nonce-capital` | 1440×800 | **396,673** | 11px 完整农场计划 7 步 + 闭环测算行 + 反证行 |
| `screenshots/3-portfolios.png` | `#view=portfolio` | 1440×800 | **296,653** | 热力图带 + 三档组合卡 + 非投资建议行 |

三张均 ≤512KiB（最大 396,673B），合计 1,037,950B；旧版为 333,643 / 368,452 / 289,673B。

## 三、七项产物门复验（`~/workspace/tmp-chrome/gates.cjs`）

```
PASS  dashboard_files  3 files, 41686 bytes, html/css/js=true/true/true, badName=undefined, url=null
PASS  board_file  178 rows, 474354 bytes, all slugs in snapshot
PASS  sorted_by_value  distinct implied values: 178
PASS  coverage  40/40 watchlist rows; missing=
PASS  farm_steps  all rows 3..12 steps, 82..188 chars
PASS  screenshots  1-board.png 1440x800 344624B; 2-detail.png 1440x800 396673B; 3-portfolios.png 1440x800 296653B
PASS  dossier_matches  byte-identical=true, text=41955B, truncated=false, dossier=1427733B

7/7 gates pass
```

## 四、kit check 复验（`makefun check --worktree`）

- pass：`competition_open`、`snapshot`（23 files / 1,247,308 bytes）、`license_osi`（MIT）、`entrypoint`（main.ts→node22）。
- fail：`transcripts_present`（无上传的 transcript bundle，按预期；bundle/提交属提交阶段）。
- skip：14 项（含 transcript 解析相关检查；无 transcript 可读）。
- at submission：5 项（`repo_public` / `repo_owner` / `repo_created_after_open` / `commit_in_repo` / `duplicate_snapshot`），需建远程公开仓并提交时处理。

## 五、两次完整构建 sha256（run1 = run2）

两次均执行 `MAKEFUN_OUTPUT_DIR=out node main.ts --input ./snapshot-dev.json`，对 out/ 全部 9 个产物做 `sha256sum` 比对，逐字节一致：

| 产物 | 字节 | sha256（两次相同） |
|---|---:|---|
| board.json | 474,354 | `68b0118145a906543d7e3d4f165e43db9cc0a7b9ada62c857aaa6d2f0f5d99c8` |
| data.js | 517,753 | `651cfd177ade62e170943cbd4626452fb175048361b9901acfad072a9feef730` |
| dossier.json | 1,427,733 | `1841c7162b16b32f02db3a81b3f44d0561c4afcbdbe8dceab6d915698a970771` |
| dashboard/app.css | 11,113 | `f97e5e1c25c4598483e7ee2c00ff36185341b3f824ccc6960fe32a0d1ec2a7bd` |
| dashboard/app.js | 25,331 | `17f28e5a540ac0f09ee2f9e4d74e28b83baef03ede84cc44d01112cb62b78a97` |
| dashboard/index.html | 5,242 | `2146dfdb2c9df76e90dec69022695544cc047674f437138b2ce307e4855af48c` |
| screenshots/1-board.png | 344,624 | `02a7b5c45f071555d8a07294c9a8a348c0a8ec3abe5c725f9c3b3d5ac6a1802a` |
| screenshots/2-detail.png | 396,673 | `53531f06fa80894b38c28c1c45c84158c31fe062d7976a559a7904b38595272b` |
| screenshots/3-portfolios.png | 296,653 | `c5e92b30d74705f03d2186bb5e913627418c85a15447b0d7b5430b4b1086311c` |

## 六、git 提交列表（打磨轮 A + B）

```
956ca9c polish A: record A-round results (calibration 44%->50%, Top3 bands, two-run hashes)
8ac40d2 polish A2: conclusion bar Top3 rows show each P25-P75 valuation band
cb3c511 polish A1: calibrate P25-P75 band from held-out backtest residuals (s=1.151, coverage 44%->50%)
e83a220 polish B1: #plan step cards 11px with compact 2-column layout; full 6-8 step plans fit 720x400
4691376 polish B2: 11px type floor, tighter rhythm, right-aligned numeric columns; default board shows full first row
dfb5b42 polish B3: retake 3 screenshots (1440x800, <=512KiB) and record 7/7 gates, kit check, identical two-run hashes
```

本文件 `POLISH_RESULT.md` 为收尾提交（其自身哈希无法写进自身，见 `git log` 最后一条）。

## 七、未完成项与已知偏差（如实）

1. **transcripts bundle + 提交**：`transcripts_present` 仍 FAIL，bundle/五项声明/Muse usage 导出/上传均未执行；按 `POLISH_CLI_B.md` 属提交阶段，且在建远程仓等硬停止线之外。
2. **建远程仓 / push / submit / 声明**：未执行（硬停止线：不建远程仓、不提交 make.fun）。`at submission` 5 项仍未通过。
3. **截图工具偏差（已处理并披露）**：`~/workspace/tmp-chrome/shoot.mjs` 原文件把 CSS 视口硬编码为 720×720；为符合简报的 720×400 规格，在仓外把视口高改为 400（工具不入 git，`gates.cjs` 未改动）。另外同一浏览器内仅改 URL hash 不会重新加载页面，故三个 hash 视图分三次独立启动拍摄；这属于工具调用方式，不改截图工具逻辑。
4. **已知小偏差（不阻塞）**：SVG 散点坐标刻度仍为 10px（不在三张目标截图主视觉内，主界面字阶下限 11px）；组合视图在 720px 宽下第三张卡的区间数值会自然换行（无横向溢出）；计划步卡为塞进 400px 采用 11px/1.22 行高与紧凑内距。

## 八、硬停止线复核

未建远程仓库、未向 make.fun 提交任何内容、未产生费用、未动钱包或签名（仅读取既有 `.makefun/owner.json` 的公开地址声明）。
