import * as THREE from 'three';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const P_COLORS = [0x4cc9f0, 0xff6fb5];
export const PAL = { ink: 0x111111, cream: 0xfff4d6, yellow: 0xffd23f, pink: 0xff6fb5, blue: 0x4cc9f0, green: 0x6be675, orange: 0xff8a3d, purple: 0xb388ff, white: 0xffffff };

// Tunable axis config (persisted) so we can fix flipped real-remote axes without code changes.
const load = () => { try { return JSON.parse(localStorage.getItem('wd-settings') || '{}'); } catch { return {}; } };
export const settings = Object.assign({ rollSign: 1, pitchSign: 1, range: 0.7 }, load());
export const saveSettings = () => { try { localStorage.setItem('wd-settings', JSON.stringify(settings)); } catch {} };

// Tilt -> normalized -1..1 stick, relative to whatever pose the player held at start (Minus recenters).
export class Tilt {
  constructor(remote) { this.r = remote; this.x = 0; this.y = 0; this.recenter(); }
  recenter() { this.c = { roll: this.r.state.tilt.roll, pitch: this.r.state.tilt.pitch }; }
  read() {
    const t = this.r.state.tilt;
    let x = (settings.rollSign * (t.roll - this.c.roll)) / settings.range;
    let y = (settings.pitchSign * (t.pitch - this.c.pitch)) / settings.range;
    const dz = (v) => (Math.abs(v) < 0.05 ? 0 : v);
    this.x = lerp(this.x, clamp(dz(x), -1, 1), 0.4);
    this.y = lerp(this.y, clamp(dz(y), -1, 1), 0.4);
    return { x: this.x, y: this.y };
  }
}

// Swing detector: spikes in acceleration once gravity (slow average) is removed.
// Returns {axis:'x'|'y'|'z', sign, power} on the frame a swing starts, else null.
export class Swing {
  constructor(remote, threshold = 1.3, cooldown = 0.26) {
    this.r = remote; this.th = threshold; this.cd = cooldown; this.cool = 0;
    this.lp = { x: 0, y: 0, z: 1 };
  }
  update(dt) {
    const a = this.r.state.accel, k = 1 - Math.exp(-dt / 0.25), l = this.lp;
    l.x += (a.x - l.x) * k; l.y += (a.y - l.y) * k; l.z += (a.z - l.z) * k;
    const hx = a.x - l.x, hy = a.y - l.y, hz = a.z - l.z;
    const mag = Math.hypot(hx, hy, hz);
    this.cool -= dt;
    if (this.cool > 0 || mag < this.th) return null;
    this.cool = this.cd;
    const ax = Math.abs(hx), ay = Math.abs(hy), az = Math.abs(hz);
    const axis = ay >= ax && ay >= az ? 'y' : ax >= az ? 'x' : 'z';
    const sign = Math.sign(axis === 'x' ? hx : axis === 'y' ? hy : hz) || 1;
    return { axis, sign, power: clamp(mag / 3, 0.3, 1.5) };
  }
}

// ---- three.js helpers: flat bright toy look with black outlines ----
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.BackSide });
export function toy(geometry, color, outline = 0.06) {
  const m = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  if (outline) {
    const o = new THREE.Mesh(geometry, outlineMat);
    o.scale.setScalar(1 + outline);
    m.add(o);
  }
  m.castShadow = false;
  return m;
}
export const box = (w, h, d, c, o) => toy(new THREE.BoxGeometry(w, h, d), c, o);
export const ball = (r, c, o) => toy(new THREE.SphereGeometry(r, 14, 10), c, o);
export const cyl = (rt, rb, h, c, o) => toy(new THREE.CylinderGeometry(rt, rb, h, 12), c, o);

export function lights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xffe0a0, 1.55));
  const d = new THREE.DirectionalLight(0xffffff, 1.6);
  d.position.set(6, 12, 8);
  scene.add(d);
}

