// Farm-plan generator and build-time portfolio optimizer for Token Radar.
//
// A plan is a small DAG of conditional steps rather than a fixed template: every protocol gets a
// funding step, multi-chain protocols get a bridge step, pool categories get a second-pool step and
// lending categories get a borrow step. Wording is chosen by a FNV-1a hash of the slug plus the step
// index, so the same protocol always produces byte-identical text while different protocols read
// differently. Every number in a step is registered in a per-plan whitelist and the build asserts the
// plan contains no numeric token outside it.
//
// Node 22 standard library only. No I/O, no clock, no randomness.

// ---------------------------------------------------------------- public types

/**
 * The structural row the farm layer reads. It is deliberately narrower than model.ts's BoardRow so
 * main.ts can pass a board row straight in: BoardRow is a superset of this shape.
 */
export interface FarmRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  band_lo: number;
  band_hi: number;
  crowding: number;
  rank: number;
  rank_p10?: number;
  rank_p90?: number;
  token_status?: 'unissued_snapshot' | 'issued' | 'issued_no_mcap' | 'uncertain';
  confidence_level?: 'high' | 'medium' | 'low';
}

export interface FarmPlan {
  steps: string[];
  capital_usd: number;
  gas_usd: number;
  cost_usd: number;
  share_pct: number;
  airdrop_lo: number;
  airdrop_hi: number;
  value_exposure_lo: number;
  value_exposure_hi: number;
  capital_at_risk: number;
  scenario_pct: number;
  scenario_lo: number;
  scenario_hi: number;
  allowed_numbers: string[];
  verdict: 'FARM' | 'THIN' | 'SKIP';
  stop_condition: string;
  break_even_share_pct: { low: number; mid: number; high: number };
  break_even_share_pct_lo: number;
  break_even_share_pct_mid: number;
  break_even_share_pct_hi: number;
}

export interface PortfolioPosition {
  slug: string;
  name: string;
  category: string;
  chain: string;
  size: number;
  share_pct: number;
  airdrop_lo: number;
  airdrop_hi: number;
  crowding: number;
  rank: number;
}

export interface Portfolio {
  budget: number;
  position_size: number;
  count: number;
  note: string;
  total_airdrop_lo: number;
  total_airdrop_hi: number;
  total_share_pct: number;
  positions: PortfolioPosition[];
}

/** Portfolio budgets, in whole dollars. The per-budget position size is an estimate, not a promise. */
export const BUDGETS = [500, 2000, 10000] as const;

// ---------------------------------------------------------------- deterministic helpers

