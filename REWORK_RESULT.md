# REWORK_RESULT.md — 阶段 1

## OOF 回测（K=5，n=90）

- 完整模型：中位 log 误差 0.0032；P25–P75 带覆盖率 0.4111；3× 内 0.4889
- 基线 A · 纯 TVL：中位 log 误差 0.0549；覆盖率 0.4778；3× 内 0.4444
- 基线 B · 类别中位数：中位 log 误差 -0.2022；覆盖率 0.2333；3× 内 0.4111
- 校准系数：0.9781（校准前/后覆盖率均为 0.4111）
- Spearman ρ（隐含估值 vs 纯 TVL 排名）：0.5022

## 账本四数

- 有代币记录且有市值：144
- 有代币记录无市值：272
- 未记录且上榜：178
- 未记录未上榜：164
- 合计：758

## 产物

- dashboard 源码：48,790 字节（≤63,000）
- dossier：1,435,118 字节（≤1.5MB）
- 截图：1-board.png 344,624B；2-detail.png 396,673B；3-portfolios.png 296,653B（均 ≤512KiB，1440×800）
- board.json sha256：47f17d7acc4781b43dfae1bcfdebda01ae3f499c86e59eca0720efa10846f2a4
- gates：7/7 PASS
- 构建耗时：<120s

## 未完成

无。

# REWORK_RESULT.md — 阶段 3 + 阶段 2.5 修正

## 阶段 2.5：判定一致性与去模板化（Muse 验收驱动）

- SKIP 行（107 条）不再给建仓指令：farm_steps 改为「不做理由（引用拥挤度/7 日变化/地板距离/区间宽度）+ 重估触发」；THIN 行首步含仓位上限提示。
- stop_condition 按 category 分 4 套模板（借贷 / CDP / 收益聚合 / 其他），阈值按行数据确定性取值，同类内 ≥3 句式按 slug hash 轮换。
- 修正一处逻辑 bug（Muse 验收发现）：重估触发原写死「TVL 回升至 $50.00M 以上」，对大 TVL 行已然满足、无意义；改为本行 TVL 的 1.5×、区间收窄至当前宽度一半（下限 10 名）。例 rank 1：$770.68M / 15 名内。修复经过数字白名单守卫（triggerWidth 须经 integer() 注册）一次构建失败后通过。
- 计划相似度自检（抽 20 个计划、去协议名、整句重复率）：**45.49%（126/277 句）**，较阶段 2 的 58.15% 下降，但**未达到简报目标 ≤40%**。剩余重复主要来自 SKIP 行两段式骨架（不做理由 + 重估触发）与闭环测算句式；判定与建议的自相矛盾已消除，模板味仍在，见下「未完成」。

## 呈现与截图

- 三泳道盘点横幅已上屏（758 全量 → 416 已发币对照 → 342 未记录 → 178 上榜，数字取 ledger 实时计算），横幅改为 sticky（滚动时置顶）；双 tab 保留；榜单行显示「#N（P10–P90：a–b）」与 token_status 状态列。
- 首屏行数修复（Muse 目检驱动）：初版横幅+hero+热力图把榜单推到首屏之外（0 行）；修了两处 CSS——横幅 sticky、榜单首列 white-space:nowrap（原排名区间换行占 4 行）——现 1-board 首屏 13 行以上。
- 三张截图重拍（1440×800、每张 ≤512KiB）：1-board.png 278,444B（横幅 sticky + 表头 + 13 行）、2-detail.png 247,211B（rank 1 详情：不做理由/重估触发/闭环测算/反证行 + 横幅）、3-filtered.png 294,804B（已发币对照 tab 激活态，替代原 portfolios 图；旧 3-portfolios.png 已删）。

## 产物

- dashboard 源码：50,986 字节（≤63,000）
- dossier：1,147,377 字节（≤1.5MB）
- board.json sha256：bad8967e06629318ea0a33a2dabef412c7bb4f3e4d709a9b0dc60c5f18d56e55（两次连续构建一致）
- gates：7/7 PASS（dashboard_files / board_file / sorted_by_value / coverage 40/40 / farm_steps 3–12 步 / screenshots 1440×800 / dossier_matches byte-identical、无截断）
- 构建耗时：<120s

## 未完成

- 计划相似度 45.49%，未达 ≤40% 目标。原因：SKIP 行两段式骨架与闭环测算句式仍高度雷同；再降需重写步骤生成模板（新句式池 × 类别 ×  verdict 组合），本轮未做。
- 阶段 2 构建方曾报的 dossier 1,435,995B 是含旧截图的版本；本轮重拍后 dossier 为 1,147,377B。

# REWORK_RESULT.md — 阶段 2

## 排名稳定性（bootstrap）

- bootstrap 重采样次数（实际使用）：200（未超时，未降至 100）
- 每行输出 P10–P90 排名区间（字段 rank_p10 / rank_p90 / rank_lo / rank_hi）与三模型中位排名（median_model_rank，模型：现模型 / 类别中位数 comps / 去动量与年龄的基准）
- 区间示例：rank 178 → P10–P90 92–176

## 农场判定

- 判定分布：FARM 21 / THIN 50 / SKIP 107（共 178）
- 每计划含 verdict、stop_condition（协议级停止条件）、break_even_share_pct（投 $100 回本所需分配份额，低/中/高三档情景）
- 计划相似度自检（抽 20 个计划、去掉协议名）：整句重复率 58.15%（321/552 句）

## 产物

- dashboard 源码：49,657 字节（≤63,000）
- dossier：1,435,995 字节（≤1.5MB）
- board.json sha256：da244d24f00e3ddbc00294733087721b45f3f016abc5bed87dc32d4add955d69
- gates：7/7 PASS
- 构建耗时：<120s

## 未完成

无。
