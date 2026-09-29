// Audio engine. Everything routes: voice → (panner) → occlusion lowpass → gain → bus → muffle
// → compressor → master. Positional voices use HRTF, and are muffled by the number of walls
// between them and the listener. Fetched samples come from sounds/manifest.json; any id that
// fails to load falls back to a synthesized buffer, so a dead file never silences the game.
import * as THREE from 'three';

const SR_FALLBACK = 44100;

export class AudioEngine {
  constructor() {
    this.ctx = null; this.buffers = new Map(); this.manifest = {}; this.voices = new Set();
    this.listenerPos = new THREE.Vector3(); this.house = null;
    this.heart = { bpm: 62, gain: 0, next: 0 };
    this.mic = { enabled: false, level: 0, floor: -60, db: -100 };
    this.basementMix = 0;
    this._occT = 0;
  }

  async init(onProgress = () => {}) {
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.master = g(0.9);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 5;
    this.comp.attack.value = 0.004; this.comp.release.value = 0.25;
    this.muffleF = ctx.createBiquadFilter(); this.muffleF.type = 'lowpass'; this.muffleF.frequency.value = 20000; this.muffleF.Q.value = 0.5;
    this.pre = g(1);
    this.pre.connect(this.muffleF); this.muffleF.connect(this.comp); this.comp.connect(this.master); this.master.connect(ctx.destination);
    this.bus = { sfx: g(1), amb: g(0.8), voice: g(1), music: g(0.7), ui: g(0.8), scare: g(1) };
    for (const b of Object.values(this.bus)) b.connect(this.pre);
    // the jumpscare bus bypasses the muffle so it always hits
    this.bus.scare.disconnect(); this.bus.scare.connect(this.comp);
    // reverbs: house + basement
    this.revHouse = ctx.createConvolver(); this.revHouse.buffer = this._ir(1.3, 2.6);
    this.revBase = ctx.createConvolver(); this.revBase.buffer = this._ir(2.6, 1.8);
    this.revHouseIn = g(1); this.revBaseIn = g(0);
    this.revHouseIn.connect(this.revHouse); this.revBaseIn.connect(this.revBase);
    this.revOut = g(0.55);
    this.revHouse.connect(this.revOut); this.revBase.connect(this.revOut); this.revOut.connect(this.pre);
    this.revSend = g(1); this.revSend.connect(this.revHouseIn); this.revSend.connect(this.revBaseIn);

    // manifest + samples
    try {
      const r = await fetch('sounds/manifest.json', { cache: 'no-store' });
      if (r.ok) this.manifest = await r.json();
    } catch { this.manifest = {}; }
    const ids = Object.keys(this.manifest);
    let done = 0;
    await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetch('sounds/' + this.manifest[id].file);
        if (!res.ok) throw new Error(res.status);
        const ab = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(ab);
        this.buffers.set(id, buf);
      } catch (e) { console.warn('[audio] failed', id, e); }
      onProgress(++done / Math.max(1, ids.length));
    }));
    console.info(`[audio] loaded ${this.buffers.size}/${ids.length} samples`);
  }

  resume() { return this.ctx?.state === 'suspended' ? this.ctx.resume() : Promise.resolve(); }
  suspend() { return this.ctx?.state === 'running' ? this.ctx.suspend() : Promise.resolve(); }
  get t() { return this.ctx.currentTime; }
  has(id) { return this.buffers.has(id) || !!SYNTH[id]; }

  buffer(id) {
    let b = this.buffers.get(id);
    if (!b && SYNTH[id]) { b = SYNTH[id](this.ctx); this.buffers.set(id, b); }
    return b || null;
  }
  // pick a random variant: 'step' → step_1..step_6
  variant(prefix, n) {
    const opts = [];
    for (let i = 1; i <= n; i++) if (this.buffers.has(`${prefix}_${i}`)) opts.push(`${prefix}_${i}`);
    if (!opts.length) return `${prefix}_1`;
    return opts[(Math.random() * opts.length) | 0];
  }

  /**
   * play(id, opts)
   *  pos: Vector3 (positional, HRTF) | null (2D)
   *  gain, rate, loop, bus, reverb (0..1 send), pan (2D only), fadeIn, offset, occlude (default true for positional)
   */
  play(id, o = {}) {
    const ctx = this.ctx; if (!ctx) return null;
    const buf = this.buffer(id);
    if (!buf) return null;
    const man = this.manifest[id];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = o.loop ?? man?.loop ?? false;
    src.playbackRate.value = o.rate ?? 1;
    const out = ctx.createGain();
    const base = (o.gain ?? 1) * (man?.gain ?? 1);
    const fadeIn = o.fadeIn ?? 0;
    out.gain.value = fadeIn ? 0 : base;
    if (fadeIn) out.gain.setTargetAtTime(base, ctx.currentTime, fadeIn / 3);
    let panner = null, occ = null, node = src;
    if (o.pos) {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
      panner.refDistance = o.ref ?? 1.2; panner.rolloffFactor = o.rolloff ?? 1.35; panner.maxDistance = 60;
      setPos(panner, o.pos);
      occ = ctx.createBiquadFilter(); occ.type = 'lowpass'; occ.frequency.value = 20000; occ.Q.value = 0.3;
      node.connect(panner); panner.connect(occ); node = occ;
    } else if (o.pan) {
      const sp = ctx.createStereoPanner(); sp.pan.value = o.pan; node.connect(sp); node = sp;
    }
    if (o.filter) {
      const bf = ctx.createBiquadFilter(); bf.type = o.filter.type || 'bandpass';
      bf.frequency.value = o.filter.freq || 1500; bf.Q.value = o.filter.Q ?? 1;
      node.connect(bf); node = bf;
    }
    node.connect(out);
    out.connect(this.bus[o.bus || 'sfx']);
    const rs = o.reverb ?? (o.pos ? 0.35 : 0);
    let send = null;
    if (rs > 0) { send = ctx.createGain(); send.gain.value = rs; out.connect(send); send.connect(this.revSend); }
    const v = {
      id, src, out, panner, occ, send, base, pos: o.pos ? o.pos.clone() : null, occlude: o.occlude ?? !!o.pos, alive: true,
      occLevel: 0,
      setPos: (p) => { if (panner) { setPos(panner, p); v.pos.copy(p); } },
      setGain: (g, tc = 0.05) => { v.base = g * (man?.gain ?? 1); out.gain.setTargetAtTime(v.base, ctx.currentTime, tc); },
      setRate: (r, tc = 0.1) => src.playbackRate.setTargetAtTime(r, ctx.currentTime, tc),
      stop: (fade = 0.05) => {
        if (!v.alive) return; v.alive = false;
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0, t + Math.max(0.01, fade));
        try { src.stop(t + fade + 0.02); } catch {}
        this.voices.delete(v);
      },
    };
    if (v.occlude && this.house) this._occlude(v, true);
    src.onended = () => { v.alive = false; this.voices.delete(v); try { out.disconnect(); } catch {} };
    src.start(ctx.currentTime + (o.delay ?? 0), o.offset ?? 0);
    this.voices.add(v);
    return v;
  }

  _occlude(v, instant) {
    const L = this.listenerPos;
    const walls = this.house.wallsBetween(L.x, L.z, v.pos.x, v.pos.z);
    // different floors: the whole floor slab in between
    const dy = Math.abs(v.pos.y - L.y);
    const n = walls + (dy > 2.2 ? 1.5 : 0);
    v.occLevel = n;
    const f = n <= 0 ? 20000 : Math.max(260, 2400 / Math.pow(1 + n, 1.6));
    const t = this.ctx.currentTime;
    if (instant) v.occ.frequency.value = f; else v.occ.frequency.setTargetAtTime(f, t, 0.08);
  }

  setListener(cam, bodyPos) {
    const ctx = this.ctx; if (!ctx) return;
    const L = ctx.listener;
    const p = cam.getWorldPosition(_v1);
    this.listenerPos.copy(bodyPos || p);
    const f = _v2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const u = _v3.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      const t = ctx.currentTime;
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(f.x, t); L.forwardY.setValueAtTime(f.y, t); L.forwardZ.setValueAtTime(f.z, t);
      L.upX.setValueAtTime(u.x, t); L.upY.setValueAtTime(u.y, t); L.upZ.setValueAtTime(u.z, t);
    } else {
      L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  update(dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // occlusion 6 Hz
    this._occT -= dt;
    if (this._occT <= 0 && this.house) {
      this._occT = 0.16;
      for (const v of this.voices) if (v.pos && v.occlude && v.alive) this._occlude(v, false);
      // basement acoustics
      const inBase = this.listenerPos.x > 20.3 ? 1 : 0;
      this.basementMix += (inBase - this.basementMix) * 0.5;
      this.revHouseIn.gain.setTargetAtTime(1 - this.basementMix, t, 0.3);
      this.revBaseIn.gain.setTargetAtTime(this.basementMix * 1.3, t, 0.3);
    }
    // heartbeat
    const h = this.heart;
    if (h.gain > 0.02) {
      if (t >= h.next - 0.05) {
        const at = Math.max(t, h.next);
        this.play('heartbeat', { gain: h.gain, bus: 'voice', delay: at - t, rate: 0.95 + Math.min(0.15, (h.bpm - 60) / 600) });
        h.next = at + 60 / h.bpm;
      }
    } else h.next = t + 0.3;
    // mic
    if (this.mic.enabled) {
      const a = this.mic.analyser, buf = this.mic.buf;
      a.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const db = 10 * Math.log10(s / buf.length + 1e-12);
      this.mic.db = db;
      // adaptive noise floor: falls fast, rises slowly
      if (db < this.mic.floor) this.mic.floor += (db - this.mic.floor) * 0.2;
      else this.mic.floor += (db - this.mic.floor) * 0.0015;
      const lvl = Math.max(0, Math.min(1, (db - this.mic.floor - 9) / 26));
      this.mic.level = Math.max(lvl, this.mic.level * Math.pow(0.02, dt));
    }
  }

  setHeart(bpm, gain) { this.heart.bpm = bpm; this.heart.gain = gain; }

  muffle(amount, tc = 0.25) {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(0.018, amount);
    this.muffleF.frequency.setTargetAtTime(f, this.ctx.currentTime, tc);
  }
  duck(bus, g, tc = 0.3) { this.bus[bus]?.gain.setTargetAtTime(g, this.ctx.currentTime, tc); }

  async enableMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const src = this.ctx.createMediaStreamSource(stream);
      const an = this.ctx.createAnalyser(); an.fftSize = 1024;
      src.connect(an); // never to destination: no feedback, nothing leaves the machine
      this.mic = { enabled: true, level: 0, floor: -50, db: -100, analyser: an, buf: new Float32Array(an.fftSize), stream };
      return true;
    } catch (e) { console.warn('[audio] mic denied', e); return false; }
  }

  stopAll(fade = 0.3) { for (const v of [...this.voices]) v.stop(fade); }

  // Speech. The macOS "Whisper" voice is ideal; otherwise the lowest pitch we can get.
  say(text, { pitch = 0.1, rate = 0.55, volume = 0.9 } = {}) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const v = voices.find(v => /whisper/i.test(v.name)) || voices.find(v => /^(Fred|Albert|Bad News|Daniel)/i.test(v.name) && /en/i.test(v.lang)) || voices.find(v => /en/i.test(v.lang));
    if (v) u.voice = v;
    u.pitch = /whisper/i.test(v?.name || '') ? 0.6 : pitch; u.rate = rate; u.volume = volume;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }

  _ir(seconds, decayPow) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const tt = i / len;
        lp += (Math.random() * 2 - 1 - lp) * (0.6 - tt * 0.45); // darker tail
        d[i] = lp * Math.pow(1 - tt, decayPow) * (i < 60 ? i / 60 : 1);
      }
      // a few early reflections
      for (const [ms, g] of [[11, 0.5], [19, 0.35], [27, 0.3], [41, 0.2]]) {
        const k = Math.floor(ctx.sampleRate * (ms + c * 3) / 1000); if (k < len) d[k] += g;
      }
    }
    return b;
  }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
