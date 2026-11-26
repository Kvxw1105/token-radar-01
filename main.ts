// A token-radar-01 entry point (Node 22, standard library only, erasable TypeScript).
//
// It reads the sealed snapshot (--input <snapshot.json|directory>, default /input), scores the board
// with lib/model.ts, gives every board row a farm plan with lib/farm.ts, validates both layers, then
// writes <out>/board.json and <out>/data.js, copies dashboard/ and screenshots/ into <out> and, when
// the screenshots are present, writes <out>/dossier.json with the vendored make.fun library.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ./snapshot-dev.json --dev-no-shots

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { assertBoard, buildRadar, determinismNote, earlyExclusionReason, parseSnapshot, type BoardRow, type Snapshot } from './lib/model.ts';
import {
  assertFarmPlans,
  buildFarmPlan,
  buildPortfolios,
  validateFarmPlan,
  BUDGETS,
  planSimilarityCheck,
  type FarmPlan,
  type FarmRow,
} from './lib/farm.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const BOARD_JSON_MAX_BYTES = 8 * 1024 * 1024;
const DASHBOARD_SOURCE_MAX_BYTES = 61_440;

const fail = (message: string): never => {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
};

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

// ---------------------------------------------------------------- input

const inputArg = arg('input', '/input');
let inputFile = inputArg;
try {
  if (statSync(inputArg).isDirectory()) inputFile = join(inputArg, 'snapshot.json');
} catch {
  // Not a statable path: the existsSync check below reports it.
}
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}

