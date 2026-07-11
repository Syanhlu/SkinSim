// ─── Demo timeline generator (plan §4.1 stage fallback) ──────────────────────
// Deterministically synthesizes public/demo/timeline-A.json and
// timeline-B.json: the SAME 60 census-plausible Vietnamese agents reacting to
// two KFC promo variants over 48 rounds. Variant A settles ~46% bullish,
// variant B ~57%. Includes per-round Vietnamese post texts, a drifting
// prediction-market series, and 3 canned interview Q&As for 5 highlighted
// agents (offline interview fallback, plan §4.4).
//
// Run:  npx tsx scripts/gen-demo-timelines.ts
// Deterministic: same output on every run (seeded mulberry32, no Date/Math.random).

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentFrameState,
  CannedInterview,
  Stance,
  WorldAgent,
  WorldFrame,
  WorldTimeline,
} from "../lib/world/types";
import { mulberry32, hashSeed, pick, randInt } from "../lib/world/seed";

const ROUNDS = 48;
const N_AGENTS = 60;

const VARIANTS = {
  A: {
    label: "A",
    injectionText: "Gà Rán Giòn Cay — combo 89k, giảm 30% cho đơn đầu tiên trên app",
    finalBullish: 28, // 46.7%
    finalBearish: 19,
    marketTarget: 0.46,
  },
  B: {
    label: "B",
    injectionText: "KFC x Bạn Thân — mua 1 tặng 1 thứ Ba hàng tuần, chỉ tại cửa hàng",
    finalBullish: 34, // 56.7%
    finalBearish: 14,
    marketTarget: 0.57,
  },
} as const;

// ── Roster ingredients ───────────────────────────────────────────────────────

const FAMILY = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương"];
const MIDDLE_M = ["Văn", "Hữu", "Đức", "Minh", "Quốc", "Thanh", "Công", "Xuân", "Tuấn", "Gia"];
const MIDDLE_F = ["Thị", "Ngọc", "Thu", "Thanh", "Kim", "Mỹ", "Hồng", "Phương", "Khánh", "Diễm"];
const GIVEN_M = ["Anh", "Bình", "Cường", "Dũng", "Hải", "Hùng", "Khoa", "Long", "Nam", "Phúc", "Quân", "Sơn", "Thắng", "Toàn", "Trung", "Việt", "Kiên", "Đạt", "Huy", "Tùng"];
const GIVEN_F = ["An", "Chi", "Dung", "Hà", "Hạnh", "Hương", "Lan", "Linh", "Mai", "My", "Ngân", "Nhi", "Oanh", "Phương", "Quỳnh", "Thảo", "Trang", "Tuyết", "Vy", "Yến"];

const REGIONS: Array<[string, number]> = [
  ["TP.HCM", 28],
  ["Hà Nội", 24],
  ["Đà Nẵng", 10],
  ["Cần Thơ", 8],
  ["Hải Phòng", 7],
  ["Đồng Nai", 6],
  ["Nghệ An", 5],
  ["Thừa Thiên Huế", 4],
  ["Bình Dương", 4],
  ["An Giang", 4],
];

type Archetype =
  | "student"
  | "office"
  | "parent"
  | "kol"
  | "loyal"
  | "skeptic"
  | "driver"
  | "vendor";

interface ArchetypeSpec {
  weight: number;
  ages: [number, number];
  occupations: string[];
  /** Base bullish affinity in [-1, 1] — feeds final-stance assignment. */
  affinity: number;
  personas: string[]; // {occ} replaced
}