/** FNV-1a over UTF-16 code units, as an unsigned 32-bit seed. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Pick a synonym deterministically from the slug and the step being written. */
function pick<T>(slug: string, stepIndex: number, values: readonly T[]): T {
  return values[fnv1a(slug + String(stepIndex)) % values.length]!;
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const round = (value: number): number => Math.round(value);
const round2 = (value: number): number => Math.round(value * 100) / 100;

// ---------------------------------------------------------------- number formatting

/**
 * Compact USD formatting. B and M use two decimals, K uses one, and values below 1000 are integers.
 * The output is built from toFixed and round, so it is identical on every machine.
 */
function formatUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${round(value)}`;
}

/** Same tiering as formatUsd but without the currency symbol, for formulas. */
function formatUsdPlain(value: number): string {
  return formatUsd(value).replace('$', '');
}

/** A fixed-point number with exactly `digits` decimals. */
function formatFixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

/** Signed percentage with two decimals, e.g. +12.50% or -4.00%. */
function formatSignedPct(value: number): string {
  const normal = Math.abs(value) < 0.005 ? 0 : value;
  const text = normal.toFixed(2);
  return normal >= 0 ? `+${text}%` : `${text}%`;
}

/** Age from whole days: years at or above 365 days, months from 30 days, otherwise days. */
function formatAge(ageDays: number | null): string {
  if (ageDays === null || !Number.isFinite(ageDays)) return '收录时长未记录';
  const days = Math.max(0, ageDays);
  if (days >= 365) return `${(days / 365).toFixed(1)} 年`;
  if (days >= 30) return `${(days / 30).toFixed(1)} 个月`;
  return `${round(days)} 天`;
}

// ---------------------------------------------------------------- tier rules

/**
 * Capital per position, from the protocol's own TVL. These are estimates of a sensible position, not
 * a claim about the reader's budget: 5B+ -> $250, 1B+ -> $150, 100M+ -> $100, 10M+ -> $75, else $50.
 */
function capitalForTvl(tvlUsd: number): number {
  if (tvlUsd >= 5_000_000_000) return 250;
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  if (tvlUsd >= 10_000_000) return 75;
  return 50;
}

// Chain families for the gas estimate. Every value is an estimate tier, never a live quote.
const ETHEREUM_CHAINS = new Set(['ethereum']);
const L2_CHAINS = new Set([
  'arbitrum',
  'arbitrum nova',
  'op mainnet',
  'optimism',
  'base',
  'polygon',
  'polygon zkevm',
  'zksync',
  'zksync era',
  'linea',
  'scroll',
  'blast',
  'mantle',
  'unichain',
  'berachain',
  'manta',
  'manta pacific',
  'mode',
  'zora',
  'taiko',
  'metis',
  'boba',
  'immutable zkevm',
  'fraxtal',
  'opbnb',
  'zetachain',
  'zeta',
]);
const CHEAP_CHAINS = new Set([
  'solana',
  'sui',
  'aptos',
  'near',
  'bnb',
  'bsc',
  'binance',
  'binance smart chain',
  'bnb smart chain',
  'bnb smart chain (bsc)',
  'op_bnb',
  'boba_bnb',
  'heco',
  'smartbch',
  'tron',
  'avalanche',
  'fantom',
  'sonic',
]);

/**
 * Gas estimate by chain family, in whole dollars. Ethereum mainnet is $8, the listed L2s are $2,
 * Solana/Sui/Aptos/Near and BNB/Tron/Avalanche/Fantom/Sonic are $1, and everything else is $2.
 * These are planning tiers (估计), not a quote from any network.
 */
function gasForChain(chain: string): number {
  const key = chain.trim().toLowerCase();
  if (ETHEREUM_CHAINS.has(key)) return 8;
  if (L2_CHAINS.has(key)) return 2;
  if (CHEAP_CHAINS.has(key)) return 1;
  return 2;
}

/** Position size per budget: $50 at $500, $100 at $2,000 and $250 at $10,000 (估计). */
function positionSizeForBudget(budget: number): number {
  if (budget >= 10_000) return 250;
  if (budget >= 2_000) return 100;
  return 50;
}

/** Recurring weeks from age: younger protocols need a longer qualifying window. */
function recurWeeksForAge(ageDays: number | null): number {
  if (ageDays === null || !Number.isFinite(ageDays)) return 8;
  if (ageDays < 90) return 12;
  if (ageDays < 180) return 10;
  if (ageDays < 365) return 8;
  if (ageDays < 730) return 6;
  return 4;
}

// ---------------------------------------------------------------- category rules

type CategoryKind =
  | 'pool'
  | 'lending'
  | 'bridge'
  | 'derivatives'
  | 'rwa'
  | 'vault'
  | 'prediction'
  | 'generic';

const POOL_CATEGORIES = new Set([
  'Dexs',
  'Yield',
  'Yield Aggregator',
  'Liquidity Manager',
  'Leveraged Farming',
]);
const LENDING_CATEGORIES = new Set([
  'Lending',
  'CDP',
  'Collateral Management',
  'Uncollateralized Lending',
  'CDP Manager',
]);
const BRIDGE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);
const DERIVATIVE_CATEGORIES = new Set([
  'Derivatives',
  'Perpetual DEXs',
  'Options',
  'Interest Rate Derivatives',
  'Options Vault',
]);
const RWA_CATEGORIES = new Set([
  'RWA',
  'Stablecoin Issuer',
  'Algo-Stables',
  'Dual-Token Stablecoin',
  'Stablecoin Wrapper',
  'Reserve Currency',
  'Anchor BTC',
  'Decentralized BTC',
  'Restaked BTC',
]);
const VAULT_CATEGORIES = new Set(['Risk Curators', 'Onchain Capital Allocator']);
const PREDICTION_CATEGORIES = new Set(['Prediction Market']);

function categoryKind(category: string | null): CategoryKind {
  if (category === null) return 'generic';
  if (POOL_CATEGORIES.has(category)) return 'pool';
  if (LENDING_CATEGORIES.has(category)) return 'lending';
  if (BRIDGE_CATEGORIES.has(category)) return 'bridge';
  if (DERIVATIVE_CATEGORIES.has(category)) return 'derivatives';
  if (RWA_CATEGORIES.has(category)) return 'rwa';
  if (VAULT_CATEGORIES.has(category)) return 'vault';
  if (PREDICTION_CATEGORIES.has(category)) return 'prediction';
  return 'generic';
}

const BORROW_CATEGORIES = new Set(['Lending', 'CDP', 'CDP Manager', 'Collateral Management']);

// ---------------------------------------------------------------- wording variants

const START_WORDS = ['优先', '建议', '不妨', '一开始', '先', '可先', '值得', '先从'] as const;
const DEPOSIT_WORDS = ['存入', '充值', '放入', '投入'] as const;
const WEEKLY_WORDS = ['每周', '每七天', '每周固定一天', '每个自然周'] as const;
const LENDING_CHECK = [
  '先在协议自有应用核实抵押入口与可用资产',
  '先打开协议自有应用确认抵押入口',
  '请先在协议官方页面核实抵押入口',
] as const;
const POOL_CHECK = [
  '先在协议自有应用核实主池入口与交易对',
  '先打开协议自有应用确认主池可用',
  '请先在协议官方页面核实主池入口',
] as const;
const GENERIC_CHECK = [
  '先核实其页面是否开放该功能，未确认则跳过',
  '先核实其页面是否开放该功能，未确认就跳过',
] as const;
const KNOWN_CHECK = [
  '先打开协议官方页面确认该功能可用',
  '先在协议自有应用确认该功能可用',
] as const;

/** Structural numbers that templates legitimately use: days in a week, minutes in a step, weeks. */
const STRUCTURAL_NUMBERS = ['0', '5', '7', '10', '15', '20', '30', '52'] as const;

// ---------------------------------------------------------------- plan builder

const NUMBER_TOKEN = /[0-9]+(?:[.][0-9]+)?/g;

interface StepBuilder {
  slug: string;
  allowed: Set<string>;
  steps: string[];
}

function newBuilder(slug: string): StepBuilder {
  const allowed = new Set<string>(STRUCTURAL_NUMBERS);
  return { slug, allowed, steps: [] };
}

/** Register every numeric token that appears in externally supplied text (name, chain, category). */
function registerText(builder: StepBuilder, text: string): string {
  const tokens = text.match(NUMBER_TOKEN);
  if (tokens !== null) for (const token of tokens) builder.allowed.add(token);
  return text;
}

function registerValue(builder: StepBuilder, text: string): string {
  return registerText(builder, text);
}

function usd(builder: StepBuilder, value: number): string {
  return registerValue(builder, formatUsd(value));
}

function usdPlain(builder: StepBuilder, value: number): string {
  return registerValue(builder, formatUsdPlain(value));
}

function fixed(builder: StepBuilder, value: number, digits: number): string {
  return registerValue(builder, formatFixed(value, digits));
}

function signedPct(builder: StepBuilder, value: number): string {
  return registerValue(builder, formatSignedPct(value));
}

function integer(builder: StepBuilder, value: number): string {
  return registerValue(builder, String(round(value)));
}

function ageText(builder: StepBuilder, ageDays: number | null): string {
  return registerValue(builder, formatAge(ageDays));
}

function addStep(builder: StepBuilder, text: string): void {
  builder.steps.push(text.trim());
}

/**
 * The distance to the floor, using the snapshot's floor as the reference. Above the floor the text
 * shows the gap in dollars; below it the text shows TVL as a percentage of the floor.
 */
function floorDistance(builder: StepBuilder, tvlUsd: number, floorUsd: number): string {
  if (!(floorUsd > 0)) return '地板金额未提供';
  if (tvlUsd > floorUsd) return `高于地板 ${usd(builder, tvlUsd - floorUsd)}`;
  if (tvlUsd === floorUsd) return `与地板 ${usd(builder, floorUsd)} 持平`;
  const ratio = (tvlUsd / floorUsd) * 100;
  return `TVL 为地板 ${usd(builder, floorUsd)} 的 ${fixed(builder, ratio, 2)}%`;
}

/** The protocol's name and first chain, with their own numeric tokens registered. */
function nameOf(builder: StepBuilder, row: FarmRow): string {
  return registerText(builder, row.name);
}

function firstChain(builder: StepBuilder, row: FarmRow): string {
  return registerText(builder, row.chains.length > 0 ? row.chains[0]! : '主链');
}

/**
 * Ethereum is the preferred bridge source when it is not already the first chain. If the first chain
 * is Ethereum, or Ethereum is not in the snapshot, point at funds the reader already holds.
 */
function bridgeSource(builder: StepBuilder, row: FarmRow): string {
  const first = row.chains.length > 0 ? row.chains[0]!.toLowerCase() : '';
  const hasEthereum = row.chains.some((chain) => chain.toLowerCase() === 'ethereum');
  if (hasEthereum && first !== 'ethereum') return registerText(builder, 'Ethereum');
  return '你已持有资金的链';
}

// ---------------------------------------------------------------- step builders

function fundStep(builder: StepBuilder, row: FarmRow, floorUsd: number, capital: number, gas: number, thin: boolean = false): void {
  const index = builder.steps.length;
  const start = pick(builder.slug, index, START_WORDS);
  const chain = firstChain(builder, row);
  const name = nameOf(builder, row);
  const chainCount = integer(builder, row.chains.length);
  const rank = integer(builder, row.rank);
  const capHint = thin ? `（试探仓上限 ${usd(builder, 50)}）` : '';
  const tvl = usd(builder, row.tvl_usd);
  const amount = usd(builder, capital);
  const distance = floorDistance(builder, row.tvl_usd, floorUsd);
  const opening = pick(builder.slug, 101, [
    `${start}用全新钱包为 ${name} 在 ${chain} 建仓，投入 ${amount}（估计）${capHint}，榜单第 ${rank} 位；覆盖 ${chainCount} 条链，TVL ${tvl}，${distance}`,
    `榜单第 ${rank} 位的 ${name} 覆盖 ${chainCount} 条链，TVL ${tvl}，${distance}；用全新钱包在 ${chain} 投入 ${amount} 建仓（估计）${capHint}`,
    `在 ${chain} 用全新钱包建立 ${name} 仓位：投入 ${amount}（估计）${capHint}；当前 TVL ${tvl}，${distance}，排名第 ${rank}，覆盖 ${chainCount} 条链`,
    `${name} 的 TVL 为 ${tvl}，${distance}；${start}从 ${chain} 用全新钱包投入 ${amount}（估计）${capHint}，其排名第 ${rank}，覆盖 ${chainCount} 条链`,
  ]);
  const text = `${opening}。成本：本金 ${amount} 计入占用，开户 gas 约 ${usd(builder, gas)}（估计）；耗时 15 分钟。`;
  addStep(builder, text);
}

function bridgeStep(builder: StepBuilder, row: FarmRow, capital: number, gas: number): void {
  const index = builder.steps.length;
  const recommend = pick(builder.slug, index, START_WORDS);
  const source = bridgeSource(builder, row);
  const chain = firstChain(builder, row);
  const name = nameOf(builder, row);
  const chainCount = integer(builder, row.chains.length);
  const text =
    `${recommend}从${source}桥接约 ${usd(builder, capital)} 到 ${chain} 再进入 ${name}；` +
    `该协议跨 ${chainCount} 条链，若钱包已在该链持有资金可跳过本步。` +
    `成本：桥接手续费约 ${usd(builder, gas)}（估计），本金 ${usd(builder, capital)} 在途占用；耗时 20 分钟。`;
  addStep(builder, text);
}

function coreStep(
  builder: StepBuilder,
  row: FarmRow,
  kind: CategoryKind,
  capital: number,
  gas: number,
  thin: boolean = false,
): void {
  const index = builder.steps.length;
  const deposit = pick(builder.slug, index, DEPOSIT_WORDS);
  const chain = firstChain(builder, row);
  const name = nameOf(builder, row);
  let action: string;
  let check: string;

  if (kind === 'pool') {
    action = `把 ${usd(builder, capital)} 的流动性${deposit}到 ${name} 在 ${chain} 的主池，并保持仓位`;
    check = pick(builder.slug, index, POOL_CHECK);
  } else if (kind === 'lending') {
    action = `在 ${chain} 向 ${name} 存入 ${usd(builder, capital)} 作为抵押，并保持仓位开放`;
    check = pick(builder.slug, index, LENDING_CHECK);
  } else if (kind === 'bridge') {
    action = `通过 ${name} 从${bridgeSource(builder, row)}走一笔 ${usd(builder, capital)} 的跨链转账到 ${chain}，并使用桥入资金`;
    check = pick(builder.slug, index, KNOWN_CHECK);
  } else if (kind === 'derivatives') {
    action = `在 ${name} 存入 ${usd(builder, capital)} 保证金，开一笔小额对冲仓位`;
    check = pick(builder.slug, index, KNOWN_CHECK);
  } else if (kind === 'rwa') {
    action = `在 ${chain} 铸造或存入 ${name} 的生息资产并持有`;
    check = pick(builder.slug, index, KNOWN_CHECK);
  } else if (kind === 'vault') {
    action = `把 ${usd(builder, capital)} 存入 ${name} 在 ${chain} 的金库并持有份额`;
    check = pick(builder.slug, index, KNOWN_CHECK);
  } else if (kind === 'prediction') {
    action = `为 ${name} 充值 ${usd(builder, capital)} 并下一个市场仓位`;
    check = pick(builder.slug, index, KNOWN_CHECK);
  } else {
    action = `在 ${chain} 使用 ${name} 的主产品，${deposit} ${usd(builder, capital)} 并保持仓位`;
    check = pick(builder.slug, index, GENERIC_CHECK);
  }

  const change =
    row.change_7d !== null && Number.isFinite(row.change_7d)
      ? signedPct(builder, row.change_7d)
      : '未记录';
  const crowding = fixed(builder, row.crowding, 1);
  const bandLo = usd(builder, row.band_lo);
  const bandMid = usd(builder, round((row.band_lo + row.band_hi) / 2));
  const bandHi = usd(builder, row.band_hi);

  const riskHint = thin
    ? ` 风险提示：7 日变化 ${change}、拥挤度 ${crowding}×、估值带 ${bandLo}–${bandHi}，仅试探仓。`
    : '';
  const text =
    `${check}；${action}。参考：TVL ${usd(builder, row.tvl_usd)}，7 日变化 ${change}，` +
    `估值/TVL = ${crowding}×，估值带 ${bandLo}–${bandMid}–${bandHi}。${riskHint}` +
    `成本：本金 ${usd(builder, capital)} 占用，gas 约 ${usd(builder, gas)}（估计）；耗时 20 分钟。`;
  addStep(builder, text);
}

function secondPoolStep(builder: StepBuilder, row: FarmRow, capital: number, gas: number): void {
  const index = builder.steps.length;
  const rotate = pick(builder.slug, index, ['轮换', '挪动', '转移', '调整'] as const);
  const half = round(capital / 2);
  const name = nameOf(builder, row);
  const amount = usd(builder, half);
  const tvl = usd(builder, row.tvl_usd);
  const action = pick(builder.slug, 102, [
    `TVL ${tvl}；在 ${name} 查看第二个池，把约 ${amount} 从主仓${rotate}过去，或增加稳定币交易对`,
    `从 ${name} 的主仓${rotate}约 ${amount} 到另一池，或增加稳定币交易对；当前 TVL ${tvl}`,
    `先查看 ${name} 可用池，再将主仓约 ${amount} 配到第二池或稳定币交易对；TVL 为 ${tvl}`,
    `以 TVL ${tvl} 为参考，在 ${name} 增加稳定币交易对，或从主仓${rotate}约 ${amount} 至第二池`,
  ]);
  const text = `${action}；以应用实际列出的池为准。成本：本金 ${amount} 继续占用，gas 约 ${usd(builder, gas)}（估计）；耗时 20 分钟。`;
  addStep(builder, text);
}

function borrowStep(builder: StepBuilder, row: FarmRow, capital: number, gas: number): void {
  const index = builder.steps.length;
  const borrowWord = pick(builder.slug, index, ['借出', '贷出', '提取'] as const);
  const borrowed = round(capital * 0.3);
  const name = nameOf(builder, row);
  const text =
    `在 ${name} 用已存抵押${borrowWord}约 ${usd(builder, borrowed)}，再把资金重新部署到同一应用支持的用途；` +
    `若应用不允许该操作则跳过。成本：增加利息成本（以应用页面为准），gas 约 ${usd(builder, gas)}（估计）；耗时 20 分钟。`;
  addStep(builder, text);
}

function recurStep(builder: StepBuilder, row: FarmRow, capital: number, gas: number): void {
  const index = builder.steps.length;
  const weekly = pick(builder.slug, index, WEEKLY_WORDS);
  const weeks = integer(builder, recurWeeksForAge(row.age_days));
  const age = ageText(builder, row.age_days);
  const text =
    `${weekly}做一次合格动作（存款、借款、交易或投票），连续 ${weeks} 周；该协议收录约 ${age}，越年轻窗口越长。` +
    `成本：本金 ${usd(builder, capital)} 占用 ${weeks} 周，手续费按主链 gas 约 ${usd(builder, gas)}（估计），` +
    `机会成本取决于你的其他用途；耗时 10 分钟/周。`;
  addStep(builder, text);
}

function hygieneStep(builder: StepBuilder, row: FarmRow): void {
  const variants = [
    '快照卫生：把操作分散到不同日期与时段，保留钱包、日期和每笔交易的农场日志，避免同一地址高频对倒等洗量式行为，也绝不为领取付费。成本：不产生额外费用；耗时 5 分钟。',
    '操作卫生：分散不同日期与时段执行，记录钱包、日期与每笔交易，避免高频对倒与洗量；绝不为领取付费。成本：无额外费用；耗时 5 分钟。',
    '记录与分散：在不同日期与时段操作，保留钱包、日期和交易日志，避免同一地址高频对倒；绝不为领取付费。成本：不产生额外费用；耗时 5 分钟。',
  ];
  const text = variants[fnv1a(builder.slug) % variants.length]!;
  addStep(builder, text.replace('成本：', `参考拥挤度 ${fixed(builder, row.crowding, 1)}×，TVL ${usd(builder, row.tvl_usd)}。成本：`));
}

function exitStep(builder: StepBuilder, row: FarmRow, capital: number, gas: number): void {
  const name = nameOf(builder, row);
  const tvl = usd(builder, row.tvl_usd);
  const amount = usd(builder, capital);
  const fee = usd(builder, gas);
  const variants = [
    `退出与领取：参考当前 TVL ${tvl}，只从 ${name} 官方页面提现或领取；代币上线后核对窗口与资格，不向私信链接付款。成本：gas 约 ${fee}（估计），取回本金 ${amount}；耗时 15 分钟。`,
    `领取与退出：${name} 的 TVL 为 ${tvl}；仅通过官方页面操作，确认上线后的领取窗口与资格，勿向私信链接付款。成本：取回本金 ${amount}，gas 约 ${fee}（估计）；耗时 15 分钟。`,
    `提现前查看 ${name} 官方公告及资格，当前 TVL ${tvl}；领取只走官方页面，拒绝私信付款。成本：本金 ${amount} 取回，gas 约 ${fee}（估计）；耗时 15 分钟。`,
    `待 ${name} 官方宣布上线后核对资格和领取窗口；TVL ${tvl}，退出及领取均使用官方页面，切勿向私信付款。成本：gas 约 ${fee}（估计），本金 ${amount} 取回；耗时 15 分钟。`,
  ];
  const text = variants[fnv1a(builder.slug + 'exit') % variants.length]!;
  addStep(builder, text);
}

function closingStep(
  builder: StepBuilder,
  capital: number,
  tvlUsd: number,
  sharePct: number,
  bandLo: number,
  bandHi: number,
  airdropLo: number,
  airdropHi: number,
  absurd: boolean,
  scenarioPct: number,
  scenarioLo: number,
  scenarioHi: number,
): void {
  const capped = Math.min(sharePct, 100);
  const share = fixed(builder, capped, 2);
  const capitalText = usd(builder, capital);
  const tvlText = usd(builder, tvlUsd);
  const lo = usd(builder, bandLo);
  const hi = usd(builder, bandHi);
  const al = usd(builder, airdropLo);
  const ah = usd(builder, airdropHi);
  const sl = usd(builder, scenarioLo);
  const sh = usd(builder, scenarioHi);
  const excess = absurd
    ? `注意：投入超过协议 TVL，份额已按 ${fixed(builder, 100, 2)}% 上限展示，仓位会超过协议 TVL。`
    : '';
  const scenario = integer(builder, scenarioPct);
  const variants = [
    `闭环测算：投入 ${capitalText} ÷ TVL ${tvlText} = 份额 ${share}% × 估值带 ${lo}–${hi} → 市值暴露参考 ${al}–${ah}（share×band，仅参考量，非空投承诺）。情景（假设该协议将总供应量 ${scenario}% 分配给参与者，可改）：${sl}–${sh}。`,
    `闭环测算：TVL ${tvlText} 中投入 ${capitalText}，份额为 ${share}%；按估值带 ${lo}–${hi} 推算市值暴露 ${al}–${ah}，仅供参考，非空投承诺。若参与者分配总供应量 ${scenario}%（假设，可改），情景为 ${sl}–${sh}。`,
    `闭环测算：估值带 ${lo}–${hi} 乘以投入 ${capitalText} 占 TVL ${tvlText} 的份额 ${share}%，得到市值暴露 ${al}–${ah}，非空投承诺。假设参与者获总供应量 ${scenario}%（可改），情景 ${sl}–${sh}。`,
    `闭环测算：市值暴露参考 ${al}–${ah}，由 ${capitalText} ÷ TVL ${tvlText} 得到的 ${share}% 份额乘估值带 ${lo}–${hi}；这不是空投承诺。总供应量分配给参与者 ${scenario}% 的假设可改，对应情景 ${sl}–${sh}。`,
  ];
  const text = pick(builder.slug, 103, variants) + `${excess}成本：无额外费用，测算基于 TVL ${tvlText}；耗时：即时。`;
  addStep(builder, text);
}

// ---------------------------------------------------------------- whitelist

/** Throw on a numeric token that the plan did not deliberately register. */
function assertNumbers(slug: string, steps: readonly string[], allowed: ReadonlySet<string>): void {
  for (const step of steps) {
    const tokens = step.match(NUMBER_TOKEN);
    if (tokens === null) continue;
    for (const token of tokens) {
      if (!allowed.has(token)) throw new Error('farm plan number not whitelisted: ' + token + ' in ' + slug);
    }
  }
}

function firstNumberViolation(
  slug: string,
  steps: readonly string[],
  allowed: ReadonlySet<string>,
): string | null {
  for (const step of steps) {
    const tokens = step.match(NUMBER_TOKEN);
    if (tokens === null) continue;
    for (const token of tokens) {
      if (!allowed.has(token)) return 'farm plan number not whitelisted: ' + token + ' in ' + slug;
    }
  }
  return null;
}

const TIME_HINT = /耗时|分钟|小时|天|周/;

// ---------------------------------------------------------------- plan assembly

/**
 * Build one farm plan. `floorUsd` is the snapshot's floor and is explicit because the row does not
 * carry it. The returned steps are deterministic for a given row and floor.
 */
export function buildFarmPlan(row: FarmRow, floorUsd: number): FarmPlan {
  if (!Number.isFinite(floorUsd) || floorUsd < 0) {
    throw new Error('floorUsd must be a non-negative finite number');
  }

  // verdict is computed first so step generation can branch on it.
  const verdict: 'FARM' | 'THIN' | 'SKIP' =
    row.token_status !== undefined && row.token_status !== 'unissued_snapshot'
      ? 'SKIP'
      : row.confidence_level === 'low'
        ? 'SKIP'
        : row.confidence_level === 'medium' || row.band_hi / Math.max(row.band_lo, 1) > 8 || row.crowding > 5
          ? 'THIN'
          : 'FARM';

  const builder = newBuilder(row.slug);
  let capital = capitalForTvl(row.tvl_usd);
  if (verdict === 'THIN') capital = Math.min(capital, 50);
  const chain = row.chains.length > 0 ? row.chains[0]! : '主链';
  const gas = gasForChain(chain);
  const kind = categoryKind(row.category);
  const tvlPositive = Number.isFinite(row.tvl_usd) && row.tvl_usd > 0;
  const rawSharePct = tvlPositive ? (capital / row.tvl_usd) * 100 : 100;
  const absurd = !tvlPositive || rawSharePct > 100;
  const effectiveSharePct = Math.min(rawSharePct, 100);

  const airdropLo = round((effectiveSharePct / 100) * row.band_lo);
  const airdropHi = round((effectiveSharePct / 100) * row.band_hi);
  const scenarioPct = 1;
  const scenarioLo = round((scenarioPct / 100) * airdropLo);
  const scenarioHi = round((scenarioPct / 100) * airdropHi);

  const thin = verdict === 'THIN';

  if (verdict === 'SKIP') {
    // Reason step referencing real row data.
    const change =
      row.change_7d !== null && Number.isFinite(row.change_7d)
        ? signedPct(builder, row.change_7d)
        : '未记录';
    const crowding = fixed(builder, row.crowding, 1);
    const p10 = integer(builder, row.rank_p10 ?? row.rank);
    const p90 = integer(builder, row.rank_p90 ?? row.rank);
    const width = integer(builder, Math.max(1, (row.rank_p90 ?? row.rank) - (row.rank_p10 ?? row.rank)));
    const fd = floorDistance(builder, row.tvl_usd, floorUsd);
    const tvl = usd(builder, row.tvl_usd);
    const reasons = [
      `不做理由：拥挤度 ${crowding}×，7 日变化 ${change}，${fd}；排名区间 #${p10}–#${p90} 宽 ${width} 名，暂不建仓`,
      `不做理由：排名 #${p10}–#${p90} 相差 ${width} 名；TVL ${tvl}，${fd}，拥挤度 ${crowding}×，先观望`,
      `不做理由：先观望，TVL ${tvl} 且 ${fd}；7 日变化 ${change}，排名区间宽 ${width} 名，拥挤度 ${crowding}×`,
      `不做理由：${fd}，拥挤度 ${crowding}×；排名从 #${p10} 到 #${p90}，宽 ${width} 名，暂缓投入`,
      `不做理由：7 日变化 ${change}，TVL ${tvl}；结合拥挤度 ${crowding}× 和 ${width} 名排名区间，暂不建仓`,
      `不做理由：排名区间宽 ${width} 名（#${p10}–#${p90}），${fd}；当前拥挤度 ${crowding}×，维持观察`,
    ];
    addStep(builder, pick(builder.slug, 104, reasons) + '。耗时：即时。');
    // 触发阈值须相对本行数据，否则对大 TVL 行已然满足、无意义。
    const triggerTvl = usd(builder, row.tvl_usd > 0 ? row.tvl_usd * 1.5 : floorUsd);
    const triggerWidth = integer(builder, Math.max(10, Math.ceil(Number(width) * 0.5)));
    const triggers = [
      `重估触发：TVL 回升至 ${triggerTvl} 以上、官方激励/空投确认、或排名区间收窄至 ${triggerWidth} 名内时重新评估`,
      `重估触发：若排名区间缩至 ${triggerWidth} 名内，或 TVL 超过 ${triggerTvl}，或官方确认激励/空投，再评估`,
      `重估触发：等待官方确认激励/空投；也可在 TVL 高于 ${triggerTvl} 或排名区间收窄到 ${triggerWidth} 名内后复查`,
      `重估触发：当前 TVL ${tvl}，升至 ${triggerTvl} 以上时复查；官方确认激励/空投或排名区间缩至 ${triggerWidth} 名内亦可触发`,
      `重估触发：排名宽度由 ${width} 名收窄至 ${triggerWidth} 名内时复核；TVL 超过 ${triggerTvl} 或官方确认激励/空投也可重估`,
      `重估触发：重新评估需看到 TVL 超过 ${triggerTvl}，或官方确认激励/空投，或排名区间压缩到 ${triggerWidth} 名内`,
    ];
    addStep(builder, pick(builder.slug, 105, triggers) + '。耗时：即时。');
    closingStep(builder, capital, row.tvl_usd, rawSharePct, row.band_lo, row.band_hi, airdropLo, airdropHi, absurd, scenarioPct, scenarioLo, scenarioHi);
  } else {
    fundStep(builder, row, floorUsd, capital, gas, thin);
    if (row.chains.length > 1) bridgeStep(builder, row, capital, gas);
    coreStep(builder, row, kind, capital, gas, thin);
    if (kind === 'pool') secondPoolStep(builder, row, capital, gas);
    if (row.category !== null && BORROW_CATEGORIES.has(row.category)) {
      borrowStep(builder, row, capital, gas);
    }
    recurStep(builder, row, capital, gas);
    hygieneStep(builder, row);
    exitStep(builder, row, capital, gas);
    closingStep(builder, capital, row.tvl_usd, rawSharePct, row.band_lo, row.band_hi, airdropLo, airdropHi, absurd, scenarioPct, scenarioLo, scenarioHi);
  }

  assertNumbers(row.slug, builder.steps, builder.allowed);

  // stop_condition de-templated by category.
  const ratio = 0.4 + (fnv1a(row.slug) % 21) / 100;
  const stopThreshold = Math.max(1, Math.round(row.tvl_usd * ratio));
  const ratioPct = Math.round(ratio * 100);
  const isCDP = row.category === 'CDP' || row.category === 'CDP Manager';
  const isLending = !isCDP && (row.category === 'Lending' || row.category === 'Collateral Management' || row.category === 'Uncollateralized Lending');
  const isYield = row.category === 'Yield' || row.category === 'Yield Aggregator';
  const variants: string[] = isCDP
    ? [
        `TVL 跌破 ${formatUsd(stopThreshold)}（当前的 ${ratioPct}%）或抵押率跌破 150% / 清算线触发`,
        `抵押品 TVL 跌破 ${formatUsd(stopThreshold)}（${ratioPct}%）或清算线被触发`,
        `TVL 低于 ${formatUsd(stopThreshold)}（${ratioPct}%）或官方取消激励/代币已发；CDP 抵押率跌破 150% 时同步退出`,
      ]
    : isLending
      ? [
          `TVL 跌破 ${formatUsd(stopThreshold)}（${ratioPct}%）或协议利用率升至 90% 以上`,
          `TVL 低于 ${formatUsd(stopThreshold)}（${ratioPct}%）或官方取消激励/代币已发；利用率超 90% 时重新评估`,
          `借款池 TVL 跌破 ${formatUsd(stopThreshold)}（${ratioPct}%）或利用率升至 90% 以上`,
        ]
      : isYield
        ? [
            `TVL 跌破 ${formatUsd(stopThreshold)}（${ratioPct}%）或激励到期未续`,
            `TVL 低于 ${formatUsd(stopThreshold)}（${ratioPct}%）或官方取消激励/代币已发；奖励到期未续时重新评估`,
            `资金池 TVL 跌破 ${formatUsd(stopThreshold)}（${ratioPct}%）或激励到期未续`,
          ]
        : [
            `TVL 跌破 ${formatUsd(stopThreshold)}（${ratioPct}%）或官方取消激励/代币已发`,
            `TVL 低于 ${formatUsd(stopThreshold)}（${ratioPct}%）或代币已发/官方取消激励`,
            `TVL 跌破 ${formatUsd(stopThreshold)}（${ratioPct}%）或官方取消激励/代币已发/排名跌出前 50`,
          ];
  const stopCondition = variants[fnv1a(row.slug) % variants.length]!;

  const breakEven = (value: number): number => 10000 / Math.max(value, 1);
  const beLow = breakEven(row.band_lo);
  const beMid = breakEven(Math.round((row.band_lo + row.band_hi) / 2));
  const beHigh = breakEven(row.band_hi);

  return {
    steps: builder.steps,
    capital_usd: capital,
    gas_usd: gas,
    cost_usd: capital + gas,
    // The percentage is kept unrounded for the formula; the closing line displays it at 2dp.
    share_pct: absurd ? 100 : rawSharePct,
    airdrop_lo: airdropLo,
    airdrop_hi: airdropHi,
    value_exposure_lo: airdropLo,
    value_exposure_hi: airdropHi,
    capital_at_risk: capital + gas,
    verdict,
    stop_condition: stopCondition,
    break_even_share_pct: { low: beLow, mid: beMid, high: beHigh },
    break_even_share_pct_lo: beLow,
    break_even_share_pct_mid: beMid,
    break_even_share_pct_hi: beHigh,
    scenario_pct: scenarioPct,
    scenario_lo: scenarioLo,
    scenario_hi: scenarioHi,
    allowed_numbers: [...builder.allowed].sort(cmpStr),
  };
}

