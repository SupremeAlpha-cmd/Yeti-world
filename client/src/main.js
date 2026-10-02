import { GameSocket } from './net.js';
import { createRenderer, ANIMALS, ANIMAL_EMOJI, ANIMAL_COLORS } from './game.js';
import { sfx, toggleMute, isMuted } from './audio.js';

const PLAYER_SPEED = 300;
const PLAYER_R = 17;

// ---------- yeti game master ----------
let yetiTimer = null;
let lastYetiNear = 0;
function yetiSay(text, dur = 2800) {
  const wrap = $('yeti'), bubble = $('yeti-bubble');
  if (!wrap) return;
  wrap.classList.remove('hidden');
  bubble.classList.remove('hidden');
  bubble.innerHTML = `<span class="yn">YETI</span>${escapeHtml(text)}`;
  clearTimeout(yetiTimer);
  yetiTimer = setTimeout(() => bubble.classList.add('hidden'), dur);
}
function yetiHide() {
  clearTimeout(yetiTimer);
  $('yeti').classList.add('hidden');
  $('yeti-bubble').classList.add('hidden');
}
const ELIM_QUIPS = [
  (n) => `💀 ${n} got rugged!`,
  (n) => `Ouch! ${n} is out!`,
  (n) => `${n} aped too hard!`,
  (n) => `The market claims ${n}! 📉`,
];
const pick = (a) => a[(Math.random() * a.length) | 0];

// ---------- dom ----------
const $ = (id) => document.getElementById(id);
const screens = { home: $('screen-home'), lobby: $('screen-lobby'), game: $('screen-game') };
function show(name) {
  for (const k in screens) screens[k].classList.toggle('active', k === name);
}

// ---------- state ----------
let sock = null;
let myId = null, myName = 'Player', myAnimal = 'ape';
let room = null;
let gameActive = false;
let myAlive = true;
let lastCountdown = -1;
let renderer = null;
const canvas = $('game-canvas');

// prediction state
const me = { x: 450, y: 560 };
const keysDown = new Set();
const keyVec = { dx: 0, dy: 0 };
const touch = { active: false, tx: 0, ty: 0 };
let lastInputSend = 0;

// ---------- home ----------
$('btn-quick').addEventListener('click', () => join({ mode: 'quick' }));
$('btn-join-code').addEventListener('click', () => {
  join({ mode: 'code', code: $('code-input').value.trim() });
});
$('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-join-code').click();
});

async function join(opts) {
  sfx.unlock();
  myName = ($('name-input').value.trim() || 'Player').slice(0, 16);
  $('home-error').textContent = '';
  $('btn-quick').disabled = true;
  try {
    sock = new GameSocket();
    sock.onMessage = onMessage;
    sock.onClose = () => {
      if (screens.lobby.classList.contains('active') || screens.game.classList.contains('active')) {
        resetToHome('Connection lost');
      }
    };
    await sock.connect();
    sock.send({ t: 'join', mode: opts.mode, code: opts.code, name: myName });
  } catch (e) {
    $('home-error').textContent = 'Could not reach the game server.';
    $('btn-quick').disabled = false;
  }
}

function resetToHome(err) {
  gameActive = false;
  yetiHide();
  if (sock) { sock.close(); sock = null; }
  myId = null;
  show('home');
  $('btn-quick').disabled = false;
  if (err) $('home-error').textContent = err;
}

// ---------- lobby ----------
function renderLobby() {
  if (!room) return;
  $('room-code').textContent = room.code;
  const n = room.players.length;
  const cd = room.countdown;
  $('countdown').classList.toggle('hidden', !(cd > 0));
  if (cd > 0) {
    $('countdown').textContent = cd;
    $('lobby-status').textContent = `Starting in ${cd}s — grab your animal!`;
    if (cd !== lastCountdown) {
      lastCountdown = cd;
      if (cd <= 5) sfx.count(cd);
      if (cd === 3) yetiSay('Ready…');
    }
  } else {
    lastCountdown = -1;
    $('lobby-status').textContent =
      n < room.minPlayers
        ? `Waiting for players… (${n}/${room.minPlayers} to start)`
        : `Starting soon… (${n}/${room.maxPlayers})`;
  }
  // players
  const list = $('player-list');
  list.innerHTML = '';
  for (const p of room.players) {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    chip.innerHTML = `<span class="dot" style="background:${ANIMAL_COLORS[p.animal] || '#fff'}"></span>${ANIMAL_EMOJI[p.animal] || '🐾'} ${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}`;
    list.appendChild(chip);
  }
  // animal picker (built once; selection updated in place so taps never get swallowed)
  const grid = $('animal-grid');
  if (!grid.dataset.built) {
    grid.innerHTML = '';
    for (const a of ANIMALS) {
      const b = document.createElement('button');
      b.className = 'animal-btn';
      b.dataset.animal = a;
      b.innerHTML = `<span class="em">${ANIMAL_EMOJI[a]}</span><span class="nm">${a}</span>`;
      b.addEventListener('click', () => {
        myAnimal = a;
        sfx.unlock();
        sock && sock.send({ t: 'animal', animal: a });
        renderLobby();
      });
      grid.appendChild(b);
    }
    grid.dataset.built = '1';
  }
  for (const b of grid.children) b.classList.toggle('sel', b.dataset.animal === myAnimal);
}