const ARCHETYPES: Record<Archetype, ArchetypeSpec> = {
  student: {
    weight: 16,
    ages: [17, 24],
    occupations: ["sinh viên", "sinh viên năm cuối", "học sinh THPT"],
    affinity: 0.35,
    personas: [
      "Sinh viên săn voucher, chỉ đặt đồ ăn khi stack được mã giảm giá.",
      "Ví lúc nào cũng mỏng nên combo dưới 100k mới dám rủ bạn đi ăn.",
      "Sống trên Threads, thấy deal hời là tag cả nhóm bạn vào.",
    ],
  },
  office: {
    weight: 12,
    ages: [25, 39],
    occupations: ["nhân viên văn phòng", "kế toán", "chuyên viên marketing", "kỹ sư phần mềm"],
    affinity: -0.15,
    personas: [
      "Dân văn phòng đang cố ăn sạch, đồ chiên rán là tội lỗi có chủ đích.",
      "Trưa nào cũng đau đầu chọn giữa cơm nhà mang theo và đặt app.",
      "So giá từng đơn trên ShopeeFood với GrabFood trước khi bấm đặt.",
    ],
  },
  parent: {
    weight: 10,
    ages: [30, 48],
    occupations: ["nội trợ", "giáo viên", "công chức", "nhân viên ngân hàng"],
    affinity: 0.1,
    personas: [
      "Cuối tuần hay chiều con đi ăn gà rán, nhưng luôn tính combo nào lợi nhất.",
      "Chỉ tin khuyến mãi khi ra tới quầy giá vẫn đúng như quảng cáo.",
      "Một bữa gà rán cho cả nhà bốn người là một khoản phải cân nhắc.",
    ],
  },
  kol: {
    weight: 5,
    ages: [20, 32],
    occupations: ["food reviewer", "KOL ẩm thực", "content creator"],
    affinity: -0.25,
    personas: [
      "Review đồ ăn nhanh để kiếm tương tác — khen thì ít view, chê mới viral.",
      "Từng bóc phốt khuyến mãi ảo nên follower rất chờ mấy vụ thế này.",
      "Ăn thử mọi chương trình mới của các chuỗi gà rán để làm content.",
    ],
  },
  loyal: {
    weight: 7,
    ages: [18, 35],
    occupations: ["nhân viên bán lẻ", "sinh viên", "nhân viên văn phòng"],
    affinity: 0.7,
    personas: [
      "Fan gà giòn cay chính hiệu, tháng nào cũng ghé KFC ít nhất hai lần.",
      "Trong máy lúc nào cũng có app KFC, ra món mới là phải thử ngay.",
      "Ăn gà rán từ bé, với mình vị KFC là tuổi thơ.",
    ],
  },
  skeptic: {
    weight: 6,
    ages: [26, 55],
    occupations: ["bác sĩ dinh dưỡng", "huấn luyện viên gym", "công nhân", "kỹ sư xây dựng"],
    affinity: -0.75,
    personas: [
      "Không bao giờ đụng đồ ăn nhanh — dầu chiên đi chiên lại là thứ đáng sợ nhất.",
      "Tin rằng khuyến mãi chỉ là cách móc ví tinh vi, giảm giá tức là đã nâng giá.",
      "Thà ăn cơm gà xối mỡ quán quen còn hơn gà rán chuỗi ngoại.",
    ],
  },
  driver: {
    weight: 4,
    ages: [22, 45],
    occupations: ["tài xế công nghệ", "shipper"],
    affinity: 0.2,
    personas: [
      "Chạy ship cả ngày nên biết quán nào đang cháy đơn, quán nào ế.",
      "Khuyến mãi mạnh là đơn nổ liên tục — nhìn app là biết chương trình có hiệu quả.",
    ],
  },
  vendor: {
    weight: 3,
    ages: [30, 58],
    occupations: ["chủ quán cơm gà", "tiểu thương chợ"],
    affinity: -0.5,
    personas: [
      "Bán cơm gà gần 20 năm, mỗi lần chuỗi lớn khuyến mãi là khách vắng hẳn một tuần.",
      "Không ưa gà rán ngoại nhưng phải theo dõi sát giá của tụi nó để giữ khách.",
    ],
  },
};

// ── Post text pools (Vietnamese, referencing the scenario) ──────────────────