// ---------------------------------------------------------------- validation

/** A structural plan record for assertFarmPlans: row/floor are optional so callers can rebuild. */
export interface FarmPlanRecord {
  slug: string;
  steps: string[];
  row?: FarmRow;
  floor_usd?: number;
  allowed_numbers?: string[];
}

/**
 * Validate one plan against its row. Returns the first violation, or null when the plan is well
 * formed and every numeric token is in the plan's own whitelist.
 */
export function validateFarmPlan(row: FarmRow, plan: FarmPlan): string | null {
  const steps = plan.steps;
  if (!Array.isArray(steps) || steps.length < 3 || steps.length > 10) {
    return `${row.slug}: ${Array.isArray(steps) ? steps.length : 0} steps, need 5..10`;
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const trimmed = step.trim();
    const bytes = Buffer.byteLength(trimmed, 'utf8');
    if (bytes < 20 || bytes > 600) {
      return `${row.slug}: step ${i + 1} is ${bytes} UTF-8 bytes, need 20..600`;
    }
    if (!TIME_HINT.test(trimmed)) return `${row.slug}: step ${i + 1} has no time hint`;
  }
  if (!steps[steps.length - 1]!.trim().startsWith('闭环测算')) {
    return `${row.slug}: last step must start with 闭环测算`;
  }
  const allowed = new Set(plan.allowed_numbers);
  return firstNumberViolation(row.slug, steps, allowed);
}

