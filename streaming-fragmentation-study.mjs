#!/usr/bin/env node
// Reproducible data collection for the "Streaming Fragmentation Index" data study.
// Hits the Crawlora REST API (JustWatch endpoints) for the current US most-popular
// titles, classifies every offer's provider into a service class (standalone OTT vs
// vMVPD vs FAST vs single-network cable-login vs TVOD store vs cinema), collapses
// ad-tier/quality/reseller variants to parent brands, then computes the fragmentation
// (how many subscriptions cover the popular set), exclusivity, monetization mix,
// movies-vs-shows split, a provider overlap matrix, and the priced subscription basket.
//
//   node scripts/streaming-fragmentation-study.mjs
//
// Auth: CRAWLORA_PUBLIC_TOOL_API_KEY (or CRAWLORA_API_KEY) from .env, sent as
// x-api-key. Each call has a timeout + one retry. Writes the full dataset + stats to
// reports/studies/ and public/datasets/ (the open download) and prints a summary.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const API_BASE = process.env.CRAWLORA_API_BASE || "https://api.crawlora.net/api/v1";
const PER_CALL_TIMEOUT_MS = 45_000;
const COUNTRY = "US";
const LANGUAGE = "en";

function readEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const line of env.split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return "";
}

const API_KEY = readEnv("CRAWLORA_PUBLIC_TOOL_API_KEY") || readEnv("CRAWLORA_API_KEY");
if (!API_KEY) {
  console.error("Missing CRAWLORA_PUBLIC_TOOL_API_KEY / CRAWLORA_API_KEY in env/.env");
  process.exit(1);
}

async function callJson(method, path, { query, body } = {}, timeoutMs = PER_CALL_TIMEOUT_MS) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
  const run = async () => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { accept: "application/json", "content-type": "application/json", "x-api-key": API_KEY },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, status: res.status, json };
      return { ok: true, json };
    } finally {
      clearTimeout(t);
    }
  };
  let last;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      last = await run();
      if (last.ok) return last;
    } catch (err) {
      last = { ok: false, status: 0, error: String(err) };
    }
  }
  return last;
}