// Big canvas-texture text sprites for floating labels.
export function labelSprite(text, bg = '#ffd23f', fg = '#111', w = 256, h = 96) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#111'; g.beginPath(); g.roundRect(4, 8, w - 4, h - 8, 22); g.fill();
  g.fillStyle = bg; g.strokeStyle = '#111'; g.lineWidth = 8;
  g.beginPath(); g.roundRect(4, 4, w - 16, h - 16, 22); g.fill(); g.stroke();
  g.fillStyle = fg; let fs = h * 0.5;
  do { g.font = `700 ${fs}px "Comic Neue", Comic Sans MS, sans-serif`; fs -= 2; } while (g.measureText(text).width > w - 40 && fs > 12);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, (w - 12) / 2, h / 2 - 6);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.scale.set(w / 64, h / 64, 1);
  s.userData.canvas = c;
  return s;
}

// ---- tiny WebAudio sfx (no assets) ----
let actx;
export function sfx(freq = 440, dur = 0.12, type = 'square', vol = 0.06, slide = 0) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, actx.currentTime + dur);
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
  } catch {}
}

// ---- polish helpers ----
export function gradientBG(scene, top = '#3aa0ff', bottom = '#bfeaff') {
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); scene.background = t; return t;
}
export function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
export const stripeTex = (a = '#ffdd00', b = '#111', rep = [4, 1]) => canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = a; g.fillRect(0, 0, w, h); g.fillStyle = b;
  for (let i = -h; i < w + h; i += 32) { g.beginPath(); g.moveTo(i, h); g.lineTo(i + 16, h); g.lineTo(i + 16 + h, 0); g.lineTo(i + h, 0); g.fill(); }
}, rep);
export const checkerTex = (a = '#fff', b = '#ccc', rep = [10, 10]) => canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = a; g.fillRect(0, 0, w, h); g.fillStyle = b; g.fillRect(0, 0, w / 2, h / 2); g.fillRect(w / 2, h / 2, w / 2, h / 2);
}, rep);
export const texMat = (map, extra = {}) => new THREE.MeshLambertMaterial({ map, flatShading: true, ...extra });

// dark blob under moving things: cheap and very 90s
const blobTex = () => canvasTex(64, 64, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h);
});
let _blob;
export function blobShadow(size = 3, y = 0.06) {
  _blob = _blob || blobTex();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: _blob, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = y; return m;
}

// Particles, floating text popups and camera shake in one tiny helper.
export class Fx {
  constructor(scene) {
    this.scene = scene; this.parts = []; this.pops = []; this.shakeT = 0; this.shakeAmp = 0; this.off = new THREE.Vector3();
    const g = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 120; i++) {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff })); m.visible = false; scene.add(m);
      this.parts.push({ m, v: new THREE.Vector3(), life: 0, max: 1, grav: 0 });
    }
  }
  burst(pos, color = 0xffdd00, n = 12, speed = 6, size = 0.3, grav = 14) {
    let k = 0;
    for (const p of this.parts) {
      if (p.life > 0) continue;
      p.life = p.max = rand(0.4, 0.9); p.grav = grav; p.m.material.color.setHex(color); p.m.scale.setScalar(size * rand(0.6, 1.3));
      p.m.position.copy(pos); p.v.set(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.4, 1)); p.m.visible = true;
      if (++k >= n) break;
    }
  }
  popup(text, pos, bg = '#ffdd00', fg = '#111') {
    const s = labelSprite(text, bg, fg, 256, 96); s.position.copy(pos); s.scale.multiplyScalar(0.8); this.scene.add(s);
    this.pops.push({ s, life: 0.9 });
  }
  shake(amp = 0.5, t = 0.3) { this.shakeAmp = Math.max(this.shakeAmp, amp); this.shakeT = Math.max(this.shakeT, t); }
  update(dt) {
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt; p.v.y -= p.grav * dt; p.m.position.addScaledVector(p.v, dt);
      p.m.scale.multiplyScalar(0.985); if (p.life <= 0) p.m.visible = false;
    }
    for (const q of this.pops) { q.life -= dt; q.s.position.y += dt * 3; q.s.material.opacity = Math.min(1, q.life * 3); if (q.life <= 0) { this.scene.remove(q.s); q.dead = true; } }
    this.pops = this.pops.filter((q) => !q.dead);
    this.shakeT = Math.max(0, this.shakeT - dt); if (this.shakeT === 0) this.shakeAmp = 0;
  }
  // called around game.update so camera shake never accumulates
  unshake(cam) { cam.position.sub(this.off); this.off.set(0, 0, 0); }
  applyShake(cam) {
    if (this.shakeAmp > 0) this.off.set(rand(-1, 1), rand(-1, 1), 0).multiplyScalar(this.shakeAmp * Math.min(1, this.shakeT * 4));
    cam.position.add(this.off);
  }
}