$('btn-copy').addEventListener('click', async () => {
  const code = $('room-code').textContent;
  try { await navigator.clipboard.writeText(code); $('btn-copy').textContent = 'Copied!'; }
  catch { $('btn-copy').textContent = code; }
  setTimeout(() => ($('btn-copy').textContent = 'Copy'), 1200);
});
$('btn-leave-lobby').addEventListener('click', () => {
  sock && sock.send({ t: 'leave' });
  resetToHome();
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- game input ----------
const KEYMAP = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};
window.addEventListener('keydown', (e) => {
  if (!gameActive || !screens.game.classList.contains('active')) return;
  const v = KEYMAP[e.code];
  if (!v) return;
  e.preventDefault();
  if (!keysDown.has(e.code)) {
    keysDown.add(e.code);
    recomputeKeys();
    sendInput(true);
  }
});
window.addEventListener('keyup', (e) => {
  if (keysDown.delete(e.code)) { recomputeKeys(); sendInput(true); }
});
function recomputeKeys() {
  let dx = 0, dy = 0;
  for (const c of keysDown) { const v = KEYMAP[c]; dx += v[0]; dy += v[1]; }
  keyVec.dx = dx; keyVec.dy = dy;
}
function sendInput(force) {
  const now = performance.now();
  if (!force && now - lastInputSend < 90) return;
  lastInputSend = now;
  sock && sock.send({ t: 'input', dx: keyVec.dx, dy: keyVec.dy });
}

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX);
  const cy = (e.touches ? e.touches[0].clientY : e.clientY);
  // to arena coords (invert renderer's letterbox)
  const x = (cx - r.left - renderer.ox) / renderer.scale;
  const y = (cy - r.top - renderer.oy) / renderer.scale - 46 / renderer.scale; // finger offset
  return { x, y };
}
let lastTargetSend = 0;
canvas.addEventListener('touchstart', (e) => {
  if (!gameActive) return;
  e.preventDefault();
  sfx.unlock();
  const p = canvasPos(e);
  touch.active = true; touch.tx = p.x; touch.ty = p.y;
  sock && sock.send({ t: 'target', x: p.x, y: p.y, active: true });
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  if (!gameActive || !touch.active) return;
  e.preventDefault();
  const p = canvasPos(e);
  touch.tx = p.x; touch.ty = p.y;
  const now = performance.now();
  if (now - lastTargetSend > 40) {
    lastTargetSend = now;
    sock && sock.send({ t: 'target', x: p.x, y: p.y, active: true });
  }
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  if (!touch.active) return;
  e.preventDefault();
  touch.active = false;
  sock && sock.send({ t: 'target', active: false });
  sendInput(true);
});

$('btn-mute').addEventListener('click', () => {
  $('btn-mute').textContent = toggleMute() ? '🔇' : '🔊';
});

// ---------- prediction ----------
function predict(dt) {
  if (touch.active) {
    const dx = touch.tx - me.x, dy = touch.ty - me.y;
    const d = Math.hypot(dx, dy);
    if (d > 4) {
      const s = Math.min(d, PLAYER_SPEED * dt);
      me.x += (dx / d) * s; me.y += (dy / d) * s;
    }
  } else if (keyVec.dx !== 0 || keyVec.dy !== 0) {
    const l = Math.hypot(keyVec.dx, keyVec.dy) || 1;
    me.x += (keyVec.dx / l) * PLAYER_SPEED * dt;
    me.y += (keyVec.dy / l) * PLAYER_SPEED * dt;
  }
  me.x = Math.max(PLAYER_R, Math.min(900 - PLAYER_R, me.x));
  me.y = Math.max(PLAYER_R, Math.min(640 - PLAYER_R, me.y));
}

// ---------- render loop ----------
let lastFrame = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  if (!renderer || !screens.game.classList.contains('active')) return;
  const dt = Math.min(0.05, (ts - lastFrame) / 1000 || 0.016);
  lastFrame = ts;
  if (gameActive && myAlive) {
    predict(dt);
    sendInput(false);
    renderer.setOverride(myId, me.x, me.y);
  } else {
    renderer.clearOverride(myId);
  }
  renderer.frame(dt, ts / 1000, myId);
}

