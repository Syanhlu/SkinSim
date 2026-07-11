// ─── MiroShark → WorldTimeline adapter (plan §4.1) ───────────────────────────
// Builds a WorldTimeline from a *completed* MiroShark simulation using the
// documented Live State / Analytics endpoints:
//
//   GET /api/simulation/<id>/profiles          → agents (facebook_profiles.json rows)
//   GET /api/simulation/<id>/actions           → per-round action log (CREATE_POST etc.)
//   GET /api/simulation/<id>/posts             → raw post rows (fallback text source)
//   GET /api/simulation/<id>/belief-drift      → per-round bullish/neutral/bearish %
//   GET /api/simulation/<id>/polymarket/markets + /market/<mid>/prices → marketYesProb
//
// All endpoints return the MiroShark `{ success, data }` envelope and sit behind
// the `x-miroshark-internal-key` guard — server-side use only (scripts / API
// routes), never from the browser.

import type { AgentFrameState, Stance, WorldAgent, WorldFrame, WorldTimeline } from "./types";
import { hashSeed } from "./seed";

// ── Raw MiroShark response shapes (as implemented in backend/app/api/simulation.py) ──

interface MiroProfile {
  user_id?: number;
  username?: string;
  name?: string;
  bio?: string;
  persona?: string;
  age?: number;
  gender?: string;
  country?: string;
  region?: string;
  profession?: string;
  [key: string]: unknown;
}

interface MiroAction {
  round_num?: number;
  platform?: string;
  agent_id?: number;
  agent_name?: string;
  action_type?: string;
  action_args?: Record<string, unknown>;
  result?: string | null;
  success?: boolean;
}

interface MiroPost {
  user_id?: number;
  content?: string;
  created_at?: string;
  [key: string]: unknown;
}

interface MiroBeliefDrift {
  rounds?: number[];
  bullish?: number[];
  neutral?: number[];
  bearish?: number[];
  final?: { bullish?: number; neutral?: number; bearish?: number };
  consensus_round?: number | null;
  consensus_stance?: string | null;
}

interface MiroMarket {
  market_id?: number;
  question?: string;
  price_yes?: number;
  trade_count?: number;
}

interface MiroPricePoint {
  t?: string;
  price_yes?: number;
}

type Envelope<T> = { success?: boolean; data?: T; error?: unknown };

