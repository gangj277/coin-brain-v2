import type {
  ClearinghouseState,
  Fill,
  FundingEntry,
  Meta,
  PortfolioResponse,
  OpenOrder,
  FrontendOpenOrder,
} from "./types";

const BASE_URL = "https://api.hyperliquid.xyz";
const INFO_URL = `${BASE_URL}/info`;

async function postInfo<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hyperliquid API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─── Market Data ─────────────────────────────────────────

export async function getMeta(): Promise<Meta> {
  return postInfo<Meta>({ type: "meta" });
}

export async function getAllMids(): Promise<Record<string, string>> {
  return postInfo<Record<string, string>>({ type: "allMids" });
}

export interface AssetContext {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string;
  oraclePx: string;
  markPx: string;
  midPx: string;
}

export async function getMetaAndAssetCtxs(): Promise<{
  meta: Meta;
  contexts: Map<string, AssetContext>;
}> {
  const raw = await postInfo<[Meta, AssetContext[]]>({ type: "metaAndAssetCtxs" });
  const meta = raw[0];
  const ctxs = raw[1];
  const contexts = new Map<string, AssetContext>();
  for (let i = 0; i < meta.universe.length; i++) {
    contexts.set(meta.universe[i].name, ctxs[i]);
  }
  return { meta, contexts };
}

// ─── User Account ────────────────────────────────────────

export async function getClearinghouseState(
  user: string
): Promise<ClearinghouseState> {
  return postInfo<ClearinghouseState>({ type: "clearinghouseState", user });
}

export async function getOpenOrders(user: string): Promise<OpenOrder[]> {
  return postInfo<OpenOrder[]>({ type: "openOrders", user });
}

export async function getFrontendOpenOrders(
  user: string
): Promise<FrontendOpenOrder[]> {
  return postInfo<FrontendOpenOrder[]>({ type: "frontendOpenOrders", user });
}

// ─── Trade History ───────────────────────────────────────

export async function getUserFills(
  user: string,
  options?: { aggregateByTime?: boolean }
): Promise<Fill[]> {
  return postInfo<Fill[]>({
    type: "userFills",
    user,
    ...(options?.aggregateByTime ? { aggregateByTime: true } : {}),
  });
}

export async function getUserFillsByTime(
  user: string,
  startTime: number,
  endTime?: number,
  options?: { aggregateByTime?: boolean }
): Promise<Fill[]> {
  const body: Record<string, unknown> = {
    type: "userFillsByTime",
    user,
    startTime,
  };
  if (endTime) body.endTime = endTime;
  if (options?.aggregateByTime) body.aggregateByTime = true;
  return postInfo<Fill[]>(body);
}

// ─── Funding ─────────────────────────────────────────────

export async function getUserFunding(
  user: string,
  startTime: number,
  endTime?: number
): Promise<FundingEntry[]> {
  const body: Record<string, unknown> = {
    type: "userFunding",
    user,
    startTime,
  };
  if (endTime) body.endTime = endTime;
  return postInfo<FundingEntry[]>(body);
}

// ─── Portfolio / Performance ─────────────────────────────

export async function getPortfolio(user: string): Promise<PortfolioResponse> {
  return postInfo<PortfolioResponse>({ type: "portfolio", user });
}

// ─── Batch: Full Trader Snapshot ─────────────────────────

export interface TraderSnapshot {
  address: string;
  state: ClearinghouseState;
  portfolio: PortfolioResponse;
  recentFills: Fill[];
  openOrders: FrontendOpenOrder[];
}

export async function getTraderSnapshot(
  address: string
): Promise<TraderSnapshot> {
  const [state, portfolio, recentFills, openOrders] = await Promise.all([
    getClearinghouseState(address),
    getPortfolio(address),
    getUserFills(address),
    getFrontendOpenOrders(address),
  ]);

  return { address, state, portfolio, recentFills, openOrders };
}

// ─── Batch: Multiple Traders ─────────────────────────────

export async function getMultipleTraderSnapshots(
  addresses: string[],
  concurrency = 5
): Promise<TraderSnapshot[]> {
  const results: TraderSnapshot[] = [];

  for (let i = 0; i < addresses.length; i += concurrency) {
    const batch = addresses.slice(i, i + concurrency);
    const snapshots = await Promise.all(
      batch.map((addr) => getTraderSnapshot(addr))
    );
    results.push(...snapshots);
  }

  return results;
}

// ─── Vault Details (for discovering traders) ─────────────

export interface VaultFollower {
  user: string;
  vaultEquity: string;
  pnl: string;
  allTimePnl: string;
  daysFollowing: number;
  vaultEntryTime: number;
}

export interface VaultDetails {
  name: string;
  vaultAddress: string;
  leader: string;
  description: string;
  apr: number;
  followers: VaultFollower[];
}

export async function getVaultDetails(
  vaultAddress: string
): Promise<VaultDetails> {
  return postInfo<VaultDetails>({ type: "vaultDetails", vaultAddress });
}

// ─── Trader Discovery ────────────────────────────────────

const HLP_VAULT = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303";

export async function discoverActiveTraders(
  topN = 50,
  concurrency = 10
): Promise<{ address: string; accountValue: number; positionCount: number }[]> {
  const vault = await getVaultDetails(HLP_VAULT);

  const candidates = vault.followers
    .sort((a, b) => parseFloat(b.vaultEquity) - parseFloat(a.vaultEquity))
    .slice(0, topN)
    .map((f) => f.user);

  const active: { address: string; accountValue: number; positionCount: number }[] = [];

  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (addr) => {
        try {
          const state = await getClearinghouseState(addr);
          return {
            address: addr,
            accountValue: parseFloat(state.marginSummary.accountValue),
            positionCount: state.assetPositions.length,
          };
        } catch {
          return null;
        }
      })
    );
    for (const r of results) {
      if (r && r.positionCount > 0) active.push(r);
    }
  }

  return active.sort((a, b) => b.accountValue - a.accountValue);
}
