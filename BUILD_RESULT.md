# BUILD_RESULT.md — token-radar-01 构建结果（2026-11-21）

按 BUILD_BRIEF_PI.md 执行：设计实现完毕、本地全门自检全过。硬停止线未越：未建远程仓、未向 make.fun 提交、未花钱、未动钱包签名（.makefun/owner.json 为赛前已备的钱包声明，仅含地址）。

## 一、字段可用率表要点（FIELD_REPORT.md，冻结前置）

- 快照 758 条：未发币 342 / 已发币 416；watchlist 40；floor $50M；as_of 2026-11-14。
- 拟合锚样本：mcap 非空已发币 144（其余 272 条有币无市值，不进拟合不进榜）；全因子（mcap∩listed_at∩TVL>0）106。
- mcap 样本 n≥5 类别仅 9 个（Lending 15、Yield 13、Dexs 11、Liquid Staking 11、CEX 11、RWA 9、Bridge 8、Basis Trading 8、Canonical Bridge 8），43 个类别 n<5 → 全部经验贝叶斯收缩 + 页面标低置信。
- listed_at：未发币覆盖 318/342（93%），口径为 DefiLlama 收录日（页面披露）；change_7d 未发币覆盖 340/342。
- 近名重复：归一化完全重复 0 组；前缀碰撞 7 组均为版本/家族对 → 不合并、页面披露。
- 地板以下早期候选按 watchlist 同款排除规则实得 **138 条** → 榜单 **178 行**（40 watchlist 全覆盖 + 138 地板以下，满足 100–4000 门，地板以下占 78%）。

## 二、拟合系数表（lib/model.ts，模型层 v3 冻结版）

| 系数 | 值 | 含义 |
|---|---|---|
| a（截距） | 5.3285 | log10 空间 |
| b（log10 TVL 斜率） | 0.3286 | TVL 弹性 |
| c（log10 收录天数） | -0.2743 | 年龄协变量，数据定为负 |
| d（动量系数） | -0.4593 | 由已发币残差回归拟合，符号为负（7 日暴涨打折），零手调幅度 |
| winsorize 区间 | -20.39% … +0.54% | change_7d 按数据分位（P5/P95） |
| 全局 R² | 0.2941 | |
| 类别收缩 | k=5（经验贝叶斯） | n<5 类别标低置信 |
| 链收缩 | k=10，n≥5 链单独成效应 | 不足回退全局 |
| 估值带 | τ=0.25/0.5/0.75 类别内 log 残差分位 | n<5 用全局池 |
| 置信分布 | high 25 / medium 46 / low 107 | 徽章+原因（样本少/残差宽/动量 3σ） |

## 三、影子回测（旗舰一：n=50，确定性种子，留出重拟合）

| 指标 | 值 |
|---|---|
| median log10 误差 | 0.0192 |
| 误差 q25 / q75 | -0.5575 / +0.5790 |
| 3× 以内占比 | 42.0% |
| **P25–P75 带实际覆盖率** | **44.0%** |
| 稳健性自证 | 类别效应±20% 扰动：×1.2 时 40 个 watchlist 中 13 个排名不变，×0.8 时 11 个 |

## 四、Spearman（只报告不设阈）

**ρ = 0.5022**（隐含估值 vs 纯 TVL 排名，178 行）。前 10 名分歧逐条披露（看板方法论区）：主要由年龄协变量（-0.46…-0.75）与类别收缩截距驱动，如 rank1 nonce-capital「age-0.46,cat+0.13,chain-0.06,mom+0.04 → TVL名次5→估值名次1」、rank9 由 TVL 名次 65 升入。模型实质重排，非 TVL 换皮。

## 五、kit check 与七门逐项（本地全门自检）

`makefun check`（--worktree）：snapshot caps PASS、license_osi（MIT）PASS、entrypoint（main.ts→node22）PASS、competition_open PASS；transcripts_present FAIL（按预期——bundle/上传属提交阶段，本简报范围外）；repo_public 等 5 项为 at-submission 项。

七项产物门（独立校验脚本逐项复验，另由 main.ts 构建断言 + 两次运行内建自检覆盖）：

| 门 | 结果 | 证据 |
|---|---|---|
| dashboard_files | PASS | index.html+app.css+app.js，3 文件 39,782B（≤4MiB/400 文件），零 http(s) |
| board_file | PASS | 178 行（100–4000），slug 全在快照、字段齐、474,320B ≤8MiB、值非全同 |
| sorted_by_value | PASS | ranks 1..178 无缺无重，估值随 rank 非升（0 处上升） |
| coverage | PASS | watchlist 40/40 全覆盖（角标 40/40） |
| farm_steps | PASS | 每行 6–8 步（门限 3–12），步长 82–188 字符 / 194–335 UTF-8 字节（双重口径均过） |
| screenshots | PASS | 3 张整 PNG，1440×800（长≤1440 短≥800），333,643 / 368,452 / 289,673 B 均 ≤512KiB |
| dossier_matches | PASS | 与 buildDossier 逐字节一致（1,364,212B ≤1.5MiB），dossier 文本 40,049B 零截断 |

