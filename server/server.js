// Yeti World — multiplayer game server (prototype, no blockchain).
// One Node process: serves the built client statically + runs the WS game.
//
// Env:
//   PORT            http/ws port (default 8080)
//   LOBBY_SECONDS   lobby countdown (default 60)
//   REMATCH_SECONDS lobby countdown after rematch (default 15)
//   MIN_PLAYERS     min players to start (default 2)
//   MAX_PLAYERS     room cap (default 8)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const chain = require('./chain.js');

const PORT = parseInt(process.env.PORT || '8080', 10);
const LOBBY_SECONDS = parseInt(process.env.LOBBY_SECONDS || '60', 10);
const REMATCH_SECONDS = parseInt(process.env.REMATCH_SECONDS || '15', 10);
const MIN_PLAYERS = parseInt(process.env.MIN_PLAYERS || '2', 10);
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS || '8', 10);
const ONCHAIN_WAIT_SECONDS = parseInt(process.env.ONCHAIN_WAIT_SECONDS || '120', 10);

// onchain referee (no-op unless CHAIN_ENABLED=1)
let chainReady = false;
try {
  chainReady = chain.init();
} catch (e) {
  console.error('[chain] init failed:', e.message);
  process.exit(1);
}

// ---- tuning ----
const ARENA = { w: 900, h: 640 };
const PLAYER_R = 17;
const PLAYER_SPEED = 300; // units/sec
const COIN_R = 13;
const PHYS_HZ = 60;
const BROADCAST_EVERY = 3; // physics ticks per snapshot => 20Hz
const GOLDEN_CHANCE = 0.14;

const ANIMALS = ['bear', 'rabbit', 'fox', 'wolf', 'leopard', 'deer', 'lizard', 'eagle'];
const ANIMAL_COLORS = {
  bear: '#a16207', rabbit: '#94a3b8', fox: '#f97316', wolf: '#a78bfa',
  leopard: '#eab308', deer: '#92400e', lizard: '#4ade80', eagle: '#38bdf8',
};
const TICKERS = ['RUG', 'HONEYPOT', 'DUMPIT', 'REKT', 'FOMO', 'SCAM',
  'PUMPDUMP', 'DEAD', 'EXIT', 'BAGHOLD', 'SOFTRUG', 'MELTDOWN'];

// ---------------- rooms ----------------
const rooms = new Map(); // code -> room
let nextPlayerNum = 1;

function makeCode() {
  const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do {
    c = Array.from({ length: 4 }, () => ABC[(Math.random() * ABC.length) | 0]).join('');
  } while (rooms.has(c));
  return c;
}

function makeRoom(code) {
  const room = {
    code, state: 'lobby', // lobby | playing | ended
    players: new Map(),   // id -> player
    coins: [], coinSeq: 0,
    countdown: null, countdownEndsAt: 0,
    tick: 0, spawnAcc: 0, elapsed: 0,
    winner: null, endTimer: null,
    chain: null, // { lobbyId, entryFee, deadline, poll } while waiting for onchain entries
  };
  rooms.set(code, room);
  return room;
}

function roomPublic(room) {
  return {
    code: room.code,
    state: room.state,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, animal: p.animal, alive: p.alive,
    })),
    countdown: room.state === 'lobby' ? lobbyCountdownLeft(room) : 0,
    maxPlayers: MAX_PLAYERS, minPlayers: MIN_PLAYERS,
  };
}

function lobbyCountdownLeft(room) {
  if (!room.countdownEndsAt) return 0;
  return Math.max(0, Math.ceil((room.countdownEndsAt - Date.now()) / 1000));
}

function broadcast(room, msg) {
  const s = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.ws.readyState === 1) p.ws.send(s);
  }
}

function send(p, msg) {
  if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
}

// ---------------- lobby ----------------
function startCountdown(room, seconds) {
  stopCountdown(room);
  room.countdownEndsAt = Date.now() + seconds * 1000;
  room.countdown = setInterval(() => {
    const left = lobbyCountdownLeft(room);
    broadcast(room, { t: 'lobby', room: roomPublic(room) });
    if (left <= 0) {
      stopCountdown(room);
      startGame(room);
    }
  }, 250);
  broadcast(room, { t: 'lobby', room: roomPublic(room) });
}

function stopCountdown(room) {
  if (room.countdown) clearInterval(room.countdown);
  room.countdown = null;
  room.countdownEndsAt = 0;
}

function maybeStartCountdown(room) {
  if (room.state !== 'lobby' || room.countdown || room.chain) return;
  if (room.players.size < MIN_PLAYERS) return;
  if (chainReady) {
    startOnchainLobby(room).catch((e) => {
      console.error(`[chain] createLobby failed for room ${room.code}:`, e.message);
      broadcast(room, { t: 'error', msg: 'Onchain lobby failed — try again' });
    });
    return;
  }
  startCountdown(room, LOBBY_SECONDS);
}