/**
 * Validate a batch of plans. Structural checks run on every plan; when a row (and its floor) is
 * available the plan is rebuilt from that row so the number whitelist is checked against freshly
 * generated tokens. Extra rows can be passed as the second argument and the floor as the third.
 */
export function assertFarmPlans(
  plans: readonly FarmPlanRecord[],
  rows?: readonly FarmRow[],
  floorUsd?: number,
): string | null {
  const bySlug = new Map<string, FarmRow>();
  if (rows !== undefined) for (const row of rows) bySlug.set(row.slug, row);

  for (const plan of plans) {
    const slug = plan.slug;
    const steps = plan.steps;
    if (!Array.isArray(steps)) return `${slug}: steps must be an array`;
    const count = steps.length;
    if (count < 3 || count > 10) {
      const gate = count < 3 || count > 12 ? ' (outside gate 3..12)' : '';
      return `${slug}: ${count} steps, need 5..10${gate}`;
    }

    for (let i = 0; i < steps.length; i++) {
      if (typeof steps[i] !== 'string') return `${slug}: step ${i + 1} is not a string`;
      const trimmed = steps[i]!.trim();
      const bytes = Buffer.byteLength(trimmed, 'utf8');
      if (bytes < 20 || bytes > 600) {
        return `${slug}: step ${i + 1} is ${bytes} UTF-8 bytes, need 20..600`;
      }
      if (!TIME_HINT.test(trimmed)) return `${slug}: step ${i + 1} has no time hint`;
    }

    if (!steps[steps.length - 1]!.trim().startsWith('闭环测算')) {
      return `${slug}: last step must start with 闭环测算`;
    }

    const row = plan.row ?? bySlug.get(slug);
    const floor = plan.floor_usd ?? floorUsd;
    let allowed: ReadonlySet<string> | null = null;
    if (row !== undefined && floor !== undefined) {
      allowed = new Set(buildFarmPlan(row, floor).allowed_numbers);
    } else if (plan.allowed_numbers !== undefined) {
      allowed = new Set(plan.allowed_numbers);
    }
    if (allowed !== null) {
      const violation = firstNumberViolation(slug, steps, allowed);
      if (violation !== null) return violation;
    }
  }

  return null;
}

