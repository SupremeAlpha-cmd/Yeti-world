// Canvas renderer: 60fps, letterboxed arena, particles, screen shake.
export const ARENA = { w: 900, h: 640 };
export const ANIMALS = ['bear', 'rabbit', 'fox', 'wolf', 'leopard', 'deer', 'lizard', 'eagle'];
export const ANIMAL_EMOJI = { bear: '🐻', rabbit: '🐰', fox: '🦊', wolf: '🐺', leopard: '🐆', deer: '🦌', lizard: '🦎', eagle: '🦅' };
export const ANIMAL_COLORS = {
  bear: '#a16207', rabbit: '#94a3b8', fox: '#f97316', wolf: '#a78bfa',
  leopard: '#eab308', deer: '#92400e', lizard: '#4ade80', eagle: '#38bdf8',
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let scale = 1, ox = 0, oy = 0, dpr = 1;
  let trauma = 0;
  const particles = [];
  const popups = [];
  // smoothed view state: id -> {rx, ry}
  const view = new Map();
  // client-prediction overrides: 'p'+id -> {x, y} (skips smoothing)
  const overrides = new Map();
  let lastPlayers = [];
  let lastCoins = [];
  let dangerPulse = 0;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    scale = Math.min(w / ARENA.w, h / ARENA.h);
    ox = (w - ARENA.w * scale) / 2;
    oy = (h - ARENA.h * scale) / 2;
  }
  window.addEventListener('resize', resize);

  function toScreen(x, y) { return [ox + x * scale, oy + y * scale]; }

  function setState(players, coins) {
    lastPlayers = players;
    lastCoins = coins;
    const seen = new Set();
    for (const p of players) {
      seen.add('p' + p.id);
      const v = view.get('p' + p.id) || { rx: p.x, ry: p.y };
      v.tx = p.x; v.ty = p.y; v.data = p;
      view.set('p' + p.id, v);
    }
    for (const c of coins) {
      seen.add('c' + c.id);
      const v = view.get('c' + c.id) || { rx: c.x, ry: c.y };
      v.tx = c.x; v.ty = c.y; v.data = c;
      view.set('c' + c.id, v);
    }
    for (const k of [...view.keys()]) if (!seen.has(k)) view.delete(k);
  }

  function burst(x, y, color, n = 26, speed = 260) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.9);
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60,
        life: 0, max: 0.5 + Math.random() * 0.5,
        color, size: 3 + Math.random() * 5,
      });
    }
  }
  function confettiBlast() {
    const colors = ['#fbbf24', '#4ade80', '#38bdf8', '#a78bfa', '#f472b6'];
    for (let i = 0; i < 90; i++) {
      particles.push({
        x: Math.random() * ARENA.w, y: -20 - Math.random() * 120,
        vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 160,
        life: 0, max: 1.6 + Math.random() * 1.2,
        color: colors[i % colors.length], size: 4 + Math.random() * 5, confetti: true,
      });
    }
  }
  function addShake(a) { trauma = Math.min(1, trauma + a); }
  function popup(x, y, text, color = '#fff') {
    popups.push({ x, y, text, color, life: 0, max: 0.9 });
  }
  function setDanger(v) { dangerPulse = v; }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBackground(t) {
    const w = canvas.width / dpr, h = canvas.height / dpr;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0a1020');
    g.addColorStop(1, '#060a13');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // arena panel
    const [ax, ay] = [ox, oy];
    const aw = ARENA.w * scale, ah = ARENA.h * scale;
    const ag = ctx.createLinearGradient(0, ay, 0, ay + ah);
    ag.addColorStop(0, '#0d1526');
    ag.addColorStop(1, '#090e1a');
    ctx.fillStyle = ag;
    roundRect(ax, ay, aw, ah, 18 * scale);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,140,190,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // grid
    ctx.save();
    roundRect(ax, ay, aw, ah, 18 * scale);
    ctx.clip();
    ctx.strokeStyle = 'rgba(120,140,190,0.055)';
    ctx.lineWidth = 1;
    const step = 64 * scale;
    for (let x = ax + step; x < ax + aw; x += step) {
      ctx.beginPath(); ctx.moveTo(x, ay); ctx.lineTo(x, ay + ah); ctx.stroke();
    }
    for (let y = ay + step; y < ay + ah; y += step) {
      ctx.beginPath(); ctx.moveTo(ax, y); ctx.lineTo(ax + aw, y); ctx.stroke();
    }
    // danger glow at top (spawn intensity)
    if (dangerPulse > 0.01) {
      const dg = ctx.createLinearGradient(0, ay, 0, ay + 90 * scale);
      dg.addColorStop(0, `rgba(239,68,68,${0.16 * dangerPulse * (0.7 + 0.3 * Math.sin(t * 5))})`);
      dg.addColorStop(1, 'rgba(239,68,68,0)');
      ctx.fillStyle = dg;
      ctx.fillRect(ax, ay, aw, 90 * scale);
    }
    ctx.restore();
  }

  function drawCoins() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of lastCoins) {
      const v = view.get('c' + c.id);
      if (!v) continue;
      const [x, y] = toScreen(v.rx, v.ry);
      const r = c.r * scale;
      if (c.golden) {
        ctx.save();
        ctx.shadowColor = 'rgba(251,191,36,0.8)';
        ctx.shadowBlur = 18;
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
        g.addColorStop(0, '#fde68a');
        g.addColorStop(1, '#b45309');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = '#fde68a';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = '#7f1d1d';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = c.golden ? '#451a03' : '#fecaca';
      ctx.font = `800 ${Math.max(9, 11 * scale)}px ui-monospace, monospace`;
      ctx.fillText('$' + c.ticker, x, y + 1);
    }
  }

  function drawPlayers(selfId, t) {
    ctx.textAlign = 'center';
    for (const p of lastPlayers) {
      if (!p.alive) continue;
      const v = view.get('p' + p.id);
      if (!v) continue;
      const ov = overrides.get('p' + p.id);
      const [x, y] = ov ? toScreen(ov.x, ov.y) : toScreen(v.rx, v.ry);
      const color = ANIMAL_COLORS[p.animal] || '#fff';
      const r = 17 * scale;
      // glow ring
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      if (p.id === selfId) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.arc(x, y, r + 8, t * 1.5, t * 1.5 + Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.font = `${Math.round(30 * scale)}px serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(ANIMAL_EMOJI[p.animal] || '🐾', x, y + 1);
      // name tag
      ctx.font = `600 ${Math.max(10, 11 * scale)}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(238,242,255,0.85)';
      ctx.fillText(p.name, x, y - r - 12 * scale);
    }
    ctx.textBaseline = 'alphabetic';
  }

  function drawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.life += dt;
      if (pt.life >= pt.max) { particles.splice(i, 1); continue; }
      const k = 1 - pt.life / pt.max;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += (pt.confetti ? 60 : 420) * dt;
      const [x, y] = toScreen(pt.x, pt.y);
      ctx.globalAlpha = k;
      ctx.fillStyle = pt.color;
      if (pt.confetti) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(pt.life * 6);
        ctx.fillRect(-pt.size * scale / 2, -pt.size * scale / 4, pt.size * scale, pt.size * scale / 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, pt.size * scale * k, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawPopups(dt) {
    ctx.textAlign = 'center';
    for (let i = popups.length - 1; i >= 0; i--) {
      const pp = popups[i];
      pp.life += dt;
      if (pp.life >= pp.max) { popups.splice(i, 1); continue; }
      const k = 1 - pp.life / pp.max;
      const [x, y] = toScreen(pp.x, pp.y - pp.life * 46);
      ctx.globalAlpha = k;
      ctx.font = `800 ${Math.round(17 * scale)}px system-ui, sans-serif`;
      ctx.fillStyle = pp.color;
      ctx.fillText(pp.text, x, y);
      ctx.globalAlpha = 1;
    }
  }

  function frame(dt, t, selfId) {
    // smooth view toward authoritative (skip prediction overrides)
    const kp = Math.min(1, dt * 14), kc = Math.min(1, dt * 16);
    for (const [k, v] of view) {
      if (overrides.has(k)) continue;
      const f = k[0] === 'p' ? kp : kc;
      v.rx += (v.tx - v.rx) * f;
      v.ry += (v.ty - v.ry) * f;
    }
    trauma = Math.max(0, trauma - dt * 1.6);
    const sh = trauma * trauma * 16;
    const shx = (Math.random() - 0.5) * 2 * sh;
    const shy = (Math.random() - 0.5) * 2 * sh;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(shx, shy);
    drawBackground(t);
    drawCoins();
    drawPlayers(selfId, t);
    drawParticles(dt);
    drawPopups(dt);
    ctx.restore();
  }

  resize();
  return { resize, setState, frame, burst, confettiBlast, addShake, popup, setDanger, toScreen, view,
    setOverride(id, x, y) { overrides.set('p' + id, { x, y }); },
    clearOverride(id) { overrides.delete('p' + id); },
    get scale() { return scale; }, get ox() { return ox; }, get oy() { return oy; } };
}
