# Streaming Fragmentation Index — data

Where the most-watched movies and TV shows in the US actually stream — and how scattered,
exclusive, and expensive that has become. Two open snapshots (June 2026):

- **Popular-100** — the 100 most-popular titles (top 50 movies + 50 shows), the
  demand-weighted *head* of the market.
- **Broad ~5,000** — a **5,047-title cross-section** pulled across every genre and decade.

It is the dataset behind the Crawlora study **["How Many Streaming Subscriptions Do You Need
in 2026?"](https://crawlora.net/blog/streaming-fragmentation-2026)**. Every title's full list
of ways-to-watch (offers) was pulled via Crawlora's JustWatch endpoints and each offer mapped
to the service behind it.

## Files

| file | rows | description |
| --- | --- | --- |
| `data/popular-titles.csv` | 100 | per-title availability for the 100 most-popular US titles |
| `data/broad-titles.csv` | 5,047 | per-title availability for the ~5,000-title cross-section |
| `data/popular-summary.json` | — | aggregates for popular-100 (fragmentation, exclusivity, monetization, overlap, cost) |
| `data/broad-summary.json` | — | aggregates for the broad corpus |

### CSV schema (one row per title)

| column | meaning |
| --- | --- |
| `id` | JustWatch title id (`tm…` movie / `ts…` show) |
| `title`, `year`, `type` | title, release year, `movie` or `show` |
| `num_subscription_services` | # of distinct standalone streaming services carrying it |
| `has_subscription` | on ≥1 subscription service |
| `exclusive` | on exactly one subscription service |
| `rent_buy_only` | no subscription — rent/buy only |
| `cinema_only` | no subscription/rent/buy — in theaters only |
| `subscription_services` | pipe-joined service brands (standalone OTT; ad-tier/quality/reseller variants collapsed to parent) |
| `monetization_types` | pipe-joined offer types seen (`FLATRATE`/`ADS`/`RENT`/`BUY`/`FREE`/`FAST`/`CINEMA`) |

## Headline findings (June 2026, US)

**Popular-100**
- **14** distinct streaming services carry the 100 most-popular titles; you'd need **11**
  subscriptions to watch all **74** that are on a subscription — and **26 of 100 aren't on any
  subscription** (rent/buy or still in theaters).
- The **Big Four** (Netflix, Disney+, Max, Prime Video) cover **51%**. **51%** of titles are
  exclusive to a single service.
- All 11 services ad-free ≈ **$152/mo (~$1,829/yr)**; even the Big Four ad-free ≈ **$70/mo**.
- **Shows 98%** on a subscription vs **movies 50%** (the movie gap is new-theatrical release-window timing).

**Broad ~5,000**
- Content scatters across **93 distinct streaming services**; **60.7%** of titles are exclusive
  to one. A **concentrated head** (6 services cover 80% of what's streamable) and a **very long
  tail** (65 services to cover all of it).
- **Netflix dominates exclusives — 1,220, more than the next four services combined.** Big Four cover **59.5%**.
- **Movies 70% / shows 89%** on a subscription; ~21% on no subscription.

## Method (brief)

For each title, JustWatch offers were pulled — `justwatch_popular` for the head; `justwatch_discover`
fanned across genre × year for the cross-section (each call ≤50 results, no offset, deduped by id).
Each offer's provider is classified into a service class — **standalone OTT subscription / live-TV
bundle (vMVPD) / free ad-supported channel (FAST) / single-network cable-login app / rent-buy store
(TVOD) / cinema** — and ad-tier, quality (SD/HD/4K), and reseller-channel ("… Apple TV/Amazon Channel")
variants are collapsed to the parent brand. "Subscriptions needed" counts only standalone retail
streaming services; a greedy set-cover gives the fewest services to reach 50/80/100% of the streamable
titles. Subscription prices are US list prices (mid-2026), the one input not from JustWatch. The data comes
from [Crawlora's JustWatch API](https://crawlora.net/docs/justwatch); the [study writeup](https://crawlora.net/blog/streaming-fragmentation-2026)
documents the full method.

## Caveats

- **Point-in-time snapshot** (June 2026), US storefront — offers change weekly and by country.
- **Popularity-stratified, not a census** — the broad corpus is the popular head across genres and
  decades, so every concentration figure is a floor; the true long tail is even more fragmented.
- **The movie / no-subscription gap is largely release-window timing** (new theatrical), not permanent lock-out.
- **~29 obscure/regional providers** in the broad corpus are left unclassified (they appear in the data
  and affect a small number of titles).
- **Subscription prices are hand-maintained list prices**; treat dollar figures as current-as-of-June-2026.
- **No quality claim** — only *where*, and at *what cost*, you can watch what's popular.

## How to cite

This repo ships a [`CITATION.cff`](CITATION.cff), so GitHub shows a **"Cite this repository"** button.
Plain text:

> Crawlora (2026). *Crawlora Streaming Fragmentation Index: where the most-popular US titles stream*
> (v1.0.0) [Data set]. https://github.com/Crawlora-org/streaming-fragmentation-data

## Data collection & ethics

- **Public availability metadata only.** Each record is the public "where to watch" listing for a
  title — the same information a viewer sees. No page content is republished and no authentication
  was bypassed.
- **No personal data** — titles, services, prices, and availability flags only.
- **Point-in-time.** Treat as a snapshot, not a live availability feed.

## License

Data is licensed **CC BY 4.0** — free to use, share and adapt with attribution to **Crawlora**
(https://crawlora.net), a link to this repository, and an indication of changes. See [`LICENSE`](LICENSE).
Generated with [Crawlora's JustWatch API](https://crawlora.net/docs/justwatch).