// ── Service-class taxonomy ────────────────────────────────────────────────────
// class OTT = a standalone retail streaming subscription (what a normal person
// would call "a streaming service you pay for"). vMVPD = a live-TV bundle (one $$$
// package of many networks — NOT one streaming sub). FAST = free ad-supported
// channel (not a subscription). CABLE = single-network app that needs a pay-TV
// login. TVOD = rent/buy store. CINEMA = in-theatres.
// We collapse ad-tier ("with Ads"), quality (SD/HD/4K), and reseller/aggregator
// channel variants (e.g. "X Amazon Channel", "X Apple TV Channel") into the parent
// brand. Codes verified against live JustWatch US data (2026-06).
const PROVIDER_MAP = {
  // Standalone OTT (subscription) — short -> brand
  nfx: ["Netflix", "OTT"], nfa: ["Netflix", "OTT"],
  amp: ["Amazon Prime Video", "OTT"], pva: ["Amazon Prime Video", "OTT"], aim: ["Amazon Prime Video", "OTT"],
  dnp: ["Disney+", "OTT"],
  hlu: ["Hulu", "OTT"],
  mxx: ["Max", "OTT"], hbm: ["Max", "OTT"], hbo: ["Max", "OTT"], max: ["Max", "OTT"], aho: ["Max", "OTT"],
  atp: ["Apple TV+", "OTT"], avl: ["Apple TV+", "OTT"],
  ppp: ["Paramount+", "OTT"], ppe: ["Paramount+", "OTT"], ppa: ["Paramount+", "OTT"], app: ["Paramount+", "OTT"], prk: ["Paramount+", "OTT"],
  pct: ["Peacock", "OTT"], pcp: ["Peacock", "OTT"],
  stz: ["Starz", "OTT"], str: ["Starz", "OTT"], saz: ["Starz", "OTT"], szt: ["Starz", "OTT"], sru: ["Starz", "OTT"],
  acp: ["AMC+", "OTT"], azp: ["AMC+", "OTT"], aat: ["AMC+", "OTT"], ark: ["AMC+", "OTT"],
  cru: ["Crunchyroll", "OTT"],
  mgm: ["MGM+", "OTT"], aep: ["MGM+", "OTT"], erk: ["MGM+", "OTT"], epx: ["MGM+", "OTT"],
  abb: ["BritBox", "OTT"], bbx: ["BritBox", "OTT"],
  shd: ["Shudder", "OTT"], asd: ["Shudder", "OTT"], sua: ["Shudder", "OTT"],
  cnp: ["Hallmark+", "OTT"], hmn: ["Hallmark+", "OTT"],
  fxf: ["FlixFling", "OTT"], mbi: ["MUBI", "OTT"], crc: ["Criterion Channel", "OTT"], bbo: ["BritBox", "OTT"],
  pmt: ["Paramount+", "OTT"],
  // vMVPD (live-TV bundles) — not one streaming sub
  ytt: ["YouTube TV", "VMVPD"], phl: ["Philo", "VMVPD"], fuv: ["fuboTV", "VMVPD"], slg: ["Sling TV", "VMVPD"],
  drv: ["DirecTV", "VMVPD"], hut: ["Hulu Live", "VMVPD"], sod: ["Spectrum On Demand", "VMVPD"],
  // FAST / free ad-supported channels — not a subscription
  rkc: ["The Roku Channel", "FAST"], ptv: ["Pluto TV", "FAST"], ptl: ["Pluto TV", "FAST"], tbv: ["Tubi", "FAST"], tbi: ["Tubi", "FAST"],
  plf: ["Plex", "FAST"], xum: ["Xumo Play", "FAST"], cbw: ["The CW", "FAST"], tcw: ["The CW", "FAST"],
  faw: ["Amazon Freevee", "FAST"], vuf: ["Vudu Free", "FAST"], fmn: ["FilmRise", "FAST"], otp: ["Free Movies Plus", "FAST"],
  hop: ["Hoopla", "FAST"], jwt: ["JustWatch TV", "FAST"],
  // Single-network cable-login apps — need a pay-TV package
  amc: ["AMC", "CABLE"], tnt: ["TNT", "CABLE"], tns: ["TNT", "CABLE"], tus: ["TBS", "CABLE"], tbs: ["TBS", "CABLE"],
  tcm: ["TCM", "CABLE"], nbc: ["NBC", "CABLE"], his: ["History", "CABLE"], aen: ["A&E", "CABLE"], lif: ["Lifetime", "CABLE"],
  ads: ["Adult Swim", "CABLE"], fxx: ["FX", "CABLE"], syf: ["Syfy", "CABLE"], usa: ["USA Network", "CABLE"], brv: ["Bravo", "CABLE"],
  dsy: ["Disney Channel", "CABLE"], fxnow: ["FX", "CABLE"], cmt: ["CMT", "CABLE"], mtv: ["MTV", "CABLE"],
  // TVOD rent/buy stores
  amz: ["Amazon Video", "TVOD"], itu: ["Apple TV (Store)", "TVOD"], vdu: ["Fandango At Home", "TVOD"],
  ply: ["Google Play Movies", "TVOD"], gpl: ["Google Play Movies", "TVOD"], mim: ["Microsoft Store", "TVOD"], msf: ["Microsoft Store", "TVOD"],
  gru: ["GRUV", "TVOD"], grv: ["GRUV", "TVOD"], adb: ["Amazon DVD/Blu-ray", "TVOD"], bnb: ["Barnes & Noble", "TVOD"],
  ydr: ["YouTube (Store)", "TVOD"], yot: ["YouTube (Store)", "TVOD"], spt: ["Spectrum On Demand", "TVOD"], zav: ["Zavvi", "TVOD"],
  // Cinema
  fad: ["Fandango", "CINEMA"], amt: ["AMC Theatres", "CINEMA"], cmk: ["Cinemark", "CINEMA"], hrk: ["Harkins", "CINEMA"],
  bbt: ["B&B Theatres", "CINEMA"], mrc: ["Marcus Theatres", "CINEMA"], ati: ["Atom Tickets", "CINEMA"], cnu: ["Cinepolis Cinemas", "CINEMA"],
};

