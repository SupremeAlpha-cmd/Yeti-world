// Single-player demo — no server, runs entirely in the browser.
// For non-dev testers (Bobby) to try the gameplay.
import { createRenderer, ARENA, ANIMAL_COLORS } from './game.js';
import { sfx } from './audio.js';

const TICKERS = ['RUG', 'HONEYPOT', 'DUMPIT', 'SCAM', 'PONZI'];
const PLAYER_R = 17;
const PLAYER_SPEED = 300;

let renderer = null;
let running = false;
let rafId = 0;
let lastTs = 0;

const player = { id: 'demo', name: 'You', animal: 'wolf', x: 450, y: 560, alive: true };
let coins = [];
let coinId = 0;
let spawnAcc = 0;
let elapsed = 0;
let danger = 0;

const keys = new Set();
const keyVec = { dx: 0, dy: 0 };
const touch = { active: false, tx: 0, ty: 0 };

function spawnCoin() {
  coinId++;
  coins.push({
    id: 'c' + coinId,
    x: 40 + Math.random() * (ARENA.w - 80),
    y: -20,
    vy: 140 + Math.random() * 120 + elapsed * 1.2,
    drift: (Math.random() - 0.5) * 40,
    r: 14,
    golden: Math.random() < 0.14,
    ticker: TICKERS[(Math.random() * TICKERS.length) | 0],
  });
}

function reset() {
  player.x = 450; player.y = 560; player.alive = true;
  coins = []; coinId = 0; spawnAcc = 0; elapsed = 0; danger = 0;
  keys.clear(); keyVec.dx = 0; keyVec.dy = 0;
  touch.active = false;
}

function collide() {
  for (const c of coins) {
    const dx = c.x - player.x, dy = c.y - player.y;
    if (Math.hypot(dx, dy) < PLAYER_R + c.r * 0.8) return c;
  }
  return null;
}

function loop(ts) {
  if (!running) return;
  rafId = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  if (!player.alive) { renderer.frame(dt, ts / 1000, null); return; }

  elapsed += dt;
  danger = Math.min(1, elapsed / 75);
  renderer.setDanger(danger);

  // spawn coins (same pacing as server)
  const interval = Math.max(0.22, 0.62 - elapsed * 0.004);
  spawnAcc += dt;
  while (spawnAcc >= interval) { spawnAcc -= interval; spawnCoin(); }

  // move coins
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.y += c.vy * dt; c.x += c.drift * dt;
    if (c.y > ARENA.h + 30) coins.splice(i, 1);
  }

  // move player
  if (touch.active) {
    const dx = touch.tx - player.x, dy = touch.ty - player.y;
    const d = Math.hypot(dx, dy);
    if (d > 4) {
      const s = Math.min(d, PLAYER_SPEED * dt);
      player.x += (dx / d) * s; player.y += (dy / d) * s;
    }
  } else if (keyVec.dx || keyVec.dy) {
    const l = Math.hypot(keyVec.dx, keyVec.dy) || 1;
    player.x += (keyVec.dx / l) * PLAYER_SPEED * dt;
    player.y += (keyVec.dy / l) * PLAYER_SPEED * dt;
  }
  player.x = Math.max(PLAYER_R, Math.min(ARENA.w - PLAYER_R, player.x));
  player.y = Math.max(PLAYER_R, Math.min(ARENA.h - PLAYER_R, player.y));

  // near-miss + collision
  const hit = collide();
  if (hit) {
    player.alive = false;
    renderer.burst(player.x, player.y, ANIMAL_COLORS[player.animal] || '#fff', 30);
    renderer.addShake(0.6);
    renderer.popup(player.x, player.y - 30, 'REKT!', '#f87171');
    sfx.elim();
    onDemoEnd(false, elapsed);
  } else {
    // near-miss sfx
    for (const c of coins) {
      const d = Math.hypot(c.x - player.x, c.y - player.y);
      if (d < PLAYER_R + c.r + 14 && d >= PLAYER_R + c.r * 0.8) {
        if (!c.near) { c.near = true; renderer.addShake(0.25); sfx.near(); }
      }
    }
  }

  renderer.setState([player], coins);
  renderer.frame(dt, ts / 1000, null);

  // HUD
  const tEl = document.getElementById('demo-time');
  if (tEl) tEl.textContent = elapsed.toFixed(1) + 's';
}

let onDemoEnd = () => {};

export function startDemo(canvas, onEnd) {
  onDemoEnd = onEnd || (() => {});
  if (!renderer) renderer = createRenderer(canvas);
  // resize after layout settles (view just became visible)
  requestAnimationFrame(() => renderer.resize());
  reset();
  running = true;
  lastTs = 0;
  renderer.setState([player], []);
  sfx.go();
  rafId = requestAnimationFrame(loop);
}

export function stopDemo() {
  running = false;
  cancelAnimationFrame(rafId);
  if (renderer) renderer.clearOverride('demo');
}

export function setDemoAnimal(animal) { player.animal = animal; }

// input — mirrors main.js key handling
const KEYMAP = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};
function recompute() {
  let dx = 0, dy = 0;
  for (const c of keys) { const v = KEYMAP[c]; dx += v[0]; dy += v[1]; }
  keyVec.dx = dx; keyVec.dy = dy;
}
window.addEventListener('keydown', (e) => {
  if (!running || !player.alive) return;
  const v = KEYMAP[e.code];
  if (!v) return;
  e.preventDefault();
  if (!keys.has(e.code)) { keys.add(e.code); recompute(); }
});
window.addEventListener('keyup', (e) => {
  if (keys.delete(e.code)) recompute();
});

export function demoTouchHandlers(canvas) {
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (cx - r.left - renderer.ox) / renderer.scale,
      y: (cy - r.top - renderer.oy) / renderer.scale,
    };
  };
  canvas.addEventListener('touchstart', (e) => {
    if (!running) return;
    e.preventDefault(); sfx.unlock();
    const p = pos(e);
    touch.active = true; touch.tx = p.x; touch.ty = p.y;
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (!running || !touch.active) return;
    e.preventDefault();
    const p = pos(e);
    touch.tx = p.x; touch.ty = p.y;
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    touch.active = false;
  });
}