function setPos(p, v) {
  if (p.positionX) { const t = p.context.currentTime; p.positionX.setValueAtTime(v.x, t); p.positionY.setValueAtTime(v.y, t); p.positionZ.setValueAtTime(v.z, t); }
  else p.setPosition(v.x, v.y, v.z);
}

// ---------------------------------------------------------------- synthesized fallbacks
function buf(ctx, sec, fn, ch = 1) {
  const sr = ctx?.sampleRate || SR_FALLBACK, n = Math.floor(sr * sec);
  const b = ctx.createBuffer(ch, n, sr);
  for (let c = 0; c < ch; c++) { const d = b.getChannelData(c); fn(d, sr, c); }
  return b;
}
const noise = () => Math.random() * 2 - 1;
function lowpassInPlace(d, a) { let y = 0; for (let i = 0; i < d.length; i++) { y += (d[i] - y) * a; d[i] = y; } }
function norm(d, peak = 0.9) { let m = 0; for (const x of d) m = Math.max(m, Math.abs(x)); if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m; }

const thud = (ctx, sec, f0, noiseAmt, lp) => buf(ctx, sec, (d, sr) => {
  for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = (Math.sin(2 * Math.PI * f0 * t * (1 - t * 2)) * 0.8 + noise() * noiseAmt) * Math.exp(-t * 28); }
  lowpassInPlace(d, lp); norm(d, 0.8);
});
const creak = (ctx, sec, f) => buf(ctx, sec, (d, sr) => {
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr, fr = f * (1 + 0.25 * Math.sin(t * 3.1) + 0.1 * Math.sin(t * 17));
    ph += fr / sr;
    const pulse = (ph % 1) < 0.08 ? 1 : 0; // stick-slip friction pulses
    d[i] = pulse * (0.5 + 0.5 * Math.sin(t * 5)) * Math.min(1, t * 8) * Math.min(1, (sec - t) * 4);
  }
  lowpassInPlace(d, 0.25); norm(d, 0.6);
});
const noiseLoop = (ctx, sec, lp, mod) => buf(ctx, sec, (d, sr, c) => {
  for (let i = 0; i < d.length; i++) d[i] = noise();
  lowpassInPlace(d, lp);
  for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] *= mod ? mod(t) : 1; }
  const fade = Math.floor(sr * 0.05); for (let i = 0; i < fade; i++) { d[i] *= i / fade; d[d.length - 1 - i] *= i / fade; }
  norm(d, 0.5);
}, 2);
const breathLoop = (ctx, sec, lp, rate, gain) => buf(ctx, sec, (d, sr) => {
  for (let i = 0; i < d.length; i++) d[i] = noise();
  lowpassInPlace(d, lp);
  for (let i = 0; i < d.length; i++) { const t = i / sr, ph = (t * rate) % 1; d[i] *= Math.pow(Math.sin(Math.PI * ph), 2) * (ph < 0.45 ? 0.7 : 1); }
  norm(d, gain);
});
function bell(d, sr, t0, f, amp) {
  const i0 = Math.floor(t0 * sr);
  for (let i = i0; i < d.length; i++) {
    const t = (i - i0) / sr;
    d[i] += amp * Math.exp(-t * 3.2) * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 6) + 0.2 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 12));
  }
}

