// LaunchScope model: what would a pre-token protocol's token be worth if it launched today?
//
// The model is calibrated on the snapshot itself, never on outside data:
//
//   1. Take every protocol in the snapshot that already trades (it records a market cap).
//      For each one compute market_cap / TVL. The median of those ratios is the market's
//      own answer to "what is $1 of TVL worth as a token?" — about 0.20x on this snapshot.
//   2. Do the same per category, then shrink each category median toward the global median
//      (weight 5) so a category with one comparable cannot dominate, and clamp every multiple
//      to [0.4x, 2.5x] of the global median: on this snapshot a single oracle token filed
//      under Risk Curators trades at 2.97x TVL, and without the clamp that one filing quirk
//      would triple the price of all twelve watchlist curators.
//   3. A pre-token protocol's implied value is then
//        TVL x category multiple x growth multiplier x maturity multiplier x reach multiplier
//      - growth:   1 + clamp(change_7d, -40, +40)/100 x 0.75   (a hot week helps, a bad week hurts, neither explodes)
//      - maturity: 0.78 + 0.30 x min(age_days, 1460)/1460      (protocols tracked longer have a record to price)
//      - reach:    1 + 0.015 x min(chains - 1, 8)              (distribution across chains is worth a little more)
//
// No protocol name is ever special-cased: one function scores every row, and every factor of
// every row is written into board.json and data.js so the dashboard can show the arithmetic.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One category's calibrated multiple and how many live comparables produced it. */
export interface CategoryMultiple {
  category: string;
  comparables: number;
  raw_median: number;
  multiple: number;
}

/** The calibration the dashboard states: global median plus every category multiple. */
export interface Calibration {
  global_median: number;
  live_protocols: number;
  shrink_weight: number;
  min_multiple: number;
  max_multiple: number;
  categories: CategoryMultiple[];
}

export const MODEL_VERSION = 'launchscope-2';
export const SHRINK_WEIGHT = 5;
/** Category multiples are clamped to this band around the global median (see header). */
export const REL_MIN_MULTIPLE = 0.4;
export const REL_MAX_MULTIPLE = 2.5;
export const GROWTH_FLOOR = -40;
export const GROWTH_CAP = 40;
export const GROWTH_WEIGHT = 0.75;
export const MATURITY_BASE = 0.78;
export const MATURITY_RANGE = 0.3;
export const MATURITY_DAYS = 1460;
export const UNKNOWN_AGE_DAYS = 365;
export const REACH_PER_CHAIN = 0.015;
export const REACH_MAX_CHAINS = 8;

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the calibration view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step before it is flattened to one string. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    comparables: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: everything the page renders, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  comparables: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the page shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days between the day DefiLlama began tracking a protocol and the snapshot date. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol may be ranked: pre-token, not an exchange, not a versioned pool of another. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * Calibrate category multiples on the snapshot's live tokens. Ratios above 5x are trimmed
 * before the medians: a handful of tiny-TVL tokens trade at absurd multiples and would
 * otherwise poison the categories they sit in.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratios = live.map((p) => p.mcap_usd! / p.tvl_usd).filter((r) => r <= 5);
  const globalMedian = ratios.length > 0 ? median(ratios) : 0.2;
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const r = p.mcap_usd! / p.tvl_usd;
    if (r > 5) continue;
    const list = byCategory.get(p.category) ?? [];
    list.push(r);
    byCategory.set(p.category, list);
  }
  const lo = REL_MIN_MULTIPLE * globalMedian;
  const hi = REL_MAX_MULTIPLE * globalMedian;
  const categories: CategoryMultiple[] = [...byCategory.entries()]
    .map(([category, list]) => {
      const raw = median(list);
      const shrunk = (list.length * raw + SHRINK_WEIGHT * globalMedian) / (list.length + SHRINK_WEIGHT);
      return {
        category,
        comparables: list.length,
        raw_median: round4(raw),
        multiple: round4(Math.min(hi, Math.max(lo, shrunk))),
      };
    })
    .sort((a, b) => b.comparables - a.comparables || (a.category < b.category ? -1 : 1));
  return {
    global_median: round4(globalMedian),
    live_protocols: live.length,
    shrink_weight: SHRINK_WEIGHT,
    min_multiple: round4(lo),
    max_multiple: round4(hi),
    categories,
  };
}

/** The multiple one protocol gets: its category's when calibrated, else the global median. */
function multipleFor(p: SnapshotProtocol, calibration: Calibration): { multiple: number; comparables: number } {
  if (p.category !== null) {
    const found = calibration.categories.find((c) => c.category === p.category);
    if (found !== undefined) return { multiple: found.multiple, comparables: found.comparables };
  }
  return { multiple: calibration.global_median, comparables: calibration.live_protocols };
}

