# DDScraper

Scrape Doginal Dogs inscription data, traits, and images from [market.doginaldogs.com](https://market.doginaldogs.com).

Requires **Node.js 18+** (uses native `fetch`).

## Quick Start

```bash
cd DDScraper

# Scrape a single dog
node scraper.js --dog 7742

# Scrape a range
node scraper.js --range 1 100

# Scrape all 10,000 dogs
node scraper.js --all

# Also download images
node scraper.js --images --range 1 50
```

## Output

| Path | Contents |
|---|---|
| `data/dog-00001.json` | Full record per dog (traits, market, colors, rarity) |
| `data/index.json` | Summary index of all scraped dogs |
| `images/7742.png` | Dog image (when `--images` flag used) |

## Options

| Flag | Default | Description |
|---|---|---|
| `--dog <n>` | — | Scrape a single dog |
| `--range <start> <end>` | — | Scrape a range of dogs |
| `--all` | — | Scrape all 10,000 |
| `--images` | off | Download PNG images |
| `--delay <ms>` | 200 | Delay between requests |
| `--concurrency <n>` | 3 | Parallel workers |
| `--output <dir>` | `./data` | JSON output directory |
| `--img-dir <dir>` | `./images` | Image output directory |

## API Module

Import `api.js` in your own scripts:

```js
import { getFullRecord, searchDog, getDogTraits, fetchDogImage } from './api.js';

const record = await getFullRecord(7742);
console.log(record.traits);       // { background: 'Yellow', furColor: 'Gray', ... }
console.log(record.rarityLabel);  // 'Collector'
```

### Exports

| Function | Description |
|---|---|
| `searchDog(n)` | Search by dog number, returns market listing data |
| `getDogTraits(n)` | Get traits (background, fur, head, eyes, etc.) |
| `getFullRecord(n)` | Combined search + traits into one object |
| `fetchDogImage(n)` | Download the dog's PNG image as a Buffer |
| `colorFromTrait(name)` | Map a trait name to a hex color |
| `rarityLabel(rank)` | Map a rarity rank to a label |

## PHP Proxy (for browser use)

The `php-proxy/` folder contains a PHP proxy you can deploy to cPanel to avoid CORS when calling the tRPC API from a browser.

## tRPC Endpoints Used

| Procedure | Input | Returns |
|---|---|---|
| `search.search` | `{ query, limit }` | `{ results: [{ dogId, name, imageUrl, isListed, price, ... }] }` |
| `wallet.getDogTraits` | `{ dogNumber }` | `{ background, furColor, furPattern, head, eyes, rarityRank, ... }` |
