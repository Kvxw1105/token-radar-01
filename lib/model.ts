// Token Radar valuation model (v3).
//
// Everything here is derived from one frozen snapshot. The file is plain erasable TypeScript with no
// dependencies: log10 mcap is modelled from log10 TVL, log10 age, shrunk category and chain effects
// and a fitted momentum coefficient. Quantile residuals turn the point estimate into a band; a seeded
// shadow backtest refits the whole pipeline on held-out listed protocols and reports its own errors.
//
// Determinism: no Date.now, no Math.random. Times come from snapshot.as_of through Date.parse; the
// only randomness is a FNV-1a hash of as_of feeding mulberry32.

// ---------------------------------------------------------------- public types

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface Comp {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

export interface BoardFactors {
  base: number;
  category_effect: number;
  chain_effect: number;
  momentum_adj: number;
  age_contrib: number;
  q50_shift: number;
}

export interface BoardConfidence {
  level: 'high' | 'medium' | 'low';
  reasons: string[];
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  band_lo: number;
  band_hi: number;
  confidence: BoardConfidence;
  counter: string;
  propensity: number;
  on_watchlist: boolean;
  crowding: number;
  comps: Comp[];
  factors: BoardFactors;
}

/** The dashboard row: the board row carries every field the page needs. */
export type RowLite = BoardRow;

export interface CategoryModel {
  name: string;
  n: number;
  r2: number;
  q25: number;
  q50: number;
  q75: number;
  low_conf: boolean;
}

export interface RadarModel {
  a: number;
  b: number;
  c: number;
  d: number;
  winsor_lo: number;
  winsor_hi: number;
  global_r2: number;
  categories: CategoryModel[];
}

export interface Backtest {
  n: number;
  median_log_err: number;
  q25_log_err: number;
  q75_log_err: number;
  within_3x_share: number;
  band_coverage: number;
}

/** A single global width multiplier fitted from the held-out shadow-backtest residuals. */
export interface Calibration {
  coefficient: number;
  before_coverage: number;
  after_coverage: number;
  method: string;
}

export interface HeatmapCell {
  chain: string;
  category: string;
  tvl_share: number;
}

export interface SpearmanData {
  rho: number;
  top10: string[];
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  stability_note: string;
  spearman: SpearmanData;
  model: RadarModel;
  backtest: Backtest;
  calibration: Calibration;
  rows: RowLite[];
  heatmap: HeatmapCell[];
  assumptions: string[];
}

export interface RadarResult {
  board: BoardRow[];
  radar: RadarData;
}

// ---------------------------------------------------------------- snapshot parsing

/** A malformed snapshot: the model refuses to guess at missing or mistyped fields. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isDateString = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

const failSnapshot = (message: string): never => {
  throw new SnapshotError(message);
};

/** Parse and validate the sealed snapshot. Throws SnapshotError on any bad shape. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new SnapshotError(`snapshot is not JSON: ${why}`);
  }
  if (!isRecord(raw)) failSnapshot('snapshot must be a JSON object');
  if (!isDateString(raw.as_of)) failSnapshot('snapshot.as_of must be a YYYY-MM-DD date');
  if (typeof raw.source !== 'string') failSnapshot('snapshot.source must be a string');
  if (!isFiniteNumber(raw.floor_usd) || raw.floor_usd < 0) failSnapshot('snapshot.floor_usd must be a non-negative number');
  if (!Array.isArray(raw.protocols)) failSnapshot('snapshot.protocols must be an array');
  if (!Array.isArray(raw.watchlist)) failSnapshot('snapshot.watchlist must be an array');

  const protocols: SnapshotProtocol[] = [];
  const seen = new Set<string>();
  raw.protocols.forEach((entry, i) => {
    const where = `snapshot.protocols[${i}]`;
    if (!isRecord(entry)) failSnapshot(`${where} must be an object`);
    if (typeof entry.slug !== 'string' || entry.slug.length === 0) failSnapshot(`${where}.slug must be a non-empty string`);
    if (seen.has(entry.slug)) failSnapshot(`${where}.slug "${entry.slug}" is duplicated`);
    seen.add(entry.slug);
    if (typeof entry.name !== 'string') failSnapshot(`${where}.name must be a string`);
    if (!(entry.category === null || typeof entry.category === 'string')) failSnapshot(`${where}.category must be a string or null`);
    if (!Array.isArray(entry.chains) || !entry.chains.every((c) => typeof c === 'string')) {
      failSnapshot(`${where}.chains must be an array of strings`);
    }
    if (!isFiniteNumber(entry.tvl_usd)) failSnapshot(`${where}.tvl_usd must be a number`);
    if (!(entry.change_7d === null || isFiniteNumber(entry.change_7d))) failSnapshot(`${where}.change_7d must be a number or null`);
    if (!(entry.mcap_usd === null || isFiniteNumber(entry.mcap_usd))) failSnapshot(`${where}.mcap_usd must be a number or null`);
    if (!(entry.listed_at === null || isDateString(entry.listed_at))) failSnapshot(`${where}.listed_at must be a YYYY-MM-DD date or null`);
    if (!(entry.gecko_id === null || typeof entry.gecko_id === 'string')) failSnapshot(`${where}.gecko_id must be a string or null`);
    if (!(entry.symbol === null || typeof entry.symbol === 'string')) failSnapshot(`${where}.symbol must be a string or null`);

    protocols.push({
      slug: entry.slug,
      name: entry.name,
      category: entry.category as string | null,
      chains: entry.chains as string[],
      tvl_usd: entry.tvl_usd,
      change_7d: entry.change_7d as number | null,
      mcap_usd: entry.mcap_usd as number | null,
      listed_at: entry.listed_at as string | null,
      gecko_id: entry.gecko_id as string | null,
      symbol: entry.symbol as string | null,
    });
  });

  const watchlist: string[] = [];
  const watchSeen = new Set<string>();
  raw.watchlist.forEach((slug, i) => {
    if (typeof slug !== 'string') failSnapshot(`snapshot.watchlist[${i}] must be a string`);
    if (!seen.has(slug)) failSnapshot(`snapshot.watchlist[${i}] "${slug}" is not a protocol`);
    if (watchSeen.has(slug)) failSnapshot(`snapshot.watchlist[${i}] "${slug}" is duplicated`);
    watchSeen.add(slug);
    watchlist.push(slug);
  });

  return {
    as_of: raw.as_of,
    source: raw.source,
    floor_usd: raw.floor_usd,
    protocols,
    watchlist,
  };
}

// ---------------------------------------------------------------- universe rules

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATEGORY = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIX = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_WORD = /\b(?:wrapped|staked|staking)\b/i;
const MS_PER_DAY = 86_400_000;
const CAT_NULL = '\u0000null-category';

const isListed = (p: SnapshotProtocol): boolean => p.gecko_id !== null || p.symbol !== null;
const categoryKey = (category: string | null): string => category ?? CAT_NULL;
const categoryName = (key: string): string => (key === CAT_NULL ? 'Uncategorized' : key);
const isExcludedCategory = (category: string | null): boolean => category !== null && EXCLUDED_CATEGORY.has(category);

/** A board candidate below the floor, with the watchlist's own exclusion rules. */
function isEarlyCandidate(p: SnapshotProtocol, floorUsd: number): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.tvl_usd >= floorUsd) return false;
  if (VERSIONED.test(p.name)) return false;
  if (isExcludedCategory(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

/** The comparable listed sample: token exists, mcap recorded, TVL positive, no structural categories. */
function fitSample(snapshot: Snapshot): SnapshotProtocol[] {
  // Non-positive mcap cannot be log10-transformed; the snapshot has a few such records and they are
  // treated as missing market caps rather than allowed to drag the fit to zero.
  return snapshot.protocols.filter(
    (p) => isListed(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && !isExcludedCategory(p.category),
  );
}

/** Age in whole days from the snapshot date; null when the snapshot records no listed_at. */
function ageDaysOf(p: SnapshotProtocol, asOfMs: number): number | null {
  if (p.listed_at === null) return null;
  const ms = Date.parse(p.listed_at);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((asOfMs - ms) / MS_PER_DAY));
}

// ---------------------------------------------------------------- numeric helpers

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Linear-interpolation quantile over a fresh ascending copy. Empty input gives 0. */
function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const meanOf = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0) / values.length;

/** FNV-1a over UTF-16 code units, as an unsigned 32-bit seed. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32: a tiny deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Deterministic Fisher-Yates shuffle of a copy. */
function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Solve a small dense linear system with partial pivoting; a singular pivot yields 0. */
function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const m = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    if (pivot !== col) {
      const tmp = m[col]!;
      m[col] = m[pivot]!;
      m[pivot] = tmp;
    }
    const pv = m[col]![col]!;
    if (Math.abs(pv) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / pv;
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) m[r]![k] = m[r]![k]! - factor * m[col]![k]!;
    }
  }
  return Array.from({ length: n }, (_, i) => (Math.abs(m[i]![i]!) < 1e-12 ? 0 : m[i]![n]! / m[i]![i]!));
}

