# Jarvis VO

A friend in your tab — powered by **Cognee** memory.

Built for the [WeMakeDevs Cognee Hackathon](https://www.wemakedevs.org/hackathons/cognee) (Jun 29 – Jul 5, 2026).

## What it does

- Lives in your browser side panel
- Remembers what you were doing across sessions (Cognee)
- Helps you continue unfinished tasks
- Acts on the page when you ask

## Stack

- Chrome Extension (MV3) + React + Vite
- Cognee (remember / recall / improve / forget)
- Cloudflare Worker (API proxy)

## Dev

```bash
npm install
npm run dev
```

Load `dist` in `chrome://extensions` (Developer mode → Load unpacked).

## Hackathon progress

- [x] Project scaffold (Jun 30)
- [ ] Cognee memory integration
- [ ] Session recall ("What was I doing?")
- [ ] Page actions
- [ ] Demo + submission