let snapshot: Snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (err) {
  const why = err instanceof Error ? err.message : String(err);
  process.stderr.write(`token radar: snapshot at ${inputFile} is not usable: ${why}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------- model + farm plans

const { board, radar } = buildRadar(snapshot);

// ---------------------------------------------------------------- token ledger (mutually exclusive four-way partition)
const boardSlugSet = new Set(board.map((r) => r.slug));
const issuedWithMcap = snapshot.protocols.filter((p) => (p.gecko_id !== null || p.symbol !== null) && p.mcap_usd !== null);
const issuedNoMcap = snapshot.protocols.filter((p) => (p.gecko_id !== null || p.symbol !== null) && p.mcap_usd === null);
const unissuedListed = snapshot.protocols.filter((p) => p.gecko_id === null && p.symbol === null && boardSlugSet.has(p.slug));
const unissuedUnlisted = snapshot.protocols.filter((p) => p.gecko_id === null && p.symbol === null && !boardSlugSet.has(p.slug));

if (issuedWithMcap.length !== 144) fail(`ledger: issued_with_mcap=${issuedWithMcap.length}, expected 144`);
if (issuedNoMcap.length !== 272) fail(`ledger: issued_no_mcap=${issuedNoMcap.length}, expected 272`);
if (unissuedListed.length !== 178) fail(`ledger: unissued_listed=${unissuedListed.length}, expected 178`);
if (unissuedUnlisted.length !== 164) fail(`ledger: unissued_unlisted=${unissuedUnlisted.length}, expected 164`);
const ledgerTotal = issuedWithMcap.length + issuedNoMcap.length + unissuedListed.length + unissuedUnlisted.length;
if (ledgerTotal !== snapshot.protocols.length) fail(`ledger: total=${ledgerTotal}, expected ${snapshot.protocols.length}`);
const ledgerSlugs = [...issuedWithMcap, ...issuedNoMcap, ...unissuedListed, ...unissuedUnlisted].map((p) => p.slug);
if (new Set(ledgerSlugs).size !== ledgerSlugs.length) fail('ledger: duplicate slug across partitions');
for (const p of unissuedUnlisted) {
  if (earlyExclusionReason(p, snapshot.floor_usd).length === 0) fail(`ledger: missing exclusion reason for ${p.slug}`);
}

// write ledger file
const ledgerJson = JSON.stringify({
  counts: {
    issued_with_mcap: issuedWithMcap.length,
    issued_no_mcap: issuedNoMcap.length,
    unissued_listed: unissuedListed.length,
    unissued_unlisted: unissuedUnlisted.length,
    total: ledgerTotal,
  },
  issued_with_mcap: issuedWithMcap.map((p) => p.slug),
  issued_no_mcap: issuedNoMcap.map((p) => p.slug),
  unissued_listed: unissuedListed.map((p) => p.slug),
  unissued_unlisted: unissuedUnlisted.map((p) => ({ slug: p.slug, exclusion_reason: earlyExclusionReason(p, snapshot.floor_usd) })),
}, null, 2);
const farmPlans: { row: FarmRow; plan: FarmPlan }[] = [];
for (const boardRow of board) {
  const row: FarmRow = {
    slug: boardRow.slug,
    name: boardRow.name,
    category: boardRow.category,
    chains: boardRow.chains,
    tvl_usd: boardRow.tvl_usd,
    change_7d: boardRow.change_7d,
    age_days: boardRow.age_days,
    implied_value_usd: boardRow.implied_value_usd,
    band_lo: boardRow.band_lo,
    band_hi: boardRow.band_hi,
    crowding: boardRow.crowding,
    rank: boardRow.rank,
    rank_p10: boardRow.rank_p10,
    rank_p90: boardRow.rank_p90,
    token_status: boardRow.token_status,
    confidence_level: boardRow.confidence.level,
  };
  const plan = buildFarmPlan(row, snapshot.floor_usd);
  const violation = validateFarmPlan(row, plan);
  if (violation !== null) { fail('farm plan for ' + row.slug + ' fails its own gate: ' + violation); }
  farmPlans.push({ row, plan });
}

const rowsWithSteps: (BoardRow & {
  farm_steps: string[];
  capital_usd: number;
  share_pct: number;
  airdrop_lo: number;
  airdrop_hi: number;
  value_exposure_lo: number;
  value_exposure_hi: number;
  capital_at_risk: number;
  verdict: string;
  stop_condition: string;
  break_even_share_pct: { low: number; mid: number; high: number };
  break_even_share_pct_lo: number;
  break_even_share_pct_mid: number;
  break_even_share_pct_hi: number;
  scenario_pct: number;
  scenario_lo: number;
  scenario_hi: number;
})[] = board.map((boardRow, i) => {
  const plan = farmPlans[i]!.plan;
  return {
    ...boardRow,
    farm_steps: plan.steps,
    capital_usd: plan.capital_usd,
    share_pct: plan.share_pct,
    airdrop_lo: plan.airdrop_lo,
    airdrop_hi: plan.airdrop_hi,
    value_exposure_lo: plan.value_exposure_lo,
    value_exposure_hi: plan.value_exposure_hi,
    capital_at_risk: plan.capital_at_risk,
    verdict: plan.verdict,
    stop_condition: plan.stop_condition,
    break_even_share_pct: plan.break_even_share_pct,
    break_even_share_pct_lo: plan.break_even_share_pct_lo,
    break_even_share_pct_mid: plan.break_even_share_pct_mid,
    break_even_share_pct_hi: plan.break_even_share_pct_hi,
    scenario_pct: plan.scenario_pct,
    scenario_lo: plan.scenario_lo,
    scenario_hi: plan.scenario_hi,
  };
});

const boardIssue = assertBoard(rowsWithSteps, snapshot);
if (boardIssue !== null) { fail('the model wrote a board the gate refuses: ' + boardIssue); }
const plansIssue = assertFarmPlans(
  rowsWithSteps.map((row) => ({ slug: row.slug, steps: row.farm_steps })),
  farmPlans.map((entry) => entry.row),
  snapshot.floor_usd,
);
if (plansIssue !== null) fail(`a farm plan the gate refuses: ${plansIssue}`);

const similarity = planSimilarityCheck(
  rowsWithSteps.map((row) => ({ slug: row.slug, name: row.name, steps: row.farm_steps })),
  20,
  snapshot.as_of,
);
process.stdout.write(
  `token radar: plan similarity (sampled ${similarity.sampled}): repetition rate ${(similarity.repetition_rate * 100).toFixed(2)}% (${similarity.total_sentences - similarity.unique_sentences}/${similarity.total_sentences} sentences)\n`,
);

const portfolios = buildPortfolios(farmPlans);
if (
  portfolios.length !== BUDGETS.length ||
  portfolios.some((card, i) => card.budget !== BUDGETS[i])
) {
  fail(`buildPortfolios returned budgets [${portfolios.map((card) => card.budget).join(', ')}], expected [${BUDGETS.join(', ')}]`);
}

// ---------------------------------------------------------------- output directory

const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
mkdirSync(out, { recursive: true });
try { writeFileSync(join(out, 'ledger.json'), ledgerJson); } catch { /* ledgerJson may be undefined in some paths */ }

const boardJson = `${JSON.stringify({ rows: rowsWithSteps, live: radar.live, counts: { board: rowsWithSteps.length, live: radar.live.length } })}\n`;
const boardBytes = Buffer.byteLength(boardJson, 'utf8');
if (boardBytes > BOARD_JSON_MAX_BYTES) {
  fail(`board.json is ${boardBytes} bytes, over the ${BOARD_JSON_MAX_BYTES} the gate allows`);
}
writeFileSync(join(out, 'board.json'), boardJson);
const boardSha256 = createHash('sha256').update(boardJson, 'utf8').digest('hex');

const payload = {
  ...radar,
  portfolios,
  determinism: determinismNote(),
  plans: Object.fromEntries(
    rowsWithSteps.map((row) => [
      row.slug,
      {
        steps: row.farm_steps,
        capital_usd: row.capital_usd,
        share_pct: row.share_pct,
        airdrop_lo: row.airdrop_lo,
        airdrop_hi: row.airdrop_hi,
        verdict: row.verdict,
        stop_condition: row.stop_condition,
        break_even_share_pct: row.break_even_share_pct,
      },
    ]),
  ),
};
const dataJs = `window.RADAR=${JSON.stringify(payload)};\n`;
writeFileSync(join(out, 'data.js'), dataJs);

// ---------------------------------------------------------------- dashboard + screenshots

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const copiedDashboard = copyFiles(join(import.meta.dirname, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(import.meta.dirname, 'screenshots'), join(out, 'screenshots'));

const devNoShots = hasFlag('dev-no-shots');
let dossierSize = 0;
if (devNoShots) {
  process.stdout.write(`token radar: --dev-no-shots: the screenshot gate and dossier.json are skipped (dev-only; hand in 3 screenshots before submitting)\n`);
} else {
  if (shots.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
    process.exit(1);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
  }

  // The dossier's text holds the whole dashboard source, so it must fit the text cap whole: the fix
  // for a large page is to shrink it, never to truncate.
  const sourceFiles = dashboardSourceFiles(join(import.meta.dirname, 'dashboard'));
  const sourceTotal = sourceFiles.reduce((sum, file) => sum + file.size, 0);
  if (sourceTotal > DASHBOARD_SOURCE_MAX_BYTES) {
    for (const file of sourceFiles) {
      process.stderr.write(`token radar: dashboard/${file.path} is ${file.size} bytes\n`);
    }
    process.stderr.write(`token radar: dashboard source is ${sourceTotal} bytes, over the ${DASHBOARD_SOURCE_MAX_BYTES} the dossier text can hold whole\n`);
    process.exit(1);
  }

  let dossierBytes: Uint8Array;
  try {
    dossierBytes = buildDossier(out, {
      text_max_bytes: TEXT_MAX_BYTES,
      screenshots: SCREENSHOT_CAPS,
      dashboard: DASHBOARD_CAPS,
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    process.stderr.write(`token radar: buildDossier refuses this /output: ${why}\n`);
    process.exit(1);
  }
  writeFileSync(join(out, 'dossier.json'), dossierBytes);

  const dossier = JSON.parse(Buffer.from(dossierBytes).toString('utf8')) as { text: string };
  if (dossier.text.includes('[Cut at') || dossier.text.includes('not shown.')) {
    process.stderr.write(`token radar: the dossier text is truncated: shrink dashboard/ source so it fits whole under ${TEXT_MAX_BYTES} bytes\n`);
    process.exit(1);
  }

  dossierSize = dossierBytes.length;
}

/** Every regular file under `root` (dot-prefixed names skipped), recursively, with its size. */
function dashboardSourceFiles(root: string): { path: string; size: number }[] {
  if (!existsSync(root)) return [];
  const files: { path: string; size: number }[] = [];
  const stack: string[] = [''];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    for (const entry of readdirSync(rel === '' ? root : join(root, rel), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) files.push({ path, size: statSync(join(root, path)).size });
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// ---------------------------------------------------------------- summary

const watchlistSet = new Set(snapshot.watchlist);
const covered = rowsWithSteps.filter((row) => watchlistSet.has(row.slug)).length;
const dashboardTotal = dashboardSourceFiles(join(import.meta.dirname, 'dashboard')).reduce((sum, file) => sum + file.size, 0);
const dataBytes = Buffer.byteLength(dataJs, 'utf8');

process.stdout.write(
  `token radar: board.json sha256 ${boardSha256}\n` +
    `token radar: ${snapshot.protocols.length} protocols, watchlist ${covered}/${snapshot.watchlist.length}, ${rowsWithSteps.length} board rows (${radar.early_size} early, farm steps ${rowsWithSteps.length > 0 ? Math.min(...rowsWithSteps.map((row) => row.farm_steps.length)) : 0}-${rowsWithSteps.length > 0 ? Math.max(...rowsWithSteps.map((row) => row.farm_steps.length)) : 0} each)\n` +
    `token radar: wrote board.json (${boardBytes} bytes), data.js (${dataBytes} bytes), dashboard/ (${copiedDashboard.length} files, ${dashboardTotal} bytes)\n` +
    (devNoShots
      ? `token radar: screenshots/ and dossier.json skipped (--dev-no-shots)\n`
      : `token radar: screenshots/ (${shots.length} images), dossier.json (${dossierSize} bytes)\n`),
);