/** Weighted least squares for y = X beta. */
function weightedLeastSquares(X: number[][], y: number[], weights: number[]): number[] {
  const k = X[0]!.length;
  const xtwx = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xtwy = new Array<number>(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    const w = weights[i]!;
    const row = X[i]!;
    for (let j = 0; j < k; j++) {
      xtwy[j] = xtwy[j]! + w * row[j]! * y[i]!;
      for (let l = 0; l < k; l++) xtwx[j]![l] = xtwx[j]![l]! + w * row[j]! * row[l]!;
    }
  }
  return solveLinearSystem(xtwx, xtwy);
}

/** Huber IRLS: initial OLS, then at most 20 reweightings; converged when coefficients move < 1e-9. */
function huberIRLS(X: number[][], y: number[]): number[] {
  const k = X[0]!.length;
  if (X.length === 0) return new Array<number>(k).fill(0);
  let beta = weightedLeastSquares(X, y, new Array<number>(X.length).fill(1));
  for (let iter = 0; iter < 20; iter++) {
    const residuals = y.map((value, i) => value - X[i]!.reduce((sum, x, j) => sum + x * beta[j]!, 0));
    const median = quantile(residuals, 0.5);
    let scale = 1.4826 * quantile(residuals.map((r) => Math.abs(r - median)), 0.5);
    if (!(scale > 1e-6)) scale = 1e-6;
    const delta = 1.345 * scale;
    const weights = residuals.map((r) => (Math.abs(r) <= delta ? 1 : delta / Math.abs(r)));
    const next = weightedLeastSquares(X, y, weights);
    const change = Math.max(...next.map((v, i) => Math.abs(v - beta[i]!)));
    beta = next;
    if (change < 1e-9) break;
  }
  return beta;
}