const POSTS_BULLISH = [
  "Combo 89k mà giảm thêm 30% đơn đầu trên app thì rẻ hơn cả cơm văn phòng, tội gì không thử 🍗",
  "Vừa stack voucher app + mã ShopeeFood, hai miếng gà giòn cay còn có 62k. Quá hời!",
  "Thứ Ba mua 1 tặng 1 là rủ được đứa bạn thân đi ăn rồi, tuần nào cũng có lý do tụ tập 😆",
  "Gà giòn cay đợt này ướp đậm hơn hẳn, chấm muối ớt xanh là hết nước chấm.",
  "Cả nhóm 5 đứa order combo mới, chia ra mỗi đứa chưa tới 45k. Sinh viên approve ✅",
  "Đặt thử đơn đầu tiên trên app, giảm 30% thật, giao 25 phút còn nóng. Ổn áp.",
  "Deal này mà không hot thì mình không biết deal nào hot nữa, timeline toàn thấy khoe bill KFC.",
  "Mua 1 tặng 1 tại quầy đông thật, tối qua xếp hàng 15 phút nhưng đáng.",
  "Lâu lắm mới thấy KFC chịu chi thế này, Lotteria với Jollibee lần này đuối rồi.",
  "Con bé nhà mình mê gà rán, có khuyến mãi thế này cuối tuần đỡ được kha khá 🙏",
  "Đợt này chạy ship nổ đơn KFC liên tục, chương trình này ăn thật chứ không phải ảo đâu.",
  "89k một combo có gà + khoai + nước, so đi so lại vẫn lời hơn mấy quán khác.",
  "Đúng kiểu chiến dịch cho Gen Z: mã trên app, share bill lên Threads, ai cũng đua nhau đặt.",
  "Bạn thân rủ đi KFC thứ Ba, được tặng nguyên phần thứ hai. Tính ra một đứa có 40 mấy k.",
  "Thử rồi nha, gà vẫn giòn, giá thì mềm hơn hẳn mọi khi. Tuần sau đi tiếp.",
];

const POSTS_BEARISH = [
  "Giảm 30% đơn đầu xong đơn sau về giá cũ, chiêu này xưa lắm rồi KFC ơi 🙄",
  "Lotteria đang giảm 40% trên ShopeeFood kìa, 89k của KFC chưa đủ rẻ đâu.",
  "Mua 1 tặng 1 nhưng bắt ra tận cửa hàng xếp hàng, thời buổi này ai rảnh vậy?",
  "Ăn gà rán hoài không tốt đâu mọi người, dầu mỡ với muối kiểu này huyết áp lên nhanh lắm.",
  "Combo 89k nhưng miếng gà bé lại thì cũng như không. Đợi review đã rồi tính.",
  "Jollibee gà giòn hơn mà giá sinh viên hơn, mình vẫn team Jollibee 🐝",
  "Khuyến mãi rầm rộ thế này thường là dấu hiệu doanh số đang đuối, không phải tin vui đâu.",
  "Đặt trên app mà phí ship + phụ thu xong cũng gần bằng giá gốc, giảm cũng như không.",
  "Cơm gà xối mỡ quán cô Sáu đầu hẻm 45k, chất hơn gà chuỗi nhiều. Ủng hộ quán Việt đi.",
  "Đọc kỹ điều kiện đi: mã 30% chỉ áp cho đơn đầu tiên TRÊN APP, khách quen coi như không có gì.",
  "Mình bỏ đồ chiên 3 tháng nay, da láng hẳn. Quảng cáo gà rán trôi qua như gió 🍃",
  "Tuần trước ghé thử, gà bị mặn hơn trước. Giảm giá mà chất lượng giảm theo thì thôi.",
  "Phốt nè: bạn mình ra quầy thứ Ba mà hết gà tặng từ 7h tối. Chương trình gì kỳ vậy?",
  "2026 rồi, vật giá leo thang, 89k vẫn là một bữa xa xỉ với công nhân tụi mình.",
  "Texas Chicken cũng đang mua 1 tặng 1 mà không bắt chờ tới thứ Ba nhé mọi người.",
];

const POSTS_NEUTRAL = [
  "Có ai ăn thử combo 89k mới của KFC chưa? Review cho mình xin ý kiến với.",
  "Đang phân vân giữa KFC khuyến mãi với Lotteria giảm trên app, chọn bên nào giờ?",
  "Nghe nói thứ Ba KFC mua 1 tặng 1, không biết áp dụng cho tất cả món không nhỉ?",
  "Timeline hôm nay toàn KFC, để tối rảnh coi thử có gì hot.",
  "Mã giảm 30% có dùng chung được với voucher ShopeeFood không mọi người?",
  "Trưa nay team mình định order gà rán, ai có kinh nghiệm stack mã chỉ với.",
  "Thấy quảng cáo chạy khắp nơi mà chưa hiểu điều kiện, ai đọc kỹ rồi tóm tắt giúp.",
  "Gà rán thì ngon đấy nhưng dạo này đang cố nhịn chi tiêu, để cuối tháng tính.",
];

