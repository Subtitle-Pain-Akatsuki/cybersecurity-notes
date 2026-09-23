# Cyber Notes SPA v2

A fully offline, single-page cybersecurity / pentest / bug bounty notes app. Vanilla HTML/CSS/JS, zero external dependencies, zero backend.

## Running it

No build step, no server required — just open `index.html` in a browser.

Optional (avoids any `file://` quirks in some browsers):
```bash
cd cyber-notes-spa-v2
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files

- `index.html` — page structure, CSP meta tag, both views, the "add command" modal
- `style.css` — dark hacker theme, CSS variables per accent color, responsive layout
- `script.js` — all app logic: seed data, rendering, search/filter, localStorage, checklist

## Features

**Command Center**
- Search across title, command text, WHY, LOOK FOR, tags, and category
- Filter by category (Recon, AD, Privesc, WebApp/API, or your custom commands)
- Terminal-style command cards with a working `[COPY]` button
- "Add Command" modal — anything you add is saved to `localStorage` under the `★ MY_COMMANDS` filter, and persists across reloads. Delete your own custom commands anytime.

**Methodology & Checklist**
- Four phases (Recon, AD, Privesc, Web/API) with detailed, actionable explanations for every item — not just a bare checklist
- Progress bar + per-phase counters
- Check state is saved to `localStorage` automatically as you go — close the tab, come back later, your progress is still there
- `[RESET]` button to wipe checklist progress if you want to start fresh

**Theme switcher**
- Top-right palette icon — swap the accent color (Electric Violet default, Matrix Green, Cyber Cyan, Terminal Amber, Laser Red, Neon Pink) without changing the dark background. Your choice is remembered.

## Data model

Seed commands and the checklist live directly in `script.js` as plain JS arrays (`SEED_COMMANDS`, `METHODOLOGY`) — edit them directly if you want to add/adjust built-in content. Anything a user adds through the UI is kept separately in `localStorage` (`cyberNotes.customCommands`) so your edits to the seed file and a user's local additions never collide.

## Security notes (why it's built this way)

- **CSP**: `index.html` ships a strict `Content-Security-Policy` meta tag (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`) — no inline scripts, no remote script sources.
- **No `innerHTML` on user data**: every custom command you add is rendered with `textContent`, never `innerHTML`, so pasting a command that happens to contain `<script>` or `<img onerror=...>` can't execute — it just displays as literal text. (The methodology checklist's explanatory text is authored by this project, not user input, so those few entries use a small amount of trusted `innerHTML` for `<b>`/`<code>` formatting only.)
- **No external dependencies**: no CDN-hosted fonts, frameworks, or libraries. It works fully offline and there's no third-party script to compromise or track you.
- **localStorage only, no network calls**: nothing you type is ever sent anywhere. All state lives in your browser.

## Customizing

- Add more seed commands: open `script.js`, find `SEED_COMMANDS`, copy an existing object and adjust `category`, `title`, `command`, `why`, `lookfor`, `tags`.
- Add more checklist items: same file, `METHODOLOGY` array — each phase has an `items` array; `detail` supports basic `<b>` and `<code>` tags.
- Add a new accent color: add a `[data-theme="yourname"] { --accent: ...; }` block in `style.css`, then add a matching button in the `#theme-dropdown` in `index.html`.
