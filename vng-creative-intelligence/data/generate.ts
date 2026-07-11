import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

var crcTable: number[] | undefined;

type Period = "history" | "holdout";

interface Variant {
  name: string;
  period: Period;
  channel: string;
  campaign: string;
  spend: number;
  impressions: number;
  clicks: number;
  installs: number;
  hook: string;
}

interface ThemeSpec {
  artStyle: string;
  motif: string;
  hero: string;
  thumbnail: string;
  colors: [number, number, number][];
  payerRate: number;
  highValueRate: number;
  d7Roas: number;
  pLtvRoas: number;
  variants: Variant[];
}

const header = [
  "creative_id",
  "creative_name",
  "period",
  "channel",
  "campaign",
  "spend",
  "impressions",
  "clicks",
  "installs",
  "payers",
  "high_value_players",
  "revenue_d7",
  "predicted_ltv_d30",
  "thumbnail",
  "text_hook",
  "visual_motif",
  "hero_archetype",
  "art_style",
];

const themes: ThemeSpec[] = [
  {
    artStyle: "cyberpunk-premium",
    motif: "neon-mecha",
    hero: "ronin",
    thumbnail: "/skins/generated/neon-mecha.png",
    colors: [[31, 220, 143], [35, 54, 64], [255, 91, 95]],
    payerRate: 0.072,
    highValueRate: 0.028,
    d7Roas: 1.18,
    pLtvRoas: 3.12,
    variants: [
      row("Neon Ronin Ascension", "history", "TikTok", "Soft Launch SEA", 14000, 680000, 22500, 5400, "Win the ranked ladder with a mythic blade"),
      row("Chrome Oni Breakout", "history", "Meta", "Soft Launch SEA", 9000, 430000, 14800, 3300, "Limited chrome armor for top guilds"),
      row("Neon Mecha Victory Pose", "history", "Meta", "Soft Launch SEA", 6800, 310000, 9800, 2240, "Show the lobby who owns the season"),
      row("Ronin Overclock Teaser", "history", "Google UAC", "Soft Launch SEA", 8200, 360000, 12000, 2700, "Overclock your ronin before ranked resets"),
      row("Ronin Prime Reforge", "holdout", "TikTok", "Holdout Creative Batch", 12500, 580000, 19800, 4800, "A ranked-only armor line for guild captains"),
      row("Chrome Oni Redline", "holdout", "Meta", "Holdout Creative Batch", 8600, 400000, 13200, 3050, "Redline chrome armor for the ladder grind"),
    ],
  },
  {
    artStyle: "mythic-luxury",
    motif: "celestial-dragon",
    hero: "oracle",
    thumbnail: "/skins/generated/celestial-dragon.png",
    colors: [[100, 212, 178], [74, 51, 107], [228, 207, 145]],
    payerRate: 0.064,
    highValueRate: 0.023,
    d7Roas: 1.08,
    pLtvRoas: 2.62,
    variants: [
      row("Celestial Dragon Oracle", "history", "Google UAC", "Mythic Expansion", 10500, 520000, 17100, 3900, "Unlock the prophecy set before the raid"),
      row("Jade Starfall Oracle", "history", "TikTok", "Mythic Expansion", 7200, 350000, 11600, 2700, "A dragon-marked support skin for ranked squads"),
      row("Astral Prophecy Set", "history", "Meta", "Mythic Expansion", 8800, 420000, 13800, 3150, "Claim the prophecy armor for your guild"),
      row("Astral Dragon Oracle", "holdout", "Google UAC", "Holdout Creative Batch", 9400, 430000, 14000, 3200, "The oracle returns with a dragon sigil"),
      row("Eclipse Oracle Bundle", "holdout", "TikTok", "Holdout Creative Batch", 7600, 360000, 11800, 2680, "An eclipse bundle for late-game spenders"),
    ],
  },
  {
    artStyle: "gilded-luxury",
    motif: "gilded-vault",
    hero: "mastermind",
    thumbnail: "/skins/generated/gilded-vault.png",
    colors: [[223, 185, 90], [33, 31, 38], [114, 96, 58]],
    payerRate: 0.058,
    highValueRate: 0.019,
    d7Roas: 1.01,
    pLtvRoas: 2.22,
    variants: [
      row("Gilded Vault Mastermind", "history", "Meta", "Heist Season", 8000, 360000, 11500, 2600, "Crack the vault with a mastermind set"),
      row("Obsidian Heist Set", "history", "TikTok", "Heist Season", 7000, 320000, 10200, 2350, "Obsidian armor for the endgame crew"),
      row("Platinum Vault Mastermind", "holdout", "Meta", "Holdout Creative Batch", 7500, 340000, 10800, 2450, "Platinum vault set for the endgame crew"),
    ],
  },
  {
    artStyle: "dark-fantasy",
    motif: "gothic-vampire",
    hero: "assassin",
    thumbnail: "/skins/generated/gothic-vampire.png",
    colors: [[199, 70, 75], [33, 26, 33], [216, 194, 164]],
    payerRate: 0.052,
    highValueRate: 0.015,
    d7Roas: 0.86,
    pLtvRoas: 1.8,
    variants: [
      row("Crimson Court Duelist", "history", "TikTok", "Dark Royale", 7700, 370000, 11300, 2500, "Win the duel before midnight"),
      row("Bloodmoon Assassin", "history", "Meta", "Dark Royale", 6800, 320000, 10200, 2300, "Strike from the shadows this bloodmoon"),
      row("Vampire Moon Assassin", "holdout", "TikTok", "Holdout Creative Batch", 6900, 330000, 9800, 2180, "A midnight assassin for clutch duels"),
      row("Nightfall Duelist", "holdout", "Meta", "Holdout Creative Batch", 6200, 300000, 9400, 2050, "Duel at nightfall for the crimson crown"),
    ],
  },
  {
    artStyle: "painted-fantasy",
    motif: "mythic-ocean",
    hero: "guardian",
    thumbnail: "/skins/generated/ocean-guardian.png",
    colors: [[79, 179, 170], [23, 49, 58], [225, 208, 154]],
    payerRate: 0.049,
    highValueRate: 0.014,
    d7Roas: 0.78,
    pLtvRoas: 1.65,
    variants: [
      row("Tidebreaker Guardian", "history", "Meta", "Seasonal Test", 6100, 260000, 7400, 1750, "Claim the reef guardian armor"),
      row("Reef Warden Ascend", "history", "Google UAC", "Seasonal Test", 5600, 240000, 7000, 1650, "Ascend as the warden of the tides"),
      row("Coral Guardian Rise", "holdout", "Google UAC", "Holdout Creative Batch", 5900, 250000, 7200, 1700, "Rise as the coral guardian of the reef"),
    ],
  },
  {
    artStyle: "urban-arcade",
    motif: "street-racing",
    hero: "rogue",
    thumbnail: "/skins/generated/street-racing.png",
    colors: [[232, 162, 63], [28, 34, 36], [111, 193, 201]],
    payerRate: 0.043,
    highValueRate: 0.011,
    d7Roas: 0.66,
    pLtvRoas: 1.32,
    variants: [
      row("Nitro Alley Rogue", "history", "Google UAC", "Arcade Test", 6600, 280000, 9300, 2100, "Drift into battle with a rogue racer"),
      row("Drift Circuit Rogue", "history", "TikTok", "Arcade Test", 5900, 250000, 8400, 1900, "Own the circuit with a drift rogue"),
      row("Turbo Alley Rogue", "holdout", "TikTok", "Holdout Creative Batch", 6200, 260000, 8800, 2000, "Turbo drift into the ranked arena"),
    ],
  },
  {
    artStyle: "pop-cute",
    motif: "chibi-festival",
    hero: "mascot",
    thumbnail: "/skins/generated/chibi-festival.png",
    colors: [[255, 173, 191], [110, 199, 219], [255, 116, 104]],
    payerRate: 0.042,
    highValueRate: 0.007,
    d7Roas: 0.58,
    pLtvRoas: 1.08,
    variants: [
      row("Chibi Festival Parade", "history", "TikTok", "Casual Install Push", 18000, 1100000, 52000, 17500, "Collect cute outfits during the weekend festival"),
      row("Bubble Tea Mascot Drop", "history", "Meta", "Casual Install Push", 9500, 560000, 27000, 8900, "The cutest daily login reward is here"),
      row("Chibi Lantern Party", "history", "TikTok", "Casual Install Push", 12000, 720000, 34000, 11200, "Light the lanterns in this cozy parade"),
      row("Chibi Fireworks Mascot", "holdout", "TikTok", "Holdout Creative Batch", 15500, 900000, 43500, 14600, "Free fireworks outfit for all players"),
      row("Mascot Sticker Rush", "holdout", "Meta", "Holdout Creative Batch", 8800, 520000, 25000, 8300, "Grab the sticker rush login rewards"),
    ],
  },
  {
    artStyle: "soft-fantasy",
    motif: "cozy-pets",
    hero: "healer",
    thumbnail: "/skins/generated/cozy-pets.png",
    colors: [[220, 182, 139], [149, 189, 136], [238, 241, 223]],
    payerRate: 0.037,
    highValueRate: 0.006,
    d7Roas: 0.48,
    pLtvRoas: 0.98,
    variants: [
      row("Cozy Familiar Picnic", "history", "Meta", "Creator Spark", 8500, 620000, 30200, 9800, "Relax with your familiar after battle"),
      row("Cozy Tea Garden", "history", "Meta", "Creator Spark", 7200, 520000, 25000, 8100, "Sip and rest in the tea garden"),
      row("Cozy Bunny Healer", "holdout", "Meta", "Holdout Creative Batch", 7800, 510000, 22500, 7300, "Daily care quests with a soft healer"),
      row("Cozy Star Nap", "holdout", "TikTok", "Holdout Creative Batch", 6600, 470000, 21000, 6900, "Nap under the stars with your familiar"),
    ],
  },
  {
    artStyle: "arcade-pop",
    motif: "retro-arcade",
    hero: "gunner",
    thumbnail: "/skins/generated/retro-arcade.png",
    colors: [[120, 212, 214], [28, 24, 48], [246, 207, 78]],
    payerRate: 0.036,
    highValueRate: 0.005,
    d7Roas: 0.42,
    pLtvRoas: 0.86,
    variants: [
      row("Pixel Arena Gunner", "history", "TikTok", "Retro CPI Test", 8200, 460000, 19800, 6400, "Old-school boss rush starts now"),
      row("Retro Boss Rush", "history", "Meta", "Retro CPI Test", 6800, 380000, 16500, 5300, "Blast through the retro boss rush"),
      row("Pixel Gunner Remix", "holdout", "Meta", "Holdout Creative Batch", 7400, 410000, 17400, 5600, "Retro remix skin with arcade loot"),
      row("Arcade Loot Blast", "holdout", "TikTok", "Holdout Creative Batch", 6200, 350000, 15000, 4900, "Blast the arcade loot vault open"),
    ],
  },
  {
    artStyle: "hypercasual-gloss",
    motif: "candy-rush",
    hero: "runner",
    thumbnail: "/skins/generated/hypercasual-candy.png",
    colors: [[255, 118, 178], [255, 220, 88], [112, 214, 255]],
    payerRate: 0.076,
    highValueRate: 0.0045,
    d7Roas: 1.66,
    pLtvRoas: 1.05,
    variants: [
      row("Candy Sprint Starter Pack", "history", "TikTok", "D7 ROAS Trap", 9200, 760000, 39800, 15400, "Grab a candy runner bundle before the timer ends"),
      row("Sugar Rush Login Skin", "history", "Meta", "D7 ROAS Trap", 7800, 610000, 31800, 12100, "Fast candy rewards for every new player"),
      row("Gummy Dash Weekend Deal", "history", "Google UAC", "D7 ROAS Trap", 8400, 670000, 34400, 13400, "Dash through gummies and claim an instant deal"),
      row("Candy Dash Fire Sale", "holdout", "TikTok", "Holdout Creative Batch", 8800, 690000, 35600, 13900, "Fire-sale candy runner bundle for new players"),
      row("Sugar Pop Starter Skin", "holdout", "Meta", "Holdout Creative Batch", 7600, 590000, 30200, 11600, "Pop into the arena with a starter skin"),
    ],
  },
];

