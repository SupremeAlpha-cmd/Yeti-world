# Yeti World 🧌

A multiplayer battle-royale arcade dodger — **prototype for fun validation only**.
No blockchain. No wallet. No entry fees. No smart contracts.

**The game:** Join a lobby, pick your animal (bull, bear, ape, whale, wolf, frog),
then memecoins (`$RUG`, `$HONEYPOT`, `$DUMPIT`…) rain from the top of the arena.
One hit eliminates you — last animal standing wins. A yeti game master hosts the
arena and calls the action.

## Run it locally

**Server** (Node 18+):
```bash
cd server
npm install
npm start            # :8080 — serves the client AND the WebSocket
```

**Client dev** (optional — the server already serves the built client):
```bash
cd client
npm install
npm run dev          # :5173, WS auto-points at localhost:8080
```

Open http://localhost:8080 in two browser windows, enter names, hit
**Quick match** — you'll land in the same lobby. Pick animals, wait out the
countdown, dodge.

Env knobs for the server: `PORT`, `LOBBY_SECONDS` (default 60),
`REMATCH_SECONDS` (15), `MIN_PLAYERS` (2), `MAX_PLAYERS` (8).

## Controls

- **Desktop:** WASD / arrow keys
- **Mobile:** touch & drag — your animal follows your finger

## Playtest (Javin + Bobby, two phones, different networks)

Vercel can't host the WebSocket server, so for the playtest the server runs on
any machine with normal internet access, exposed through a tunnel:

```bash
cd server && npm start   # keep this running on the host machine
cloudflared tunnel --url http://localhost:8080
```

Cloudflared prints a public URL like `https://xyz.trycloudflare.com`.
**Both phones open that URL** — the page, the game, and the WebSocket all run
over it (wss). One phone taps **Quick match**, the other joins with the room
code shown. That's it — no install, no account, no wallet.

> The tunnel URL is temporary: it lives as long as the `cloudflared` process
> runs. If it restarts, share the new URL. Run the tunnel from a machine with
> unrestricted internet (some sandboxed/VPN networks block tunnel registration).
> For a permanent home, put the `server/` folder on Railway/Render/Fly.io
> (any Node host works — it's one `node server.js`) and point the client's
> `VITE_WS_URL` at it at build time.

## How it works

- `server/server.js` — authoritative game server (60Hz physics, 20Hz state
  broadcasts). Rooms, lobbies, countdowns, coin spawner, collisions,
  near-miss detection, win/elimination flow. Also serves `client/dist`.
- `client/` — Vite + vanilla JS canvas game (60fps).
  - `src/main.js` — screens (home/lobby/game), input, client-side prediction
    for your own animal with server reconciliation.
  - `src/game.js` — renderer: letterboxed arena, particles, screen shake,
    interpolation, golden-coin glow.
  - `src/net.js` — WebSocket wrapper. Same-origin WS by default;
    `VITE_WS_URL` overrides at build time for split hosting.
  - `src/audio.js` — tiny WebAudio bleeps (no assets).

**Protocol** (JSON): `join` → `welcome`/`lobby`, `animal`, `input`/`target`,
`start`, `state` @20Hz, `elim`, `near`, `end`, `rematch`, `leave`.

## What's stubbed / cut for the prototype

- No accounts, persistence, or leaderboard — rooms are in-memory.
- No anti-cheat beyond server-side clamping; client prediction is naive lerp.
- Coin patterns are pure random rain (no aimed/directed patterns yet).
- 8-player cap, one arena size, no difficulty select.
- Yeti is a client-side announcer (flavor only, no game logic).
- Balance/tuning (coin speed, spawn rate, player speed) is first-guess —
  that's what the playtest is for.