// ---------------------------------------------------------------- model fit

interface FitRow {
  p: SnapshotProtocol;
  y: number;
  L: number;
  A: number;
  M: number;
}

interface ModelFit {
  a: number;
  b: number;
  c: number;
  d: number;
  winsorLo: number;
  winsorHi: number;
  catEffect: Map<string, number>;
  chainEffect: Map<string, number>;
  catN: Map<string, number>;
  catR2: Map<string, number>;
  catTriple: Map<string, [number, number, number]>;
  globalTriple: [number, number, number];
  globalR2: number;
}

const winsorChange = (change: number | null, lo: number, hi: number): number =>
  change === null ? 0 : clamp(change, lo, hi);

const momentumOf = (change: number | null, lo: number, hi: number): number => winsorChange(change, lo, hi) / 100;

/** Average a per-chain effect across the protocol's chains; unknown chains contribute 0. */
function chainContribution(chainEffect: Map<string, number>, chains: readonly string[]): number {
  if (chains.length === 0) return 0;
  let sum = 0;
  for (const chain of chains) sum += chainEffect.get(chain) ?? 0;
  return sum / chains.length;
}

function rSquared(rows: readonly FitRow[], predict: (row: FitRow) => number): number {
  if (rows.length === 0) return 0;
  const mean = meanOf(rows.map((r) => r.y));
  let ssres = 0;
  let sstot = 0;
  for (const row of rows) {
    const err = row.y - predict(row);
    ssres += err * err;
    const dev = row.y - mean;
    sstot += dev * dev;
  }
  return sstot === 0 ? 0 : 1 - ssres / sstot;
}

/**
 * Steps 1-7 of the frozen procedure over a comparable listed sample. Age-missing rows use
 * `ageFallbackDays`; winsor bounds and every effect are recomputed from `fit` alone, which is what
 * the shadow backtest needs.
 */
function fitModel(fit: readonly SnapshotProtocol[], asOfMs: number, ageFallbackDays: number): ModelFit {
  const changes = fit.filter((p) => p.change_7d !== null).map((p) => p.change_7d as number);
  const winsorLo = changes.length === 0 ? 0 : quantile(changes, 0.05);
  const winsorHi = changes.length === 0 ? 0 : quantile(changes, 0.95);

  const rows: FitRow[] = fit.map((p) => {
    const age = ageDaysOf(p, asOfMs) ?? ageFallbackDays;
    return {
      p,
      y: Math.log10(p.mcap_usd as number),
      L: Math.log10(Math.max(p.tvl_usd, 1)),
      A: Math.log10(age + 1),
      M: momentumOf(p.change_7d, winsorLo, winsorHi),
    };
  });

  // 1. Robust global regression on the age-fit subset.
  const ageRows = rows.filter((r) => r.p.listed_at !== null);
  const regressionRows = ageRows.length >= 3 ? ageRows : rows;
  const X = regressionRows.map((r) => [1, r.L, r.A]);
  const y = regressionRows.map((r) => r.y);
  const [a, b, c] = huberIRLS(X, y);

  const pred1 = (r: FitRow): number => a! + b! * r.L + c! * r.A;

  // 2. Category effects, empirical-Bayes shrunk with k=5.
  const catResiduals = new Map<string, number[]>();
  for (const r of rows) {
    const key = categoryKey(r.p.category);
    const list = catResiduals.get(key);
    const residual = r.y - pred1(r);
    if (list === undefined) catResiduals.set(key, [residual]);
    else list.push(residual);
  }
  const catEffect = new Map<string, number>();
  for (const [key, values] of catResiduals) {
    const n = values.length;
    catEffect.set(key, (n / (n + 5)) * meanOf(values));
  }
  const catEffectOf = (r: FitRow): number => catEffect.get(categoryKey(r.p.category)) ?? 0;

  // 3. Chain effects, only chains with n >= 5; empirical-Bayes k=10.
  const chainResiduals = new Map<string, number[]>();
  for (const r of rows) {
    const residual = r.y - pred1(r) - catEffectOf(r);
    for (const chain of r.p.chains) {
      const list = chainResiduals.get(chain);
      if (list === undefined) chainResiduals.set(chain, [residual]);
      else list.push(residual);
    }
  }
  const chainEffect = new Map<string, number>();
  for (const [chain, values] of chainResiduals) {
    const n = values.length;
    if (n >= 5) chainEffect.set(chain, (n / (n + 10)) * meanOf(values));
  }
  const chainEffectOf = (r: FitRow): number => chainContribution(chainEffect, r.p.chains);

  // 4. Momentum coefficient, no intercept, on rows with a recorded 7-day change.
  let numerator = 0;
  let denominator = 0;
  for (const r of rows) {
    if (r.p.change_7d === null) continue;
    const residual = r.y - pred1(r) - catEffectOf(r) - chainEffectOf(r);
    numerator += r.M * residual;
    denominator += r.M * r.M;
  }
  const d = denominator === 0 ? 0 : numerator / denominator;

  // 5. Fitted log10 prediction.
  const logpred = (r: FitRow): number => pred1(r) + catEffectOf(r) + chainEffectOf(r) + d * r.M;

  // 6. Residual quantiles: per category when n >= 5, global otherwise.
  const globalResiduals = rows.map((r) => r.y - logpred(r));
  const globalTriple: [number, number, number] = [
    quantile(globalResiduals, 0.25),
    quantile(globalResiduals, 0.5),
    quantile(globalResiduals, 0.75),
  ];
  const catN = new Map<string, number>();
  const catR2 = new Map<string, number>();
  const catTriple = new Map<string, [number, number, number]>();
  for (const [key, values] of catResiduals) {
    catN.set(key, values.length);
    const catRows = rows.filter((r) => categoryKey(r.p.category) === key);
    catR2.set(key, rSquared(catRows, logpred));
    if (values.length >= 5) {
      const residuals = catRows.map((r) => r.y - logpred(r));
      catTriple.set(key, [quantile(residuals, 0.25), quantile(residuals, 0.5), quantile(residuals, 0.75)]);
    }
  }

  return {
    a: a!,
    b: b!,
    c: c!,
    d,
    winsorLo,
    winsorHi,
    catEffect,
    chainEffect,
    catN,
    catR2,
    catTriple,
    globalTriple,
    globalR2: rSquared(rows, logpred),
  };
}