/** Every factor of one protocol's implied value, and the value itself. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
): { implied: number; multiple: number; comparables: number; growthPct: number; growthMult: number; maturityMult: number; reachMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, comparables } = multipleFor(p, calibration);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturityMult = MATURITY_BASE + (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
  const reachMult = 1 + REACH_PER_CHAIN * Math.min(Math.max(p.chains.length - 1, 0), REACH_MAX_CHAINS);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * reachMult));
  return { implied, multiple, comparables, growthPct, growthMult, maturityMult, reachMult, age };
}

/** A step as one string for board.json: the action, then its cost and time (20..600 characters). */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and re-check it weekly.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Typical gas for one transaction on a chain, in plain dollars a farmer can budget with. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 'about $8 of ETH for gas';
  if (c.includes('bitcoin')) return 'about $3 of BTC for fees';
  if (c.includes('solana')) return 'under $0.10 of SOL for fees';
  if (c.includes('tron')) return 'about $1 of TRX for fees';
  return 'under $0.50 of gas';
}

/** How much capital one qualifying position needs, scaled to the protocol's size. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long a position should be held: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in words a first-time farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend')) return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow no more than $${Math.round(capital / 4)} against it so the supply counts as active lending.`;
  if (c.includes('cdp') || c.includes('collateral')) return `Deposit $${capital} of collateral into ${n} on ${chain} and mint a small position, keeping the health factor above 2.`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${n}'s busiest pool on ${chain}, split evenly between the pool's two assets.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${n} to ${chain} and spend or deposit it there instead of bridging straight back.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the staking receipt in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${n} and open one small hedged trade, then close it after a day.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('capital')) return `Deposit $${capital} into one of ${n}'s curated vaults on ${chain} and keep the vault shares untouched.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it in the farming wallet.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it past the next distribution date.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} for one month and keep the policy NFT in the wallet.`;
  if (c.includes('payment')) return `Route one real payment of about $${capital} through ${n} and keep the receiving balance on ${chain} for a week.`;
  if (c.includes('basis')) return `Open ${n}'s basis position with $${capital} on ${chain}: half spot, half the offsetting hedge it describes.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${n}'s incentive market on ${chain} and claim the weekly incentive once it appears.`;
  if (c.includes('chain')) return `Hold $${capital} of assets on the ${n} chain and make one transfer or swap a week so the wallet is an active user.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open and untouched.`;
}

/** A second, different action so the wallet looks like a user, not a one-click airdrop hunter. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Repay and re-borrow once in week two, and vote in any ${n} governance poll that opens while you hold the position.`;
  if (c.includes('dex') || c.includes('yield')) return `Make two small swaps through ${n} in different weeks so the wallet has trading history, not only liquidity.`;
  if (p.chains.length > 1) return `Repeat the core deposit with $25 on ${p.chains[1]}, the protocol's second chain, so the wallet is active in two of its markets.`;
  return `Use one more feature of ${n} than the deposit itself — a swap, a vote or a claim — in a separate week from the deposit.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) — never a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Set up one fresh wallet for ${p.name} alone, save its seed phrase offline, and fund it with the position plus gas money.`,
      cost: gas,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus ${gas}`,
      time: '20 minutes to set up',
    },
    {
      text: secondActionFor(p, chain),
      cost: 'about $10 of extra capital and under $1 of gas on most chains',
      time: '10 minutes in week two',
    },
    {
      text: `Repeat one qualifying action every week — a deposit top-up of $10, a swap, a borrow or a claim — so no week is empty.`,
      cost: 'about $2 a week in gas and top-ups',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days: protocols this age are usually snapshotted more than once before any launch.`,
      cost: `the $${capital} stays in the position for the whole hold`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own points, rewards or governance page every Sunday and claim only through links that page publishes.`,
      cost: 'nothing to check; never pay a fee to claim an airdrop',
      time: '5 minutes a week',
    },
    {
      text: `Log the wallet, dates, amounts and transaction hashes in a farm diary, and note the exit route (withdrawal queue or pool) before you need it.`,
      cost: 'nothing but the diary',
      time: '10 minutes, once',
    },
  ];
}

/** The protocols the board ranks: the whole watchlist plus the early radar below the floor. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const calibration = calibrate(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, calibration) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watch.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      category_multiple: s.v.multiple,
      comparables: s.v.comparables,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      reach_multiplier: round4(s.v.reachMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the calibration view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    on_watchlist: row.on_watchlist,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    comparables: row.model.comparables,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    reach_multiplier: row.model.reach_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    calibration: calibrate(snapshot),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
