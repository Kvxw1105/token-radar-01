# 农场计划降重验收

- 修改文件：`lib/farm.ts`（SKIP 理由与触发、闭环测算、建仓、第二池调仓和退出句式，以及操作卫生中的行数据）；`lib/model.ts`（用真实同类样本数替换占位符）；本报告 `CODEX_SIM_RESULT.md`。
- 构建抽样整句重复率：**33.78%（101/299）**，原口径未变。
- 判定分布：FARM 21、THIN 50、SKIP 107；共 178 行，watchlist 40/40。
- 两次 `--dev-no-shots` 的 `board.json` SHA-256 均为 `9547be915f49b0dbc825e7aef96362c1836d8c363733b70d55dab655faba9cab`。
- 完整构建及 `tmp-chrome/gates.cjs`：**7/7 通过**；dashboard 4 个文件共 50,986 字节，完整构建耗时 0.835 秒，生成 3 张截图。
- 产物中未发现 `同类样本不足n`。构建期间数字白名单检查通过。
- 未达标项：无。
