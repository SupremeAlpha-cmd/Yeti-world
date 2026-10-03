// Leaderboard client for Yeti World (vanilla JS).
// Submits free-play/demo survival scores to the daily leaderboard service.
// Winner determination is server-side; payouts are manual.
const LB_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_LEADERBOARD_URL)
  || (typeof window !== 'undefined' && window.LEADERBOARD_URL)
  || 'http://localhost:3001';

const NAME_KEY = 'yeti_player_name';
const NAME_RE = /^[A-Za-z0-9 _.\-]{2,20}$/;

export function getStoredName() {
  try { return (localStorage.getItem(NAME_KEY) || '').trim() || null; }
  catch { return null; }
}

function saveName(n) {
  try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ }
}

// Dark-styled inline name prompt (matches Yeti's dark UI). Resolves once.
let namePromise = null;
export function ensureName() {
  const existing = getStoredName();
  if (existing) return Promise.resolve(existing);
  if (namePromise) return namePromise;
  namePromise = new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.id = 'lb-name-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(4,8,16,0.85);backdrop-filter:blur(4px);';
    ov.innerHTML =
      '<div style="background:#0d1526;border:2px solid #26314d;border-radius:20px;padding:28px;width:min(92vw,360px);text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.6);">' +
      '<div style="font-size:13px;letter-spacing:0.2em;color:#7cc4f5;font-weight:800;margin-bottom:8px;">🏆 DAILY LEADERBOARD</div>' +
      '<p style="color:#a1a1aa;font-size:13px;margin:0 0 16px;">Enter a display name to enter today\'s contest. Longest survival wins.</p>' +
      '<input id="lb-name-input" maxlength="20" placeholder="Your name" autocomplete="off" style="width:100%;box-sizing:border-box;background:#131a2e;border:2px solid #26314d;border-radius:12px;color:#fff;padding:12px 14px;font-size:15px;outline:none;" />' +
      '<div id="lb-name-err" style="color:#f87171;font-size:12px;min-height:18px;margin-top:6px;"></div>' +
      '<button id="lb-name-ok" style="margin-top:8px;width:100%;background:#7cc4f5;color:#0b1230;border:none;border-radius:12px;padding:12px;font-weight:800;font-size:14px;cursor:pointer;">ENTER CONTEST →</button>' +
      '</div>';
    document.body.appendChild(ov);
    const input = ov.querySelector('#lb-name-input');
    const err = ov.querySelector('#lb-name-err');
    const done = () => {
      const v = (input.value || '').trim();
      if (!NAME_RE.test(v)) { err.textContent = '2–20 chars: letters, numbers, space, _ . -'; return; }
      saveName(v);
      ov.remove();
      namePromise = null;
      resolve(v);
    };
    ov.querySelector('#lb-name-ok').addEventListener('click', done);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
    setTimeout(() => input.focus(), 50);
  });
  return namePromise;
}

export async function submitScore(game, score, tiebreak) {
  try {
    const name = await ensureName();
    const res = await fetch(`${LB_URL}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game, name, score: Math.round(score), tiebreak: tiebreak == null ? undefined : Math.round(tiebreak) }),
    });
    if (!res.ok) console.warn('[leaderboard] submit rejected', res.status);
  } catch (e) {
    console.warn('[leaderboard] submit failed', e);
  }
}

export { LB_URL };