// Niche providers surfaced when sampling the wider catalog (broad mode). Reseller
// "X Apple TV / Amazon Channel" variants collapse to their parent brand; single-network
// cable apps stay CABLE (excluded from "subscriptions"); library/free stay FAST.
Object.assign(PROVIDER_MAP, {
  agl: ["Angel Studios", "OTT"], vik: ["Rakuten Viki", "OTT"], vix: ["ViX", "OTT"], sdn: ["Sundance Now", "OTT"],
  acr: ["Acorn TV", "OTT"], hda: ["Hidive", "OTT"], bpa: ["BET+", "OTT"], bpc: ["BET+", "OTT"],
  cma: ["Cinemax", "OTT"], hmc: ["Hallmark+", "OTT"], hva: ["HISTORY Vault", "OTT"], bsa: ["BBC Select", "OTT"],
  bba: ["BritBox", "OTT"], pux: ["Pure Flix", "OTT"], gpx: ["Pure Flix", "OTT"], pfa: ["Passionflix", "OTT"],
  mtp: ["Midnight Pulp", "OTT"], kca: ["Kocowa", "OTT"], kif: ["Kino Film Collection", "OTT"], gdc: ["GuideDoc", "OTT"],
  run: ["Runtime", "OTT"], awt: ["Wonder Project", "OTT"], dpu: ["Discovery+", "OTT"], f1a: ["FOX One", "OTT"],
  pbd: ["PBS Documentaries", "OTT"], nfk: ["Netflix", "OTT"], acn: ["Acorn TV", "OTT"], iqi: ["iQIYI", "OTT"], hoc: ["Hoichoi", "OTT"],
  pep: ["Peacock", "OTT"], hdv: ["Hidive", "OTT"], umc: ["ALLBLK", "OTT"], hyh: ["Hi-YAH", "OTT"], mnp: ["Midnight Pulp", "OTT"], cts: ["Curiosity Stream", "OTT"], csa: ["Curiosity Stream", "OTT"],
  knp: ["Kanopy", "FAST"], rcf: ["The Roku Channel", "FAST"], fmz: ["Filmzie", "FAST"],
  aae: ["A&E", "CABLE"], fxn: ["FX", "CABLE"], hgt: ["HGTV", "CABLE"], tlc: ["TLC", "CABLE"], lft: ["Lifetime", "CABLE"],
  dis: ["Discovery", "CABLE"], inv: ["Investigation Discovery", "CABLE"], oxy: ["Oxygen", "CABLE"],
  nag: ["National Geographic", "CABLE"], pbs: ["PBS", "CABLE"], kqd: ["KQED", "CABLE"], thr: ["Thirteen", "CABLE"],
  wtp: ["WETA+", "CABLE"], dnw: ["DisneyNOW", "CABLE"],
});

const AD_TIER_SHORTS = new Set(["nfa", "pva", "aim"]); // explicit ad-tier provider variants

// Fallback classifier from clear_name + monetization when a short is unmapped. Order:
// explicit map → theatrical → rent/buy → live-TV bundle → reseller channel (collapse to
// parent OTT) → known cable network (exclude) → free/FAST → unknown (logged).
function classify(short, clearName, monetization) {
  if (PROVIDER_MAP[short]) return { brand: PROVIDER_MAP[short][0], cls: PROVIDER_MAP[short][1] };
  const raw = String(clearName || "");
  const n = raw.toLowerCase();
  if (/theat(re|er)|cinemas\b|cinemark|harkins|fandango|cinepolis|cinépolis/.test(n)) return { brand: raw, cls: "CINEMA" };
  if (monetization === "RENT" || monetization === "BUY") return { brand: raw, cls: "TVOD" };
  if (/(youtube tv|philo|fubo|sling|directv|spectrum).*?(live|tv|on demand)?|live tv/.test(n) && /tv|live|fubo|philo|sling|directv|spectrum/.test(n)) return { brand: raw, cls: "VMVPD" };
  const chan = raw.match(/^(.*?)\s+(?:apple ?tv|amazon)(?:\s+channel)?$/i);
  if (chan && chan[1].trim()) return { brand: chan[1].trim(), cls: "OTT" };
  if (/\b(a&e|hgtv|tlc|lifetime(?! movie)|discovery(?!\+)|oxygen|national geographic|nat geo|pbs|bravo|syfy|usa network|tnt|tbs|history channel|adult swim|mtv|cmt|fxnow|disneynow|freeform|food network|science channel|travel channel|vice tv|tru ?tv|magnolia network|comedy central|nickelodeon|cartoon network|animal planet|cooking channel|destination america|we tv|ovation|investigation discovery|\btpt\b|\babc\b|\bnbc\b|\bcbs\b)\b/.test(n)) return { brand: raw, cls: "CABLE" };
  if (/free|with ads|roku|pluto|tubi|plex|xumo|freevee|kanopy|youtube free/.test(n) && monetization !== "FLATRATE") return { brand: raw, cls: "FAST" };
  // A named-but-unmapped provider at this scale is almost always a genuine niche streaming
  // service — count it as its own OTT brand. Only nameless code-only providers stay
  // OTT_UNKNOWN (flagged, uncounted).
  const named = raw.trim() && raw.trim().toLowerCase() !== short.toLowerCase();
  return named ? { brand: raw.trim(), cls: "OTT" } : { brand: short, cls: "OTT_UNKNOWN" };
}