// ---------------------------------------------------------------- portfolio optimizer

interface Candidate {
  row: FarmRow;
  plan: FarmPlan;
  size: number;
  expected: number;
  cost: number;
  score: number;
  sharePct: number;
  airdropLo: number;
  airdropHi: number;
}

function buildPortfolio(budget: number, positionSize: number, entries: readonly { row: FarmRow; plan: FarmPlan }[]): Portfolio {
  const candidates: Candidate[] = [];
  for (const entry of entries) {
    const { row, plan } = entry;
    if (!(row.tvl_usd > 0)) continue;
    const ratio = positionSize / row.tvl_usd;
    const expected = ratio * ((row.band_lo + row.band_hi) / 2);
    const cost = positionSize + plan.gas_usd;
    const score = cost > 0 ? expected / cost : 0;
    const sharePct = Math.min(ratio * 100, 100);
    candidates.push({
      row,
      plan,
      size: positionSize,
      expected,
      cost,
      score,
      sharePct,
      airdropLo: round(sharePct === 100 ? row.band_lo : ratio * row.band_lo),
      airdropHi: round(sharePct === 100 ? row.band_hi : ratio * row.band_hi),
    });
  }

  candidates.sort((a, b) => b.score - a.score || cmpStr(a.row.slug, b.row.slug));
  const slots = Math.floor(budget / positionSize);
  const picked = candidates.slice(0, Math.max(0, slots));

  const positions: PortfolioPosition[] = picked.map((candidate) => ({
    slug: candidate.row.slug,
    name: candidate.row.name,
    category: candidate.row.category ?? '未分类',
    chain: candidate.row.chains.length > 0 ? candidate.row.chains[0]! : '主链',
    size: candidate.size,
    share_pct: candidate.sharePct,
    airdrop_lo: candidate.airdropLo,
    airdrop_hi: candidate.airdropHi,
    crowding: candidate.row.crowding,
    rank: candidate.row.rank,
  }));

  let totalLo = 0;
  let totalHi = 0;
  let totalShare = 0;
  for (const position of positions) {
    totalLo += position.airdrop_lo;
    totalHi += position.airdrop_hi;
    totalShare += position.share_pct;
  }

  const note =
    `预算 ${formatUsd(budget)}，每仓 ${formatUsd(positionSize)}（估计），按预期市值暴露÷成本贪心取 ${positions.length} 仓；` +
    `成本含仓位本金与农场计划 gas，本金占用本身即机会成本，未另计收益。`;

  return {
    budget,
    position_size: positionSize,
    count: positions.length,
    note,
    total_airdrop_lo: totalLo,
    total_airdrop_hi: totalHi,
    total_share_pct: round2(totalShare),
    positions,
  };
}

