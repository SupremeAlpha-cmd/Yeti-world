# Yeti World 🧌

A multiplayer battle-royale arcade dodger — **prototype for fun validation only**.
No blockchain. No wallet. No entry fees. No smart contracts.

**The game:** Join a lobby, pick your animal (bull, bear, ape, whale, wolf, frog),
then memecoins (`$RUG`, `$HONEYPOT`, `$DUMPIT`…) rain from the top of the arena.
One hit eliminates you — last animal standing wins. A yeti game master hosts the
arena and calls the action.

## Onchain mode (testnet)

Set `CHAIN_ENABLED=1` to play for real stakes on Robinhood testnet (chain 46630).
The money lives onchain (YetiArena); the game itself still runs on this server,
which acts as the authorized referee.

**Server env:**
```bash
CHAIN_ENABLED=1
ARENA_ADDRESS=0xe3cc3221c1444169a0218954b3f76de72968dd23
REFEREE_KEY_PATH=/path/to/referee.key   # NEVER commit
ENTRY_FEE_USDG=5000000                  # $5 entry (6-decimal USDG)
ONCHAIN_WAIT_SECONDS=120                # payment window per round
PORT=8080
```

**Client build env:**
```bash
VITE_CHAIN_ENABLED=1
VITE_ARENA_ADDRESS=0xe3cc3221c1444169a0218954b3f76de72968dd23
VITE_USDG_ADDRESS=0x451e4a07d601a4327c35c7cd687763eb8d32f6c5
```

**Flow:** room fills (2+ players) → server creates an onchain lobby and
broadcasts `{t:'onchain_lobby', lobbyId, entryFee}` → each client approves USDG
and calls `arena.join(lobbyId)`, then the game starts once every player is
onchain (120s payment window) → on game end the server calls
`declareWinner(lobbyId, winnerWallet)` as referee → winner gets 95% of the pot
+ the YETI bonus, treasury gets 5%. Without `CHAIN_ENABLED`, the original
free-play path runs unchanged.

**Deployed (testnet 46630):**
- YetiArena: `0xe3cc3221c1444169a0218954b3f76de72968dd23`
- MockUSDG: `0x451e4a07d601a4327c35c7cd687763eb8d32f6c5`
- MockYETI: `0x85ea441b5bd85baca58fa5d9720a497e3d3f9cea` (1,000/win bonus)

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
