// Token Radar dashboard (vanilla JS, no framework, no network).
// Data contract: window.RADAR is written by main.ts into ../data.js, loaded before this script.
'use strict';

// ---------------------------------------------------------------- pure helpers

// Escape a string for safe interpolation into innerHTML templates.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Clamp x into [lo, hi].
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Compact USD formatter: $1.23B / $456M / $7.8M / $987K. plain=true drops the "$".
function fmtUsd(v, plain) {
  if (!Number.isFinite(v)) return '—';
  const s = plain ? '' : '$';
  const a = Math.abs(v);
  if (a >= 1e9) return s + (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + (a < 1e7 ? (v / 1e6).toFixed(1) : Math.round(v / 1e6)) + 'M';
  if (a >= 1e3) return s + (a < 1e4 ? (v / 1e3).toFixed(1) : Math.round(v / 1e3)) + 'K';
  return s + Math.round(v);
}

// Signed 7-day change: '+9.7%' / '-3.2%' / '—' when unrecorded.
function fmtChange(v) {
  return v === null || !Number.isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

// Percentages already expressed in percent units (share_pct fields), adaptive decimals.
function fmtPct(p) {
  const a = Math.abs(p);
  return (a < 0.01 ? p.toFixed(4) : a < 1 ? p.toFixed(3) : a < 100 ? p.toFixed(2) : p.toFixed(1)) + '%';
}

// Fractions in [0,1] (shares, coverage) rendered as percentages.
function fmtShare(f) {
  return Number.isFinite(f) ? (f * 100).toFixed(1) + '%' : '—';
}

// A plain ratio as a multiplier: ×0.14 / ×3.61 / ×42.
function fmtX(v) {
  return '×' + (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
}

// A log10 contribution rendered as its 10^x multiplier.
function fmtPow(x) {
  return fmtX(Math.pow(10, x));
}

// Age in whole days: compact Chinese units, '—' when unrecorded.
function fmtAge(d) {
  if (d === null || !Number.isFinite(d)) return '—';
  if (d >= 365) return (d / 365).toFixed(1) + '年';
  if (d >= 30) return (d / 30).toFixed(1) + '月';
  return Math.round(d) + '天';
}

// TVL tier index for the tier filter: 0 <$10M, 1 $10–100M, 2 $100M–1B, 3 >$1B.
function tierOf(tvl) {
  return tvl < 1e7 ? 0 : tvl < 1e8 ? 1 : tvl < 1e9 ? 2 : 3;
}

const CONF_LABEL = { high: '高', medium: '中', low: '低' };

// Factor keys in display order with Chinese labels (factors are log10 contributions).
const FACTORS = [
  ['base', '基座'],
  ['category_effect', '类别'],
  ['chain_effect', '链'],
  ['momentum_adj', '动量'],
  ['age_contrib', '年龄'],
  ['q50_shift', '中位偏移'],
];

// ---------------------------------------------------------------- boot

const RADAR = typeof window !== 'undefined' ? window.RADAR : null;

// Location.hash display mode, parsed once on load: '#plan=<slug>' full-plan view,
// '#view=portfolio' portfolio/heatmap mode, '#slug=<slug>' default view preselected.
const HASH = (() => {
  const out = { mode: 'default', slug: '' };
  if (typeof location === 'undefined') return out;
  const h = String(location.hash || '').replace(/^#/, '');
  const eq = h.indexOf('=');
  if (eq < 1) return out;
  const key = h.slice(0, eq);
  const val = h.slice(eq + 1);
  if (key === 'view' && val === 'portfolio') out.mode = 'portfolio';
  else if ((key === 'plan' || key === 'slug') && val) {
    out.mode = key;
    out.slug = val;
  }
  return out;
})();

if (typeof document !== 'undefined') {
  if (RADAR) init(RADAR);
  else document.getElementById('fallback').hidden = false;
}

function init(R) {
  // All page state lives in one object; render() is the only DOM writer besides selectRow().
  const state = { sort: 'implied', wonly: true, cat: '*', chain: '*', tier: '*', sel: '', tab: 'pre' };
  const rows = R.rows;
  const live = R.live || [];
  const covered = rows.filter((r) => r.on_watchlist).length;

  // '#slug=<slug>': default view with that row already selected (unknown slug → default).
  if (HASH.mode === 'slug') {
    const row = rows.find((r) => r.slug === HASH.slug);
    if (row) {
      state.sel = row.slug;
      if (!row.on_watchlist && state.wonly) {
        state.wonly = false;
        const cb = document.getElementById('wonly');
        if (cb) cb.checked = false;
      }
    } else HASH.mode = 'default';
  }

  // ---------------------------------------------------------------- derived option lists

  const catCounts = new Map();
  const chainCounts = new Map();
  for (const r of rows) {
    const c = r.category || '未分类';
    catCounts.set(c, (catCounts.get(c) || 0) + 1);
    for (const ch of r.chains) chainCounts.set(ch, (chainCounts.get(ch) || 0) + 1);
  }
  const byCount = (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const catList = [...catCounts.entries()].sort(byCount).map((e) => e[0]);
  const chainList = [...chainCounts.entries()].sort(byCount).slice(0, 12).map((e) => e[0]);

  const fcat = document.getElementById('fcat');
  const fchain = document.getElementById('fchain');
  fcat.innerHTML = '<option value="*">全部类别</option>' + catList.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  fchain.innerHTML = '<option value="*">全部链</option>' + chainList.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  // ---------------------------------------------------------------- filter + sort

  // Sort keys, negated so plain ascending comparison yields the wanted descending order.
  const SORTS = {
    implied: (r) => -r.implied_value_usd,
    tvl: (r) => -r.tvl_usd,
    mom: (r) => -(r.change_7d === null ? -Infinity : r.change_7d),
    age: (r) => -(r.age_days === null ? -Infinity : r.age_days),
    crowd: (r) => -r.crowding,
  };

  // Apply every filter, then sort (ties break on slug ascending for determinism).
  function visible() {
    const key = SORTS[state.sort];
    return rows
      .filter(
        (r) =>
          (!state.wonly || r.on_watchlist) &&
          (state.cat === '*' || (r.category || '未分类') === state.cat) &&
          (state.chain === '*' || r.chains.includes(state.chain)) &&
          (state.tier === '*' || tierOf(r.tvl_usd) === Number(state.tier)),
      )
      .sort((a, b) => key(a) - key(b) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  }

  // ---------------------------------------------------------------- render (one function)

  function render() {
    const view = visible();
    if (state.tab === 'pre' && !view.some((r) => r.slug === state.sel)) state.sel = view.length ? view[0].slug : '';
    renderHead();
    renderBanner();
    renderHero();
    renderHeat();
    const pre = state.tab === 'pre';
    document.getElementById('pre-controls').hidden = !pre;
    document.getElementById('boardwrap').hidden = !pre;
    document.getElementById('detail').hidden = !pre;
    document.getElementById('livewrap').hidden = pre;
    document.getElementById('live-note').hidden = pre;
    if (pre) {
      renderTable(view);
      renderDetail();
    } else {
      renderLive();
    }
    renderScatter();
    renderPortfolios();
    renderMethod();
    document.getElementById('count').textContent = pre ? `显示 ${view.length} / ${rows.length} 行` : `显示 ${live.length} / ${live.length} 行`;
    for (const b of document.querySelectorAll('#sorts button')) b.classList.toggle('on', b.dataset.k === state.sort);
    document.getElementById('wbadge').textContent = `${covered}/${R.watchlist_size}`;
    document.getElementById('tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  }

  function renderHead() {
    const tcPre = document.getElementById('tc-pre');
    if (tcPre) tcPre.textContent = rows.length;
    const tcLive = document.getElementById('tc-live');
    if (tcLive) tcLive.textContent = live.length;
    document.getElementById('asof').textContent = R.as_of;
    document.getElementById('fasof').textContent = R.as_of;
    document.getElementById('floor').textContent = fmtUsd(R.floor_usd);
    document.getElementById('hcounts').textContent = `榜单 ${R.board_size} · 早期 ${R.early_size} · 关注名单 ${R.watchlist_size}`;
  }

  function renderBanner() {
    const el = document.getElementById('banner');
    if (!el) return;
    const L = R.ledger || {};
    const total = L.total || R.rows.length + (R.live ? R.live.length : 0);
    const issued = (L.issued_with_mcap || 0) + (L.issued_no_mcap || 0);
    const unrec = (L.unissued_listed || 0) + (L.unissued_unlisted || 0);
    const listed = L.unissued_listed || R.board_size || 0;
    el.innerHTML =
      `<span class="bn">${total} 全量</span>` +
      `<span class="ba">→</span>` +
      `<span class="bn">${issued} 已发币对照</span>` +
      `<span class="ba">→</span>` +
      `<span class="bn">${unrec} 未记录</span>` +
      `<span class="ba">→</span>` +
      `<span class="bn acc">${listed} 上榜</span>`;
  }

  function renderHero() {
    const top3 = [...rows]
      .sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1))
      .slice(0, 3);
    document.getElementById('hbadge').textContent = `${covered}/${R.watchlist_size} watchlist 全覆盖`;
    document.getElementById('hsum').innerHTML =
      `${R.board_size} 行榜单（地板以下 ${R.early_size} 行）· Top 3 候选（点估计 / P25–P75 估值带）：`;
    document.getElementById('htop3').innerHTML = top3
      .map(
        (r, i) =>
          `<div class="t3"><span class="t3i num">${i + 1}</span><b>${esc(r.name)}</b>` +
          `<span class="num">${fmtUsd(r.implied_value_usd)}</span>` +
          `<span class="band num">P25 ${fmtUsd(r.band_lo, 1)} – P75 ${fmtUsd(r.band_hi, 1)}</span></div>`,
      )
      .join('');
    document.getElementById('hstab').textContent = R.stability_note;
  }

  // Chain × category heatmap: top 6 chains × top 6 categories, opacity ∝ TVL share.
  function renderHeat() {
    const cells = R.heatmap;
    const cs = new Map();
    const ks = new Map();
    for (const c of cells) {
      cs.set(c.chain, (cs.get(c.chain) || 0) + c.tvl_share);
      ks.set(c.category, (ks.get(c.category) || 0) + c.tvl_share);
    }
    const chains = [...cs.entries()].sort(byCount).slice(0, 6).map((e) => e[0]);
    const cats = [...ks.entries()].sort(byCount).slice(0, 6).map((e) => e[0]);
    const max = Math.max(...cells.map((c) => c.tvl_share), 1e-9);
    const share = (ch, ca) => {
      const hit = cells.find((c) => c.chain === ch && c.category === ca);
      return hit ? hit.tvl_share : 0;
    };
    let html = `<div class="hgrid" style="grid-template-columns:96px repeat(${cats.length},minmax(0,1fr))"><div></div>`;
    html += cats.map((c) => `<div class="hlab" title="${esc(c)}">${esc(c)}</div>`).join('');
    for (const ch of chains) {
      html += `<div class="hlab row" title="${esc(ch)}">${esc(ch)}</div>`;
      for (const ca of cats) {
        const s = share(ch, ca);
        html +=
          s > 0
            ? `<div class="hcell" style="background:rgba(44,229,167,${clamp(s / max, 0.1, 1).toFixed(2)})" title="${esc(ch)} · ${esc(ca)}：${fmtShare(s)}"><span class="num">${fmtShare(s)}</span></div>`
            : '<div class="hcell empty" title="无数据"></div>';
      }
    }
    document.getElementById('heat').innerHTML = html + '</div>';
  }

  function renderLive() {
    document.getElementById('livebody').innerHTML = live
      .map((r) => {
        const sym = r.symbol ? ` <span class="sl">${esc(r.symbol)}</span>` : '';
        return (
          `<tr>` +
          `<td><div class="nm">${esc(r.name)}</div>${sym}</td>` +
          `<td><span class="chip">${esc(r.category || '未分类')}</span></td>` +
          `<td class="num">${fmtUsd(r.tvl_usd)}</td>` +
          `<td class="num">${fmtUsd(r.mcap_usd)}</td>` +
          `<td class="num">${r.multiple.toFixed(2)}×</td></tr>`
        );
      })
      .join('');
  }

  function renderTable(view) {
    document.getElementById('tbody').innerHTML = view
      .map((r) => {
        const chg = r.change_7d;
        const cls = chg === null || !Number.isFinite(chg) ? '' : chg >= 0 ? ' up' : ' dn';
         const ts = r.token_status || 'unissued_snapshot';
         const tsLabel = ts === 'issued' ? '已发币' : ts === 'issued_no_mcap' ? '已发币·无市值' : ts === 'uncertain' ? '不确定' : '快照未记录';
         const delta = (r.tvl_rank || r.rank) - r.rank;
         const deltaHtml = delta > 0 ? `<span class="up">▲${delta}</span>` : delta < 0 ? `<span class="dn">▼${-delta}</span>` : `<span class="dim">—</span>`;
         return (
           `<tr class="row${r.slug === state.sel ? ' on' : ''}" data-s="${esc(r.slug)}">` +
           `<td class="num c dim">${r.rank}（P10–P90：${r.rank_p10}–${r.rank_p90}）</td>` +
           `<td title="${esc(r.slug)}"><div class="nm">${esc(r.name)}</div></td>` +
           `<td><span class="chip">${esc(r.category || '未分类')}</span></td>` +
           `<td><span class="chip">${esc(tsLabel)}</span></td>` +
           `<td class="num c">${r.chains.length}</td>` +
           `<td class="num">${fmtUsd(r.tvl_usd)}</td>` +
           `<td class="num${cls}">${fmtChange(chg)}</td>` +
           `<td class="num"><b>${fmtUsd(r.implied_value_usd)}</b> <span class="band">${fmtUsd(r.band_lo, 1)}–${fmtUsd(r.band_hi, 1)}</span></td>` +
           `<td><span class="conf ${r.confidence.level}">${CONF_LABEL[r.confidence.level]}</span></td>` +
           `<td class="num">${fmtX(r.crowding)}</td>` +
           `<td class="num">${deltaHtml}</td></tr>`
         );
      })
      .join('');
  }

  // Detail panel: identity, numbers, factor breakdown, comps, counter-evidence, full farm plan.
  function renderDetail() {
    const r = rows.find((x) => x.slug === state.sel);
    const el = document.getElementById('detail');
    if (!r) {
      el.innerHTML = '<p class="dim">无选中行</p>';
      return;
    }
    const p = R.plans[r.slug] || { steps: [], capital_usd: 0, share_pct: 0, airdrop_lo: 0, airdrop_hi: 0, verdict: 'FARM', stop_condition: '', break_even_share_pct_lo: 0, break_even_share_pct_mid: 0, break_even_share_pct_hi: 0 };
    const f = r.factors;
    const maxAdj = Math.max(...FACTORS.slice(1).map(([, k]) => Math.abs(f[k])), 0.01);
    const factorRows = FACTORS.map(([key, label], i) => {
      const v = f[key];
      if (key === 'base') {
        return `<div class="fx" title="log10 基座 = ${v}"><span class="fl">基座</span>` +
          `<span class="fv">${fmtUsd(Math.pow(10, v))}</span><i class="fb" style="width:100%"></i></div>`;
      }
      const neg = v < 0;
      const w = clamp((Math.abs(v) / maxAdj) * 100, 2, 100);
      return `<div class="fx" title="log10 贡献 = ${v}"><span class="fl">${label}</span>` +
        `<span class="fv">${fmtPow(v)}</span><i class="fb${neg ? ' neg' : ''}" style="width:${w.toFixed(0)}%"></i></div>`;
    }).join('');
    const reasonLine = r.confidence.reasons.length ? `<div class="why">原因：${r.confidence.reasons.map(esc).join('；')}</div>` : '';
    const comps =
      r.comps.length === 0
        ? '<tr><td colspan="4" class="dim">无同类可比</td></tr>'
        : r.comps
            .map(
              (cp) =>
                `<tr><td>${esc(cp.name)}</td><td class="num">${fmtUsd(cp.tvl_usd)}</td>` +
                `<td class="num">${fmtUsd(cp.mcap_usd)}</td><td class="num">${cp.multiple.toFixed(2)}×</td></tr>`,
            )
            .join('');
    el.innerHTML =
      `<div class="dtop"><h2>${esc(r.name)}</h2><span class="sl num">${esc(r.slug)}</span>` +
      `<span class="chip">${esc(r.category || '未分类')}</span>` +
      `<span class="badge ${r.on_watchlist ? 'acc' : 'early'}">${r.on_watchlist ? 'Watchlist' : '地板以下'}</span></div>` +
      `<div class="dch"><span class="dim">链：</span>${r.chains.map(esc).join('、')}</div>` +
      `<div class="dch"><span class="dim">排名稳定性：</span><span class="num">${r.rank}（P10–P90：${r.rank_p10}–${r.rank_p90}） · 三模型中位 #${r.median_model_rank}</span></div>` +
      `<div class="dnums">` +
      `<span>TVL <b>${fmtUsd(r.tvl_usd)}</b></span>` +
      `<span>7日 <b>${fmtChange(r.change_7d)}</b></span>` +
      `<span>收录 <b>${fmtAge(r.age_days)}</b></span>` +
      `<span title="横截面指数，非概率">指数·非概率 <b>${r.propensity}</b></span></div>` +
      `<div class="dval"><span class="big">${fmtUsd(r.implied_value_usd)}</span>` +
      `<span class="band num">P25 ${fmtUsd(r.band_lo, 1)} – P75 ${fmtUsd(r.band_hi, 1)}</span>` +
      `<span class="conf ${r.confidence.level}">${CONF_LABEL[r.confidence.level]}</span>${reasonLine}</div>` +
      `<h3>因子分解（log10，× = 10^x）</h3><div class="factors">${factorRows}</div>` +
       `<h3>可比锚点（同类已发币，按 log TVL 最近）</h3><table class="ctable"><tr><th>名称</th><th>TVL</th><th>市值</th><th>市值/TVL</th></tr>${comps}</table>` +
      `<div class="counter">反证：${esc(r.counter)}</div>` +
      `<div class="counter">农场判定：${esc(p.verdict || 'FARM')} · 停止条件：${esc(p.stop_condition || '')} · 投 $100 回本需分配 ${( (p.break_even_share_pct && p.break_even_share_pct.low) || 0).toFixed(6)}%（低/中/高三档 ${( (p.break_even_share_pct && p.break_even_share_pct.low) || 0).toFixed(6)}% / ${( (p.break_even_share_pct && p.break_even_share_pct.mid) || 0).toFixed(6)}% / ${( (p.break_even_share_pct && p.break_even_share_pct.high) || 0).toFixed(6)}%）</div>` +
      `<h3>农场计划</h3><ol class="steps">${p.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` +
      `<div class="pchips num"><span>投入 ${fmtUsd(p.capital_usd)}</span>` +
      `<span>÷ TVL ${fmtUsd(r.tvl_usd, 1)}</span>` +
      `<span>= 份额 ${fmtPct(p.share_pct)}</span>` +
      `<span>× 估值带 ${fmtUsd(r.band_lo, 1)}–${fmtUsd(r.band_hi, 1)}</span>` +
       `<span>= 市值暴露参考 ${fmtUsd(p.airdrop_lo, 1)}–${fmtUsd(p.airdrop_hi, 1)}</span>` +
       `<span>情景(${p.scenario_pct || 1}%) ${fmtUsd(p.scenario_lo || p.airdrop_lo, 1)}–${fmtUsd(p.scenario_hi || p.airdrop_hi, 1)}</span></div>`;
  }

  // Hand-written SVG scatter: log10 TVL vs log10 implied, watchlist in accent, early in secondary.
  function renderScatter() {
    const W = 960;
    const H = 300;
    const pad = { l: 62, r: 14, t: 14, b: 30 };
    const xs = rows.map((r) => Math.log10(Math.max(r.tvl_usd, 1)));
    const ys = rows.map((r) => Math.log10(r.implied_value_usd));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const X = (v) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
    const Y = (v) => H - pad.b - ((v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
    const f1 = (v) => X(v).toFixed(1);
    const g1 = (v) => Y(v).toFixed(1);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="隐含估值 × TVL 散点图">`;
    for (const t of [0, 0.5, 1]) {
      const xv = x0 + t * (x1 - x0);
      const yv = y0 + t * (y1 - y0);
      s += `<line class="grid" x1="${f1(xv)}" y1="${pad.t}" x2="${f1(xv)}" y2="${H - pad.b}"/>`;
      s += `<text class="tick" text-anchor="middle" x="${f1(xv)}" y="${H - 10}">${fmtUsd(Math.pow(10, xv), 1)}</text>`;
      if (t > 0) s += `<line class="grid" x1="${pad.l}" y1="${g1(yv)}" x2="${W - pad.r}" y2="${g1(yv)}"/>`;
      s += `<text class="tick" text-anchor="end" x="${pad.l - 6}" y="${(+g1(yv) + 4).toFixed(1)}">${fmtUsd(Math.pow(10, yv), 1)}</text>`;
    }
    // Fitted base line y = a + b·x in log10 space.
    s += `<line class="fit" x1="${f1(x0)}" y1="${g1(clamp(R.model.a + R.model.b * x0, y0, y1))}" ` +
      `x2="${f1(x1)}" y2="${g1(clamp(R.model.a + R.model.b * x1, y0, y1))}"/>`;
    s += rows
      .map(
        (r) =>
          `<circle r="3" fill="${r.on_watchlist ? '#2ce5a7' : '#4d8dff'}" fill-opacity=".65" ` +
          `cx="${f1(Math.log10(Math.max(r.tvl_usd, 1)))}" cy="${g1(Math.log10(r.implied_value_usd))}">` +
          `<title>${esc(r.name)}：TVL ${fmtUsd(r.tvl_usd)}，隐含估值 ${fmtUsd(r.implied_value_usd)}</title></circle>`,
      )
      .join('');
    s += `<text class="axis" x="10" y="12">log10 隐含估值</text>`;
    s += `<text class="axis" text-anchor="end" x="${W - pad.r}" y="12">log10 TVL →</text></svg>`;
    document.getElementById('scatter').innerHTML = s;
  }

  function renderPortfolios() {
    const pm = HASH.mode === 'portfolio';
    document.getElementById('cards').innerHTML = R.portfolios
      .map(
        (p) =>
          `<div class="pcard"><h3 class="num">$${p.budget}</h3>` +
          `<div class="pmeta">每仓 <b>$${p.position_size}</b>（估计） · ${p.count} 仓</div>` +
          (pm ? '' : `<p class="pnote">${esc(p.note)}</p>`) +
          `<div class="ptot num">${pm ? '份额' : '份额合计'} ${fmtPct(p.total_share_pct)} · ${pm ? '市值暴露参考' : '市值暴露参考合计'} ${fmtUsd(p.total_airdrop_lo, 1)}–${fmtUsd(p.total_airdrop_hi, 1)}</div>` +
          `<table class="ptab">` +
          p.positions
            .slice(0, pm ? 4 : 8)
            .map(
              (q, i) =>
                pm
                  ? `<tr title="${esc(q.category)} · ${esc(q.chain)}"><td class="num dim">${i + 1}</td><td class="pn">${esc(q.name)}</td>` +
                    `<td class="num">$${q.size}</td><td class="num">${fmtPct(q.share_pct)}</td>` +
                    `<td class="num">${fmtUsd(q.airdrop_lo, 1)}–${fmtUsd(q.airdrop_hi, 1)}</td></tr>`
                  : `<tr><td class="num dim">${i + 1}</td><td>${esc(q.name)}` +
                    `<div class="sl">${esc(q.category)} · ${esc(q.chain)}</div></td>` +
                    `<td class="num">$${q.size}</td><td class="num">${fmtPct(q.share_pct)}</td>` +
                    `<td class="num">${fmtUsd(q.airdrop_lo, 1)}–${fmtUsd(q.airdrop_hi, 1)}</td></tr>`,
            )
            .join('') +
          `</table></div>`,
      )
      .join('');
  }

  function renderMethod() {
    const m = R.model;
    const bt = R.backtest;
    const cal = R.calibration;
    const row = (k, v) => `<tr><td>${k}</td><td class="num">${v}</td></tr>`;
    document.getElementById('mcoef').innerHTML =
      row('a（截距）', m.a.toFixed(4)) +
      row('b（log10 TVL 斜率）', m.b.toFixed(4)) +
      row('c（log10 收录天数）', m.c.toFixed(4)) +
      row('d（动量系数）', m.d.toFixed(4)) +
      row('动量 winsor 区间', `${m.winsor_lo.toFixed(2)}% … ${m.winsor_hi.toFixed(2)}%`) +
      row('全局 R²', m.global_r2.toFixed(4)) +
      row(`影子回测 n=${bt.n} · 中位 log 误差`, bt.median_log_err.toFixed(4)) +
      row('回测 log 误差 P25 / P75', `${bt.q25_log_err.toFixed(3)} / ${bt.q75_log_err.toFixed(3)}`) +
      row('|log 误差| ≤ log10(3)（3× 内）占比', fmtShare(bt.within_3x_share)) +
      row('P25–P75 带覆盖率（校准前）', fmtShare(cal.before_coverage)) +
      row('P25–P75 带覆盖率（校准后）', fmtShare(cal.after_coverage)) +
      row('估值带校准系数 s', cal.coefficient.toFixed(4)) +
       row('Spearman ρ（只报告不设阈）', R.spearman.rho.toFixed(4)) +
       (R.baselines || []).map((b) => row(b.name + ' · OOF 覆盖率', b.backtest.band_coverage.toFixed(4)) + row(b.name + ' · OOF 中位 log 误差', b.backtest.median_log_err.toFixed(4))).join('') +
       (R.ablations || []).map((a) => row(a.name + ' · OOF 中位 log 误差', a.median_log_err.toFixed(4))).join('');
    document.getElementById('mcal').textContent = `校准方法：${cal.method}`;
    document.getElementById('mtop10').innerHTML = R.spearman.top10.map((s) => `<li>${esc(s)}</li>`).join('');
    document.getElementById('mcats').innerHTML = m.categories
      .map(
        (c) =>
          `<tr><td>${esc(c.name)}</td><td class="num">${c.n}</td><td class="num">${c.r2.toFixed(2)}</td>` +
          `<td class="num">${c.q25.toFixed(2)}</td><td class="num">${c.q50.toFixed(2)}</td><td class="num">${c.q75.toFixed(2)}</td>` +
          `<td>${c.low_conf ? '<span class="conf low">低置信</span>' : '—'}</td></tr>`,
      )
      .join('');
    document.getElementById('massum').innerHTML = R.assumptions.map((s) => `<li>${esc(s)}</li>`).join('');
    document.getElementById('mdet').textContent = R.determinism;
    document.getElementById('mstab').textContent = R.stability_note;
  }

  // ---------------------------------------------------------------- events (plain listeners)

  // Row clicks update the selection in place (no tbody rebuild → no scroll jump).
  function selectRow(slug) {
    if (state.sel === slug) return;
    const prev = document.querySelector('#tbody tr.on');
    if (prev) prev.classList.remove('on');
    const next = document.querySelector(`#tbody tr[data-s="${CSS.escape(slug)}"]`);
    if (next) next.classList.add('on');
    state.sel = slug;
    renderDetail();
  }

  document.getElementById('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-s]');
    if (tr) selectRow(tr.dataset.s);
  });
  document.getElementById('sorts').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (b) {
      state.sort = b.dataset.k;
      render();
    }
  });
  document.getElementById('wonly').addEventListener('change', (e) => {
    state.wonly = e.target.checked;
    render();
  });
  fcat.addEventListener('change', (e) => {
    state.cat = e.target.value;
    render();
  });
  fchain.addEventListener('change', (e) => {
    state.chain = e.target.value;
    render();
  });
  document.getElementById('ftier').addEventListener('change', (e) => {
    state.tier = e.target.value;
    render();
  });
  document.getElementById('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) {
      state.tab = b.dataset.tab;
      render();
    }
  });

  render();

  // ---------------------------------------------------------------- hash display modes

  // Body-level mode class: '#plan=<slug>' full-plan view, '#view=portfolio' portfolio view.
  const planOk = HASH.mode === 'plan' && !!R.plans[HASH.slug];
  document.body.classList.add(planOk ? 'mode-plan' : HASH.mode === 'portfolio' ? 'mode-portfolio' : 'mode-default');

  // The master-detail table zone: the whole <section> around board table + detail panel.
  const tableZone = document.getElementById('tbody').closest('section');

  // '#plan=<slug>': a centered full-farm-plan view directly under the header (unknown slug falls
  // back to the default view); heatmap, table, scatter, portfolios, methodology and footer hidden.
  if (planOk) {
    const row = rows.find((r) => r.slug === HASH.slug);
    const p = R.plans[HASH.slug];
    const reasons = row.confidence.reasons.map(esc).join('；');
    const steps = p.steps
      .map(
        (s, i) =>
          `<div class="plan-step">` +
          `<b class="num">步骤 ${i + 1}</b><span>${esc(s)}</span></div>`,
      )
      .join('');
    const sec = document.createElement('section');
    sec.innerHTML =
      `<div class="plan">` +
      `<div class="plan-head">` +
      `<b>${esc(row.name)}</b> <span class="sl num">${esc(row.slug)}</span> ` +
      `<span class="chip">${esc(row.category || '未分类')}</span> ` +
      `<span class="badge ${row.on_watchlist ? 'acc' : 'early'}">${row.on_watchlist ? 'Watchlist' : '地板以下'}</span></div>` +
      `<div class="pchips num plan-chips">` +
      `<span>投入 ${fmtUsd(p.capital_usd)}</span>` +
      `<span>份额 ${fmtPct(p.share_pct)}</span>` +
      `<span>估值带 ${fmtUsd(row.band_lo, 1)}–${fmtUsd(row.band_hi, 1)}</span>` +
      `<span>市值暴露参考 ${fmtUsd(p.airdrop_lo, 1)}–${fmtUsd(p.airdrop_hi, 1)}</span></div>` +
      `<div class="plan-conf">置信 ` +
      `<span class="conf ${row.confidence.level}">${CONF_LABEL[row.confidence.level]}</span>` +
      `${reasons ? ` 原因：${reasons}` : ''}</div>` +
      `<div class="plan-grid">${steps}</div>` +
      `<div class="counter plan-counter">反证：${esc(row.counter)}</div></div>`;
    const header = document.querySelector('.head');
    header.parentNode.insertBefore(sec, header.nextSibling);
    tableZone.style.display = 'none';
    document.getElementById('heat').closest('section').style.display = 'none';
    const scatterZone = document.getElementById('scatter').closest('section');
    if (scatterZone) scatterZone.style.display = 'none';
    const method = document.querySelector('.method');
    if (method && method.closest('section')) method.closest('section').style.display = 'none';
    const cardsZone = document.getElementById('cards').closest('section');
    if (cardsZone) cardsZone.style.display = 'none';
    const hero = document.querySelector('.hero');
    if (hero) hero.style.display = 'none';
    const foot = document.querySelector('.foot');
    if (foot) foot.style.display = 'none';
  }

  // '#view=portfolio': header + heatmap band + the three portfolio cards in one row; the hero bar,
  // master-detail zone, scatter and methodology sections are hidden. No scrolling.
  if (HASH.mode === 'portfolio') {
    tableZone.style.display = 'none';
    const scatterZone = document.getElementById('scatter').closest('section');
    if (scatterZone) scatterZone.style.display = 'none';
    const method = document.querySelector('.method');
    if (method && method.closest('section')) method.closest('section').style.display = 'none';
    const hero = document.querySelector('.hero');
    if (hero) hero.style.display = 'none';
    document.getElementById('cards').classList.add('row3');
  }
}
