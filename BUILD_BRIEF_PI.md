# 构建简报（执行者：Pi 督导 + OpenCode 写码）

任务：把 make.fun token-radar-01 参赛作品在本仓完整构建出来并通过本地全门自检。设计已定稿，只实现、不改设计。

先读：本仓 DESIGN.md 全文（v3 为终规格，v2.1 未被覆盖的条款有效）、BUILD_LOG.md、~/workspace/makefun/token-radar-PREP.md。竞赛 kit 在 ~/workspace/makefun/token-radar-01-kit/（input/snapshot.json、cli/makefun.mjs、starter 参照）。

## 分工纪律（硬性，关系参赛资格）

- 你（Pi）是督导：下达实现指令、审查产出、跑验证、修问题、记日志。**你不许亲手写代码文件**（main.ts、lib/、dashboard/ 里的任何文件）——代码必须出自 OpenCode CLI 在本仓目录内运行的会话（kit 的 transcript 门要查会话记录：入口文件 ≥2 次写入、main.ts ≥30% 行数出自会话）。
- 写码通道：在本仓目录运行 `~/workspace/tools/agent-stack/node_modules/.bin/opencode run --model opencode-go/glm-5.3-flash "<具体实现指令>"`（stdin 必须 </dev/null；该命令形态若报错，先看 `opencode --help` 再调整）。备选模型 deepseek-v4.1-flash。**禁用 mimo-v2.6-flash 与任何 -free 结尾模型 id。**
- 文档文件（FIELD_REPORT.md、BUILD_LOG.md、BUILD_RESULT.md）你可以亲手写。
- 每个阶段完成 git commit 一次；BUILD_LOG.md 逐阶段追加。

## 实现清单（按 DESIGN v3）

1. 字段可用率表 → FIELD_REPORT.md：每类别已发币 mcap 非空条数、listed_at 非空条数、n<5 类别清单、近名重复量级。
2. 模型层：多因子拟合 log(mcap) ~ log(TVL) + 类别收缩截距 + 链收缩截距 + log(收录天数) 协变量；动量用已发币样本拟合系数（change_7d 按数据分位 winsorize），零手调幅度常数；分位数带 τ=0.25/0.5/0.75 + 每类 n 与 R² 披露、n<5 标低置信；影子回测（抽 50 个已发币假装未发币跑全管线，误差分布 + 区间覆盖率）；发币倾向指数（类别已发币占比 + 年龄 + 动量同类 z-score，与估值分离、标注非概率）；comps（同类 log TVL 最近 3 个已发币邻居）；置信徽章 + 每行一句数据规则生成的反证；Spearman 只报告 + 前 10 名与纯 TVL 排名分歧原因逐条。
3. 农场生成器：DAG 条件组合（桥接步仅多链、LP 步仅池子类、借贷步仅 Lending/CDP），每步注入协议自身数字，加闭环一行（建议投入 ÷ TVL = 份额% × 估值带 = 潜在空投区间，公式呈现）；措辞变体用 slug 哈希种子；数字白名单校验器作构建断言（只许快照原值 / 派生量 / 标注「估计」的常识档，白名单外数字拦截报错）；断言每步 20–600 UTF-8 字节、每行 3–12 步。
4. 产物：board.json 约 220 行（watchlist 40 全覆盖 + 地板以下约 180，隐含估值降序、slug 升序兜底）；data.js 写 output 根；dossier 经 vendor/makefun-board.ts 的 buildDossier 生成；dashboard 源码 ≤60KB UTF-8 且 dossier 零截断（断言红了回源码改文案，不许生成时截断）。
5. 看板：结论条（40/40 覆盖）+ master–detail 单屏；链 × 类别热力图带（格 = 未发币 TVL 占比）；组合卡三档（$500 / $2,000 / $10,000，贪心按预期空投 ÷ 成本配仓，构建时预计算）；方法论区（公式、拟合系数表、回测覆盖率、FDV 与流通市值口径披露、外部假设表）；可排序（估值 / TVL / 动量 / 年龄 / 拥挤度）、可筛选（类别 / 链 / TVL 档 / watchlist 开关）；详情面板含 comps、因子展示和完整一份农场计划。默认视图 = watchlist 40 行按估值排序、角标 40/40。
6. 截图 3 张（默认榜单、详情含完整农场计划、组合/热力图）：长边 ≤1440、短边 ≥800、2x 像素密度、每张 ≤512KiB。用 ~/.cache/hyperframes 的 Chrome Headless Shell 无头渲染本地页面；TMPDIR 指到 ~/workspace 下大磁盘目录（/tmp 只有 512MB）。
7. 程序约束：Node 22 标准库 only、无网络；禁用 Date.now / Math.random，时间取 snapshot.as_of；最后实跑两次，比对全部产物 sha256 必须一致。
8. 跑 kit 的 check 全门（dashboard_files / board_file / sorted_by_value / coverage / farm_steps / screenshots / dossier_matches），修到全过。

## 硬停止线

不建远程 GitHub 仓、不向 make.fun 提交、不花钱、不动钱包签名。遇到必须越过停止线才能继续的情形，停下并把情况写进 BUILD_RESULT.md。

## 收尾

把结构化结果写进 BUILD_RESULT.md：字段表要点、拟合系数表、影子回测覆盖率、Spearman 值、kit check 逐项结果、两次运行 sha256 一致证据、产物文件大小、截图路径、git 提交列表、未完成项（如实标注，不许把计划当完成）。