// ── Collection ────────────────────────────────────────────────────────────────
async function fetchProviders() {
  const r = await callJson("GET", "/justwatch/providers", { query: { country: COUNTRY } });
  const list = r.ok ? r.json?.data?.providers || [] : [];
  const byShort = {};
  for (const p of list) byShort[p.short_name] = p.clear_name;
  return { byShort, count: list.length, ok: r.ok };
}

async function fetchPopular(type) {
  const r = await callJson("GET", "/justwatch/popular", {
    query: { country: COUNTRY, language: LANGUAGE, type, limit: 50 },
  });
  if (!r.ok) return { ok: false, status: r.status, items: [] };
  const items = (r.json?.data?.results || []).map((t) => ({
    id: t.id,
    title: t.title,
    year: t.year,
    type: t.object_type === "SHOW" ? "show" : "movie",
    offers: (t.offers || []).map((o) => ({ short: o.provider_short, mon: o.monetization_type })),
  }));
  return { ok: true, items };
}

function mapResults(results) {
  return (results || []).map((t) => ({
    id: t.id,
    title: t.title,
    year: t.year,
    type: t.object_type === "SHOW" ? "show" : "movie",
    offers: (t.offers || []).map((o) => ({ short: o.provider_short, mon: o.monetization_type })),
  }));
}

// Standard JustWatch genre short-codes (fallback if /genres shape changes).
const FALLBACK_GENRES = ["act", "ani", "cmy", "crm", "doc", "drm", "eur", "fnt", "hrr", "fml", "war", "msc", "rly", "rma", "scf", "spt", "trl", "wsn"];

async function fetchGenres() {
  const r = await callJson("GET", "/justwatch/genres", { query: { language: LANGUAGE } });
  const list = r.ok ? r.json?.data?.genres || r.json?.data?.results || (Array.isArray(r.json?.data) ? r.json.data : []) : [];
  return list.map((g) => g.short_name || g.short || g.technical_name || g.slug).filter(Boolean);
}

async function fetchDiscover(type, genre, yearMin, yearMax) {
  const r = await callJson("GET", "/justwatch/discover", {
    query: { country: COUNTRY, language: LANGUAGE, type, genres: genre, year_min: yearMin, year_max: yearMax, limit: 50 },
  });
  if (!r.ok) return { ok: false, status: r.status, items: [] };
  return { ok: true, items: mapResults(r.json?.data?.results) };
}

// Build a broad popularity-stratified corpus by fanning justwatch_discover across
// genre × year-bucket × type (each call <=50, no offset), deduped by title id. This
// is the only way past the 50-cap — it's the popular head across many filters, NOT a
// census. Stops when `target` unique titles are collected or the grid is exhausted.
const YEAR_BUCKETS = [[2026, 2026], [2025, 2025], [2024, 2024], [2023, 2023], [2022, 2022], [2021, 2021], [2020, 2020], [2018, 2019], [2015, 2017], [2010, 2014], [2005, 2009], [2000, 2004], [1990, 1999], [1970, 1989]];
const MAX_DISCOVER_CALLS = 700; // safety cap so a large target can't run away
async function collectBroad(target, genres) {
  const seen = new Map(); // id -> title (first seen wins; offers are inline)
  const types = ["movie", "show"];
  let calls = 0, failed = 0;
  outer: for (const bucket of YEAR_BUCKETS) {
    for (const genre of genres) {
      for (const type of types) {
        const r = await fetchDiscover(type, genre, bucket[0], bucket[1]);
        calls += 1;
        if (!r.ok) { failed += 1; continue; }
        for (const it of r.items) if (it.id && !seen.has(it.id)) seen.set(it.id, it);
        if (seen.size >= target || calls >= MAX_DISCOVER_CALLS) break outer;
      }
    }
    console.error(`  broad: ${seen.size} unique after ${calls} calls (through ${bucket[0]}-${bucket[1]})`);
  }
  console.error(`  broad: ${seen.size} unique titles in ${calls} discover calls (${failed} failed)`);
  return [...seen.values()];
}