// ── Roster generation ────────────────────────────────────────────────────────

interface DemoAgent extends WorldAgent {
  archetype: Archetype;
  affinity: number; // [-1, 1] with jitter, drives final stance assignment
}

function weightedPick<T>(rand: () => number, entries: Array<[T, number]>): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

function buildRoster(): DemoAgent[] {
  const rand = mulberry32(hashSeed("vng-demo-roster-v1"));
  const agents: DemoAgent[] = [];
  const usedNames = new Set<string>();
  const archetypeEntries = Object.entries(ARCHETYPES) as Array<[Archetype, ArchetypeSpec]>;

  for (let i = 0; i < N_AGENTS; i++) {
    const archetype = weightedPick(
      rand,
      archetypeEntries.map(([key, spec]) => [key, spec.weight] as [Archetype, number]),
    );
    const spec = ARCHETYPES[archetype];
    const gender = rand() < 0.52 ? "nữ" : "nam";

    let name = "";
    do {
      const family = pick(rand, FAMILY);
      const middle = gender === "nam" ? pick(rand, MIDDLE_M) : pick(rand, MIDDLE_F);
      const given = gender === "nam" ? pick(rand, GIVEN_M) : pick(rand, GIVEN_F);
      name = `${family} ${middle} ${given}`;
    } while (usedNames.has(name));
    usedNames.add(name);

    const id = `agent-${String(i + 1).padStart(2, "0")}`;
    agents.push({
      id,
      name,
      avatarSeed: hashSeed(`avatar:${id}:${name}`),
      demographics: {
        age: randInt(rand, spec.ages[0], spec.ages[1]),
        gender,
        region: weightedPick(rand, REGIONS),
        occupation: pick(rand, spec.occupations),
      },
      personaSummary: pick(rand, spec.personas),
      archetype,
      affinity: Math.max(-1, Math.min(1, spec.affinity + (rand() - 0.5) * 0.7)),
    });
  }
  return agents;
}

// ── Stance trajectories ──────────────────────────────────────────────────────

interface Trajectory {
  finalStance: Stance;
  stances: Stance[]; // index 0 = round 1
}

function assignFinalStances(
  agents: DemoAgent[],
  variant: keyof typeof VARIANTS,
): Map<string, Stance> {
  const spec = VARIANTS[variant];
  const rand = mulberry32(hashSeed(`final-stance:${variant}`));
  // Variant-specific jitter on top of the shared affinity: the same marginal
  // agents flip between variants, core fans/skeptics stay put.
  const scored = agents
    .map((agent) => ({ agent, score: agent.affinity + (rand() - 0.5) * 0.55 }))
    .sort((a, b) => b.score - a.score);

  const map = new Map<string, Stance>();
  scored.forEach(({ agent }, i) => {
    if (i < spec.finalBullish) map.set(agent.id, "bullish");
    else if (i >= agents.length - spec.finalBearish) map.set(agent.id, "bearish");
    else map.set(agent.id, "neutral");
  });
  return map;
}

