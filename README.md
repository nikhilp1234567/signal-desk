# Signal Desk

Signal Desk is a local, single-user LinkedIn engagement assistant for a UK agency operator. It discovers and ranks useful conversations, drafts human-reviewed replies, turns recurring themes into text-post ideas, and improves profile positioning. It never publishes, comments, connects, or messages on the user's behalf.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:5173`. On first launch, a blocking setup dialog asks for the OpenRouter, Apify, and Companies House API keys. Signal Desk contains no sample opportunities, sources, ideas, or profile copy; live collection becomes available only after all three keys are saved locally.

For live-assisted collection, set server-side values in `.env`:

- `APIFY_API_TOKEN`
- `OPENROUTER_API_KEY`
- `COMPANIES_HOUSE_API_KEY`
- Optional `OPENROUTER_MODEL` and `SIGNAL_DESK_MAX_CHARGE_USD`

You can also enter or replace these keys in **Settings → Connections & storage**. Locally entered keys are saved to `data/secrets.json` with owner-only file permissions. Saved values are never returned by the API, written to SQLite, included in JSON data snapshots, or logged.

## Architecture

- React + TypeScript + Vite client
- Express local API
- Node's SQLite driver with 30-day normalized-post retention
- Automatic human-readable `data/signal-desk.json` snapshots, configurable in Settings
- Replaceable Apify adapters for public-search and group-post actors
- Companies House matching with explicit `verified`, `likely`, and `unknown` evidence
- Task-specific OpenRouter routing: `inception/mercury-2.5-preview` for high-volume ranking, replies, and search planning; `deepseek/deepseek-v4-flash-0731` for profile and longer-form writing
- Reasoning is disabled for the bulk Mercury requests and output-token caps are enforced to prevent accidental spend
- Plain-English targeting is turned into editable LinkedIn searches before the user approves any collection spend
- Every valid seven-day post is sent to AI in bounded batches and retained in the decision ledger; an AI failure falls back to transparent freshness and conversation ranking instead of emptying Today
- Collection defaults to 15 posts per approved search and shows the next-run maximum before collection starts
- Daily scheduler that runs only while the backend is open, plus manual refresh

Community Apify actor schemas can change. Adapter contract tests cover the supported shapes, and malformed rows surface as source errors instead of silently becoming opportunities.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

The API deliberately has no publishing, connection, messaging, or profile-modification routes. LinkedIn engagement remains manual.