export const SYNTH = {
  heartbeat: (c) => buf(c, 0.7, (d, sr) => {
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const a = Math.sin(2 * Math.PI * 48 * t) * Math.exp(-t * 22);
      const t2 = t - 0.23; const b = t2 > 0 ? Math.sin(2 * Math.PI * 40 * t2) * Math.exp(-t2 * 26) * 0.7 : 0;
      d[i] = a + b;
    }
    norm(d, 0.95);
  }),
  step_1: (c) => thud(c, 0.3, 70, 0.6, 0.18), step_2: (c) => thud(c, 0.3, 64, 0.7, 0.16), step_3: (c) => thud(c, 0.3, 76, 0.6, 0.2),
  pstep_1: (c) => thud(c, 0.2, 110, 0.5, 0.3), pstep_2: (c) => thud(c, 0.2, 120, 0.5, 0.35),
  creak_1: (c) => creak(c, 0.9, 38), creak_2: (c) => creak(c, 1.2, 30), creak_3: (c) => creak(c, 0.7, 52),
  door_creak_1: (c) => creak(c, 2.6, 26), door_creak_2: (c) => creak(c, 3.4, 20),
  door_close: (c) => thud(c, 0.5, 60, 0.8, 0.2), door_slam: (c) => thud(c, 1.0, 45, 1.2, 0.35),
  knock_3: (c) => buf(c, 2.0, (d, sr) => {
    for (const t0 of [0, 0.55, 1.1]) { const i0 = Math.floor(t0 * sr); for (let i = 0; i < sr * 0.2; i++) { const t = i / sr; d[i0 + i] += (Math.sin(2 * Math.PI * 180 * t) * 0.6 + noise() * 0.5) * Math.exp(-t * 40); } }
    lowpassInPlace(d, 0.3); norm(d, 0.9);
  }),
  handle_rattle: (c) => buf(c, 1.2, (d, sr) => { for (let k = 0; k < 9; k++) { const i0 = Math.floor((k * 0.12 + Math.random() * 0.03) * sr); for (let i = 0; i < 600; i++) d[i0 + i] += noise() * Math.exp(-i / 90); } norm(d, 0.7); }),
  thunder_1: (c) => noiseLoop(c, 6, 0.02, (t) => (t < 0.05 ? t * 20 : 1) * Math.exp(-t * 0.6) * (1 + 0.6 * Math.sin(t * 7))),
  thunder_2: (c) => noiseLoop(c, 7, 0.012, (t) => Math.min(1, t * 2) * Math.exp(-t * 0.5) * (1 + 0.5 * Math.sin(t * 5))),
  thunder_3: (c) => noiseLoop(c, 8, 0.008, (t) => Math.min(1, t) * Math.exp(-t * 0.4)),
  amb_rain: (c) => noiseLoop(c, 6, 0.35),
  amb_wind: (c) => noiseLoop(c, 8, 0.02, (t) => 0.5 + 0.5 * Math.sin(t * 0.8) * Math.sin(t * 0.33)),
  amb_house: (c) => noiseLoop(c, 6, 0.006),
  drone_dread: (c) => buf(c, 12, (d, sr, ch) => {
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      d[i] = Math.sin(2 * Math.PI * 41.2 * t) * 0.5 + Math.sin(2 * Math.PI * (43.65 + ch * 0.3) * t) * 0.4 + Math.sin(2 * Math.PI * 61.7 * t + Math.sin(t * 0.5)) * 0.2 + noise() * 0.03;
      d[i] *= 0.7 + 0.3 * Math.sin(2 * Math.PI * t / 12);
    }
    norm(d, 0.5);
  }, 2),
  tv_static: (c) => noiseLoop(c, 3, 0.9), radio_static: (c) => noiseLoop(c, 4, 0.5, (t) => 0.6 + 0.4 * Math.sin(t * 13)),
  electric_hum: (c) => buf(c, 2, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(2 * Math.PI * 50 * t) * 0.5 + Math.sin(2 * Math.PI * 100 * t) * 0.3 + Math.sin(2 * Math.PI * 150 * t) * 0.15; } norm(d, 0.4); }),
  monster_breath: (c) => breathLoop(c, 4.2, 0.08, 0.48, 0.8),
  player_breath_scared: (c) => breathLoop(c, 3.0, 0.2, 1.0, 0.5),
  gasp: (c) => buf(c, 0.6, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = noise() * Math.sin(Math.PI * Math.min(1, t / 0.5)); } lowpassInPlace(d, 0.3); norm(d, 0.7); }),
  whisper_1: (c) => buf(c, 3, (d, sr) => {
    for (let i = 0; i < d.length; i++) d[i] = noise();
    let hp = 0; for (let i = 0; i < d.length; i++) { const x = d[i]; hp = x - (hp * 0.98); d[i] = hp; }
    for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] *= Math.max(0, Math.sin(t * 13 + Math.sin(t * 5) * 2)) * Math.min(1, t * 3) * Math.min(1, (3 - t) * 3); }
    norm(d, 0.5);
  }),
  scream: (c) => buf(c, 2.2, (d, sr) => {
    const ph = [0, 0, 0, 0];
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const base = 380 + 700 * Math.min(1, t * 6) - t * 120;
      let s = 0;
      [1, 1.06, 1.41, 2.03].forEach((m, k) => { ph[k] += base * m * (1 + 0.02 * Math.sin(t * 60 + k)) / sr; s += ((ph[k] % 1) * 2 - 1); });
      d[i] = Math.tanh((s * 0.5 + noise() * 0.8) * 3) * Math.min(1, t * 40) * Math.min(1, (2.2 - t) * 2);
    }
    norm(d, 0.98);
  }),
  stinger_1: (c) => buf(c, 2.5, (d, sr) => {
    const fs = [220, 233.1, 311.1, 329.6, 466.2];
    for (let i = 0; i < d.length; i++) { const t = i / sr; let s = 0; for (const f of fs) s += Math.sin(2 * Math.PI * f * t + Math.sin(2 * Math.PI * 6 * t) * 0.3); d[i] = Math.tanh(s * 0.6) * Math.min(1, t * 30) * Math.exp(-t * 1.2); }
    norm(d, 0.9);
  }),
  growl: (c) => buf(c, 1.8, (d, sr) => { let ph = 0; for (let i = 0; i < d.length; i++) { const t = i / sr; ph += (55 + 10 * Math.sin(t * 9)) / sr; d[i] = Math.tanh(((ph % 1) * 2 - 1 + noise() * 0.5) * 2) * Math.sin(Math.PI * t / 1.8); } lowpassInPlace(d, 0.12); norm(d, 0.8); }),
  bones_crack: (c) => buf(c, 0.8, (d, sr) => { for (let k = 0; k < 6; k++) { const i0 = Math.floor(Math.random() * 0.6 * sr); for (let i = 0; i < 300; i++) d[i0 + i] += noise() * Math.exp(-i / 40); } norm(d, 0.8); }),
  scratch: (c) => buf(c, 1.6, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = noise() * (0.5 + 0.5 * Math.sin(t * 40)) * Math.sin(Math.PI * t / 1.6); } norm(d, 0.5); }),
  glass_bang: (c) => thud(c, 0.8, 90, 1.0, 0.5),
  object_fall: (c) => buf(c, 1.4, (d, sr) => { for (let k = 0; k < 5; k++) { const i0 = Math.floor((k * 0.12 + Math.random() * 0.1) * sr); for (let i = 0; i < sr * 0.3 && i0 + i < d.length; i++) { const t = i / sr; d[i0 + i] += (Math.sin(2 * Math.PI * (120 + k * 30) * t) + noise()) * Math.exp(-t * 20); } } lowpassInPlace(d, 0.4); norm(d, 0.85); }),
  switch_click: (c) => buf(c, 0.05, (d) => { for (let i = 0; i < d.length; i++) d[i] = noise() * Math.exp(-i / 60); norm(d, 0.5); }),
  breaker: (c) => thud(c, 0.6, 90, 1.2, 0.6),
  pickup: (c) => buf(c, 0.4, (d, sr) => { bell(d, sr, 0, 1800, 0.3); bell(d, sr, 0.03, 2600, 0.2); norm(d, 0.5); }),
  clock_tick: (c) => buf(c, 2, (d, sr) => { for (const t0 of [0, 1]) { const i0 = Math.floor(t0 * sr); for (let i = 0; i < 500; i++) d[i0 + i] += noise() * Math.exp(-i / 50) * (t0 ? 0.7 : 1); } norm(d, 0.5); }),
  clock_chime: (c) => buf(c, 9, (d, sr) => { for (let k = 0; k < 3; k++) bell(d, sr, k * 2.4, 196, 0.5); norm(d, 0.8); }),
  phone_ring: (c) => buf(c, 4, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = t < 1.8 ? (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) * (Math.sin(2 * Math.PI * 20 * t) > 0 ? 1 : 0.2) : 0; } norm(d, 0.6); }),
  phone_pickup: (c) => thud(c, 0.3, 200, 0.8, 0.5),
  music_box: (c) => buf(c, 16, (d, sr) => {
    // a slow, slightly detuned lullaby
    const mel = [659, 587, 523, 587, 659, 659, 659, 0, 587, 587, 587, 0, 659, 784, 784, 0, 659, 587, 523, 587, 659, 659, 659, 659, 587, 587, 659, 587, 523];
    mel.forEach((f, k) => { if (f) bell(d, sr, k * 0.5, f * 1.003 * (1 - k * 0.0012), 0.3); });
    norm(d, 0.6);
  }),
  piano_low: (c) => buf(c, 5, (d, sr) => {
    const f = 55;
    for (let i = 0; i < d.length; i++) { const t = i / sr; let s = 0; for (let n = 1; n < 12; n++) { const fn = f * n * Math.sqrt(1 + 0.0004 * n * n); s += Math.sin(2 * Math.PI * fn * t) * Math.exp(-t * (0.6 + n * 0.35)) / n; } d[i] = s * Math.min(1, t * 400); }
    norm(d, 0.9);
  }),
  piano_high: (c) => buf(c, 4, (d, sr) => {
    const f = 1046;
    for (let i = 0; i < d.length; i++) { const t = i / sr; let s = 0; for (let n = 1; n < 6; n++) { const fn = f * n * Math.sqrt(1 + 0.001 * n * n); s += Math.sin(2 * Math.PI * fn * t) * Math.exp(-t * (1.2 + n * 0.8)) / n; } d[i] = s * Math.min(1, t * 600); }
    norm(d, 0.7);
  }),
  bulb_pop: (c) => buf(c, 0.5, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = noise() * Math.exp(-t * 30) + Math.sin(2 * Math.PI * 3000 * t) * Math.exp(-t * 60) * 0.3; } norm(d, 0.8); }),
  tinnitus: (c) => buf(c, 4, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(2 * Math.PI * 7200 * t) * Math.exp(-t * 0.9) * Math.min(1, t * 20); } norm(d, 0.25); }),
  sub_hit: (c) => buf(c, 2.5, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(2 * Math.PI * (38 - t * 8) * t) * Math.exp(-t * 1.6) * Math.min(1, t * 200); } norm(d, 0.95); }),
  swell: (c) => buf(c, 4, (d, sr, ch) => {
    // reverse-cymbal-like noise swell into a hit
    for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = noise() * Math.pow(t / 4, 3); }
    let hp = 0; for (let i = 0; i < d.length; i++) { const x = d[i]; hp = x - hp * 0.9; d[i] = hp; }
    norm(d, 0.6);
  }, 2),
};
SYNTH.step_4 = SYNTH.step_1; SYNTH.step_5 = SYNTH.step_2; SYNTH.step_6 = SYNTH.step_3;
SYNTH.pstep_3 = SYNTH.pstep_1; SYNTH.pstep_4 = SYNTH.pstep_2;
SYNTH.whisper_2 = SYNTH.whisper_1; SYNTH.whisper_3 = SYNTH.whisper_1; SYNTH.stinger_2 = SYNTH.stinger_1;