function buildTrajectory(
  agent: DemoAgent,
  finalStance: Stance,
  variant: keyof typeof VARIANTS,
): Trajectory {
  const rand = mulberry32(hashSeed(`traj:${variant}:${agent.id}`));
  const stances: Stance[] = new Array(ROUNDS);

  const awaken = randInt(rand, 2, 9); // rounds before this: no formed stance yet
  const settle = randInt(rand, 16, 42); // final stance locked from here
  // Some agents pass through the OPPOSITE camp first (skeptic converted by the
  // deal, fan disappointed then won back) — that's the visible churn.
  const detour = rand() < 0.3 && finalStance !== "neutral";
  const detourStance: Stance = finalStance === "bullish" ? "bearish" : "bullish";
  const detourStart = randInt(rand, awaken, Math.max(awaken, settle - 8));
  const detourEnd = Math.min(settle - 1, detourStart + randInt(rand, 2, 6));
  // Late one-round wobble after settling (rare, returns to final).
  const wobbleRound = rand() < 0.18 ? randInt(rand, settle + 1, ROUNDS - 2) : -1;

  for (let r = 1; r <= ROUNDS; r++) {
    let stance: Stance;
    if (r < awaken) stance = "unknown";
    else if (r >= settle) stance = finalStance;
    else if (detour && r >= detourStart && r <= detourEnd) stance = detourStance;
    else {
      // Pre-settle wandering: mostly neutral, leaning into the final stance as
      // the settle round approaches.
      const progress = (r - awaken) / Math.max(1, settle - awaken);
      stance = rand() < 0.25 + progress * 0.6 ? finalStance : "neutral";
    }
    if (r === wobbleRound && finalStance !== "neutral") stance = "neutral";
    stances[r - 1] = stance;
  }
  return { finalStance, stances };
}

// ── Posts ────────────────────────────────────────────────────────────────────

function buildPosts(
  agents: DemoAgent[],
  trajectories: Map<string, Trajectory>,
  variant: keyof typeof VARIANTS,
): Map<number, Map<string, { text: string; platform: "threads" | "facebook" }>> {
  const rand = mulberry32(hashSeed(`posts:${variant}`));
  const byRound = new Map<number, Map<string, { text: string; platform: "threads" | "facebook" }>>();
  const recentTexts: string[] = [];

  const pickText = (stance: Stance): string => {
    const pool = stance === "bullish" ? POSTS_BULLISH : stance === "bearish" ? POSTS_BEARISH : POSTS_NEUTRAL;
    for (let attempt = 0; attempt < 6; attempt++) {
      const text = pick(rand, pool);
      if (!recentTexts.includes(text)) {
        recentTexts.push(text);
        if (recentTexts.length > 10) recentTexts.shift();
        return text;
      }
    }
    return pick(rand, pool);
  };

  for (let r = 1; r <= ROUNDS; r++) {
    const posts = new Map<string, { text: string; platform: "threads" | "facebook" }>();
    // Stance-changers speak first (they have something to say)…
    for (const agent of agents) {
      if (posts.size >= 5) break;
      const stances = trajectories.get(agent.id)!.stances;
      const current = stances[r - 1];
      const prev = r >= 2 ? stances[r - 2] : "unknown";
      if (current !== prev && current !== "unknown" && rand() < 0.5) {
        posts.set(agent.id, { text: pickText(current), platform: rand() < 0.6 ? "threads" : "facebook" });
      }
    }
    // …then a couple of random voices keep the feed alive.
    let guard = 0;
    while (posts.size < 2 + Math.floor(rand() * 3) && guard++ < 30) {
      const agent = agents[Math.floor(rand() * agents.length)];
      const stance = trajectories.get(agent.id)!.stances[r - 1];
      if (stance === "unknown" || posts.has(agent.id)) continue;
      posts.set(agent.id, { text: pickText(stance), platform: rand() < 0.6 ? "threads" : "facebook" });
    }
    byRound.set(r, posts);
  }
  return byRound;
}

// ── Market series ────────────────────────────────────────────────────────────

function buildMarketSeries(
  trajectories: Map<string, Trajectory>,
  variant: keyof typeof VARIANTS,
): number[] {
  const rand = mulberry32(hashSeed(`market:${variant}`));
  const target = VARIANTS[variant].marketTarget;
  const series: number[] = [];
  let price = 0.5;
  for (let r = 1; r <= ROUNDS; r++) {
    // Bullish share among stance-formed agents this round.
    let bullish = 0;
    let formed = 0;
    for (const traj of trajectories.values()) {
      const stance = traj.stances[r - 1];
      if (stance === "unknown") continue;
      formed++;
      if (stance === "bullish") bullish++;
    }
    const signal = formed > 0 ? bullish / formed : 0.5;
    // AMM-ish: price chases the crowd signal with inertia + trade noise,
    // pulled toward the variant's terminal belief late in the run.
    const lateAnchor = r / ROUNDS;
    const desired = signal * (1 - lateAnchor * 0.5) + target * lateAnchor * 0.5;
    price = price + (desired - price) * 0.35 + (rand() - 0.5) * 0.03;
    price = Math.min(0.95, Math.max(0.05, price));
    series.push(Math.round(price * 1000) / 1000);
  }
  // Land exactly on the storyline number.
  series[ROUNDS - 1] = target;
  series[ROUNDS - 2] = Math.round(((series[ROUNDS - 3] + target) / 2) * 1000) / 1000;
  return series;
}