function residualTripleOf(fit: ModelFit, category: string | null): [number, number, number] {
  const key = categoryKey(category);
  const n = fit.catN.get(key) ?? 0;
  if (n >= 5) return fit.catTriple.get(key) ?? fit.globalTriple;
  return fit.globalTriple;
}

/**
 * The band triple after the global calibration: only the two gaps around q50 move, by one fitted
 * multiplier. The point estimate and the median shift stay exactly where the fit put them.
 */
function calibratedTripleOf(fit: ModelFit, category: string | null, scale: number): [number, number, number] {
  const [q25, q50, q75] = residualTripleOf(fit, category);
  return [q50 + scale * (q25 - q50), q50, q50 + scale * (q75 - q50)];
}

/** The full log10 prediction for an unlisted protocol with the given age and momentum features. */
function predictLog(
  fit: ModelFit,
  category: string | null,
  chains: readonly string[],
  L: number,
  A: number,
  M: number,
): number {
  return (
    fit.a +
    fit.b * L +
    fit.c * A +
    (fit.catEffect.get(categoryKey(category)) ?? 0) +
    chainContribution(fit.chainEffect, chains) +
    fit.d * M
  );
}

// ---------------------------------------------------------------- comps

function compsFor(p: SnapshotProtocol, all: readonly SnapshotProtocol[], L: number): Comp[] {
  const candidates: { p: SnapshotProtocol; distance: number }[] = [];
  for (const q of all) {
    if (q.slug === p.slug) continue;
    if (!isListed(q)) continue;
    if (q.mcap_usd === null || q.mcap_usd <= 0 || q.tvl_usd <= 0) continue;
    if (categoryKey(q.category) !== categoryKey(p.category)) continue;
    candidates.push({ p: q, distance: Math.abs(Math.log10(Math.max(q.tvl_usd, 1)) - L) });
  }
  candidates.sort((x, y) => x.distance - y.distance || cmpStr(x.p.slug, y.p.slug));
  return candidates.slice(0, 3).map(({ p: q }) => ({
    slug: q.slug,
    name: q.name,
    tvl_usd: q.tvl_usd,
    mcap_usd: q.mcap_usd as number,
    multiple: round4((q.mcap_usd as number) / q.tvl_usd),
  }));
}

// ---------------------------------------------------------------- launch propensity

interface PropensityInput {
  p: SnapshotProtocol;
  ageDays: number | null;
  winsorizedChange: number;
}

/** Percentile of `value` among `sorted` values, 0..100, using the share at or below it. */
function percentileAtOrBelow(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return 50;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return (100 * lo) / sorted.length;
}

/**
 * The launch-propensity index: a cross-sectional index, explicitly not a probability. It mixes the
 * category's shrunk listed share, age percentile on the board and a category-local momentum z-score.
 */