// ---------- messages ----------
function onMessage(m) {
  if (m.t === 'welcome') {
    myId = m.id;
    room = m.room;
    const meInfo = room.players.find((p) => p.id === myId);
    if (meInfo) myAnimal = meInfo.animal;
    show('lobby');
    renderLobby();
    yetiSay('Welcome to my arena! Pick your beast. 🎪', 4200);
  } else if (m.t === 'lobby') {
    room = m.room;
    if (screens.game.classList.contains('active') && !$('banner').classList.contains('hidden')) {
      // rematch -> back to lobby
      gameActive = false;
      $('banner').classList.add('hidden');
      $('spectate').classList.add('hidden');
      show('lobby');
      yetiSay('Run it back! 🔁', 2200);
    }
    if (screens.lobby.classList.contains('active')) renderLobby();
  } else if (m.t === 'error') {
    resetToHome(m.msg);
  } else if (m.t === 'start') {
    room = m.room;
    gameActive = true;
    myAlive = true;
    keysDown.clear(); recomputeKeys();
    touch.active = false;
    const meInfo = room.players.find((p) => p.id === myId);
    if (meInfo) { me.x = meInfo.x ?? 450; me.y = meInfo.y ?? 560; }
    $('banner').classList.add('hidden');
    $('spectate').classList.add('hidden');
    show('game');
    if (!renderer) renderer = createRenderer(canvas);
    renderer.resize();
    sfx.go();
    yetiSay('DODGE THE RUG! 🏃💨', 2200);
  } else if (m.t === 'state') {
    if (!renderer) return;
    renderer.setState(m.players, m.coins);
    renderer.setDanger(Math.min(1, m.elapsed / 75));
    const alive = m.players.filter((p) => p.alive);
    $('hud-alive').textContent = `🐾 ${alive.length}`;
    $('hud-time').textContent = `${m.elapsed.toFixed(1)}s`;
    const srv = m.players.find((p) => p.id === myId);
    if (srv) {
      if (!srv.alive && myAlive) {
        // server noticed before elim event edge-case; overlay handled by elim msg
      }
      // reconcile prediction toward authoritative
      me.x += (srv.x - me.x) * 0.45;
      me.y += (srv.y - me.y) * 0.45;
    }
  } else if (m.t === 'near') {
    if (!renderer) return;
    renderer.addShake(0.32);
    renderer.popup(m.x, m.y - 24, 'CLOSE!', '#fde68a');
    sfx.near();
    const now = performance.now();
    if (now - lastYetiNear > 5000) {
      lastYetiNear = now;
      yetiSay('Ooh! Close one! 😅', 1600);
    }
  } else if (m.t === 'elim') {
    if (!renderer) return;
    const p = room && room.players.find((q) => q.id === m.id);
    const color = (p && ANIMAL_COLORS[p.animal]) || '#f87171';
    renderer.burst(m.x, m.y, color, 30);
    renderer.addShake(0.55);
    if (m.id === myId) {
      myAlive = false;
      sfx.elim();
      const total = room ? room.players.length : 0;
      $('spectate-text').textContent = m.left ? 'Disconnected!' : `Eliminated — #${m.place || '?'} of ${total}`;
      $('spectate').classList.remove('hidden');
      renderer.popup(m.x, m.y - 30, 'REKT!', '#f87171');
      yetiSay('Ouch! Watch the skies. 👀', 2200);
    } else {
      sfx.elimOther();
      if (p) {
        renderer.popup(m.x, m.y - 30, `${p.name} got rugged!`, '#fca5a5');
        yetiSay(pick(ELIM_QUIPS)(p.name), 2200);
      }
    }
  } else if (m.t === 'end') {
    gameActive = false;
    renderer.clearOverride(myId);
    const w = m.winner;
    const iWon = w && w.id === myId;
    $('banner-title').textContent = w ? `${ANIMAL_EMOJI[w.animal] || '🏆'} ${iWon ? 'YOU WIN!' : w.name.toUpperCase() + ' WINS!'}` : "Nobody survived?!";
    $('banner-sub').textContent = w ? (iWon ? 'Last animal standing. Certified diamond hands.' : 'Better luck next round.') : '';
    $('banner').classList.remove('hidden');
    if (w) yetiSay(`👑 ${w.name} takes the jungle crown!`, 4200);
    if (iWon) { renderer.confettiBlast(); sfx.win(); }
    else sfx.lose();
  }
}

$('btn-rematch').addEventListener('click', () => {
  $('banner').classList.add('hidden');
  sock && sock.send({ t: 'rematch' });
});
$('btn-leave-end').addEventListener('click', () => {
  sock && sock.send({ t: 'leave' });
  resetToHome();
});

requestAnimationFrame(loop);