export interface BuildWorldTimelineOptions {
  baseUrl: string;
  simulationId: string;
  variantLabel: string;
  /** The injected variant/ad text shown on the TV. */
  injectionText?: string;
  /** Sent as x-miroshark-internal-key (server-side only). */
  internalKey?: string;
  /** Per-request timeout (ms). Default 30s. */
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Pull a completed simulation and shape it into a WorldTimeline. Missing or
 *  partial endpoints degrade gracefully (empty frames > thrown error) — only a
 *  missing/empty profile roster is fatal, because the world has nobody in it. */
export async function buildWorldTimeline(opts: BuildWorldTimelineOptions): Promise<WorldTimeline> {
  const get = makeGetter(opts);
  const sid = encodeURIComponent(opts.simulationId);

  const [profilesData, actionsData, postsData, driftData, marketsData] = await Promise.all([
    get<{ profiles?: MiroProfile[] }>(`/api/simulation/${sid}/profiles`),
    get<{ actions?: MiroAction[] }>(`/api/simulation/${sid}/actions?limit=100000`),
    get<{ posts?: MiroPost[] }>(`/api/simulation/${sid}/posts?limit=1000`),
    get<MiroBeliefDrift | null>(`/api/simulation/${sid}/belief-drift`),
    get<{ markets?: MiroMarket[] }>(`/api/simulation/${sid}/polymarket/markets`),
  ]);

  const profiles = profilesData?.profiles ?? [];
  if (profiles.length === 0) {
    throw new Error(`buildWorldTimeline: simulation ${opts.simulationId} has no agent profiles`);
  }
  const agents = profiles.map(profileToAgent);

  const actions = actionsData?.actions ?? [];
  const drift = driftData ?? undefined;

  // Round axis: prefer belief-drift's round list; else the max round seen in actions.
  const driftRounds = drift?.rounds ?? [];
  const maxActionRound = actions.reduce((max, a) => Math.max(max, a.round_num ?? 0), 0);
  const totalRounds = Math.max(
    driftRounds.length > 0 ? driftRounds[driftRounds.length - 1] : 0,
    maxActionRound,
    1,
  );

  // Market price series → per-round marketYesProb. Price points are trade-time
  // ordered (not round-stamped), so we spread them evenly across rounds — an
  // approximation that preserves the shape of the price path.
  const marketByRound = await loadMarketSeries(get, sid, marketsData?.markets ?? [], totalRounds);

  // Per-agent stance series. belief-drift only exposes AGGREGATE per-round
  // percentages, so we distribute stances across agents using a stable
  // per-agent affinity score (seeded by agent id): each round, the
  // most-bullish-affine agents take the bullish share, the most-bearish-affine
  // take the bearish share, the middle stays neutral. This is an APPROXIMATION
  // (documented in the plan §4.1): aggregates match the engine exactly per
  // round; the identity of which specific agent is bullish is synthetic but
  // stable across rounds, so individual arcs read believably.
  const stancePerRound = distributeStances(agents, drift, totalRounds);

  // Posts per round: CREATE_POST actions carry round_num + agent identity.
  // Fall back to raw /posts rows (no round info → spread evenly) when the
  // action log carries no usable post text.
  const postEvents = extractPostEvents(actions, postsData?.posts ?? [], agents, totalRounds);

  const frames: WorldFrame[] = [];
  for (let round = 1; round <= totalRounds; round++) {
    const states: Record<string, AgentFrameState> = {};
    const roundStances = stancePerRound.get(round);
    for (const agent of agents) {
      states[agent.id] = { stance: roundStances?.get(agent.id) ?? "unknown" };
    }
    for (const event of postEvents.get(round) ?? []) {
      const state = states[event.agentId];
      if (state) {
        state.post = { text: event.text, platform: event.platform };
        state.action = "CREATE_POST";
      }
    }
    frames.push({
      round,
      states,
      marketYesProb: marketByRound.get(round),
    });
  }

  return {
    agents,
    frames,
    variantLabel: opts.variantLabel,
    injectionText: opts.injectionText ?? "",
    simulationId: opts.simulationId,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function makeGetter(opts: BuildWorldTimelineOptions) {
  const base = opts.baseUrl.trim().replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async function get<T>(path: string): Promise<T | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.requestTimeoutMs ?? 30_000);
    try {
      const res = await fetchImpl(`${base}${path}`, {
        headers: opts.internalKey ? { "x-miroshark-internal-key": opts.internalKey } : {},
        signal: controller.signal,
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as Envelope<T>;
      if (body && typeof body === "object" && "success" in body) {
        return body.success ? (body.data as T) : undefined;
      }
      return body as unknown as T;
    } catch {
      return undefined; // degrade, never throw per-endpoint
    } finally {
      clearTimeout(timer);
    }
  };
}

function profileToAgent(profile: MiroProfile, index: number): WorldAgent {
  const id = String(profile.user_id ?? profile.username ?? profile.name ?? `agent-${index}`);
  const persona = typeof profile.persona === "string" ? profile.persona : "";
  const bio = typeof profile.bio === "string" ? profile.bio : "";
  return {
    id,
    name: profile.name || profile.username || `Agent ${index + 1}`,
    avatarSeed: hashSeed(`${id}:${profile.name ?? ""}`),
    demographics: {
      age: typeof profile.age === "number" ? profile.age : undefined,
      gender: profile.gender || undefined,
      region: (typeof profile.region === "string" && profile.region) || profile.country || undefined,
      occupation: profile.profession || undefined,
    },
    personaSummary: firstSentence(persona || bio) || "A simulated consumer.",
  };
}

function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const match = cleaned.match(/^.{10,160}?[.!?。](\s|$)/);
  return (match ? match[0] : cleaned.slice(0, 160)).trim();
}

async function loadMarketSeries(
  get: <T>(path: string) => Promise<T | undefined>,
  sid: string,
  markets: MiroMarket[],
  totalRounds: number,
): Promise<Map<number, number>> {
  const byRound = new Map<number, number>();
  const market = [...markets].sort((a, b) => (b.trade_count ?? 0) - (a.trade_count ?? 0))[0];
  if (!market || market.market_id === undefined) return byRound;

  const prices = await get<{ points?: MiroPricePoint[] }>(
    `/api/simulation/${sid}/polymarket/market/${market.market_id}/prices`,
  );
  const points = (prices?.points ?? []).filter((p) => typeof p.price_yes === "number");
  if (points.length === 0) {
    if (typeof market.price_yes === "number") {
      for (let r = 1; r <= totalRounds; r++) byRound.set(r, market.price_yes);
    }
    return byRound;
  }
  // Spread trade-ordered points evenly across rounds (see approximation note).
  for (let r = 1; r <= totalRounds; r++) {
    const idx = Math.min(
      points.length - 1,
      Math.floor(((r - 1) / Math.max(1, totalRounds - 1)) * (points.length - 1)),
    );
    byRound.set(r, points[idx].price_yes as number);
  }
  return byRound;
}

function distributeStances(
  agents: WorldAgent[],
  drift: MiroBeliefDrift | undefined,
  totalRounds: number,
): Map<number, Map<string, Stance>> {
  const perRound = new Map<number, Map<string, Stance>>();

  // Stable affinity ordering: same agent always sits at the same place on the
  // bearish↔bullish axis, so stance churn reads as individuals changing minds
  // near the margin rather than the whole crowd shuffling.
  const ordered = [...agents].sort(
    (a, b) => (hashSeed(`affinity:${a.id}`) % 100000) - (hashSeed(`affinity:${b.id}`) % 100000),
  );

  const rounds = drift?.rounds ?? [];
  const bullishPct = drift?.bullish ?? [];
  const bearishPct = drift?.bearish ?? [];

  for (let round = 1; round <= totalRounds; round++) {
    // Nearest known drift sample at-or-before this round; before the first
    // sample everyone is "unknown" (agents haven't formed a stance yet).
    let sampleIdx = -1;
    for (let i = 0; i < rounds.length; i++) {
      if (rounds[i] <= round) sampleIdx = i;
      else break;
    }
    const map = new Map<string, Stance>();
    if (sampleIdx === -1) {
      for (const agent of agents) map.set(agent.id, "unknown");
    } else {
      const nBullish = Math.round(((bullishPct[sampleIdx] ?? 0) / 100) * agents.length);
      const nBearish = Math.round(((bearishPct[sampleIdx] ?? 0) / 100) * agents.length);
      ordered.forEach((agent, i) => {
        if (i < nBullish) map.set(agent.id, "bullish");
        else if (i >= ordered.length - nBearish) map.set(agent.id, "bearish");
        else map.set(agent.id, "neutral");
      });
    }
    perRound.set(round, map);
  }
  return perRound;
}

interface PostEvent {
  agentId: string;
  text: string;
  platform: "threads" | "facebook";
}

function extractPostEvents(
  actions: MiroAction[],
  rawPosts: MiroPost[],
  agents: WorldAgent[],
  totalRounds: number,
): Map<number, PostEvent[]> {
  const byRound = new Map<number, PostEvent[]>();
  const agentIds = new Set(agents.map((a) => a.id));
  const idByName = new Map(agents.map((a) => [a.name, a.id]));

  const push = (round: number, event: PostEvent) => {
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push(event);
  };

  let found = 0;
  for (const action of actions) {
    if (action.action_type !== "CREATE_POST" || action.success === false) continue;
    const text = extractPostText(action);
    if (!text) continue;
    const agentId =
      (action.agent_id !== undefined && agentIds.has(String(action.agent_id))
        ? String(action.agent_id)
        : undefined) ?? (action.agent_name ? idByName.get(action.agent_name) : undefined);
    if (!agentId) continue;
    const round = Math.min(Math.max(action.round_num ?? 1, 1), totalRounds);
    push(round, { agentId, text: text.slice(0, 240), platform: normalizePlatform(action.platform) });
    found++;
  }

  if (found === 0 && rawPosts.length > 0) {
    // Fallback: raw post rows carry no round — spread them across the run in
    // created_at order so the world still talks.
    const posts = rawPosts.filter((p) => typeof p.content === "string" && p.content);
    posts.forEach((post, i) => {
      const agentId = String(post.user_id ?? "");
      if (!agentIds.has(agentId)) return;
      const round = 1 + Math.floor((i / Math.max(1, posts.length)) * totalRounds);
      push(Math.min(round, totalRounds), {
        agentId,
        text: (post.content as string).slice(0, 240),
        platform: "facebook",
      });
    });
  }

  return byRound;
}

function extractPostText(action: MiroAction): string | undefined {
  const args = action.action_args ?? {};
  for (const key of ["content", "text", "post_content", "message"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (typeof action.result === "string" && action.result.trim().length > 20) {
    return action.result.trim();
  }
  return undefined;
}

function normalizePlatform(platform: string | undefined): "threads" | "facebook" {
  return platform === "threads" ? "threads" : "facebook";
}