// ---- onchain lobby flow (CHAIN_ENABLED=1) ----
async function startOnchainLobby(room) {
  if (room.chain || room.state !== 'lobby') return;
  console.log(`[chain] creating onchain lobby for room ${room.code}...`);
  const { lobbyId, tx } = await chain.createLobby();
  console.log(`[chain] lobby ${lobbyId} created (tx ${tx}) for room ${room.code}`);
  room.chain = {
    lobbyId,
    entryFee: chain.ENTRY_FEE_USDG.toString(),
    deadline: Date.now() + ONCHAIN_WAIT_SECONDS * 1000,
    poll: null,
  };
  broadcast(room, { t: 'onchain_lobby', lobbyId, entryFee: room.chain.entryFee });
  room.chain.poll = setInterval(() => pollOnchainEntries(room), 2000);
}

async function pollOnchainEntries(room) {
  if (!room.chain || room.state !== 'lobby') {
    if (room.chain?.poll) clearInterval(room.chain.poll);
    return;
  }
  // timeout
  if (Date.now() > room.chain.deadline) {
    console.log(`[chain] onchain wait timed out for room ${room.code} (lobby ${room.chain.lobbyId})`);
    clearInterval(room.chain.poll);
    const abandoned = room.chain.lobbyId;
    room.chain = null;
    broadcast(room, { t: 'onchain_timeout', lobbyId: abandoned });
    broadcast(room, { t: 'lobby', room: roomPublic(room) });
    return;
  }
  try {
    const ps = [...room.players.values()];
    // every player must have a wallet and have entered onchain
    for (const p of ps) {
      if (!p.wallet) return; // shouldn't happen in chain mode
      const entered = await chain.hasEntered(room.chain.lobbyId, p.wallet);
      if (!entered) return;
    }
    // all in — stop polling, start the game
    clearInterval(room.chain.poll);
    console.log(`[chain] all ${ps.length} players onchain for lobby ${room.chain.lobbyId} — starting`);
    startGame(room);
  } catch (e) {
    console.error(`[chain] poll error for room ${room.code}:`, e.message);
  }
}

function abortOnchainWait(room, reason) {
  if (!room.chain) return;
  clearInterval(room.chain.poll);
  console.log(`[chain] aborting onchain wait for room ${room.code}: ${reason} (lobby ${room.chain.lobbyId} abandoned)`);
  room.chain = null;
  broadcast(room, { t: 'onchain_timeout' });
  broadcast(room, { t: 'lobby', room: roomPublic(room) });
}

function addPlayer(room, ws, name, wallet) {
  const id = 'p' + (nextPlayerNum++);
  const animal = ANIMALS[[...room.players.values()].length % ANIMALS.length];
  const p = {
    id, ws, room, name: (typeof name === 'string' && name.trim() ? name.trim().slice(0, 16) : 'Player'),
    animal, x: ARENA.w / 2, y: ARENA.h - 80, alive: true,
    input: { dx: 0, dy: 0, tx: null, ty: null, touch: false },
    color: ANIMAL_COLORS[animal],
    place: null,
    wallet: wallet || null, // onchain address (chain mode)
  };
  room.players.set(id, p);
  ws._player = p;
  send(p, { t: 'welcome', id, room: roomPublic(room) });
  // late joiner during onchain wait: send them the payment prompt
  if (room.chain) {
    send(p, { t: 'onchain_lobby', lobbyId: room.chain.lobbyId, entryFee: room.chain.entryFee });
  }
  broadcast(room, { t: 'lobby', room: roomPublic(room) });
  if (room.players.size >= MAX_PLAYERS) {
    stopCountdown(room);
    if (chainReady && !room.chain) {
      startOnchainLobby(room).catch((e) => {
        console.error(`[chain] createLobby failed for room ${room.code}:`, e.message);
      });
    } else {
      startGame(room);
    }
  } else {
    maybeStartCountdown(room);
  }
  return p;
}

function removePlayer(p) {
  const room = p.room;
  if (!room || !room.players.has(p.id)) return;
  room.players.delete(p.id);
  if (room.state === 'lobby') {
    if (room.players.size < MIN_PLAYERS) {
      stopCountdown(room);
      abortOnchainWait(room, 'not enough players');
      broadcast(room, { t: 'lobby', room: roomPublic(room) });
    } else {
      broadcast(room, { t: 'lobby', room: roomPublic(room) });
    }
    if (room.players.size === 0) {
      stopCountdown(room);
      rooms.delete(room.code);
    }
  } else if (room.state === 'playing') {
    if (p.alive) {
      p.alive = false;
      broadcast(room, { t: 'elim', id: p.id, x: p.x, y: p.y, left: true });
    }
    checkWin(room);
    if (room.players.size === 0) rooms.delete(room.code);
  } else if (room.state === 'ended') {
    broadcast(room, { t: 'lobby', room: roomPublic(room) });
    if (room.players.size === 0) rooms.delete(room.code);
  }
}