// ── Analysis ────────────────────────────────────────────────────────────────
const uniq = (a) => [...new Set(a)];
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const round1 = (x) => Math.round(x * 10) / 10;

// Curated US monthly subscription prices (mid-2026), brand -> {ads, adfree}. The one
// non-JustWatch input; cite + snapshot-date. null ads = no ad tier (use adfree).
const PRICES = {
  Netflix: { ads: 8.99, adfree: 19.99 },
  "Disney+": { ads: 11.99, adfree: 18.99 },
  Hulu: { ads: 11.99, adfree: 18.99 },
  Max: { ads: 10.99, adfree: 18.49 },
  "Amazon Prime Video": { ads: 8.99, adfree: 11.99 },
  "Apple TV+": { ads: null, adfree: 12.99 },
  "Paramount+": { ads: 8.99, adfree: 13.99 },
  Peacock: { ads: 10.99, adfree: 16.99 },
  Starz: { ads: null, adfree: 11.99 },
  "AMC+": { ads: 7.99, adfree: 10.99 },
  Crunchyroll: { ads: null, adfree: 9.99 },
  "MGM+": { ads: null, adfree: 6.99 },
  BritBox: { ads: null, adfree: 8.99 },
  Shudder: { ads: null, adfree: 6.99 },
};
function basketCost(brands, tier) {
  let sum = 0;
  const missing = [];
  for (const b of brands) {
    const p = PRICES[b];
    if (!p) { missing.push(b); continue; }
    const v = tier === "ads" ? (p.ads ?? p.adfree) : p.adfree;
    sum += v;
  }
  return { total: round1(sum), missing };
}