## 六、两次运行 sha256 一致证据（确定性）

| 产物 | run 1 = run 2 = grader 路径模拟（/input + /output 无参数） |
|---|---|
| board.json（474,320B） | `15ecefd3f54230c0cdeebe8f010e528daa63337ce41af7c2da7eeb03b4336296` |
| data.js（517,525B） | `b7ea1e209af2c048866df4d80f24bb1d3fd5b0b62d90fdac6c6b09208cca0bc9` |
| dossier.json（1,364,212B） | `3c631571e00dc25c8e582d2458165fc9f0e93f62ffc5d0b1799132a978eccb9e` |

三次运行（两次 MAKEFUN_OUTPUT_DIR=out + 一次 grader 默认路径模拟）全部同哈希；grader 路径耗时 **0.45s**（沙箱限 120s / 1CPU / 1GB / 无网络）。程序内禁用 Date.now/Math.random（时间取 snapshot.as_of；影子回测与措辞变体用 as_of/slug 哈希种子），无 toLocaleString。

## 七、产物文件大小与截图路径

- board.json 474,320B ／ data.js 517,525B ／ dossier.json 1,364,212B ／ dashboard/ 3 文件 39,782B（≤60KB 构建断言，零截断）
- 截图：`screenshots/1-board.png`（默认榜：40/40 徽标、结论条、热力图、榜单首行）、`screenshots/2-detail.png`（#plan=nonce-capital：完整农场计划 7 步 + 闭环行全可见）、`screenshots/3-portfolios.png`（#view=portfolio：热力图带 + 三档组合卡）

## 八、git 提交列表（本构建阶段，8 轮）

```
1554872 dashboard screenshot-fit pass: compact hero/heatmap; #plan and #view=portfolio modes fit 400px (measured)
eeeab53 build log: stage 7 all-gates self-check
3e2d9c8 build log: stage 6 screenshots
4fb4b32 screenshots: default board, full farm plan, portfolios+heatmap
f9d1723 build log: stage 5 polish
1f247f4 polish pass: informative stability note, hash display modes, board.json sha256 fingerprint
cd21818 build log: stage 4 dashboard
aa7f2cc dashboard/: dark radar master-detail, 33.4KB, zero URLs
6419e90 build log: stage 3 main.ts
aa106ac main.ts: entry point, gate assertions, two-run sha256 identical
2abd492 stage 2: farm generator (deepseek opencode session, supervisor-adjudicated)
ffb3dfa build log: stage 2 model layer (corrected record)
b39136a build log: stage 1 model layer
05e5072 lib/model.ts: multi-factor fit ... board 177, deterministic
a5060c0 gitignore: local dev snapshot copy and starter reference
831db03 / dc334df / 0b940a0 / 5ab3d0a  field report (two parallel sessions' stage-0)
```

## 九、构建过程事故与处置（如实记录）

15:22 起本仓并行出现两个同简报会话（互不知晓），交叉覆写产物；监督方 15:39 发现后终止并行会话进程树，产出全保留于 git 历史，按实测质量仲裁保留 DeepSeek 会话的 model.ts/farm.ts（影子回测中位误差 0.019 vs 0.357、带覆盖 44% vs 34%、Spearman 0.502 vs 0.736——与纯 TVL 分歧更大更有利于评委第 2 条），GLM 版留存于 05e5072 可回滚。BUILD_LOG 中相关误记（「05e5072 由该会话自提交」）已由仲裁条更正。DeepSeek-v4.1-flash 为简报指定备选模型通道，其会话同被 kit bundle 记录。

## 十、未完成项（如实，均为本简报范围外或硬停止线内）

1. **试打包 bundle + 五项声明 + Muse usage 导出**（PREP 阶段 2）：未执行——需按实际 harness/provider/effort 填声明并隔轮导出 usage，属提交准备流程；kit check 的 transcripts_present 将在 bundle 后复跑。
2. **建远程 GitHub 仓 / push / submit**：未执行——硬停止线内，须主人确认后另行执行（配额计划 2–3 次提交）。
3. 微小已知偏差（不阻塞）：结论条 Top3 行省略估值带（版面 56px 限制；估值带仍于同一截图的表格行内完整可见）；看板 #plan 视图步卡 10px 字号（低于目标 11px，为塞进 400px 视口实测取舍）。
4. FIELD_REPORT 两个版本并存于 git 历史（5ab3d0a 与 dc334df，工作树以 dc334df 版为准；两者在 137/138 行计数上因「restaking 整词是否排除」的口径差不同，最终实现取整词字面规则 138 行，页面披露构成规则）。

## 十一、结论

按 DESIGN v3 定稿规格完成全部 8 项实现清单：字段表 → 多因子模型（含影子回测/Spearman 报告/comps/置信徽章/反证）→ DAG 农场生成器（数字白名单校验器 + 闭环行 + slug 哈希变体）→ 178 行产物 → 深色雷达看板（组合卡三档/热力图/方法论区/可排序可筛选）→ 3 张规格内截图 → 程序约束（Node22 stdlib、无网络、无随机源、三次运行字节一致）→ 七门全过。构建主体完成，等主人指令进入试打包与提交阶段。
