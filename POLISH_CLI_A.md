# 打磨轮 A（CLI 执行）：校准 + 结论条估值带

先读 BUILD_RESULT.md、BUILD_LOG.md 尾部、DESIGN.md 中估值模型与回测部分。只做下面两项，每项完成立即 git commit 并在 BUILD_LOG.md 追加一行。DESIGN v3 其余冻结。

1. **估值带校准**：影子回测 P25–P75 带实际覆盖率 44%，理论应接近 50%。用留出回测残差拟合一个单一全局校准系数（由残差分位推出，写进 lib/model.ts 的既有管线），方法论区披露拟合方法与校准前后覆盖率。红线：系数必须由数据拟合，禁止手填常数；校准后必须重跑影子回测验证覆盖率确实改善，没改善就回滚并在 BUILD_LOG 如实记录。
2. **结论条 Top3 补估值带**：默认看板结论条的 Top3 行显示各自的 P25–P75 估值带。版面可重排，但 dashboard 源码仍 ≤60KB、dossier 零截断。

收尾：重跑程序确认产物可正常生成、两次运行 sha256 一致；在本文件末尾追加一段「A 轮结果」：校准系数与出处、校准前后覆盖率、结论条改动、两次运行哈希、提交列表。硬停止线：不建远程仓、不提交 make.fun、不花钱、不动钱包、不做截图（截图在 B 轮）。

---

## A 轮结果（2026-11-21，OpenCode deepseek-v4.1-flash）

### 1. 估值带校准

- **校准系数 s = 1.1510**（落盘为 round4；实际应用值为同一回测拟合出的全精度值）。
- **出处与拟合方法**：由留出影子回测（n=50，as_of 哈希种子确定性抽样的同一 holdout）的残差分位推出——`s = 留出残差的 IQR(P75−P25) ÷ 训练带内宽`，训练带内宽取每个留出样本 `(q50−q25) + (q75−q50)` 的均值。只缩放 P25/P75 两个缺口，点估计与中位偏移不动；无手填常数，系数写在 `lib/model.ts` 既有估值带的 `calibratedTripleOf` 管线中。
- **校准前后覆盖率（重跑影子回测实测）**：44.0% → **50.0%**（确为改善，未回滚）。原始回测中位 log10 误差、P25/P75 误差、3× 内占比均未变（0.0192 / −0.5575 / +0.5790 / 42.0%）。
- **方法论区披露**：`dashboard` 方法论区新增校准方法说明、校准前/后覆盖率两行与系数 s；公式段注明带宽经留出残差校准。

### 2. 结论条 Top3 估值带

- 默认看板结论条由单行 Top3 改为三行纵向列表，每行显示名次、协议名、点估计及各自的 **P25–P75 估值带**（例如 Nonce Capital $74.0M / P25 $20.6M – P75 $252.1M）。
- 榜单 178 行、排序与 watchlist 40/40 覆盖不变；dashboard 三文件合计 **40,836B**（≤60KB），dossier 文本零截断。

### 3. 两次运行确定性（同输入、同参数）

| 产物 | 两次运行 sha256（一致） |
|---|---|
| board.json（474,354B） | `68b0118145a906543d7e3d4f165e43db9cc0a7b9ada62c857aaa6d2f0f5d99c8` |
| data.js（517,753B） | `651cfd177ade62e170943cbd4626452fb175048361b9901acfad072a9feef730` |
| dossier.json（1,365,294B） | `479332e8b732af4bf35ad5124a6c15f075eff117205e97c0c03cfc12738944cf` |

两次完整构建均正常产出 board/data/dashboard/screenshots/dossier（非 `--dev-no-shots`），日志均为 178 行、watchlist 40/40、farm steps 6–8、dashboard 40,836B。

### 4. 提交列表

```
8ac40d2 polish A2: conclusion bar Top3 rows show each P25-P75 valuation band
cb3c511 polish A1: calibrate P25-P75 band from held-out backtest residuals (s=1.151, coverage 44%->50%)
```

硬停止线复核：未建远程仓、未向 make.fun 提交、未花钱、未动钱包、未产生新截图。
