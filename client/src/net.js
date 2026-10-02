// WS connection helper. Same-origin by default (server serves the client),
// ws://host:8080 when running under `vite dev`.
export function resolveWsUrl() {
  const override = import.meta.env.VITE_WS_URL;
  if (override) return override;
  if (import.meta.env.DEV) return `ws://${location.hostname}:8080`;
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
}

export class GameSocket {
  constructor() {
    this.ws = null;
    this.onMessage = () => {};
    this.onOpen = () => {};
    this.onClose = () => {};
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(resolveWsUrl());
      const timer = setTimeout(() => reject(new Error('timeout')), 8000);
      ws.onopen = () => { clearTimeout(timer); this.ws = ws; this.attach(); this.onOpen(); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('connect failed')); };
    });
  }
  attach() {
    this.ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this.onMessage(m);
    };
    this.ws.onclose = () => this.onClose();
  }
  send(m) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  close() {
    try { this.ws && this.ws.close(); } catch {}
    this.ws = null;
  }
}