// ---------------- game ----------------
function startGame(room) {
  if (room.state === 'playing') return;
  stopCountdown(room);
  room.state = 'playing';
  room.coins = [];
  room.elapsed = 0;
  room.spawnAcc = 0;
  room.winner = null;
  // spread players along the bottom
  const ps = [...room.players.values()];
  ps.forEach((p, i) => {
    p.alive = true;
    p.place = null;
    p.x = ARENA.w * ((i + 1) / (ps.length + 1));
    p.y = ARENA.h - 70;
    p.input = { dx: 0, dy: 0, tx: null, ty: null, touch: false };
  });
  broadcast(room, {
    t: 'start',
    room: roomPublic(room),
    arena: ARENA,
    animals: ANIMALS,
  });
}

function spawnCoin(room) {
  const golden = Math.random() < GOLDEN_CHANCE;
  const speed = golden
    ? 330 + Math.random() * 150
    : 130 + Math.random() * 170 + Math.min(120, room.elapsed * 1.6);
  room.coins.push({
    id: ++room.coinSeq,
    x: 20 + Math.random() * (ARENA.w - 40),
    y: -24,
    vy: speed,
    drift: (Math.random() - 0.5) * 40,
    r: COIN_R + (golden ? 3 : 0),
    ticker: TICKERS[(Math.random() * TICKERS.length) | 0],
    golden,
    nearMissed: new Set(),
  });
}

function checkWin(room) {
  const alive = [...room.players.values()].filter((p) => p.alive);
  if (alive.length === 1 && room.players.size >= 2) {
    endGame(room, alive[0]);
  } else if (alive.length === 0 && room.players.size > 0) {
    endGame(room, null);
  }
}

function endGame(room, winner) {
  if (room.state !== 'playing') return;
  room.state = 'ended';
  room.winner = winner ? { id: winner.id, name: winner.name, animal: winner.animal } : null;
  broadcast(room, { t: 'end', winner: room.winner });
  // onchain payout
  const lobbyId = room.chain?.lobbyId || null;
  room.chain = null;
  if (chainReady && lobbyId && winner && winner.wallet) {
    chain.declareWinner(lobbyId, winner.wallet)
      .then(({ hash }) => console.log(`[chain] winner ${winner.name} (${winner.wallet}) paid for lobby ${lobbyId} — tx ${hash}`))
      .catch((e) => console.error(`[chain] declareWinner failed for lobby ${lobbyId}:`, e.message));
  } else if (chainReady && lobbyId) {
    console.log(`[chain] no payout for lobby ${lobbyId} (winner: ${winner ? winner.name : 'none'})`);
  }
  // auto-cleanup empty rooms after a while
  clearTimeout(room.endTimer);
  room.endTimer = setTimeout(() => {
    if (room.players.size === 0) rooms.delete(room.code);
  }, 5 * 60 * 1000);
}

function physics(room, dt) {
  room.elapsed += dt;
  // spawn pacing: faster over time
  const interval = Math.max(0.22, 0.62 - room.elapsed * 0.004);
  room.spawnAcc += dt;
  while (room.spawnAcc >= interval) {
    room.spawnAcc -= interval;
    spawnCoin(room);
  }
  // coins
  for (let i = room.coins.length - 1; i >= 0; i--) {
    const c = room.coins[i];
    c.y += c.vy * dt;
    c.x += c.drift * dt;
    if (c.y > ARENA.h + 30) room.coins.splice(i, 1);
  }
  // players
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    const inp = p.input;
    if (inp.touch && inp.tx !== null) {
      const dx = inp.tx - p.x, dy = inp.ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 4) {
        const step = Math.min(d, PLAYER_SPEED * dt);
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    } else if (inp.dx !== 0 || inp.dy !== 0) {
      const len = Math.hypot(inp.dx, inp.dy) || 1;
      p.x += (inp.dx / len) * PLAYER_SPEED * dt;
      p.y += (inp.dy / len) * PLAYER_SPEED * dt;
    }
    p.x = Math.max(PLAYER_R, Math.min(ARENA.w - PLAYER_R, p.x));
    p.y = Math.max(PLAYER_R, Math.min(ARENA.h - PLAYER_R, p.y));
  }
  // collisions + near misses
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    for (const c of room.coins) {
      const dx = c.x - p.x, dy = c.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < c.r + PLAYER_R) {
        p.alive = false;
        const alive = [...room.players.values()].filter((q) => q.alive);
        p.place = alive.length + 1;
        broadcast(room, { t: 'elim', id: p.id, x: p.x, y: p.y, place: p.place });
        checkWin(room);
        break;
      }
      // near miss: coin just passed the player horizontally close, vertically overlapping band
      if (!c.nearMissed.has(p.id) && Math.abs(dy) < 46 && Math.abs(dx) < 52 && Math.abs(dx) >= c.r + PLAYER_R) {
        c.nearMissed.add(p.id);
        send(p, { t: 'near', x: p.x, y: p.y });
      }
    }
    if (room.state !== 'playing') break;
  }
}

