// SPDX-License-Identifier: Apache-2.0
// Asset table. Feed IDs come from Pyth Hermes /v2/price_feeds (fetched 2026-10-18).
// `sol` = Pyth Solana push-oracle PriceUpdateV2 account (shard 0) derived from the feed id.
// `demoPrice` is ONLY a starting point for the clearly labelled simulated demo mode.
export const ASSETS = {
  DOGE: { sym: "DOGE", name: "Dogecoin", color: "#c2a633", kind: "meme", feed: "0xdcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c", sol: "681QkKLoAQrB5h23Ewq9c8rjM19RBuzqwXZf2RPr9Pyw", demoPrice: 0.0792 },
  SHIB: { sym: "SHIB", name: "Shiba Inu", color: "#f04a2d", kind: "meme", feed: "0xf0d57deca57b3da2fe63a493f4c25925fdfd8edf834b20f93e1f84dbd1504d4a", sol: "FkphkegaYbsZdjQki1PMngmrvkLZczujiJEbibm877AQ", demoPrice: 0.0000045 },
  PEPE: { sym: "PEPE", name: "Pepe", color: "#3d9b35", kind: "meme", feed: "0xd69731a2e74ac1ce884fc3890f7ee324b6deb66147055249568869ed700882e4", sol: "3adfGDsTjqC55Mw5MfzpcLpNMKGGPBwc9M8xAYq4VEQe", demoPrice: 0.0000041 },
  BONK: { sym: "BONK", name: "Bonk", color: "#f7a400", kind: "meme", feed: "0x72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419", sol: "DBE3N8uNjhKPRHfANdwGvCZghWXyLPdqdSbEW2XFwBiX", demoPrice: 0.0000029 },
  WIF: { sym: "WIF", name: "dogwifhat", color: "#c79a6b", kind: "meme", feed: "0x4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc", sol: "6B23K3tkb51vLZA14jcEQVCA1pfHptzEHFA93V5dYwbT", demoPrice: 0.1964 },
  FLOKI: { sym: "FLOKI", name: "Floki", color: "#e8a33d", kind: "meme", feed: "0x6b1381ce7e874dc5410b197ac8348162c0dd6c0d4c9cd6322672d6c2b1d58293", sol: "vCvsiLQ7yDBGqtAptFxPmjFf2bwbrD3o8RifgcDgP8c", demoPrice: 0.0000323 },
  POPCAT: { sym: "POPCAT", name: "Popcat", color: "#8b5cf6", kind: "meme", feed: "0xb9312a7ee50e189ef045aa3c7842e099b061bd9bdc99ac645956c3b660dc8cce", sol: "6UxPR2nXJNNM1nESVWGAf8NXMVu3SGgYf3ZfUFoGB9cs", demoPrice: 0.0413 },
  BRETT: { sym: "BRETT", name: "Brett", color: "#2d6cf6", kind: "meme", feed: "0x9b5729efe3d68e537cdcb2ca70444dea5f06e1660b562632609757076d0b9448", sol: "6XotQZDUbnHCpZJX2H2qQMCZLApP47mPJJCEtZhJX6AB", demoPrice: 0.047 },
  MOG: { sym: "MOG", name: "Mog Coin", color: "#ff6aa2", kind: "meme", feed: "0x17894b9fff49cd07efeab94a0d02db16f158efe04e0dee1db6af5f069082ce83", sol: "BLSEasVpJqY5YAxnmgeos6dqok5jX7oiSBBSE96Jmd4Z", demoPrice: 9.2e-7 },
  BABYDOGE: { sym: "BABYDOGE", name: "Baby Doge", color: "#f2c94c", kind: "meme", feed: "0x053e0a17cc9282f191a6e60165dabd4a4861a8847c06eb34f54e07155eebedba", sol: "2caHB4jjETSeXytNng9sB3AswBsH3R7TL3imp5CFbeWG", demoPrice: 1.3e-9 },
  NEIRO: { sym: "NEIRO", name: "Neiro", color: "#ff9f43", kind: "meme", feed: "0x83dfac550d6066d5c837e99c27e38a392c5cccc9a637044c2ef6c843336da444", sol: "D3L5dNsyPj4ziL2oW3N4iXexTDjUnRW2xBZBfzKkcv9k", demoPrice: 0.00027 },
  MEW: { sym: "MEW", name: "cat in a dogs world", color: "#ff7ad9", kind: "meme", feed: "0x514aed52ca5294177f20187ae883cec4a018619772ddce41efcc36a6448f5d5d", sol: "EF6U755BdHMXim8RBw6XSC6Yk6XaouTKpwcBZ7QkcanB", demoPrice: 0.000405 },
  PENGU: { sym: "PENGU", name: "Pudgy Penguins", color: "#7cc4ff", kind: "meme", feed: "0xbed3097008b9b5e3c93bec20be79cb43986b85a996475589351a21e67bae9b61", sol: "27zzC5wXCeZeuJ3h9uAJzV5tGn6r5Tzo98S1ZceYKEb8", demoPrice: 0.00659 },
  BTC: { sym: "BTC", name: "Bitcoin", color: "#f7931a", kind: "major", feed: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", sol: "4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo", demoPrice: 81761 },
  ETH: { sym: "ETH", name: "Ethereum", color: "#8c9eff", kind: "major", feed: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", sol: "42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC", demoPrice: 2392.7 },
  SOL: { sym: "SOL", name: "Solana", color: "#14f195", kind: "major", feed: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", sol: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE", demoPrice: 103.86 },
  FARTCOIN: { sym: "FARTCOIN", name: "Fartcoin", color: "#9be15d", kind: "meme", feed: "0x58cd29ef0e714c5affc44f269b2c1899a52da4169d7acc147b9da692e6953608", sol: "2t8eUbYKjidMs3uSeYM9jXM9uudYZwGkSeTB4TKjmvnC", demoPrice: 0.1429 },
  PYTH: { sym: "PYTH", name: "Pyth Network", color: "#b388ff", kind: "major", feed: "0x0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff", sol: "8vjchtMuJNY4oFQdTi8yCe6mhCaNBFaUbktT482TpLPS", demoPrice: 0.0744 },
  JUP: { sym: "JUP", name: "Jupiter", color: "#2ee6b7", kind: "major", feed: "0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996", sol: "7dbob1psH1iZBS7qPsm3Kwbf5DzSXK8Jyg31CTgTnxH5", demoPrice: 0.2889 },
  HYPE: { sym: "HYPE", name: "Hyperliquid", color: "#5ce1e6", kind: "major", feed: "0x4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b", sol: "6usXZCEM4kf1KHGDTzgQLAWtDMNdzLjfAUYSwGKJm19Y", demoPrice: 78.8 },
  XRP: { sym: "XRP", name: "XRP", color: "#9fb4c7", kind: "major", feed: "0xec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8", sol: "Ae3LGcV5Wt5Z11xvhxSX1h65uNyjuX4qYFFbgifLx5eX", demoPrice: 1.3078 },
  BNB: { sym: "BNB", name: "BNB", color: "#f3ba2f", kind: "major", feed: "0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f", sol: "A3qp5QG9xGeJR1gexbW9b9eMMsMDLzx3rhud9SnNhwb4", demoPrice: 727.1 },
  PUMP: { sym: "PUMP", name: "Pump.fun", color: "#ff4f8b", kind: "meme", feed: "0x7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9", sol: "HMm3GPbdnqGwbkTnUUqCFsH8AMHDdEC3Lg8gcPD3HJSH", demoPrice: 0.004488 },
  JTO: { sym: "JTO", name: "Jito", color: "#7bd3a8", kind: "major", feed: "0xb43660a5f790c69354b0729a5ef9d50d68f1df92107540210b9cccba1f947cc2", sol: "7ajR2zA4MGMMTqRAVjghTKqPPn4kbrj3pYkAVRVwTGzP", demoPrice: 0.4484 },
  RENDER: { sym: "RENDER", name: "Render", color: "#ff5a4e", kind: "major", feed: "0x3d4a2bd9535be6ce8059d75eadeba507b043257321aa544717c56fa19b49e35d", sol: "HAm5DZhrgrWa12heKSxocQRyJWGCtXegC77hFQ8F5QTH", demoPrice: 1.807 },
  W: { sym: "W", name: "Wormhole", color: "#d9d9e3", kind: "major", feed: "0xeff7446475e218517566ea99e72a4abec2e1bd8498b43b7d8331e29dcb059389", sol: "BEMsCSQEGi2kwPA4mKnGjxnreijhMki7L4eeb96ypzF9", demoPrice: 0.01301 },
  TNSR: { sym: "TNSR", name: "Tensor", color: "#ffcf5c", kind: "major", feed: "0x05ecd4597cd48fe13d6cc3596c62af4f9675aee06e2e0b94c06d8bee2b659e05", sol: "9TSGDwcPQX4JpAvZbu2Wp5b68wSYkQvHCvfeBjYcCyC", demoPrice: 0.03112 },
  AAVE: { sym: "AAVE", name: "Aave", color: "#b6509e", kind: "major", feed: "0x2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445", sol: "38aAZxne9JkspNZPzz5oqtLHWKVDAZuP4ZTcnkGfJSJg", demoPrice: 148.3 },
  ZEC: { sym: "ZEC", name: "Zcash", color: "#f4b728", kind: "major", feed: "0xbe9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24", sol: "HzdKMXqocYWqy7mh8AKDoZFJinjeGMfBKmGAxGbasc28", demoPrice: 1128.5 },
  ORE: { sym: "ORE", name: "ORE", color: "#ff8f3f", kind: "major", feed: "0x142b804c658e14ff60886783e46e5a51bdf398b4871d9d8f7c28aa1585cad504", sol: "GYYQ8gbX4Tndc4WMJ9jSjZTePTvbmgRRxByt54ZQYqvZ", demoPrice: 113.38 },
};

// ---------------------------------------------------------------------------
// Bracket presets are DATA-DRIVEN: each one is an ordered wish-list of candidates.
// At load the app keeps only candidates that are live right now (Hermes key entitled,
// or a fresh Solana push feed), in this order, and takes the first `size` of them
// (falls back to `minSize` if there aren't enough). `required` assets must be live
// or the preset is unavailable. To change a lineup, just reorder or edit `candidates`.
// In explicit demo mode (simulated data) the first `size` candidates are used as-is.
// Live entitlement checked 2026-10-19: Hermes key covers BTC ETH SOL DOGE XRP BNB HYPE PYTH
// (+ stables/LSTs); fresh Solana push feeds incl. BONK WIF MEW FARTCOIN PUMP JUP JTO W RENDER TNSR.
export const BRACKETS = {
  doginal16: {
    id: "doginal16",
    title: "Doginal Dogs Meme Madness",
    blurb: "DOGE leads the pack. Dogs and memes first, big caps fill the rest.",
    size: 16,
    minSize: 8,
    required: ["DOGE"],
    candidates: [
      "DOGE", "BONK", "WIF", "MEW", "SHIB", "FLOKI", "BABYDOGE", "PEPE", "FARTCOIN", "PUMP",
      "POPCAT", "BRETT", "MOG", "NEIRO", "PENGU",
      "BTC", "ETH", "SOL", "XRP", "BNB", "HYPE", "PYTH", "JUP", "JTO", "RENDER", "W", "TNSR",
    ],
  },
  doginal8: {
    id: "doginal8",
    title: "Doginal Dogs Top Dog 8",
    blurb: "8 seeds. The dog pack and meme friends, with BTC and SOL as final bosses.",
    size: 8,
    minSize: 8,
    required: ["DOGE"],
    candidates: ["DOGE", "BONK", "WIF", "SHIB", "FLOKI", "BABYDOGE", "MEW", "FARTCOIN", "PUMP", "PEPE", "BTC", "SOL", "ETH"],
  },
  solpark8: {
    id: "solpark8",
    title: "Solana Dog Park 8 (keyless live)",
    blurb: "8 seeds on Pyth's Solana push feeds. Works with no API key.",
    size: 8,
    minSize: 8,
    required: [],
    keylessOnly: true, // always uses the Solana on-chain source
    candidates: ["BONK", "WIF", "MEW", "FARTCOIN", "SOL", "BTC", "ETH", "PYTH", "JUP", "JTO", "PUMP", "W", "RENDER", "TNSR"],
  },
};

// Resolve a preset against live availability. `isLive(sym)` -> bool.
// Returns { assets, size, dropped, ok, reason }.
export function resolveBracket(def, isLive, { demo = false } = {}) {
  if (demo) return { assets: def.candidates.slice(0, def.size), size: def.size, dropped: [], ok: true };
  const live = def.candidates.filter((s) => ASSETS[s] && isLive(s));
  const missingReq = (def.required || []).filter((s) => !live.includes(s));
  if (missingReq.length) return { assets: [], size: 0, dropped: def.candidates.filter((s) => !live.includes(s)), ok: false, reason: `${missingReq.join(", ")} has no live Pyth feed right now` };
  let size = live.length >= def.size ? def.size : live.length >= def.minSize ? def.minSize : 0;
  if (!size) return { assets: [], size: 0, dropped: def.candidates.filter((s) => !live.includes(s)), ok: false, reason: `only ${live.length} live feeds (need ${def.minSize})` };
  const assets = live.slice(0, size);
  // "dropped" = wished-for assets ranked above the cut that aren't live
  const cutIx = def.candidates.indexOf(assets[assets.length - 1]);
  const dropped = def.candidates.slice(0, cutIx + 1).filter((s) => !live.includes(s));
  return { assets, size, dropped, ok: true };
}

// Standard bracket seed order (1 v 16, 8 v 9, ...).
export const SEED_ORDER = {
  16: [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15],
  8: [1, 8, 4, 5, 3, 6, 2, 7],
};

export const ROUND_NAMES = {
  16: ["Round of 16", "Quarterfinals", "Semifinals", "Final"],
  8: ["Quarterfinals", "Semifinals", "Final"],
};

// Pick'em points per correct pick, per round.
export const ROUND_POINTS = {
  16: [10, 20, 40, 80],
  8: [20, 40, 80],
};