const rows = themes.flatMap((theme, themeIndex) =>
  theme.variants.map((variant, variantIndex) => {
    const jitter = 1 + (((themeIndex * 17 + variantIndex * 7) % 9) - 4) / 100;
    const payers = Math.round(variant.installs * theme.payerRate * jitter);
    const highValuePlayers = Math.min(payers, Math.round(variant.installs * theme.highValueRate * jitter));
    return [
      `cr_${String(rowsSoFar(themeIndex, variantIndex) + 1).padStart(3, "0")}`,
      variant.name,
      variant.period,
      variant.channel,
      variant.campaign,
      variant.spend,
      variant.impressions,
      variant.clicks,
      variant.installs,
      payers,
      highValuePlayers,
      Math.round(variant.spend * theme.d7Roas * jitter),
      Math.round(variant.spend * theme.pLtvRoas * jitter),
      theme.thumbnail,
      variant.hook,
      theme.motif,
      theme.hero,
      theme.artStyle,
    ];
  }),
);

mkdirSync(join("public", "skins", "generated"), { recursive: true });
for (const theme of themes) {
  const fileName = theme.thumbnail.split("/").at(-1);
  if (!fileName) continue;
  writeFileSync(join("public", "skins", "generated", fileName), createPng(theme.colors));
}