// ── Canned interviews ────────────────────────────────────────────────────────

function buildInterviews(
  agents: DemoAgent[],
  trajectories: Map<string, Trajectory>,
  variant: keyof typeof VARIANTS,
): { highlighted: string[]; interviews: Record<string, CannedInterview[]> } {
  const wanted: Archetype[] = ["loyal", "student", "skeptic", "kol", "parent"];
  const highlighted: string[] = [];
  for (const type of wanted) {
    const found = agents.find((a) => a.archetype === type && !highlighted.includes(a.id));
    if (found) highlighted.push(found.id);
  }
  while (highlighted.length < 5) {
    const next = agents.find((a) => !highlighted.includes(a.id));
    if (!next) break;
    highlighted.push(next.id);
  }

  const variantName = VARIANTS[variant].injectionText;
  const interviews: Record<string, CannedInterview[]> = {};
  for (const id of highlighted) {
    const agent = agents.find((a) => a.id === id)!;
    const stance = trajectories.get(id)!.finalStance;
    interviews[id] = cannedFor(agent, stance, variantName, variant);
  }
  return { highlighted, interviews };
}

function cannedFor(
  agent: DemoAgent,
  stance: Stance,
  variantText: string,
  variant: keyof typeof VARIANTS,
): CannedInterview[] {
  const first = agent.name.split(" ").pop();
  const q1 = "Bạn nghĩ gì về quảng cáo này?";
  const q2 = stance === "bullish" ? "Điều gì thuyết phục bạn nhất?" : "Why didn't this convince you?";
  const q3 = "Bạn có nghĩ chương trình này sẽ tăng doanh số trong 2 tuần tới không?";

  const byStance: Record<Stance, [string, string, string]> = {
    bullish: [
      `Mình thấy ổn đấy. "${variantText}" đánh đúng thứ mình quan tâm — ${
        agent.archetype === "student" ? "giá cuối cùng sau khi trừ mã" : "giá trị thực của một bữa ăn"
      }. Mình đã rủ bạn đi thử rồi.`,
      `Con số cụ thể. Không phải kiểu "ưu đãi hấp dẫn" chung chung — mình nhìn thấy ngay mình tiết kiệm được bao nhiêu, ${
        variant === "B" ? "và có cớ rủ bạn thân đi cùng, một mình ăn hai phần thì ngại" : "chỉ cần đặt qua app là xong"
      }.`,
      `Có. Quanh mình mọi người bàn tán nhiều, ${
        agent.archetype === "driver" ? "đơn app nổ liên tục mấy hôm nay" : "trên Threads ai cũng khoe bill"
      }. Hai tuần là đủ thấy khác biệt.`,
    ],
    bearish: [
      `Nói thật là mình không ấn tượng. ${
        agent.archetype === "skeptic"
          ? "Đồ chiên rán thì giảm giá cỡ nào mình cũng không quay lại thói quen cũ."
          : agent.archetype === "kol"
            ? "Mình review đồ ăn nhanh nhiều rồi — khuyến mãi kiểu này thường kèm điều kiện nhỏ xíu ở cuối trang."
            : "Lotteria với Jollibee đang giảm sâu hơn, cùng tiền đó mình có lựa chọn tốt hơn."
      }`,
      `${
        variant === "A"
          ? "Vì nó chỉ áp dụng cho ĐƠN ĐẦU TIÊN trên app. Khách quen như bọn mình không được gì cả — cảm giác bị bỏ rơi."
          : "Vì phải ra tận cửa hàng vào đúng thứ Ba. Mình bận, và xếp hàng để nhận khuyến mãi thì mất hết cái sướng."
      } Chưa kể ăn gà rán thường xuyên thì sức khỏe đi xuống.`,
      `Khó. Có thể tuần đầu đông vì tò mò, nhưng ${
        agent.archetype === "vendor"
          ? "khách ăn quen vị cơm gà quán mình rồi cũng quay lại thôi"
          : "hết khuyến mãi là hết khách — mình thấy kịch bản này nhiều lần rồi"
      }.`,
    ],
    neutral: [
      `Mình thấy bình thường. "${variantText}" nghe cũng được nhưng chưa đủ để mình đổi thói quen ăn uống hiện tại.`,
      `Không hẳn là không thuyết phục — chỉ là mình cần thấy review thật từ người quen trước. Quảng cáo nào chẳng nói hay.`,
      `Năm mươi năm mươi. Nếu ra quầy mà giá đúng như quảng cáo, không phụ phí ẩn, thì có thể mình sẽ thử một lần.`,
    ],
    unknown: [
      `Xin lỗi, mình chưa để ý tới quảng cáo này lắm.`,
      `Mình chưa có ý kiến — dạo này bận quá chưa xem gì cả.`,
      `Chưa biết nữa, để mình xem thêm đã.`,
    ],
  };

  const answers = byStance[stance];
  return [
    { question: q1, answer: `(${first}) ${answers[0]}` },
    { question: q2, answer: answers[1] },
    { question: q3, answer: answers[2] },
  ];
}