function launchPropensity(
  input: PropensityInput,
  globalListedShare: number,
  categoryCounts: Map<string, { total: number; listed: number }>,
  boardAges: readonly number[],
  boardMomentum: readonly PropensityInput[],
): { score: number; z: number } {
  const key = categoryKey(input.p.category);
  const counts = categoryCounts.get(key) ?? { total: 0, listed: 0 };
  const shrunk = (counts.listed + globalListedShare * 10) / (counts.total + 10);

  const agePercentile = input.ageDays === null ? 50 : percentileAtOrBelow(boardAges, input.ageDays);

  const allValues = boardMomentum.map((r) => r.winsorizedChange);
  const globalMean = meanOf(allValues);
  const globalVariance = meanOf(allValues.map((v) => (v - globalMean) * (v - globalMean)));
  const globalStd = Math.sqrt(globalVariance);

  const local = boardMomentum.filter((r) => categoryKey(r.p.category) === key).map((r) => r.winsorizedChange);
  let mu = globalMean;
  let sd = globalStd;
  if (local.length >= 5) {
    mu = meanOf(local);
    sd = Math.sqrt(meanOf(local.map((v) => (v - mu) * (v - mu))));
  }
  const z = sd < 1e-12 ? 0 : (input.winsorizedChange - mu) / sd;
  const zForScore = clamp(z, -2, 2);
  const momentumScore = (50 + 25 * zForScore) / 100;

  const raw = 50 * shrunk + 30 * (agePercentile / 100) + 20 * momentumScore;
  return { score: Math.round(clamp(raw, 0, 100)), z };
}

// ---------------------------------------------------------------- counter-evidence

function formatSigned(x: number, digits = 2): string {
  const value = Math.abs(x) < 0.5 * 10 ** -digits ? 0 : x;
  const text = value.toFixed(digits);
  return value >= 0 ? `+${text}` : text;
}

function counterEvidence(
  p: SnapshotProtocol,
  ageDays: number | null,
  factors: BoardFactors,
  categoryN: number,
  boardMedianTvl: number,
): string {
  if (p.chains.length === 1 && p.tvl_usd < boardMedianTvl) {
    return '单链集中,估值与该链同涨跌';
  }
  if (p.change_7d !== null && p.change_7d <= -20) {
    return `7日TVL下跌${p.change_7d}%,跌势可能未充分计价`;
  }
  if (ageDays !== null && ageDays > 1095) {
    const years = (ageDays / 365).toFixed(1);
    return `收录已${years}年仍未发币,发币意愿存疑`;
  }
  if (p.tvl_usd < 6_000_000) {
    return 'TVL贴近快照下限,数据稳定性弱';
  }
  if (categoryN < 5) {
    return '同类已发币样本不足,估值带来自全局收缩';
  }
  const terms: { name: string; value: number }[] = [
    { name: 'category', value: factors.category_effect },
    { name: 'chain', value: factors.chain_effect },
    { name: 'momentum', value: factors.momentum_adj },
    { name: 'age', value: factors.age_contrib },
  ];
  terms.sort((x, y) => Math.abs(y.value) - Math.abs(x.value) || cmpStr(x.name, y.name));
  return `估值主要由${terms[0]!.name}驱动,该因子翻转时估值同步翻转`;
}

// ---------------------------------------------------------------- spearman, ranks, stability

/** Average ranks (ties share the mean of their positions), in the input order. */
function averageRanks(values: readonly number[]): number[] {
  const order = values.map((_, i) => i);
  order.sort((i, j) => values[i]! - values[j]! || i - j);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i + 1;
    while (j < order.length && values[order[j]!]! === values[order[i]!]!) j++;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[order[k]!] = rank;
    i = j;
  }
  return ranks;
}

function pearson(x: readonly number[], y: readonly number[]): number {
  if (x.length < 2 || x.length !== y.length) return 0;
  const mx = meanOf(x);
  const my = meanOf(y);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return 0;
  return cov / Math.sqrt(vx * vy);
}

/** Ranks 1..N by descending value, slug ascending for ties. */
function descendingSlugRanks<T extends { slug: string }>(items: readonly T[], value: (item: T) => number): Map<string, number> {
  const order = [...items].sort((a, b) => value(b) - value(a) || cmpStr(a.slug, b.slug));
  const ranks = new Map<string, number>();
  order.forEach((item, i) => ranks.set(item.slug, i + 1));
  return ranks;
}

// ---------------------------------------------------------------- backtest

interface BacktestRun {
  metrics: Backtest;
  residuals: number[];
  lowerGaps: number[];
  upperGaps: number[];
}

function runBacktest(
  fit: readonly SnapshotProtocol[],
  snapshot: Snapshot,
  asOfMs: number,
  ageFallbackDays: number,
  bandScale: number,
): BacktestRun {
  const rng = mulberry32(fnv1a(snapshot.as_of));
  const order = shuffled(fit, rng);
  const take = Math.min(50, order.length);
  const held = order.slice(0, take);
  const train = order.slice(take);
  const trainAges = train
    .map((p) => ageDaysOf(p, asOfMs))
    .filter((age): age is number => age !== null);
  const trainAgeFallback = trainAges.length > 0 ? quantile(trainAges, 0.5) : ageFallbackDays;
  const model = fitModel(train, asOfMs, trainAgeFallback);

  const errors: number[] = [];
  const residuals: number[] = [];
  const lowerGaps: number[] = [];
  const upperGaps: number[] = [];
  let covered = 0;
  for (const p of held) {
    const age = ageDaysOf(p, asOfMs) ?? trainAgeFallback;
    const L = Math.log10(Math.max(p.tvl_usd, 1));
    const A = Math.log10(age + 1);
    const M = momentumOf(p.change_7d, model.winsorLo, model.winsorHi);
    const logpred = predictLog(model, p.category, p.chains, L, A, M);
    const [q25, q50, q75] = calibratedTripleOf(model, p.category, bandScale);
    const point = 10 ** (logpred + q50);
    const lo = 10 ** (logpred + q25);
    const hi = 10 ** (logpred + q75);
    const real = p.mcap_usd as number;
    errors.push(Math.log10(point / real));
    residuals.push(Math.log10(real) - (logpred + q50));
    lowerGaps.push(q50 - q25);
    upperGaps.push(q75 - q50);
    if (real >= lo && real <= hi) covered++;
  }

  return {
    metrics: {
      n: held.length,
      median_log_err: round4(quantile(errors, 0.5)),
      q25_log_err: round4(quantile(errors, 0.25)),
      q75_log_err: round4(quantile(errors, 0.75)),
      within_3x_share: round4(errors.filter((e) => Math.abs(e) <= 0.5).length / (errors.length || 1)),
      band_coverage: round4(covered / (held.length || 1)),
    },
    residuals,
    lowerGaps,
    upperGaps,
  };
}

