# S2 设计修复结果

状态：未全部达标，按失败处理停止。未修改模型、数据或截图，未提交、推送或运行 makefun 命令。

- 修改文件：`dashboard/index.html`、`dashboard/app.js`、`dashboard/app.css`、`dashboard/MODEL_CARD.md`；本报告 `CODEX_DESIGN_RESULT.md`。
- 机会决策地图依次为：优先研究 0、先验证 89、有据但不优先 0、暂不投入 89，合计 178。吸引力中位数 0.4303054822656381；所有行均不满足高可靠性条件。抽查高吸引力、低可靠性的 Top 3：Keyrock、Axis、Flowdesk，按隐含估值降序。
- 原判定分布：FARM 21 / THIN 50 / SKIP 107。SKIP 副标计数：证据不足 107 / 明确不做 0。
- 完整构建 `MAKEFUN_OUTPUT_DIR=out-design node main.ts --input ./snapshot-dev.json`：0.837 秒；dashboard 57,046 字节，较开始的 52,559 字节增加 4,487 字节。
- `node tmp-chrome/gates.cjs out-design ./snapshot-dev.json /home/hatch/workspace/makefun/token-radar-work`：7/7 PASS；dossier 无截断。
- 构建后 `board.json` SHA-256：`9547be915f49b0dbc825e7aef96362c1836d8c363733b70d55dab655faba9cab`。
- 详情视图源码已加入「已知 / 未知 / 行动结论」；尚未进行浏览器视觉验收。

未达标项：

1. 榜单中无法同时出现两种 SKIP 副标：全部 107 条 SKIP 均为低置信度，没有非低置信度 SKIP。按指定映射和不改判定逻辑、数据的硬线，第二种必然为 0。
2. 全仓搜索仍在历史文件 `REWORK_RESULT.md` 第 5 行发现「中位 log 误差 0.0032」，且同文件还有其他旧称呼。硬线仅允许修改 dashboard 指定文件与本报告，因此未改写历史文件。此外 `lib/model.ts` 仍含「中位对数误差」文字，展示时由数据假设传入，硬线禁止修改 lib；该动态文案尚未修正。
3. 未完成浏览器中榜单与详情的视觉验收；发现上述冲突后依指示停止。
