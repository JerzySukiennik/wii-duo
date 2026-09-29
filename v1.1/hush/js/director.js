// The director decides when you are afraid. It runs a tension cycle
//   calm → build → hunt → relax → calm …
// fires scare events that fit the moment (where you are, what you're looking at, whether
// your light is on), converts entity proximity into fear, and drives the heartbeat, the
// breathing, the drone and the post-process.
import * as THREE from 'three';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class Director {
  constructor(G) {
    this.G = G;
    this.fear = 0; this.spikeV = 0; this.tension = 0;
    this.active = false;
    this.cycle = { name: 'calm', t: 0, dur: 30 };
    this.cool = {}; this.t = 0;
    this.nextAmb = 7; this.nextBig = 14;
    this.flags = { firsts: {} };
    this.loops = {};
    this.micT = 0;
    this.heartPhase = 0;
    this.phoneRinging = null;
    this.tvEvent = null; this.mirrorEvent = null; this.revealEvent = null; this.musicBox = null; this.breathEar = null;
    this.horse = { t: 0 }; this.swing = { t: 0, amp: 0 }; this.curtain = { v: 0, target: 0 };
    this.doll = { turned: false };
    this._buildEvents();
  }

  get A() { return this.G.entity.aggression; }

  startAmbience() {
    const a = this.G.audio;
    this.loops.rain = a.play('amb_rain', { loop: true, bus: 'amb', gain: 0.5, fadeIn: 3 });
    this.loops.wind = a.play('amb_wind', { loop: true, bus: 'amb', gain: 0.28, fadeIn: 4 });
    this.loops.house = a.play('amb_house', { loop: true, bus: 'amb', gain: 0.4, fadeIn: 4 });
    this.loops.drone = a.play('drone_dread', { loop: true, bus: 'music', gain: 0.0, fadeIn: 6 });
    this.loops.clock = a.play('clock_tick', { loop: true, pos: this.G.house.clockPos, gain: 0.55, ref: 0.8, rolloff: 1.8 });
    this.loops.pbreath = a.play('player_breath_scared', { loop: true, bus: 'voice', gain: 0 });
  }

  spike(v) { this.spikeV = Math.max(this.spikeV, v); }
  firstTime(k) { if (this.flags.firsts[k]) return false; this.flags.firsts[k] = true; return true; }
  ready(id) { return (this.cool[id] ?? 0) <= this.t; }
  used(id, cd) { this.cool[id] = this.t + cd; }

  // ------------------------------------------------ helpers
  get P() { return this.G.player; }
  get E() { return this.G.entity; }
  get H() { return this.G.house; }
  room() { return this.H.roomAt(this.P.pos.x, this.P.pos.z)?.id; }
  looking(p, thr = 0.8) {
    const e = this.P.eye, f = this.P.forward(_v);
    const d = _w.set(p.x - e.x, p.y - e.y, p.z - e.z).normalize();
    return f.dot(d) > thr;
  }
  losTo(p) { const e = this.P.eye; return !this.H.losBlocked(e.x, e.z, p.x, p.z, 1.4); }
  dist(p) { return Math.hypot(p.x - this.P.pos.x, p.z - this.P.pos.z); }
  behind(d) { const f = this.P.forward(_v); f.y = 0; f.normalize(); return new THREE.Vector3(this.P.pos.x - f.x * d, this.P.floorY, this.P.pos.z - f.z * d); }
  // a walkable point in front of the player within [a,b] metres with line of sight
  pointAhead(a, b, spread = 0.35) {
    const f = this.P.forward(_v); f.y = 0; f.normalize();
    for (let k = 0; k < 24; k++) {
      const ang = Math.atan2(f.x, f.z) + rnd(-spread, spread), d = rnd(a, b);
      const x = this.P.pos.x + Math.sin(ang) * d, z = this.P.pos.z + Math.cos(ang) * d;
      if (!this.H.walkableAt(x, z)) continue;
      if (!this.losTo({ x, z })) continue;
      if (Math.abs(this.H.floorAt(x, z) - this.P.floorY) > 0.4) continue;
      return new THREE.Vector3(x, this.H.floorAt(x, z), z);
    }
    return null;
  }
  // a point far from the player, out of sight
  spawnFar(minD = 10) {
    const rooms = this.H.rooms.filter(r => r.id !== 'stairs');
    let best = null, bd = -1;
    for (let k = 0; k < 30; k++) {
      const p = this.H.randomPointIn(pick(rooms).id);
      const d = this.dist(p) + Math.abs(p.y - this.P.floorY) * 3;
      if (d < minD) continue;
      if (this.losTo(p)) continue;
      if (d > bd) { bd = d; best = p; }
      if (d > minD + 4) break;
    }
    return best || this.H.randomPointIn('basement');
  }
  yawTo(from, to) { return Math.atan2(to.x - from.x, to.z - from.z); }

  // ------------------------------------------------ events
  _buildEvents() {
    const G = this.G;
    const a = () => G.audio;
    this.ambient = [
      { id: 'distantSteps', w: 3, cd: 28, run: () => {
        const r = this.H.rooms.filter(r => r.id !== this.room() && r.id !== 'stairs').map(r => this.H.randomPointIn(r.id))
          .filter(p => { const d = this.dist(p); return d > 6 && d < 16; });
        if (!r.length) return false;
        const A0 = pick(r), B = A0.clone().add(new THREE.Vector3(rnd(-3, 3), 0, rnd(-3, 3)));
        const n = 5 + (Math.random() * 6 | 0), stopAt = Math.random() < 0.4 ? n - 2 : n;
        for (let i = 0; i < stopAt; i++) {
          const p = A0.clone().lerp(B, i / n);
          a().play(a().variant('step', 6), { pos: p, gain: 0.9, delay: i * rnd(0.55, 0.7), rate: rnd(0.8, 0.9) });
        }
      } },
      { id: 'doorCreak', w: 2.5, cd: 35, run: () => {
        const ds = this.H.doors.filter(d => !d.front && d.open < 0.05 && this.dist(d.center) > 2.5 && this.dist(d.center) < 11);
        if (!ds.length) return false;
        const inView = ds.filter(d => this.looking(d.center, 0.6) && this.losTo(d.center));
        const d = inView.length ? pick(inView) : pick(ds);
        d.target = rnd(0.35, 0.7); d.speed = 0.22;
        a().play(Math.random() < 0.5 ? 'door_creak_1' : 'door_creak_2', { pos: d.center.clone(), gain: 0.75, rate: 0.8 });
        if (inView.length) this.spike(0.35);
      } },
      { id: 'doorSlam', w: 1.3, cd: 70, cond: () => this.cycle.name === 'build' || this.A > 0.45, run: () => {
        const ds = this.H.doors.filter(d => !d.front && d.open > 0.5 && this.dist(d.center) < 10 && !this.looking(d.center, 0.3));
        if (!ds.length) return false;
        const d = pick(ds); d.target = 0; d.speed = 7;
        setTimeout(() => { a().play('door_slam', { pos: d.center.clone(), gain: 1.1 }); this.P.shake = 0.5; this.spike(0.7); }, 120);
      } },
      { id: 'knock', w: 2, cd: 50, run: () => {
        const ds = this.H.doors.filter(d => !d.front && d.open < 0.05 && this.dist(d.center) > 1.2 && this.dist(d.center) < 7);
        if (!ds.length) return false;
        const d = pick(ds);
        a().play('knock_3', { pos: d.center.clone(), gain: 1.0, reverb: 0.4 });
        this.flags.knock = { door: d, t: this.t };
        this.spike(0.4);
      } },
      { id: 'whisper', w: 2, cd: 32, run: () => {
        a().play(a().variant('whisper', 3), { pan: Math.random() < 0.5 ? -0.9 : 0.9, gain: 0.32, bus: 'voice', reverb: 0 });
        this.spike(0.3);
      } },
      { id: 'scratch', w: 1.5, cd: 45, run: () => {
        const f = this.P.forward(_v); const side = Math.random() < 0.5 ? 1 : -1;
        const p = new THREE.Vector3(this.P.pos.x + f.z * side * 1.6, this.P.floorY + 0.9, this.P.pos.z - f.x * side * 1.6);
        a().play('scratch', { pos: p, gain: 0.7 });
      } },
      { id: 'objectFall', w: 1.4, cd: 60, run: () => {
        const s = this.H.pickupSpots.filter(s => { const d = this.dist(s.pos); return d > 4 && d < 11; });
        if (!s.length) return false;
        a().play('object_fall', { pos: pick(s).pos.clone(), gain: 1 });
        this.spike(0.35);
      } },
      { id: 'childLaugh', w: 1, cd: 110, cond: () => this.room() !== 'kid' && this.dist(this.H.musicBoxPos) > 5 && this.dist(this.H.musicBoxPos) < 18, run: () => {
        a().play('child_laugh', { pos: this.H.musicBoxPos.clone(), gain: 0.6, rate: 0.92 });
      } },
      { id: 'musicBox', w: 1.2, cd: 140, cond: () => this.room() !== 'kid' && !this.musicBox && this.dist(this.H.musicBoxPos) < 16, run: () => {
        this.musicBox = { v: a().play('music_box', { pos: this.H.musicBoxPos.clone(), loop: true, gain: 0.75, rate: 0.8 }), t: 0 };
      } },
      { id: 'horse', w: 2, cd: 60, cond: () => this.dist(this.H.horse.position) < 7, run: () => { this.horse.t = 7; } },
      { id: 'dollTurn', w: 4, cd: 30, cond: () => this.room() === 'kid' && !this.looking(this.H.doll.root.position, 0.5), run: () => { this.doll.turned = true; } },
      { id: 'piano', w: 1.3, cd: 80, cond: () => ['living', 'kitchen', 'hall', 'foyer'].includes(this.room()) && !this.looking(this.H.pianoPos, 0.5), run: () => {
        a().play(Math.random() < 0.7 ? 'piano_low' : 'piano_high', { pos: this.H.pianoPos.clone(), gain: 0.9 });
        this.spike(0.35);
      } },
      { id: 'chime', w: 0.6, cd: 220, run: () => { a().play('clock_chime', { pos: this.H.clockPos.clone(), gain: 0.9, ref: 2 }); } },
      { id: 'crying', w: 0.8, cd: 130, cond: () => this.room() !== 'laundry' && !this.H.inBasement(this.P.pos.x), run: () => {
        a().play('crying', { pos: new THREE.Vector3(28, -3.2 + 1.2, 12), gain: 0.9 });
      } },
      { id: 'swing', w: 1.2, cd: 100, cond: () => ['kid', 'study', 'master'].includes(this.room()), run: () => { this.swing.amp = 0.5; } },
      { id: 'curtain', w: 4, cd: 70, cond: () => this.room() === 'bath' && this.dist(this.H.curtain.position) < 3.5, run: () => {
        this.curtain.target = 1; this.curtain.hold = 2.5;
        a().play(a().variant('creak', 3), { pos: this.H.curtain.position.clone(), gain: 0.5 });
      } },
    ];

    this.big = [
      { id: 'hallGlimpse', w: 3, cd: 60, cond: () => this.room() === 'hall' && Math.abs(this.P.forward(_v).x) > 0.8, run: () => {
        const dir = Math.sign(this.P.forward(_v).x);
        const x = clamp(this.P.pos.x + dir * rnd(10, 15), 1.2, 18.8);
        if (Math.abs(x - this.P.pos.x) < 7) return false;
        return this.glimpseAt(new THREE.Vector3(x, 0, 6.0), { near: 5 });
      } },
      { id: 'doorwayGlimpse', w: 2.5, cd: 50, run: () => {
        const ds = this.H.doors.filter(d => !d.front && d.open > 0.6 && this.dist(d.center) > 5 && this.dist(d.center) < 13 && this.looking(d.center, 0.75) && this.losTo(d.center));
        if (!ds.length) return false;
        const d = pick(ds);
        // stand just beyond the doorway, on the far side
        const nx = d.o.line === 'z' ? 0 : 1, nz = d.o.line === 'z' ? 1 : 0;
        const side = Math.sign((d.center.x - this.P.pos.x) * nx + (d.center.z - this.P.pos.z) * nz) || 1;
        const p = new THREE.Vector3(d.center.x + nx * side * 0.9, 0, d.center.z + nz * side * 0.9);
        return this.glimpseAt(p, { near: 4 });
      } },
      { id: 'runAcross', w: 2, cd: 90, cond: () => this.room() === 'hall', run: () => {
        const lanes = [
          { from: new THREE.Vector3(8.75, 0, 3.4), to: new THREE.Vector3(10.2, 0, 9.2), door: 'd_bath' },
          { from: new THREE.Vector3(18.05, 0, 3.4), to: new THREE.Vector3(16.5, 0, 8.8), door: 'd_study' },
          { from: new THREE.Vector3(3.45, 0, 3.4), to: new THREE.Vector3(2.65, 0, 9.0), door: 'd_master', door2: 'd_kitchen' },
        ].filter(l => { const mid = new THREE.Vector3((l.from.x + l.to.x) / 2, 1.2, 6); return this.dist(mid) > 6 && this.looking(mid, 0.8); });
        if (!lanes.length || this.E.state !== 'hidden') return false;
        const l = pick(lanes);
        for (const id of [l.door, l.door2]) { const d = this.H.doors.find(d => d.id === id); if (d) { d.target = 1; d.speed = 8; d.setOpen(1); } }
        this.E.spawnAt(l.from, this.yawTo(l.from, l.to), 'scripted');
        const path = this.H.findPath(l.from.x, l.from.z, l.to.x, l.to.z) || [l.from, l.to];
        let i = 1;
        this.E.scriptFn = (dt, E) => {
          const wp = path[i]; if (!wp) { E.hide(); return; }
          const dx = wp.x - E.pos.x, dz = wp.z - E.pos.z, d = Math.hypot(dx, dz);
          if (d < 0.3) { i++; return; }
          E.speed = 5.2; E.mode = 'run';
          E.pos.x += dx / d * Math.min(d, 5.2 * dt); E.pos.z += dz / d * Math.min(d, 5.2 * dt);
          E.yaw = Math.atan2(dx, dz);
        };
        this.spike(0.8);
      } },
      { id: 'stalk', w: 3, cd: 70, cond: () => this.E.state === 'hidden', run: () => {
        const p = this.behind(rnd(8, 11));
        const w = this.H.nearestWalkablePoint(p.x, p.z);
        if (!w || this.losTo(w) && this.looking(w, 0.3)) return false;
        this.E.spawnAt(w, this.yawTo(w, this.P.pos), 'stalk');
        this.E.stalkData = { t: 0, dur: rnd(25, 40) };
      } },
      { id: 'reveal', w: 2.5, cd: 100, cond: () => this.E.state === 'hidden' && !this.revealEvent, run: () => {
        const p = this.pointAhead(3.5, 6.5, 0.45);
        if (!p) return false;
        this.revealAt(p, 'random');
      } },
      { id: 'windowFace', w: 4, cd: 90, cond: () => this.E.state === 'hidden' && this.nearWindow(), run: () => {
        const w = this.nearWindow();
        const p = w.center.clone().addScaledVector(w.outN, 0.75);
        p.y = w.center.y - 2.05;
        this.E.spawnAt(p, this.yawTo(p, this.P.pos), 'scripted');
        this.E.pos.y = p.y;
        const t0 = this.t;
        let banged = false;
        this.E.scriptFn = (dt, E) => {
          E.mode = 'lurk'; E.speed = 0; E.lookAt = this.P.eye.clone();
          const age = this.t - t0;
          if (!banged && (E.lit > 0.25 || age > 1.2) && Math.random() < 0.5 + this.A * 0.4) {
            banged = true;
            G.audio.play('glass_bang', { pos: w.center.clone(), gain: 1.3 }); this.P.shake = 0.6; this.spike(1);
          }
          if (age > 2.2 || (banged && age > 1.4)) E.vanish(this.P, 0.14);
        };
        this.G.weather.strike({ big: true, delay: 0.3 });
        this.spike(0.5);
      } },
      { id: 'tv', w: 3.5, cd: 150, cond: () => !this.tvEvent && this.room() === 'living' && this.dist(this.H.tv.pos) > 2.5, run: () => this.tvOn() },
      { id: 'mirror', w: 6, cd: 80, cond: () => !this.mirrorEvent && this.room() === 'bath' && this.dist(this.H.mirror.position) < 2.8 && this.looking(this.H.mirror.position, 0.75), run: () => {
        const f = this.P.forward(_v); f.y = 0; f.normalize();
        const p = new THREE.Vector3(this.P.pos.x - f.x * 0.95, this.P.floorY, this.P.pos.z - f.z * 0.95);
        this.E.showPhantom(p, this.yawTo(p, this.P.pos), this.P.eye.clone());
        this.mirrorEvent = { yaw0: this.P.yaw, t: 0, p };
      } },
      { id: 'phone', w: 2, cd: 200, cond: () => !this.phoneRinging && this.room() !== 'kitchen' && this.dist(this.H.phone.pos) < 16, run: () => {
        this.phoneRinging = { v: G.audio.play('phone_ring', { pos: this.H.phone.pos.clone(), loop: true, gain: 1, ref: 1.6 }), t: 0 };
      } },
      { id: 'flashDie', w: 2, cd: 160, cond: () => this.P.fl.on && this.P.fl.battery > 0.15 && this.E.state === 'hidden', run: () => this.flashDie() },
      { id: 'breathEar', w: 1.6, cd: 80, cond: () => !this.breathEar && this.E.state === 'hidden', run: () => {
        const p = this.behind(0.55); p.y = this.P.eye.y + 0.1;
        this.breathEar = { v: G.audio.play('monster_breath', { pos: p, loop: true, gain: 1.1, ref: 0.5, reverb: 0.05 }), yaw0: this.P.yaw, t: 0 };
        this.spike(0.6);
      } },
    ];
  }

  // the entity exists only while lightning lights the sky
  revealAt(p, second = 'random') {
    this.revealEvent = { p, stage: 0, t: 0, second };
    this.G.weather.strike({ big: true, delay: 0.6 });
    this.E.spawnAt(p, this.yawTo(p, this.P.pos), 'scripted');
    this.E.scriptFn = (dt, E) => { E.mode = 'lurk'; E.speed = 0; E.lookAt = this.P.eye.clone(); };
    this.E.root.visible = false;
  }

  nearWindow() {
    for (const w of this.H.windows) {
      if (!w.light) continue;
      const d = Math.hypot(w.center.x - this.P.pos.x, w.center.z - this.P.pos.z);
      if (d < 4.2 && d > 1.2 && this.looking(w.center, 0.82)) return w;
    }
    return null;
  }

  glimpseAt(p, opts = {}) {
    if (this.E.state !== 'hidden') return false;
    const w = this.H.nearestWalkablePoint(p.x, p.z);
    if (!w) return false;
    this.E.spawnAt(w, this.yawTo(w, this.P.pos), 'glimpse');
    this.E.glimpse = { hold: opts.hold ?? 0.45, maxT: opts.maxT ?? 12, near: opts.near ?? 3.5, onEnd: (seen) => { if (seen) { this.spike(0.85); if (Math.random() < 0.5) this.G.audio.play('sub_hit', { gain: 0.8, bus: 'music' }); } opts.onEnd?.(seen); } };
    this.E.looked = 0;
    return true;
  }

  tvOn() {
    const tv = this.H.tv;
    tv.on = true; tv.mat.uniforms.uOn.value = 1; tv.mat.uniforms.uFeed.value = 0;
    this.tvEvent = { t: 0, stage: 0, v: this.G.audio.play('tv_static', { pos: tv.pos.clone(), loop: true, gain: 0.9 }) };
    this.spike(0.5);
  }
  tvOff(pop = true) {
    const tv = this.H.tv;
    tv.on = false; tv.mat.uniforms.uOn.value = 0; tv.light.intensity = 0;
    this.tvEvent?.v?.stop(0.02); this.tvEvent = null;
    this.E.hidePhantom();
    if (pop) this.G.audio.play('switch_click', { pos: tv.pos.clone(), gain: 0.8 });
  }

  flashDie() {
    const P = this.P, a = this.G.audio;
    P.fl.dead = true; P.fl.deadPresses = 0; P.fl.deadNeed = 4 + Math.round(this.A * 3);
    a.play('switch_click', { gain: 0.5 });
    if (this.firstTime('shake')) this.G.ui.caption('It died. Press F to shake it.', 4);
    const ahead = this.pointAhead(1.6, 2.4, 0.2);
    setTimeout(() => {
      if (!P.fl.dead) return;
      const p = ahead ? ahead.clone().setY(P.eye.y) : this.behind(-1.5).setY(P.eye.y);
      this.flags.darkBreath = a.play('monster_breath', { pos: p, loop: true, gain: 1, ref: 0.8 });
      a.play('bones_crack', { pos: p, gain: 0.8 });
      this.spike(0.8);
    }, 1400);
    P.onRevive = () => {
      this.flags.darkBreath?.stop(0.1); this.flags.darkBreath = null;
      P.onRevive = null;
      if (ahead && Math.random() < 0.5 + this.A * 0.3 && this.E.state === 'hidden') {
        this.E.spawnAt(ahead, this.yawTo(ahead, P.pos), 'glimpse');
        this.E.glimpse = { hold: 0.25, maxT: 0.45, near: 0.5, onEnd: () => {} };
        this.E.looked = 0;
        a.play(Math.random() < 0.5 ? 'stinger_1' : 'stinger_2', { gain: 1, bus: 'scare' });
        this.spike(1); P.shake = 0.7;
      }
    };
  }

  answerPhone() {
    const pr = this.phoneRinging; if (!pr) return;
    pr.v?.stop(0.02); this.phoneRinging = null;
    const a = this.G.audio;
    a.play('phone_pickup', { gain: 0.8 });
    const tel = { type: 'bandpass', freq: 1500, Q: 1.3 };
    const b = a.play('monster_breath', { gain: 0.7, bus: 'voice', filter: tel, loop: true, fadeIn: 0.5 });
    this.P.locked = true;
    setTimeout(() => { a.play('whisper_2', { gain: 0.8, bus: 'voice', filter: tel }); }, 2600);
    setTimeout(() => { a.say('I can see you.', { rate: 0.5 }); }, 4200);
    setTimeout(() => {
      b?.stop(0.05);
      a.play('phone_pickup', { gain: 0.6, rate: 0.8 });
      this.P.locked = false;
      // then a knock right behind you
      const p = this.behind(1.2); p.y = this.P.eye.y - 0.3;
      a.play('knock_3', { pos: p, gain: 1.1 });
      this.spike(0.9);
      this.G.ui.caption('', 0);
    }, 7000);
    this.used('phone', 240);
  }

  // ------------------------------------------------ cycle
  setCycle(name) {
    const A = this.A;
    const durs = { calm: rnd(26, 40) * (1.1 - A * 0.5), build: rnd(24, 36), hunt: rnd(40, 70) * (0.75 + A * 0.5), relax: rnd(14, 22) };
    this.cycle = { name, t: 0, dur: durs[name] };
    if (name === 'hunt') this.beginHunt();
    if (name === 'relax' && this.E.state !== 'hidden' && this.E.state !== 'chase' && this.E.state !== 'search') this.E.leave();
    this.nextBig = rnd(4, 9);
  }

  beginHunt(at = null) {
    const E = this.E, P = this.P, H = this.H;
    if (E.state !== 'hidden') E.hide();
    let sp;
    if (at) sp = at;
    else if (!H.inBasement(P.pos.x) && P.pos.x < 17 && Math.random() < 0.5) sp = H.randomPointIn('basement');
    else sp = this.spawnFar(11);
    E.spawnAt(sp, 0, 'roam');
    E.idleT = 0;
    E.roamTarget = () => {
      if (Math.random() < 0.55 + this.A * 0.25) {
        // drift toward where you are
        const r = H.roomAt(P.pos.x, P.pos.z);
        if (r && r.id !== 'stairs') return H.randomPointIn(r.id);
      }
      return H.randomPointIn(pick(H.rooms.filter(r => r.id !== 'stairs')).id);
    };
    // it announces itself
    if (H.inBasement(sp.x) && !H.inBasement(P.pos.x)) {
      const d = H.doors.find(d => d.id === 'd_basement');
      if (d && d.open < 0.3) { this.G.audio.play('door_creak_2', { pos: d.center.clone(), gain: 1, delay: 3 }); }
    } else this.G.audio.play('growl', { pos: sp.clone().setY(sp.y + 2), gain: 0.7 });
  }

  // ------------------------------------------------ per frame
  update(dt) {
    const G = this.G, P = this.P, E = this.E, H = this.H, a = G.audio;
    this.t += dt;

    // noises → entity
    for (const n of P.noises) E.hear(n, P);
    P.noises.length = 0;
    // microphone
    this.micT -= dt;
    if (a.mic.enabled && a.mic.level > 0.2 && this.micT <= 0) {
      this.micT = 0.25;
      const n = { pos: P.pos.clone().setY(P.floorY), radius: 4 + a.mic.level * 18, kind: 'mic' };
      const heard = E.hear(n, P);
      if (heard && this.firstTime('micHeard')) G.ui.caption('It heard that.', 3);
      if (!heard && E.state === 'hidden' && this.active && a.mic.level > 0.55 && this.cycle.name !== 'hunt') {
        // loud enough to call it
        if (this.firstTime('micCalled')) G.ui.caption('It heard you.', 3);
        this.cycle = { name: 'hunt', t: 0, dur: rnd(35, 50) };
        this.beginHunt(this.spawnFar(8));
        E._investigate(n.pos);
      }
    }

    // ------------------------------------------------ fear
    let prox = 0;
    if (E.root.visible && E.state !== 'hidden') {
      prox = clamp(1 - E.dist / 12) * (E.los ? 1 : 0.5);
      if (E.inView) prox = Math.max(prox, 0.55 * clamp(1 - E.dist / 22));
    }
    if (E.state === 'chase') prox = 1;
    const dark = P.fl.level < 0.3 && P.hasLight ? 0.1 : 0;
    const target = Math.max(prox, this.spikeV) + dark + (P.hiding && E.state === 'search' ? 0.3 : 0);
    this.fear += (target - this.fear) * Math.min(1, dt * (target > this.fear ? 3 : 0.13));
    this.spikeV = Math.max(0, this.spikeV - dt * 0.3);
    this.tension += ((E.state === 'hidden' ? 0 : E.state === 'chase' ? 1 : 0.5) - this.tension) * Math.min(1, dt * 0.5);
    const fear = clamp(this.fear);

    const bpm = 60 + fear * 88 + (P.sprinting ? 16 : 0) + (P.holding ? 10 : 0);
    a.setHeart(bpm, 0.08 + fear * 0.9 + (P.holding ? 0.25 : 0));
    this.heartPhase += dt * bpm / 60;
    const pulse = Math.pow(Math.max(0, Math.sin(this.heartPhase * Math.PI * 2)), 12) * fear;
    if (this.loops.pbreath) {
      const bg = P.holding ? 0 : clamp(fear * 0.45 + (P.exhausted ? 0.55 : P.stamina < 0.5 ? (0.5 - P.stamina) * 0.6 : 0));
      this.loops.pbreath.setGain(bg, 0.35);
      this.loops.pbreath.setRate(0.9 + fear * 0.25, 0.5);
    }
    this.loops.drone?.setGain(0.1 + this.tension * 0.55 + fear * 0.15, 1.2);
    a.muffle(P.holding ? 0.45 : P.hiding ? 0.22 : 0);
    // post
    const pu = G.post.u;
    pu.uFear.value = fear * 0.85;
    pu.uPulse.value = pulse;
    let stat = 0;
    if (E.root.visible && E.state !== 'hidden' && E.los) stat = clamp(1 - E.dist / 7) * (E.inView ? 0.9 : 0.35);
    pu.uStatic.value += (stat - pu.uStatic.value) * Math.min(1, dt * 6);
    // flashlight gets nervous near it
    P.fl.flicker = E.root.visible && E.state !== 'hidden' ? clamp(1 - E.dist / 8) * 0.9 : 0.015;
    P.fearSlow = this.cycle.name === 'hunt' && fear > 0.9 ? 0.96 : 1;

    // ------------------------------------------------ running event state
    this._events(dt);

    // ------------------------------------------------ cycle
    if (!this.active) {
      if (this.ambientOnly) {
        this.nextAmb -= dt;
        if (this.nextAmb <= 0) { this.nextAmb = rnd(14, 24); this.fire(this.ambient.filter(e => !['doorSlam', 'knock'].includes(e.id))); }
      }
      return;
    }
    const c = this.cycle;
    c.t += dt;
    if (c.name === 'hunt' && (E.state === 'chase' || E.state === 'search' || E.state === 'investigate')) c.t = Math.min(c.t, c.dur - 5);
    if (c.t > c.dur) {
      const next = { calm: 'build', build: 'hunt', hunt: 'relax', relax: 'calm' }[c.name];
      this.setCycle(next);
    }
    if (c.name === 'relax') return;
    // ambient
    this.nextAmb -= dt;
    if (this.nextAmb <= 0) {
      this.nextAmb = rnd(7, 15) * (1.1 - this.A * 0.4);
      this.fire(this.ambient);
    }
    if (c.name === 'build' || (c.name === 'calm' && this.A > 0.6)) {
      this.nextBig -= dt;
      if (this.nextBig <= 0) {
        this.nextBig = rnd(9, 15) * (1.1 - this.A * 0.3);
        if (!this.fire(this.big)) this.nextBig = 2.5;
      }
    }
  }

  fire(list) {
    const ok = list.filter(e => this.ready(e.id) && (!e.cond || e.cond()));
    let tot = ok.reduce((s, e) => s + e.w * (e.id === 'reveal' && this.P.fl.level < 0.3 ? 2 : 1), 0);
    while (ok.length) {
      let r = Math.random() * tot, e = ok[0];
      for (const x of ok) { r -= x.w; if (r <= 0) { e = x; break; } }
      const res = e.run();
      if (res !== false) { this.used(e.id, e.cd); return e.id; }
      ok.splice(ok.indexOf(e), 1); tot -= e.w;
    }
    return null;
  }

  // things that play out over several frames
  _events(dt) {
    const G = this.G, P = this.P, E = this.E, H = this.H, a = G.audio;
    // music box stops the moment you step into the room
    if (this.musicBox) {
      this.musicBox.t += dt;
      if (this.room() === 'kid' || this.musicBox.t > 38) { this.musicBox.v?.stop(0.01); this.musicBox = null; if (this.room() === 'kid') this.spike(0.5); }
    }
    // rocking horse
    if (this.horse.t > 0) {
      this.horse.t -= dt;
      const k = Math.min(1, this.horse.t / 2);
      H.horse.rotation.z = Math.sin(this.t * 3.2) * 0.14 * k;
      if (Math.abs(Math.sin(this.t * 3.2)) > 0.995 && Math.random() < 0.5) a.play('creak_3', { pos: H.horse.position.clone(), gain: 0.35, rate: 1.4 });
    } else H.horse.rotation.z *= 0.9;
    // doll: once turned, it keeps facing you
    if (this.doll.turned) {
      const d = H.doll;
      const hp = d.head.getWorldPosition(_v);
      const want = Math.atan2(P.pos.x - hp.x, P.pos.z - hp.z) - d.root.rotation.y;
      d.head.rotation.y += (Math.atan2(Math.sin(want - d.head.rotation.y), Math.cos(want - d.head.rotation.y))) * Math.min(1, dt * (this.looking(hp, 0.9) ? 0 : 6));
    }
    // swing
    if (this.swing.amp > 0.01) { this.swing.amp *= Math.pow(0.97, dt * 10); H.swing.rotation.x = Math.sin(this.t * 1.9) * this.swing.amp; }
    // shower curtain bulge
    const cu = this.curtain;
    if (cu.target > 0) { cu.hold = (cu.hold ?? 0) - dt; if (cu.hold <= 0 || (E.lit > 0) || (this.looking(H.curtain.position, 0.93) && P.fl.level > 0.5 && cu.v > 0.6)) cu.target = 0; }
    cu.v += (cu.target - cu.v) * Math.min(1, dt * (cu.target ? 1.2 : 5));
    H.curtain.userData.update(this.t, 0.1, cu.v > 0.01 ? { x: -0.2, y: 0.25, amount: cu.v * 0.28 } : null);
    // curtains near the big window breathe with the draft
    for (const c of H.curtains) c.userData.update(this.t + c.position.x, 0.25 + G.weather.flash, null);
    // knock follow-up: opening the door you heard knocking
    if (this.flags.knock) {
      const k = this.flags.knock;
      if (this.t - k.t > 14) this.flags.knock = null;
      else if (k.door.open > 0.4 && k.door.openedByPlayer && E.state === 'hidden') {
        this.flags.knock = null;
        if (Math.random() < 0.4 + this.A * 0.3) {
          const d = k.door, nx = d.o.line === 'z' ? 0 : 1, nz = d.o.line === 'z' ? 1 : 0;
          const side = -Math.sign((P.pos.x - d.center.x) * nx + (P.pos.z - d.center.z) * nz) || 1;
          const p = new THREE.Vector3(d.center.x + nx * side * 1.0, 0, d.center.z + nz * side * 1.0);
          if (this.glimpseAt(p, { hold: 0.2, maxT: 0.8, near: 0.6 })) {
            a.play('stinger_2', { gain: 1.1, bus: 'scare' }); P.shake = 0.8; this.spike(1);
          }
        }
      }
    }
    // breath in your ear: stops the moment you turn around
    if (this.breathEar) {
      const b = this.breathEar; b.t += dt;
      let dy = P.yaw - b.yaw0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      if (Math.abs(dy) > 1.6 || b.t > 4) { b.v?.stop(Math.abs(dy) > 1.6 ? 0.02 : 0.8); this.breathEar = null; }
    }
    // lightning reveal: the entity only exists while the sky is lit
    if (this.revealEvent) {
      const r = this.revealEvent; r.t += dt;
      const lit = G.weather.flash > 0.25;
      if (E.state === 'scripted') E.root.visible = lit;
      if (lit && !r.seen) { r.seen = true; this.spike(0.9); }
      if (r.stage === 0 && r.t > 1.4) {
        r.stage = 1;
        // second strike: closer, or gone
        const closer = r.second !== 'gone' ? this.pointAhead(1.4, 2.2, 0.25) : null;
        if (closer && (r.second === 'closer' || Math.random() < 0.6)) { E.pos.copy(closer); E.yaw = this.yawTo(closer, P.pos); }
        else E.pos.set(0, -50, 0);
        G.weather.strike({ big: false, delay: 0.2 });
      }
      if (r.stage === 1 && r.t > 2.6) { this.revealEvent = null; E.hide(); }
    }
    // TV
    if (this.tvEvent) {
      const tv = this.tvEvent; tv.t += dt;
      H.tv.light.intensity = 1.2 + Math.random() * 0.8;
      if (tv.stage === 0 && tv.t > 2.2 && this.room() === 'living') {
        tv.stage = 1; H.tv.mat.uniforms.uFeed.value = 1;
        tv.v?.setGain(0.35);
        const toTv = _v.set(H.tv.pos.x - P.pos.x, 0, H.tv.pos.z - P.pos.z).normalize();
        const p = new THREE.Vector3(P.pos.x - toTv.x * 1.1, P.floorY, P.pos.z - toTv.z * 1.1);
        E.showPhantom(p, this.yawTo(p, P.pos), P.eye.clone());
        tv.yaw0 = P.yaw;
      }
      if (tv.stage === 1) {
        E.updatePhantom(dt, P.eye.clone(), tv.t > 7 ? 'reach' : 'lurk');
        let dy = P.yaw - tv.yaw0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        if (Math.abs(dy) > 1.7) { this.tvOff(false); a.play('sub_hit', { gain: 1, bus: 'music' }); this.spike(1); P.shake = 0.4; }
        else if (tv.t > 14) { this.tvOff(); }
      } else if (tv.t > 16) this.tvOff();
    }
    // mirror
    if (this.mirrorEvent) {
      const m = this.mirrorEvent; m.t += dt;
      E.updatePhantom(dt, P.eye.clone(), m.t > 3 ? 'reach' : 'lurk');
      let dy = P.yaw - m.yaw0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      if (Math.abs(dy) > 1.5 || this.room() !== 'bath' || m.t > 9) {
        E.hidePhantom(); this.mirrorEvent = null;
        if (Math.abs(dy) > 1.5) { a.play('sub_hit', { gain: 1, bus: 'music' }); this.spike(1); P.shake = 0.35; }
      }
    }
    // the sheet-covered shape in the basement is never where you left it
    const sh = H.shroud;
    if (sh) {
      const inB = H.inBasement(P.pos.x);
      if (inB) sh.away = 0; else sh.away = (sh.away || 0) + dt;
      if (sh.away > 15 && this.flags.basementVisited && !sh.moved) {
        sh.moved = true;
        sh.i = (sh.i + 1) % sh.spots.length;
        const [x, z] = sh.spots[sh.i];
        sh.mesh.position.x = x; sh.mesh.position.z = z;
        sh.mesh.rotation.y = Math.atan2(22 - x, 12.5 - z) + (Math.random() - 0.5) * 0.4; // turned toward the stairs
        Object.assign(sh.col, { x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 });
      }
      if (inB) { this.flags.basementVisited = true; sh.moved = false; }
    }
    // phone keeps ringing
    if (this.phoneRinging) { this.phoneRinging.t += dt; if (this.phoneRinging.t > 26) { this.phoneRinging.v?.stop(0.05); this.phoneRinging = null; } }
  }
}
