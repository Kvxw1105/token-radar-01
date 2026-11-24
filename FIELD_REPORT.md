# 字段可用率表（token-radar-01 快照，2026-11-21，模型层冻结前置条件）

数据源：`~/workspace/makefun/token-radar-01-kit/input/snapshot.json`（as_of 2026-11-14，758 条协议，watchlist 40，floor $50,000,000）。
统计脚本为一次性 Node 探针（`/tmp/fr/`，不进仓），口径如下：

- **已发币判定**：`gecko_id` 与 `symbol` 均为 null 才算未发币（与 watchlist 同口径）。快照内未发币 342、已发币 416。
- **已发币 mcap 非空**：144 / 416。其余 272 条已发币协议有 gecko_id/symbol 但 DefiLlama 未记市值——**这 272 条既不能进榜也不能进拟合**，有效锚样本只有 144。
- **拟合全因子样本**（mcap∩listed_at∩TVL>0）：106 条。全部 106 条 change_7d 非空。
- **listed_at 非空**：全体 645/758；未发币 318/342（覆盖率 93%）。listed_at 是 DefiLlama 收录日、非协议上线日，页面须披露。

## 一、每类别字段可用率（按协议总数降序，仅列 n≥3 的类别）

| 类别 | 协议总数 | 已发币数 | mcap非空 | listed_at非空 | 未发币数 | 未发币listed_at非空 |
|---|---|---|---|---|---|---|
| Dexs | 99 | 73 | 11 | 81 | 26 | 26 |
| Liquid Staking | 78 | 40 | 11 | 71 | 38 | 37 |
| Lending | 75 | 59 | 15 | 65 | 16 | 16 |
| CEX | 56 | 14 | 11 | 50 | 42 | 37 |
| Bridge | 55 | 27 | 8 | 50 | 28 | 27 |
| Risk Curators | 39 | 5 | 1 | 39 | 34 | 34 |
| Yield | 39 | 23 | 13 | 33 | 16 | 16 |
| RWA | 33 | 17 | 9 | 33 | 16 | 16 |
| Canonical Bridge | 32 | 17 | 8 | 9 | 15 | 5 |
| Onchain Capital Allocator | 29 | 9 | 3 | 28 | 20 | 20 |
| Derivatives | 26 | 13 | 2 | 23 | 13 | 13 |
| Yield Aggregator | 23 | 14 | 5 | 14 | 9 | 9 |
| Basis Trading | 21 | 13 | 8 | 21 | 8 | 8 |
| CDP | 20 | 10 | 3 | 17 | 10 | 9 |
| Staking Pool | 11 | 5 | 2 | 10 | 6 | 6 |
| Liquid Restaking | 9 | 6 | 2 | 9 | 3 | 3 |
| Chain | 8 | 3 | 1 | 5 | 5 | 3 |
| Liquidity Manager | 8 | 5 | 1 | 7 | 3 | 3 |
| Cross Chain Bridge | 7 | 6 | 4 | 6 | 1 | 1 |
| Leveraged Farming | 6 | 4 | 1 | 5 | 2 | 2 |
| Restaking | 6 | 4 | 2 | 6 | 2 | 2 |
| Indexes | 6 | 5 | 3 | 1 | 1 | 0 |
| Farm | 5 | 2 | 1 | 5 | 3 | 3 |
| Token Locker | 5 | 5 | 2 | 5 | 0 | 0 |
| Launchpad | 4 | 4 | 1 | 4 | 0 | 0 |
| Anchor BTC | 4 | 2 | 0 | 4 | 2 | 2 |
| Dual-Token Stablecoin | 4 | 2 | 2 | 3 | 2 | 2 |
| Privacy | 4 | 3 | 3 | 3 | 1 | 1 |
| Synthetics | 3 | 3 | 0 | 2 | 0 | 0 |
| Decentralized BTC | 3 | 1 | 0 | 3 | 2 | 2 |
| Options | 3 | 3 | 1 | 2 | 0 | 0 |
| CeDeFi | 3 | 1 | 0 | 3 | 2 | 2 |
| Restaked BTC | 3 | 1 | 0 | 3 | 2 | 2 |
| Payments | 3 | 2 | 2 | 2 | 1 | 0 |
| Prediction Market | 3 | 1 | 1 | 3 | 2 | 2 |