// ── Assemble & write ─────────────────────────────────────────────────────────

function buildTimeline(agents: DemoAgent[], variant: keyof typeof VARIANTS): WorldTimeline {
  const finals = assignFinalStances(agents, variant);
  const trajectories = new Map<string, Trajectory>();
  for (const agent of agents) {
    trajectories.set(agent.id, buildTrajectory(agent, finals.get(agent.id)!, variant));
  }
  const posts = buildPosts(agents, trajectories, variant);
  const market = buildMarketSeries(trajectories, variant);
  const { highlighted, interviews } = buildInterviews(agents, trajectories, variant);

  const frames: WorldFrame[] = [];
  for (let r = 1; r <= ROUNDS; r++) {
    const states: Record<string, AgentFrameState> = {};
    const roundPosts = posts.get(r)!;
    for (const agent of agents) {
      const state: AgentFrameState = { stance: trajectories.get(agent.id)!.stances[r - 1] };
      const post = roundPosts.get(agent.id);
      if (post) {
        state.post = post;
        state.action = "CREATE_POST";
      }
      states[agent.id] = state;
    }
    frames.push({ round: r, states, marketYesProb: market[r - 1] });
  }

  // Strip generator-only fields from the published agents.
  const publicAgents: WorldAgent[] = agents.map(({ id, name, avatarSeed, demographics, personaSummary }) => ({
    id,
    name,
    avatarSeed,
    demographics,
    personaSummary,
  }));

  return {
    agents: publicAgents,
    frames,
    variantLabel: VARIANTS[variant].label,
    injectionText: VARIANTS[variant].injectionText,
    highlightedAgents: highlighted,
    interviews,
  };
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "public", "demo");
  mkdirSync(outDir, { recursive: true });

  const roster = buildRoster();
  for (const variant of ["A", "B"] as const) {
    const timeline = buildTimeline(roster, variant);
    const outPath = join(outDir, `timeline-${variant}.json`);
    writeFileSync(outPath, JSON.stringify(timeline), "utf-8");
    const finalFrame = timeline.frames[timeline.frames.length - 1];
    const bullish = timeline.agents.filter((a) => finalFrame.states[a.id]?.stance === "bullish").length;
    console.log(
      `wrote ${outPath} — ${timeline.agents.length} agents, ${timeline.frames.length} rounds, ` +
        `final bullish ${bullish}/${timeline.agents.length} (${((bullish / timeline.agents.length) * 100).toFixed(1)}%), ` +
        `market ${finalFrame.marketYesProb}`,
    );
  }
}

main();