writeFileSync("data/ads.sample.csv", [header.join(","), ...rows.map(csvLine)].join("\n") + "\n");

function row(
  name: string,
  period: Period,
  channel: string,
  campaign: string,
  spend: number,
  impressions: number,
  clicks: number,
  installs: number,
  hook: string,
): Variant {
  return { name, period, channel, campaign, spend, impressions, clicks, installs, hook };
}

function rowsSoFar(themeIndex: number, variantIndex: number): number {
  return themes.slice(0, themeIndex).reduce((sum, theme) => sum + theme.variants.length, 0) + variantIndex;
}

function csvLine(values: Array<string | number>): string {
  return values
    .map((value) => {
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(",");
}

function createPng(colors: [number, number, number][], size = 192): Buffer {
  const bytesPerPixel = 4;
  const raw = Buffer.alloc((size * bytesPerPixel + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * bytesPerPixel + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const color = colors[Math.floor(((x + y * 0.7) / size) * colors.length) % colors.length];
      const offset = rowStart + 1 + x * bytesPerPixel;
      const stripe = (Math.floor(x / 24) + Math.floor(y / 24)) % 2 === 0 ? 1 : 0.78;
      raw[offset] = Math.round(color[0] * stripe);
      raw[offset + 1] = Math.round(color[1] * stripe);
      raw[offset + 2] = Math.round(color[2] * stripe);
      raw[offset + 3] = 255;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = chunk("IHDR", bufferFromUInts([size, size, 8, 6, 0, 0, 0]));
  const idat = chunk("IDAT", deflateSync(raw));
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function bufferFromUInts(values: number[]): Buffer {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(values[0], 0);
  buffer.writeUInt32BE(values[1], 4);
  buffer.writeUInt8(values[2], 8);
  buffer.writeUInt8(values[3], 9);
  buffer.writeUInt8(values[4], 10);
  buffer.writeUInt8(values[5], 11);
  buffer.writeUInt8(values[6], 12);
  return buffer;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc(buffer: Buffer): number {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