/**
 * Fit the single global width multiplier from held-out residuals only: the empirical IQR of the
 * shadow-backtest residuals divided by the mean training-band width (the two gaps around q50).
 * That is the factor by which the training band must widen or narrow to reproduce the held-out
 * spread. No hand-set constant enters: both terms come from the same backtest run.
 */
function deriveBandScale(run: BacktestRun): number {
  if (run.residuals.length === 0) return 1;
  const empiricalWidth = quantile(run.residuals, 0.75) - quantile(run.residuals, 0.25);
  const modelWidth = meanOf(run.lowerGaps.map((gap, i) => gap + run.upperGaps[i]!));
  if (!(modelWidth > 1e-9) || !Number.isFinite(empiricalWidth)) return 1;
  return empiricalWidth / modelWidth;
}

// ---------------------------------------------------------------- the build

interface RowSeed {
  p: SnapshotProtocol;
  ageDays: number | null;
  L: number;
  M: number;
  winsorizedChange: number;
  logpred: number;
  q25: number;
  q50: number;
  q75: number;
  implied: number;
  bandLo: number;
  bandHi: number;
  factors: BoardFactors;
  comps: Comp[];
  onWatchlist: boolean;
  crowding: number;
  categoryN: number;
  propensity: number;
  zMom: number;
}

