// Wiimote over WebHID + keyboard/mouse virtual remotes for development.
// Both expose the same state shape, so games never care which one they get.

const NINTENDO = 0x057e;
export const FILTERS = [
  { vendorId: NINTENDO, productId: 0x0306 }, // RVL-CNT-01
  { vendorId: NINTENDO, productId: 0x0330 }, // RVL-CNT-01-TR (Wii Remote Plus)
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BTN = ['left', 'right', 'down', 'up', 'plus'];
const BTN2 = { 0: 'two', 1: 'one', 2: 'b', 3: 'a', 4: 'minus', 7: 'home' };

function blankState() {
  return {
    buttons: { a: 0, b: 0, one: 0, two: 0, plus: 0, minus: 0, home: 0, up: 0, down: 0, left: 0, right: 0 },
    pressed: {},                      // edges since last consume()
    accel: { x: 0, y: 0, z: 1 },      // in g
    tilt: { roll: 0, pitch: 0 },      // radians, from gravity (valid when held still)
    ir: [],                           // raw dots [{x,y,size}]
    pointer: { x: 0.5, y: 0.5, valid: false },
    battery: null,
  };
}

class BaseRemote extends EventTarget {
  constructor(slot) {
    super();
    this.slot = slot; // 0 or 1
    this.state = blankState();
    this.kind = 'base';
    this.connected = false;
    this.ready = false;
  }
  // Return which buttons went down since last call (edge detection for menus/actions).
  consume() {
    const p = this.state.pressed;
    this.state.pressed = {};
    return p;
  }
  _setButtons(map) {
    const s = this.state;
    for (const k in map) {
      if (map[k] && !s.buttons[k]) s.pressed[k] = true;
      s.buttons[k] = map[k] ? 1 : 0;
    }
  }
  _setAccel(x, y, z) {
    const s = this.state;
    s.accel.x = x; s.accel.y = y; s.accel.z = z;
    s.tilt.roll = Math.atan2(x, z);
    s.tilt.pitch = Math.atan2(y, Math.hypot(x, z));
  }
  _emit() { this.dispatchEvent(new Event('update')); }
  rumble() {}
  setLed() {}
}

export class Wiimote extends BaseRemote {
  constructor(device, slot) {
    super(slot);
    this.kind = 'wiimote';
    this.device = device;
    this._rumble = 0;
    this._led = 1 << slot;
    this._cal = { zero: [128, 128, 128], grav: [153, 153, 153] };
    this._irOn = false;
    this.pointerGain = 1.6; // camera FOV is narrow; >1 lets the pointer reach screen edges
    this._onReport = (e) => this._handle(e.reportId, new Uint8Array(e.data.buffer));
  }

  async open() {
    const d = this.device;
    if (!d.opened) await d.open();
    d.addEventListener('inputreport', this._onReport);
    this.connected = true;
    await this._send(0x11, [(this._led << 4) | this._rumble]);
    await this._send(0x12, [0x04, 0x31]);           // continuous: buttons + accel
    await this._send(0x15, [this._rumble]);         // status request -> battery
    await this._readCalibration();
    this.ready = true;
    this._emit();
  }

  async close() {
    this.device.removeEventListener('inputreport', this._onReport);
    this.connected = false;
    try { await this.device.close(); } catch {}
  }

  _send(id, bytes) { return this.device.sendReport(id, new Uint8Array(bytes)); }

  async _writeReg(addr, bytes) {
    const p = new Uint8Array(21);
    p[0] = 0x04 | this._rumble; // 0x04 = control registers
    p[1] = (addr >> 16) & 0xff; p[2] = (addr >> 8) & 0xff; p[3] = addr & 0xff;
    p[4] = bytes.length;
    p.set(bytes, 5);
    await this.device.sendReport(0x16, p);
    await sleep(50);
  }

  async _readCalibration() {
    // EEPROM 0x16: zero xyz, lsb, gravity xyz
    await this._send(0x17, [this._rumble, 0x00, 0x00, 0x16, 0x00, 0x08]);
  }

  async enableIR() {
    if (this._irOn) return;
    this._irOn = true;
    await this._send(0x13, [0x04 | this._rumble]); await sleep(50);
    await this._send(0x1a, [0x04 | this._rumble]); await sleep(50);
    await this._writeReg(0xb00030, [0x08]);
    await this._writeReg(0xb00000, [0x02, 0x00, 0x00, 0x71, 0x01, 0x00, 0xaa, 0x00, 0x64]); // sensitivity block 1
    await this._writeReg(0xb0001a, [0x63, 0x03]);                                            // block 2
    await this._writeReg(0xb00033, [0x03]);                                                  // extended mode
    await this._writeReg(0xb00030, [0x08]);
    await this._send(0x12, [0x04, 0x33]);           // buttons + accel + 12 bytes IR
  }

  async disableIR() {
    if (!this._irOn) return;
    this._irOn = false;
    await this._send(0x13, [this._rumble]);
    await this._send(0x1a, [this._rumble]);
    await this._send(0x12, [0x04, 0x31]);
    this.state.ir = [];
    this.state.pointer.valid = false;
  }

  setLed(mask) {
    this._led = mask & 0x0f;
    return this._send(0x11, [(this._led << 4) | this._rumble]);
  }

  rumble(ms = 120) {
    this._rumble = 1;
    this._send(0x10, [1]).catch(() => {});
    clearTimeout(this._rt);
    this._rt = setTimeout(() => {
      this._rumble = 0;
      this._send(0x10, [0]).catch(() => {});
    }, ms);
  }

  _handle(id, d) {
    if (id === 0x21) { this._onRead(d); return; }
    if (id === 0x20) { this.state.battery = d[5] / 255; this._emit(); return; }
    if (id < 0x30 || id > 0x3f) return;
    this._buttons(d[0], d[1]);
    if (id === 0x31 || id === 0x33) {
      const c = this._cal;
      const g = (i) => (d[2 + i] - c.zero[i]) / (c.grav[i] - c.zero[i]);
      this._setAccel(g(0), g(1), g(2));
    }
    if (id === 0x33) this._parseIR(d, 5);
    this._emit();
  }

  _buttons(b0, b1) {
    const m = {};
    BTN.forEach((n, i) => (m[n] = b0 & (1 << i)));
    for (const bit in BTN2) m[BTN2[bit]] = b1 & (1 << bit);
    this._setButtons(m);
  }

  _onRead(d) {
    const size = (d[2] >> 4) + 1, err = d[2] & 0x0f, addr = (d[3] << 8) | d[4];
    if (err || addr !== 0x0016 || size < 7) return;
    const z = [d[5], d[6], d[7]], g = [d[9], d[10], d[11]];
    if (g.every((v, i) => v > z[i] + 10)) this._cal = { zero: z, grav: g };
  }

  _parseIR(d, o) {
    const dots = [];
    for (let i = 0; i < 4; i++) {
      const a = d[o + i * 3], b = d[o + i * 3 + 1], c = d[o + i * 3 + 2];
      if (a === 0xff && b === 0xff && c === 0xff) continue;
      dots.push({ x: a | ((c & 0x30) << 4), y: b | ((c & 0xc0) << 2), size: c & 0x0f });
    }
    this.state.ir = dots;
    const p = this.state.pointer;
    if (dots.length >= 2) {
      const [p1, p2] = [dots[0], dots[1]].sort((a, b) => a.x - b.x);
      const mx = (p1.x + p2.x) / 2 - 512, my = (p1.y + p2.y) / 2 - 384;
      const roll = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const c = Math.cos(-roll), s = Math.sin(-roll);
      const rx = mx * c - my * s, ry = mx * s + my * c;
      const g = this.pointerGain;
      const nx = 0.5 - (rx / 1024) * g, ny = 0.5 - (ry / 768) * g;
      p.x += (nx - p.x) * 0.5; p.y += (ny - p.y) * 0.5; p.valid = true;
    } else p.valid = false;
  }
}

// Keyboard/mouse stand-in so games can be built and checked without hardware.
export class VirtualWiimote extends BaseRemote {
  // keys: {roll:[l,r], pitch:[d,u], a,b,one,two,plus,minus,home, point:[up,down,left,right], swing:{y,x,z}}
  constructor(slot, keys, mouse = false) {
    super(slot);
    this.kind = 'virtual';
    this.keys = keys;
    this.mouse = mouse;
    this.connected = this.ready = true;
    this._down = new Set();
    this._prev = new Set();
    this._imp = [0, 0, 0];
    this._roll = 0; this._pitch = 0;
    this.state.pointer.valid = true;
    this._kd = (e) => this._down.add(e.code);
    this._ku = (e) => this._down.delete(e.code);
    addEventListener('keydown', this._kd);
    addEventListener('keyup', this._ku);
    if (mouse) {
      this._mm = (e) => {
        const p = this.state.pointer;
        p.x = e.clientX / innerWidth; p.y = e.clientY / innerHeight; p.valid = true;
      };
      this._md = () => this._down.add('MouseLeft');
      this._mu = () => this._down.delete('MouseLeft');
      addEventListener('mousemove', this._mm);
      addEventListener('mousedown', this._md);
      addEventListener('mouseup', this._mu);
    }
    this._t = setInterval(() => this._tick(), 16);
  }
  destroy() {
    clearInterval(this._t);
    removeEventListener('keydown', this._kd);
    removeEventListener('keyup', this._ku);
    if (this.mouse) {
      removeEventListener('mousemove', this._mm);
      removeEventListener('mousedown', this._md);
      removeEventListener('mouseup', this._mu);
    }
  }
  _tick() {
    const k = this.keys, dn = (c) => c && this._down.has(c);
    const tr = (dn(k.roll[1]) ? 1 : 0) - (dn(k.roll[0]) ? 1 : 0);
    const tp = (dn(k.pitch[1]) ? 1 : 0) - (dn(k.pitch[0]) ? 1 : 0);
    this._roll += (tr * 0.9 - this._roll) * 0.15;
    this._pitch += (tp * 0.9 - this._pitch) * 0.15;
    const r = this._roll, p = this._pitch;
    // swing keys inject a short acceleration spike on one axis (0=x,1=y,2=z)
    if (k.swing) {
      [['x', 0], ['y', 1], ['z', 2]].forEach(([n, i]) => {
        const c = k.swing[n];
        if (c && this._down.has(c) && !this._prev.has(c)) this._imp[i] = 3;
      });
    }
    this._prev = new Set(this._down);
    this._imp = this._imp.map((v) => (Math.abs(v) < 0.1 ? 0 : v * 0.55));
    this._setAccel(
      Math.sin(r) * Math.cos(p) + this._imp[0],
      Math.sin(p) + this._imp[1],
      Math.cos(r) * Math.cos(p) + this._imp[2]);
    // tilt for games comes from gravity only, so recompute it without the spike
    this.state.tilt.roll = Math.atan2(Math.sin(r) * Math.cos(p), Math.cos(r) * Math.cos(p));
    this.state.tilt.pitch = p;
    if (k.point) {
      const pt = this.state.pointer, sp = 0.012;
      pt.x = Math.min(1, Math.max(0, pt.x + ((dn(k.point[3]) ? 1 : 0) - (dn(k.point[2]) ? 1 : 0)) * sp));
      pt.y = Math.min(1, Math.max(0, pt.y + ((dn(k.point[1]) ? 1 : 0) - (dn(k.point[0]) ? 1 : 0)) * sp));
      pt.valid = true;
    }
    this._setButtons({
      a: dn(k.a) || (this.mouse && this._down.has('MouseLeft')),
      b: dn(k.b), one: dn(k.one), two: dn(k.two),
      plus: dn(k.plus), minus: dn(k.minus), home: dn(k.home),
      up: 0, down: 0, left: 0, right: 0,
    });
    this._emit();
  }
  enableIR() { return Promise.resolve(); }
  disableIR() { return Promise.resolve(); }
  rumble(ms) { this.dispatchEvent(new CustomEvent('rumble', { detail: ms })); }
}

export const VIRTUAL_KEYMAPS = [
  { roll: ['KeyA', 'KeyD'], pitch: ['KeyS', 'KeyW'], a: 'KeyF', b: 'KeyG', one: 'KeyQ', two: 'KeyE', plus: 'KeyR', minus: 'KeyT', home: 'KeyH',
    swing: { y: 'KeyZ', x: 'KeyX', z: 'KeyC' } },
  { roll: ['ArrowLeft', 'ArrowRight'], pitch: ['ArrowDown', 'ArrowUp'], a: 'Enter', b: 'ShiftRight', one: 'Comma', two: 'Period', plus: 'Equal', minus: 'Minus', home: 'Backspace',
    point: ['KeyI', 'KeyK', 'KeyJ', 'KeyL'], swing: { y: 'KeyB', x: 'KeyN', z: 'KeyM' } },
];

// Owns the two player slots. Slot order = order of connection.
export class WiimoteHub extends EventTarget {
  constructor() {
    super();
    this.remotes = [null, null];
    this.supported = 'hid' in navigator;
    if (this.supported) {
      navigator.hid.addEventListener('disconnect', (e) => this._lost(e.device));
      navigator.hid.addEventListener('connect', (e) => this._adopt(e.device));
    }
  }

  // Reopen devices the user already granted (no click needed on later visits).
  async restore() {
    if (!this.supported) return;
    for (const d of await navigator.hid.getDevices()) await this._adopt(d);
  }

  // Must be called from a click (user gesture). Lets the user pick one or more remotes.
  async request() {
    if (!this.supported) throw new Error('WebHID not available — use Chrome or Edge.');
    const picked = await navigator.hid.requestDevice({ filters: FILTERS });
    for (const d of picked) await this._adopt(d);
  }

  async _adopt(device) {
    if (this.remotes.some((r) => r && r.device === device)) return;
    const slot = this.remotes.findIndex((r) => !r);
    if (slot < 0) return;
    const w = new Wiimote(device, slot);
    this.remotes[slot] = w;
    try { await w.open(); } catch (err) { this.remotes[slot] = null; this._change(); throw err; }
    this._change();
  }

  _lost(device) {
    const i = this.remotes.findIndex((r) => r && r.device === device);
    if (i >= 0) { this.remotes[i].connected = false; this.remotes[i] = null; this._change(); }
  }

  useVirtual(slot, remote) { this.remotes[slot]?.destroy?.(); this.remotes[slot] = remote; this._change(); }
  clear(slot) { this.remotes[slot]?.destroy?.(); this.remotes[slot] = null; this._change(); }
  _change() { this.dispatchEvent(new Event('change')); }
}
