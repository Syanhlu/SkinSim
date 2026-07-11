# VNG — A/B Testing & Creative Intelligence

AABW hackathon, VNG track.

## Contents

- **[MiroShark/](MiroShark/)** — social-simulation platform (cloned + adapted for Vietnam: Facebook/Threads/TikTok personas) used to A/B test ad creatives against simulated audiences.
- **[vng-ab-test-agent/](vng-ab-test-agent/)** — agent that designs, runs, and scores A/B tests against the simulator.
- **[vng-creative-intelligence/](vng-creative-intelligence/)** — creative generation + scrape-context pipeline feeding the tests.
- **[VNG_GRAND_PLAN.md](VNG_GRAND_PLAN.md)** — the phased grand plan (execute with the `/goal` Claude Code command in `.claude/commands/`).
- **[vng.md](vng.md)** — track strategy / notes.
- **docs/** — MiroShark wiring, sim-view and web-scraping plans, plus the Vietnam-adaptation patch.

## Quick start

Each project is a standalone Node app:

```bash
cd <project>
npm install
cp .env.example .env.local   # fill in keys
npm run dev
```