// ---- 8-bit style music: tiny step sequencer on WebAudio ----
const SONGS = {
  menu: { bpm: 132, root: 60, lead: [0, 4, 7, 12, 7, 4, 0, 7, 5, 9, 12, 17, 12, 9, 5, 9], bass: [0, 0, 5, 5, 7, 7, 5, 5], wave: 'square' },
  paperplane: { bpm: 150, root: 64, lead: [0, 7, 12, 7, 4, 11, 16, 11, 5, 12, 17, 12, 7, 14, 19, 14], bass: [0, 0, 5, 5, 7, 7, 4, 4], wave: 'triangle' },
  station: { bpm: 96, root: 57, lead: [0, 3, 7, 10, 7, 3, 0, -2, 0, 5, 8, 12, 8, 5, 0, -2], bass: [0, 0, 0, 0, -4, -4, -2, -2], wave: 'sine' },
  heist: { bpm: 112, root: 55, lead: [0, -1, 0, 3, 0, -1, 0, 5, 0, -1, 0, 3, 7, 6, 5, 3], bass: [0, 0, 0, 0, 3, 3, 5, 5], wave: 'sawtooth' },
  bomb: { bpm: 168, root: 57, lead: [0, 12, 0, 12, 3, 15, 3, 15, 5, 17, 5, 17, 7, 19, 7, 19], bass: [0, 0, 0, 0, 0, 0, 0, 0], wave: 'square' },
  lumberjacks: { bpm: 90, root: 62, lead: [0, 4, 7, 4, 0, 4, 7, 9, 7, 4, 2, 4, 0, 2, 4, 0], bass: [0, 0, 7, 7, 5, 5, 7, 7], wave: 'triangle' },
  boxing: { bpm: 140, root: 52, lead: [0, 0, 12, 0, 7, 0, 10, 0, 5, 5, 17, 5, 12, 5, 15, 5], bass: [0, 0, 0, 0, 5, 5, 3, 3], wave: 'sawtooth' },
};
export const music = {
  on: (() => { try { return localStorage.getItem('wd-music') !== '0'; } catch { return true; } })(),
  song: null, step: 0, timer: null, ctx: null,
  toggle() { this.on = !this.on; try { localStorage.setItem('wd-music', this.on ? '1' : '0'); } catch {} if (!this.on) this.stop(); return this.on; },
  play(name) {
    this.stop(); this.song = SONGS[name] || SONGS.menu; if (!this.on) return;
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); this.ctx.resume?.();
      this.step = 0; this.next = this.ctx.currentTime + 0.05;
      this.timer = setInterval(() => this._sched(), 60);
    } catch {}
  },
  stop() { clearInterval(this.timer); this.timer = null; },
  _note(midi, t, dur, wave, vol) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = wave; o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  _sched() {
    const s = this.song; if (!s || !this.ctx) return;
    const spb = 60 / s.bpm / 2; // 8th notes
    while (this.next < this.ctx.currentTime + 0.25) {
      const i = this.step % 16, l = s.lead[i];
      if (l !== null) this._note(s.root + 12 + l, this.next, spb * 0.9, s.wave, 0.028);
      if (i % 2 === 0) this._note(s.root - 12 + s.bass[(i / 2) % s.bass.length | 0], this.next, spb * 1.8, 'triangle', 0.05);
      this.step++; this.next += spb;
    }
  },
};

export { THREE };
