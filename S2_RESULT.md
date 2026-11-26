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
EOF
cd /home/hatch/workspace/makefun/token-radar-work && echo written