function snapshot(room) {
  return {
    t: 'state',
    tick: room.tick,
    elapsed: Math.round(room.elapsed * 10) / 10,
    players: [...room.players.values()].map((p) => ({
      id: p.id, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
      animal: p.animal, alive: p.alive, name: p.name,
    })),
    coins: room.coins.map((c) => ({
      id: c.id, x: Math.round(c.x), y: Math.round(c.y),
      r: c.r, ticker: c.ticker, golden: c.golden,
    })),
  };
}

// physics loop (60Hz), broadcast snapshots at 20Hz
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.state !== 'playing') continue;
    room.tick++;
    physics(room, 1 / PHYS_HZ);
    if (room.state === 'playing' && room.tick % BROADCAST_EVERY === 0) {
      broadcast(room, snapshot(room));
    }
  }
}, 1000 / PHYS_HZ);

// ---------------- websocket ----------------
function handleMessage(ws, raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  const p = ws._player;

  if (m.t === 'join') {
    if (p) return;
    let room;
    if (m.mode === 'code' && typeof m.code === 'string') {
      const code = m.code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      room = rooms.get(code);
      if (!room) room = makeRoom(code);
      if (room.state !== 'lobby' || room.players.size >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: 'error', msg: 'Room not joinable' }));
        return;
      }
    } else {
      // quick match: first open lobby room, else new
      room = [...rooms.values()].find((r) => r.state === 'lobby' && r.players.size < MAX_PLAYERS);
      if (!room) room = makeRoom(makeCode());
    }
    addPlayer(room, ws, m.name, m.wallet);
    return;
  }
  if (!p) return;
  const room = p.room;

  if (m.t === 'onchain_ready') {
    // client signals its join tx confirmed; the poller verifies onchain — just log
    console.log(`[chain] ${p.name} reports onchain entry (lobby ${m.lobbyId}, tx ${m.tx || 'n/a'})`);
  } else if (m.t === 'animal') {
    if (room.state === 'lobby' && ANIMALS.includes(m.animal)) {
      p.animal = m.animal;
      p.color = ANIMAL_COLORS[m.animal];
      broadcast(room, { t: 'lobby', room: roomPublic(room) });
    }
  } else if (m.t === 'input') {
    p.input.dx = Math.max(-1, Math.min(1, Number(m.dx) || 0));
    p.input.dy = Math.max(-1, Math.min(1, Number(m.dy) || 0));
    p.input.touch = false;
  } else if (m.t === 'target') {
    if (typeof m.x === 'number' && typeof m.y === 'number') {
      p.input.tx = Math.max(0, Math.min(ARENA.w, m.x));
      p.input.ty = Math.max(0, Math.min(ARENA.h, m.y));
      p.input.touch = !!m.active;
    } else {
      p.input.touch = false;
    }
  } else if (m.t === 'rematch') {
    if (room.state === 'ended' && room.players.size >= 1) {
      room.state = 'lobby';
      room.winner = null;
      room.chain = null;
      // reset positions/alive for lobby display
      for (const q of room.players.values()) { q.alive = true; q.place = null; }
      broadcast(room, { t: 'lobby', room: roomPublic(room) });
      if (room.players.size >= MIN_PLAYERS) {
        if (chainReady) maybeStartCountdown(room);
        else startCountdown(room, REMATCH_SECONDS);
      }
    }
  } else if (m.t === 'leave') {
    removePlayer(p);
    ws._player = null;
  }
}

// ---------------- http (static client) ----------------
const DIST = path.join(__dirname, '..', 'client', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  let p;
  try {
    p = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(DIST, p));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      fs.readFile(path.join(DIST, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('not built yet — run the client build'); return; }
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(d2);
      });
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.on('message', (raw) => handleMessage(ws, raw));
  ws.on('close', () => { if (ws._player) removePlayer(ws._player); });
  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`Yeti World server on :${PORT} (lobby ${LOBBY_SECONDS}s, min ${MIN_PLAYERS}, max ${MAX_PLAYERS})`);
});