（其余 15 个类别各 1–2 条，合计 17 条协议：CDP Manager、Crypto Card Issuer、Insurance、Algo-Stables、Governance Incentives、AI Agents、Stablecoin Wrapper、Uncollateralized Lending、Collateral Management、NFT Marketplace、Interest Rate Derivatives、Decentralized AI、OTC Marketplace、Stablecoin Issuer、Options Vault、Collateral Markets、Reserve Currency、DOR——其中 mcap 非空仅 5 条。）

## 二、mcap 样本 n<5 的类别清单（模型收缩对象）

43 个类别 mcap 非空样本 <5（含 20 个为 0 的类别）。mcap 样本 ≥5 的类别仅 9 个：Lending(15)、Dexs(11)、Liquid Staking(11)、CEX(11)、Yield(13)、RWA(9)、Bridge(8)、Basis Trading(8)、Canonical Bridge(8)。

**拟合全因子（mcap∩listed_at）样本 n≥5 的类别只有 8 个**：Lending(11)、CEX(10)、Yield(9)、Liquid Staking(9)、RWA(9)、Basis Trading(8)、Dexs(6)、Bridge(6)。链收缩同理：fittable 样本中 Ethereum(72)、Arbitrum(34)、Binance(32)、Base(29)、Polygon(26)、Avalanche(25)、Optimism(21)、Solana(20) 样本足，长尾链不足。

**结论**：类别收缩截距与链收缩截距必须用经验贝叶斯向全局拟合收缩（收缩强度随 n 自动变化），n<5 类别在页面标「低置信」——否则 43 个类别里超过一半的截距是噪声。

## 三、近名重复量级

- 归一化名称（去空格/标点、小写）**完全重复组：0**。
- 前 12 字符前缀碰撞组：7 组，全部为同家族版本对或姊妹产品（Binance staked ETH/SOL、Curve LlamaLend(±V2)、Figure Markets Exchange/Prime、Meteora DAMM V1/V2、PancakeSwap AMM(±V3)、Theo thBill/thUSD、UNCX V2/V3），非同一协议多链重复。
- **裁决**：无明确重复，不合并行；7 组前缀碰撞在看板方法论区披露即可。

## 四、对模型层的直接影响（冻结前确认）

1. 锚池 106 条足够拟合全局 log-log 斜率与残差分位，但类别/链截距大面积依赖收缩；分位数带 τ=0.25/0.5/0.75 在 n<5 类别必然宽，低置信标记必须真实生效。
2. 未发币 342 条中 listed_at 覆盖 93%、change_7d 覆盖 99%（340/342），log(收录天数) 协变量与动量 winsorize 在榜内可用性良好。
3. watchlist 40 全部 tvl ≥ $51.27M，地板以下早期候选（沿用 watchlist 同款排除规则：非包装/质押/桥接/CEX/版本名，且不在 watchlist）共 **138 条**（listed_at 134/138、change_7d 136/138 非空）。DESIGN 目标「地板以下约 180」按排除规则如实收敛为 138，榜单合计 **178 行**（≥100 硬门槛余量充足），页面披露入选规则与收敛原因。
4. 全样本 mcap/TVL 比中位数 0.17（P10≈0.00、P90≈2.06），类别间差异大，证实「倍数从数据长出来」而非全局常数——v1 全局 0.25 常数会被 P10/P90 跨两个数量级的现实打穿。
5. 272 条「有代币但无市值」协议单独归为 live-without-mcap 组，不进拟合、不进榜，页面口径披露。

## 五、影子回测与自检的可行口径

- 影子回测抽 50 个已发币：从 106 条 fittable 样本按确定性种子（slug 哈希序，禁 Math.random）抽取，跑全管线后对比真实 mcap；75% 带覆盖率实算。
- Spearman（榜内 178 行 隐含估值 vs 纯 TVL 排序）：只报告、不设阈值；前 10 名逐条写与纯 TVL 排名的分歧原因。
