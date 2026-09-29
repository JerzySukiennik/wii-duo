// Wii Remote control for HUSH (WebHID, Chrome/Edge). One remote, held like a flashlight.
//   Pointer (sensor bar) — turn: push the pointer past the centre dead zone, like Metroid Prime
//   D-pad  — up/down walk, left/right strafe        A — use / open / hide / get out
//   B      — hold breath (hold)                     1 — flashlight
//   2      — crouch (hold)                          Minus — sprint (hold)      Home/Plus — pause
//   No sensor bar in view? Tilt the remote left/right to turn instead.
// The remote rumbles with your heartbeat when you are afraid.
import { WiimoteHub } from './wiimote.js';

export class WiiControl {
  constructor() {
    this.hub = new WiimoteHub();
    this.supported = this.hub.supported;
    this.remote = null;
    this.mode = 'pointer';
    this.onChange = () => {};
    this.hub.addEventListener('change', () => {
      const r = this.hub.remotes[0] || this.hub.remotes[1] || null;
      if (r && r !== this.remote) r.enableIR?.().catch(() => {});
      this.remote = r;
      this.onChange(!!r);
    });
    this.hub.restore().catch(() => {});
  }
  get active() { return !!(this.remote && this.remote.connected); }
  connect() { return this.hub.request(); }
  rumble(ms) { if (this.active) this.remote.rumble(ms); }

  // Fills `input` (held state) and returns {look:[yawPx, pitchPx], pressed:{}}
  poll(dt, input) {
    const r = this.remote;
    if (!r || !r.connected) return null;
    const s = r.state, b = s.buttons;
    const held = (v) => v ? 1 : 0;
    input.f = input.f || held(b.up); input.b = input.b || held(b.down);
    input.l = input.l || held(b.left); input.r = input.r || held(b.right);
    input.sprint = input.sprint || held(b.minus);
    input.crouch = input.crouch || held(b.two);
    input.hold = input.hold || held(b.b);
    let lx = 0, ly = 0;
    const p = s.pointer;
    if (p.valid) {
      this.mode = 'pointer';
      const dz = 0.16;
      const f = (v) => { const a = Math.abs(v - 0.5); return a < dz ? 0 : Math.sign(v - 0.5) * Math.pow((a - dz) / (0.5 - dz), 1.4); };
      const rate = 3.0; // rad/s at the screen edge
      lx = f(p.x) * rate * dt / 0.0022;
      ly = f(p.y) * rate * 0.7 * dt / 0.0022;
    } else {
      this.mode = 'tilt';
      const roll = Math.abs(s.tilt.roll) > 0.3 ? s.tilt.roll : 0; // ignore hand tremor
      lx = -roll * 1.6 * dt / 0.0022;
      ly = 0;
    }
    return { look: [lx, ly], pressed: r.consume() };
  }
}
