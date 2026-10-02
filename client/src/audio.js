// Tiny WebAudio synth — no assets. Muted until first user gesture.
let ctx = null;
let muted = false;

export function isMuted() { return muted; }
export function toggleMute() { muted = !muted; return muted; }

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, type = 'sine', vol = 0.12, slideTo = null, delay = 0) {
  if (muted) return;
  try {
    const c = ac();
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  } catch {}
}

export const sfx = {
  unlock() { try { ac(); } catch {} },
  near()  { tone(900, 0.12, 'sine', 0.07, 300); },
  elim()  { tone(220, 0.25, 'square', 0.1, 60); },
  elimOther() { tone(330, 0.15, 'triangle', 0.06, 120); },
  count(n) { tone(n <= 3 ? 660 : 440, 0.09, 'sine', 0.08); },
  go()    { tone(523, 0.12, 'sine', 0.1); tone(784, 0.2, 'sine', 0.1, null, 0.1); },
  win()   { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.1, null, i * 0.11)); },
  lose()  { tone(392, 0.2, 'sine', 0.09, 196); },
};