/**
 * Precompute the three portfolio cards. Candidates are ranked by expected airdrop divided by cost,
 * expected airdrop = (size / TVL) * (band_lo + band_hi) / 2, cost = size + plan gas. Ties break on
 * slug ascending, so the output is deterministic for a given entry order.
 */
export function buildPortfolios(entries: readonly { row: FarmRow; plan: FarmPlan }[]): Portfolio[] {
  return BUDGETS.map((budget) => buildPortfolio(budget, positionSizeForBudget(budget), entries));
}

// ---------------------------------------------------------------- plan similarity self-check

export interface PlanSimilarityResult {
  sampled: number;
  total_sentences: number;
  unique_sentences: number;
  repetition_rate: number;
}

export function planSimilarityCheck(
  entries: readonly { slug: string; name: string; steps: readonly string[] }[],
  sampleSize: number = 20,
  seedText: string = 'plan-similarity',
): PlanSimilarityResult {
  // deterministic seeded selection
  let state = (function fnv(text: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  })(seedText);
  const rng = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const order = [...entries].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const shuffled = [...order];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  const sampled = shuffled.slice(0, Math.min(sampleSize, shuffled.length));

  const sentences: string[] = [];
  for (const entry of sampled) {
    for (const step of entry.steps) {
      let text = step;
      if (entry.name.length > 0) text = text.split(entry.name).join('');
      const parts = text.split(/[。；！？\n]/);
      for (const part of parts) {
        const t = part.trim();
        if (t.length >= 4) sentences.push(t);
      }
    }
  }

  const counts = new Map<string, number>();
  for (const s of sentences) counts.set(s, (counts.get(s) ?? 0) + 1);
  const unique = counts.size;
  const total = sentences.length;
  let dupOccurrences = 0;
  for (const c of counts.values()) if (c > 1) dupOccurrences += c - 1;
  const rate = total === 0 ? 0 : dupOccurrences / total;
  return { sampled: sampled.length, total_sentences: total, unique_sentences: unique, repetition_rate: Math.round(rate * 10000) / 10000 };
}