/** Assemble the board and the dashboard payload. Farm steps are deliberately not part of this layer. */
export function buildRadar(snapshot: Snapshot): RadarResult {
  const asOfMs = Date.parse(snapshot.as_of);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlistSet = new Set(snapshot.watchlist);
  const watchlistProtocols = snapshot.watchlist.map((slug) => bySlug.get(slug)).filter((p): p is SnapshotProtocol => p !== undefined);
  const earlyProtocols = snapshot.protocols.filter(
    (p) => !watchlistSet.has(p.slug) && isEarlyCandidate(p, snapshot.floor_usd),
  );
  const boardProtocols = [...watchlistProtocols, ...earlyProtocols].sort((a, b) => cmpStr(a.slug, b.slug));

  const boardAges = boardProtocols
    .map((p) => ageDaysOf(p, asOfMs))
    .filter((age): age is number => age !== null)
    .sort((a, b) => a - b);
  const medianAgeDays = boardAges.length > 0 ? quantile(boardAges, 0.5) : 365;

  const fit = fitSample(snapshot);
  const model = fitModel(fit, asOfMs, medianAgeDays);

  // Calibration is fitted from held-out backtest residuals, then the shadow backtest is rerun with
  // the calibrated bands. `before` is the uncalibrated coverage, `after` the one actually shipped.
  const uncalibrated = runBacktest(fit, snapshot, asOfMs, medianAgeDays, 1);
  const bandScale = deriveBandScale(uncalibrated);
  const calibrated = runBacktest(fit, snapshot, asOfMs, medianAgeDays, bandScale);
  const backtest = calibrated.metrics;
  const calibration: Calibration = {
    coefficient: round4(bandScale),
    before_coverage: uncalibrated.metrics.band_coverage,
    after_coverage: calibrated.metrics.band_coverage,
    method:
      '留出影子回测残差的 IQR ÷ 训练残差 P25–P75 带内宽（两缺口之和的均值）；只缩放带宽，点估计与中位偏移不动。',
  };

  // Sorted momentum inputs for the propensity axis.
  const boardMomentum = boardProtocols.map((p) => ({
    p,
    ageDays: ageDaysOf(p, asOfMs),
    winsorizedChange: winsorChange(p.change_7d, model.winsorLo, model.winsorHi),
  }));

  let listedTotal = 0;
  const categoryCounts = new Map<string, { total: number; listed: number }>();
  for (const p of snapshot.protocols) {
    const key = categoryKey(p.category);
    const counts = categoryCounts.get(key) ?? { total: 0, listed: 0 };
    counts.total++;
    if (isListed(p)) {
      counts.listed++;
      listedTotal++;
    }
    categoryCounts.set(key, counts);
  }
  const globalListedShare = snapshot.protocols.length === 0 ? 0 : listedTotal / snapshot.protocols.length;

  const seeds: RowSeed[] = [];
  for (const p of boardProtocols) {
    const ageDays = ageDaysOf(p, asOfMs);
    const effectiveAge = ageDays ?? medianAgeDays;
    const L = Math.log10(Math.max(p.tvl_usd, 1));
    const A = Math.log10(effectiveAge + 1);
    const M = momentumOf(p.change_7d, model.winsorLo, model.winsorHi);
    const catEffect = model.catEffect.get(categoryKey(p.category)) ?? 0;
    const chainEffect = chainContribution(model.chainEffect, p.chains);
    const logpred = predictLog(model, p.category, p.chains, L, A, M);
    const [q25, q50, q75] = calibratedTripleOf(model, p.category, bandScale);

    const implied = Math.max(1, Math.round(10 ** (logpred + q50)));
    const bandLo = Math.max(1, Math.round(10 ** (logpred + q25)));
    const bandHi = Math.max(1, Math.round(10 ** (logpred + q75)));
    const factors: BoardFactors = {
      base: round4(model.a + model.b * L),
      category_effect: round4(catEffect),
      chain_effect: round4(chainEffect),
      momentum_adj: round4(model.d * M),
      age_contrib: round4(model.c * A),
      q50_shift: round4(q50),
    };

    const propensityInput: PropensityInput = {
      p,
      ageDays,
      winsorizedChange: winsorChange(p.change_7d, model.winsorLo, model.winsorHi),
    };
    const propensity = launchPropensity(
      propensityInput,
      globalListedShare,
      categoryCounts,
      boardAges,
      boardMomentum,
    );

    seeds.push({
      p,
      ageDays,
      L,
      M,
      winsorizedChange: propensityInput.winsorizedChange,
      logpred,
      q25,
      q50,
      q75,
      implied,
      bandLo,
      bandHi,
      factors,
      comps: compsFor(p, snapshot.protocols, L),
      onWatchlist: watchlistSet.has(p.slug),
      crowding: implied / Math.max(p.tvl_usd, 1),
      categoryN: model.catN.get(categoryKey(p.category)) ?? 0,
      propensity: propensity.score,
      zMom: propensity.z,
    });
  }

  seeds.sort((a, b) => b.implied - a.implied || cmpStr(a.p.slug, b.p.slug));

  const bandRatios = seeds.map((s) => s.bandHi / Math.max(s.bandLo, 1));
  const wideRatio = quantile(bandRatios, 0.75);
  const boardMedianTvl = quantile(boardProtocols.map((p) => p.tvl_usd), 0.5);

  const board: BoardRow[] = seeds.map((s, i) => {
    const reasons: string[] = [];
    const lowCategory = s.categoryN < 5;
    if (lowCategory) reasons.push('同类样本不足n');
    if (s.bandHi / Math.max(s.bandLo, 1) > wideRatio) reasons.push('残差宽');
    if (Math.abs(s.zMom) > 3) reasons.push('动量3σ');
    let level: BoardConfidence['level'];
    if (lowCategory) level = 'low';
    else if (reasons.length === 0) level = 'high';
    else if (reasons.length === 1) level = 'medium';
    else level = 'low';

    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: [...s.p.chains],
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.ageDays,
      implied_value_usd: s.implied,
      band_lo: s.bandLo,
      band_hi: s.bandHi,
      confidence: { level, reasons },
      counter: counterEvidence(s.p, s.ageDays, s.factors, s.categoryN, boardMedianTvl),
      propensity: s.propensity,
      on_watchlist: s.onWatchlist,
      crowding: s.crowding,
      comps: s.comps,
      factors: s.factors,
    };
  });

  // Spearman rank correlation between implied value and pure TVL, no threshold.
  const rho = round4(
    pearson(
      averageRanks(board.map((r) => r.implied_value_usd)),
      averageRanks(board.map((r) => r.tvl_usd)),
    ),
  );
  const tvlRanks = descendingSlugRanks(board, (r) => r.tvl_usd);
  const top10 = board.slice(0, 10).map((r) => {
    const terms = [
      { name: 'cat', value: r.factors.category_effect },
      { name: 'chain', value: r.factors.chain_effect },
      { name: 'mom', value: r.factors.momentum_adj },
      { name: 'age', value: r.factors.age_contrib },
    ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || cmpStr(a.name, b.name));
    const contributions = terms.map((t) => `${t.name}${formatSigned(t.value)}`).join(',');
    return `${contributions} → TVL名次${tvlRanks.get(r.slug) ?? 0}→估值名次${r.rank}`;
  });

  // Heatmap: every chain × category pair on the board, as a share of total board TVL.
  const totalBoardTvl = boardProtocols.reduce((sum, p) => sum + p.tvl_usd, 0);
  const heat = new Map<string, { chain: string; category: string; tvl: number }>();
  for (const p of boardProtocols) {
    const category = p.category ?? 'Unknown';
    for (const chain of new Set(p.chains)) {
      const key = `${chain}\u0000${category}`;
      const cell = heat.get(key);
      if (cell === undefined) heat.set(key, { chain, category, tvl: p.tvl_usd });
      else cell.tvl += p.tvl_usd;
    }
  }
  const heatmap: HeatmapCell[] = [...heat.values()]
    .map((cell) => ({
      chain: cell.chain,
      category: cell.category,
      tvl_share: round4(totalBoardTvl === 0 ? 0 : cell.tvl / totalBoardTvl),
    }))
    .sort(
      (a, b) =>
        b.tvl_share - a.tvl_share || cmpStr(a.chain, b.chain) || cmpStr(a.category, b.category),
    );

  // Stability: a ±20% perturbation of every category effect (intercept, slopes, chain effects,
  // momentum, age and quantile shifts all fixed), every board point estimate recomputed and each
  // variant re-ranked 1..N by (implied desc, slug asc); watchlist rows keeping their base rank
  // number are counted.
  const baseWatchRanks = descendingSlugRanks(board, (r) => r.implied_value_usd);
  const stableCount = (scale: number): number => {
    const variant = board.map((row, i) => {
      const seed = seeds[i]!;
      const catEffect = model.catEffect.get(categoryKey(row.category)) ?? 0;
      const implied = Math.max(1, Math.round(10 ** (seed.logpred + (scale - 1) * catEffect + seed.q50)));
      return { slug: row.slug, implied };
    });
    const ranks = descendingSlugRanks(variant, (v) => v.implied);
    let kept = 0;
    for (const row of board) {
      if (!row.on_watchlist) continue;
      if (ranks.get(row.slug) === baseWatchRanks.get(row.slug)) kept++;
    }
    return kept;
  };
  const stableUp = stableCount(1.2);
  const stableDown = stableCount(0.8);
  const watchlistCount = board.filter((r) => r.on_watchlist).length;
  const stabilityNote = `类别效应±20%扰动:×1.2时${watchlistCount}个watchlist中${stableUp}个排名不变,×0.8时${stableDown}个`;

  // Model report categories: fit categories plus board-only categories, all with their triples.
  const allCategoryKeys = new Set<string>([...model.catN.keys()]);
  for (const p of boardProtocols) allCategoryKeys.add(categoryKey(p.category));
  const categories: CategoryModel[] = [...allCategoryKeys]
    .sort(cmpStr)
    .map((key) => {
      const n = model.catN.get(key) ?? 0;
      const triple = calibratedTripleOf(model, key, bandScale);
      return {
        name: categoryName(key),
        n,
        r2: round4(model.catR2.get(key) ?? 0),
        q25: round4(triple[0]),
        q50: round4(triple[1]),
        q75: round4(triple[2]),
        low_conf: n < 5,
      };
    });

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlyProtocols.length,
    stability_note: stabilityNote,
    spearman: { rho, top10 },
    model: {
      a: round4(model.a),
      b: round4(model.b),
      c: round4(model.c),
      d: round4(model.d),
      winsor_lo: round4(model.winsorLo),
      winsor_hi: round4(model.winsorHi),
      global_r2: round4(model.globalR2),
      categories,
    },
    backtest,
    calibration,
    rows: board,
    heatmap,
    assumptions: [
      'listed_at 是 DefiLlama 收录日，不是协议上线日；缺失时以榜单有收录日协议的中位年龄代入并披露。',
      'mcap_usd 为流通市值口径，不是 FDV；市值非正的记录视为缺失，不进入拟合。',
      'gas 成本为估计档，不是实时报价。',
      '空投份额公式为上限情景，不构成承诺。',
      '动量系数由横截面残差回归外推，假设该关系在未发币样本上延续。',
      '类别效应按经验贝叶斯收缩（k=5），链效应 k=10。',
    ],
  };

  return { board, radar };
}

