# S2 Result — live-token tab separation + mcap filter fix

## What S2 changed overall
- Data layer (lib/model.ts + main.ts): added a separate `live` block (LiveRow[]) to board.json/data.js with all market-capped protocols sorted by mcap desc, plus `live_size`/`counts.live`; dashboard gets a tab switcher ("未发币雷达 (178)" / "已发币对照 (N)") with the live table as calibration samples (comps), never mixed into the ranked board.
- Filter fix: `liveRows()` now requires `mcap_usd > 0` (was `!== null` only), excluding the 15 zero-mcap dead tokens that rendered a 0.00x multiple. Before: 144 live rows; after: 128 live rows. (Task note stated 129; actual non-positive count is 16 — 15 zeros + 1 negative sentinel `autofinance` at -1 — so the `> 0` filter leaves 128.)

## Verification (MAKEFUN_OUTPUT_DIR=out node main.ts --input ./snapshot-dev.json, no --dev-no-shots)
- board.json rows: 178
- rank 1: Nonce Capital, implied_value_usd 74041603
- live count: 128
- dashboard source total bytes: 44548 (app.css 11627 + app.js 26944 + index.html 5977)
- dossier.json bytes: 1430706
- board.json bytes: 502569
- gates.cjs: 7/7 PASS

## Build
- Full rebuild (with screenshots) succeeded; board.json sha256 754ce0a6a2ee65770eaf3007790264960a7659484adb0604b15e822c646c6b5c.
- Screenshots untouched (3 images in screenshots/).

# 优化轮 + S2 设计修复包（2026-11-26 晚，主人指示多 Agent 协作；本地 commit dfd073e）

## 降重轮（Codex / gpt-6.1-terra，Muse 独立验收）
- 计划整句重复率 **33.78%（101/299）**，达标（≤40%）；判定分布不变（FARM 21 / THIN 50 / SKIP 107），双跑 board.json 哈希一致。
- lib/model.ts 写死占位符「同类样本不足n」修为真实样本数。

## 前端打磨（Antigravity / Gemini 4 Neon，Muse 目检复核）
- 修复真功能 bug：「已发币对照」tab 切换失效（CSS display 覆盖 [hidden] 语义）；另修 sticky 横幅滚动遮挡、详情视图横幅错位、步骤卡孤立留白、双表列对齐作用域。

## 设计修复包（GPT 设计轮裁决 → Codex 执行 → Muse 校准收尾）
- 首屏新增机会决策地图（吸引力 = 隐含估值/TVL 相对中位；可靠性 = 置信非 low 且排名区间宽度 ≤ 全榜中位宽度）：优先研究 9 / 先验证 80 / 有据但不优先 8 / 暂不投入 81；估值前三全部落在「暂不投入」。
- 判定加副标（SKIP · 证据不足（暂不投入）等）；详情加「已知 / 未知 / 行动结论」三段；本榜 107 条 SKIP 全部源于低置信，「明确不做」计数为 0，已如实写入 MODEL_CARD。
- 口径修正：带符号误差中位数改称「中位偏差（带符号）」，主证据改为 3× 内占比（0.4889 vs 纯 TVL 0.4444）；P10–P90 改称「样本重采样排名波动区间」并注明不覆盖项；MODEL_CARD 加公开设计原则。
- board.json 全程逐字节不变。

## 最终产物（S2 提交基线，2026-11-26 晚全量构建 + 目检）
- board.json sha256 9547be915f49b0dbc825e7aef96362c1836d8c363733b70d55dab655faba9cab；178 行；live 128。
- dashboard 源码 57,205 字节（≤63,000）；dossier 1,125,160 字节（≤1.5MB）；gates 7/7。
- 三张截图全部重拍并经 Muse 目检：1-board（横幅 + hero + 决策地图）、2-detail（横幅置顶 + 已知/未知/行动结论 + 步骤通栏）、3-filtered（已发币对照表 128 行即时可见）。
- GitHub：文本提交 6384a84，截图提交 4f79add；公开仓与本地 dfd073e 状态一致。
- 报告：CODEX_SIM_RESULT.md、AGY_FE_RESULT.md、CODEX_DESIGN_RESULT.md；REWORK_RESULT.md 已追加本轮记录。