// Greedy set-cover: fewest OTT brands to reach k% of the streamable titles.
function setCover(titles, brandsOf) {
  const streamable = titles.filter((t) => brandsOf(t).length);
  const remaining = new Set(streamable.map((t) => t.id));
  const order = [];
  const coverageCurve = [];
  const chosen = new Set();
  while (remaining.size) {
    // pick brand covering the most remaining titles
    const counts = {};
    for (const t of streamable) {
      if (!remaining.has(t.id)) continue;
      for (const b of brandsOf(t)) if (!chosen.has(b)) counts[b] = (counts[b] || 0) + 1;
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (!best) break;
    chosen.add(best[0]);
    order.push(best[0]);
    for (const t of streamable) {
      if (remaining.has(t.id) && brandsOf(t).includes(best[0])) remaining.delete(t.id);
    }
    coverageCurve.push({ services: order.length, lastAdded: best[0], covered: streamable.length - remaining.size, coveredPct: pct(streamable.length - remaining.size, streamable.length) });
  }
  const need = (p) => {
    const hit = coverageCurve.find((c) => c.coveredPct >= p);
    return hit ? hit.services : order.length;
  };
  return { order, coverageCurve, streamableCount: streamable.length, need50: need(50), need80: need(80), need100: order.length };
}

function analyze(titles, providersByShort) {
  // annotate each title with brand sets per class
  const annotated = titles.map((t) => {
    const subBrands = new Set(); // OTT subscription brands
    const ottUnknown = new Set();
    let hasTVOD = false, hasCinema = false, hasFAST = false, hasVMVPD = false, hasCable = false, adReachable = false;
    for (const o of t.offers) {
      const { brand, cls } = classify(o.short, providersByShort[o.short], o.mon);
      const isSub = o.mon === "FLATRATE" || o.mon === "ADS";
      if (cls === "OTT" && isSub) {
        subBrands.add(brand);
        if (o.mon === "ADS" || AD_TIER_SHORTS.has(o.short)) adReachable = true;
      } else if (cls === "OTT_UNKNOWN" && isSub) {
        ottUnknown.add(brand);
      } else if (cls === "TVOD") hasTVOD = true;
      else if (cls === "CINEMA") hasCinema = true;
      else if (cls === "FAST") hasFAST = true;
      else if (cls === "VMVPD") hasVMVPD = true;
      else if (cls === "CABLE") hasCable = true;
    }
    return { ...t, subBrands: [...subBrands], ottUnknown: [...ottUnknown], hasTVOD, hasCinema, hasFAST, hasVMVPD, hasCable, adReachable };
  });

  const n = annotated.length;
  const withSub = annotated.filter((t) => t.subBrands.length);
  const exclusive = withSub.filter((t) => t.subBrands.length === 1);
  const rentBuyOnly = annotated.filter((t) => !t.subBrands.length && t.hasTVOD && !t.hasCinema);
  const cinemaOnly = annotated.filter((t) => !t.subBrands.length && t.hasCinema && !t.hasTVOD);

  // distinct OTT brands across the set
  const allBrands = uniq(annotated.flatMap((t) => t.subBrands));
  // per-service: catalog count (popular titles carried) + exclusive count
  const byService = allBrands
    .map((b) => ({
      brand: b,
      titles: annotated.filter((t) => t.subBrands.includes(b)).length,
      exclusives: exclusive.filter((t) => t.subBrands[0] === b).length,
      hasAdTier: PRICES[b] ? PRICES[b].ads != null : null,
    }))
    .sort((a, b) => b.titles - a.titles);

  // set-cover (Model A headline = all OTT brands)
  const cover = setCover(annotated, (t) => t.subBrands);
  const big4 = ["Netflix", "Disney+", "Max", "Amazon Prime Video"];
  const big4Covered = withSub.filter((t) => t.subBrands.some((b) => big4.includes(b))).length;

  // overlap matrix among the top brands by title count
  const topBrands = byService.slice(0, 8).map((s) => s.brand);
  const overlap = topBrands.map((a) => ({
    brand: a,
    row: topBrands.map((b) => (a === b ? annotated.filter((t) => t.subBrands.includes(a)).length : annotated.filter((t) => t.subBrands.includes(a) && t.subBrands.includes(b)).length)),
  }));

  // movie vs show split
  const split = (type) => {
    const sub = annotated.filter((t) => t.type === type);
    return { n: sub.length, withSub: sub.filter((t) => t.subBrands.length).length, withSubPct: pct(sub.filter((t) => t.subBrands.length).length, sub.length) };
  };

  // priced basket: the full set-cover order (everything streamable)
  const basketAds = basketCost(cover.order, "ads");
  const basketAdfree = basketCost(cover.order, "adfree");
  const big4Ads = basketCost(big4, "ads");
  const big4Adfree = basketCost(big4, "adfree");

  return {
    universe: { titles: n, movies: annotated.filter((t) => t.type === "movie").length, shows: annotated.filter((t) => t.type === "show").length, totalOffers: annotated.reduce((s, t) => s + t.offers.length, 0) },
    fragmentation: {
      distinctOttServices: allBrands.length,
      streamableTitles: withSub.length,
      streamablePct: pct(withSub.length, n),
      noSubscriptionTitles: n - withSub.length,
      big4: { brands: big4, covers: big4Covered, coversPct: pct(big4Covered, n) },
      servicesToCover: { p50: cover.need50, p80: cover.need80, p100: cover.need100 },
      coverageCurve: cover.coverageCurve,
      setCoverOrder: cover.order,
    },
    exclusivity: {
      exclusiveTitles: exclusive.length,
      exclusivePctOfAll: pct(exclusive.length, n),
      exclusivePctOfStreamable: pct(exclusive.length, withSub.length),
      byService: byService.filter((s) => s.exclusives > 0).map((s) => ({ brand: s.brand, exclusives: s.exclusives })),
    },
    monetization: {
      anySubscriptionPct: pct(withSub.length, n),
      rentBuyOnly: rentBuyOnly.length,
      rentBuyOnlyPct: pct(rentBuyOnly.length, n),
      cinemaOnly: cinemaOnly.length,
      cinemaOnlyPct: pct(cinemaOnly.length, n),
      adReachable: annotated.filter((t) => t.adReachable).length,
      adReachablePct: pct(annotated.filter((t) => t.adReachable).length, n),
    },
    movieVsShow: { movies: split("movie"), shows: split("show") },
    byService,
    overlap: { brands: topBrands, matrix: overlap },
    cost: {
      basketAdsMonthly: basketAds.total,
      basketAdfreeMonthly: basketAdfree.total,
      basketAdfreeYearly: round1(basketAdfree.total * 12),
      big4AdsMonthly: big4Ads.total,
      big4AdfreeMonthly: big4Adfree.total,
      pricedBrands: cover.order.filter((b) => PRICES[b]),
      unpricedBrands: basketAdfree.missing,
      priceTable: PRICES,
    },
    titlesSample: annotated.slice(0, 20).map((t) => ({ title: t.title, year: t.year, type: t.type, services: t.subBrands, exclusive: t.subBrands.length === 1 })),
    // audit: any provider short we couldn't map (so the headline isn't silently wrong)
    unmappedShorts: uniq(titles.flatMap((t) => t.offers.map((o) => o.short)).filter((s) => !PROVIDER_MAP[s])),
    ottUnknownBrands: uniq(annotated.flatMap((t) => t.ottUnknown)),
  };
}

// Per-title export rows (one row per title, offers collapsed to brand level) for the
// open CSV dataset. Re-applies the provider taxonomy independently of analyze().
function toRows(titles, providersByShort) {
  return titles.map((t) => {
    const subBrands = new Set();
    const mons = new Set();
    let tvod = false, cinema = false;
    for (const o of t.offers) {
      const { brand, cls } = classify(o.short, providersByShort[o.short], o.mon);
      if (o.mon) mons.add(o.mon);
      if (cls === "OTT" && (o.mon === "FLATRATE" || o.mon === "ADS")) subBrands.add(brand);
      else if (cls === "TVOD") tvod = true;
      else if (cls === "CINEMA") cinema = true;
    }
    const services = [...subBrands].sort();
    return {
      id: t.id, title: t.title, year: t.year ?? "", type: t.type,
      num_subscription_services: services.length,
      has_subscription: services.length > 0,
      exclusive: services.length === 1,
      rent_buy_only: services.length === 0 && tvod && !cinema,
      cinema_only: services.length === 0 && cinema && !tvod,
      subscription_services: services.join("|"),
      monetization_types: [...mons].sort().join("|"),
    };
  });
}
function toCsv(rows) {
  const cols = ["id", "title", "year", "type", "num_subscription_services", "has_subscription", "exclusive", "rent_buy_only", "cinema_only", "subscription_services", "monetization_types"];
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return cols.join(",") + "\n" + rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n") + "\n";
}

async function main() {
  console.error(`Collecting JustWatch ${COUNTRY} data from ${API_BASE} ...`);
  const providers = await fetchProviders();
  console.error(`  providers: ${providers.count}${providers.ok ? "" : " [FAILED]"}`);
  const movies = await fetchPopular("movie");
  const shows = await fetchPopular("show");
  console.error(`  popular movies: ${movies.items.length}${movies.ok ? "" : ` [FAILED ${movies.status}]`}`);
  console.error(`  popular shows:  ${shows.items.length}${shows.ok ? "" : ` [FAILED ${shows.status}]`}`);

  const titles = [...movies.items, ...shows.items];
  if (!titles.length) { console.error("No titles collected — aborting."); process.exit(1); }

  const stats = analyze(titles, providers.byShort);
  const out = {
    generatedNote: "collected via scripts/streaming-fragmentation-study.mjs",
    snapshotDate: process.env.SNAPSHOT_DATE || "2026-06-17",
    country: COUNTRY,
    apiBase: API_BASE,
    providerCount: providers.count,
    stats,
    titles: titles.map((t) => ({ id: t.id, title: t.title, year: t.year, type: t.type })),
  };

  mkdirSync(join(process.cwd(), "reports", "studies"), { recursive: true });
  mkdirSync(join(process.cwd(), "public", "datasets"), { recursive: true });
  const reportFile = join(process.cwd(), "reports", "studies", "streaming-fragmentation-2026.json");
  const publicFile = join(process.cwd(), "public", "datasets", "streaming-fragmentation-2026.json");
  writeFileSync(reportFile, JSON.stringify(out, null, 2));
  writeFileSync(publicFile, JSON.stringify(out, null, 2));
  const popCsv = toCsv(toRows(titles, providers.byShort));
  writeFileSync(join(process.cwd(), "public", "datasets", "streaming-fragmentation-2026-titles.csv"), popCsv);
  writeFileSync(join(process.cwd(), "reports", "studies", "streaming-fragmentation-2026-titles.csv"), popCsv);
  console.error(`\nWrote ${reportFile}\nWrote ${publicFile} (+ titles.csv)`);
  if (stats.unmappedShorts.length) console.error(`\n⚠ unmapped provider shorts: ${stats.unmappedShorts.join(", ")}`);
  if (stats.ottUnknownBrands.length) console.error(`⚠ OTT_UNKNOWN brands (review classification): ${stats.ottUnknownBrands.join(", ")}`);

  const broadTarget = Number(process.env.BROAD_TARGET || 0);
  if (broadTarget > 0) {
    console.error(`\nCollecting BROAD corpus (target ${broadTarget}) via justwatch_discover ...`);
    const genres = await fetchGenres();
    console.error(`  genres: ${genres.length || FALLBACK_GENRES.length}${genres.length ? " (" + genres.slice(0, 8).join(",") + "…)" : " [fallback]"}`);
    const broadTitles = await collectBroad(broadTarget, genres.length ? genres : FALLBACK_GENRES);
    const broadStats = analyze(broadTitles, providers.byShort);
    const bout = { generatedNote: out.generatedNote, snapshotDate: out.snapshotDate, country: COUNTRY, apiBase: API_BASE, providerCount: providers.count, scope: `broad-${broadTitles.length}`, stats: broadStats, titles: broadTitles.map((t) => ({ id: t.id, title: t.title, year: t.year, type: t.type })) };
    const bf = join(process.cwd(), "reports", "studies", "streaming-fragmentation-broad-2026.json");
    const bpub = join(process.cwd(), "public", "datasets", "streaming-fragmentation-broad-2026.json");
    writeFileSync(bf, JSON.stringify(bout, null, 2));
    writeFileSync(bpub, JSON.stringify(bout, null, 2));
    const broadCsv = toCsv(toRows(broadTitles, providers.byShort));
    writeFileSync(join(process.cwd(), "public", "datasets", "streaming-fragmentation-broad-2026-titles.csv"), broadCsv);
    writeFileSync(join(process.cwd(), "reports", "studies", "streaming-fragmentation-broad-2026-titles.csv"), broadCsv);
    console.error(`Wrote ${bf} (+ titles.csv)`);
    if (broadStats.unmappedShorts.length) console.error(`⚠ broad unmapped shorts: ${broadStats.unmappedShorts.join(", ")}`);
    const cmp = (label, p, b) => console.error(`  ${String(label).padEnd(24)} popular=${p}\tbroad=${b}`);
    console.error(`\n=== POPULAR-${stats.universe.titles} vs BROAD-${broadTitles.length} ===`);
    cmp("distinct OTT services", stats.fragmentation.distinctOttServices, broadStats.fragmentation.distinctOttServices);
    cmp("streamable %", stats.fragmentation.streamablePct, broadStats.fragmentation.streamablePct);
    cmp("Big-4 coverage %", stats.fragmentation.big4.coversPct, broadStats.fragmentation.big4.coversPct);
    cmp("exclusive %", stats.exclusivity.exclusivePctOfAll, broadStats.exclusivity.exclusivePctOfAll);
    cmp("services to 80%", stats.fragmentation.servicesToCover.p80, broadStats.fragmentation.servicesToCover.p80);
    cmp("services to 100%", stats.fragmentation.servicesToCover.p100, broadStats.fragmentation.servicesToCover.p100);
    cmp("movies sub %", stats.movieVsShow.movies.withSubPct, broadStats.movieVsShow.movies.withSubPct);
    cmp("shows sub %", stats.movieVsShow.shows.withSubPct, broadStats.movieVsShow.shows.withSubPct);
    cmp("ad-reachable %", stats.monetization.adReachablePct, broadStats.monetization.adReachablePct);
    console.error(`  top exclusives (broad): ${broadStats.exclusivity.byService.slice(0, 6).map((s) => s.brand + " " + s.exclusives).join(", ")}`);
  }

  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