// ---------------------------------------------------------------- gate

/**
 * The board gate. Returns the first violation, or null when the board is well-formed. Farm steps are
 * only checked when a caller has attached them to rows (the farm layer runs after this model).
 */
export function assertBoard(board: readonly BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((row) => row.slug));
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `watchlist slug "${slug}" is missing from the board`;
  }

  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank at position ${i + 1} is ${board[i]!.rank}, expected ${i + 1}`;
  }

  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `implied value rises at rank ${board[i]!.rank}`;
    }
  }

  if (board.length > 1 && board.every((row) => row.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'all implied values are equal';
  }

  for (const row of board) {
    const value = row.implied_value_usd;
    if (!Number.isSafeInteger(value) || value <= 0 || value > 1e14) {
      return `row "${row.slug}" implied value ${String(value)} is not a positive safe integer <= 1e14`;
    }
  }

  if (slugs.size !== board.length) {
    const seen = new Set<string>();
    for (const row of board) {
      if (seen.has(row.slug)) return `duplicate board slug "${row.slug}"`;
      seen.add(row.slug);
    }
  }

  for (const row of board) {
    const withSteps = row as BoardRow & { farm_steps?: unknown };
    if (withSteps.farm_steps === undefined) continue;
    const steps = withSteps.farm_steps;
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) {
      return `row "${row.slug}" farm_steps must be 3 to 12 steps`;
    }
    for (const step of steps) {
      if (typeof step !== 'string') return `row "${row.slug}" farm_steps must contain only strings`;
      const bytes = Buffer.byteLength(step, 'utf8');
      if (bytes < 20 || bytes > 600) {
        return `row "${row.slug}" farm step is ${bytes} UTF-8 bytes, need 20 to 600`;
      }
    }
  }

  return null;
}

/** The methodology page's determinism statement. */
export function determinismNote(): string {
  return 'no Date.now, no Math.random, seeded by as_of';
}
