// The entity's brain. States:
//   hidden      not in the house
//   glimpse     placed somewhere, frozen; vanishes when you look at it too long or get close
//   stalk       follows you out of sight; freezes when watched; its steps stop when yours do
//   roam        walks room to room, opening doors, listening
//   investigate walks to a noise
//   search      sweeps an area and checks hiding spots, listening for your breath
//   chase       runs you down; loses you if you break line of sight long enough
//   leave       walks away, then hidden
//   scripted    positioned by the director
import * as THREE from 'three';
import { PHANTOM } from './house.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _h = new THREE.Vector3();

export class Entity {
  constructor(scene, house, audio, factory) {
    this.scene = scene; this.house = house; this.audio = audio;
    this.model = factory ? safeCreate(factory) : null;
    if (!this.model) this.model = fallbackModel();
    this.root = this.model.root;
    scene.add(this.root);
    this.phantom = factory ? safeCreate(factory) : null;
    if (!this.phantom) this.phantom = fallbackModel();
    this.phantom.setLayer(PHANTOM);
    this.phantom.root.visible = false;
    scene.add(this.phantom.root);

    this.pos = new THREE.Vector3(30, -3.2, 15); this.yaw = 0; this.speed = 0;
    this.state = 'hidden'; this.stateT = 0; this.mode = 'idle';
    this.path = null; this.pi = 0; this.goal = null; this.goalCb = null; this.moveSpeed = 1.3;
    this.awareness = 0; this.lastKnown = new THREE.Vector3(); this.lostT = 0; this.sawHide = null;
    this.aggression = 0.3;
    this.stepAcc = 0; this.stepSide = 1;
    this.breath = null; this.breathGain = 0;
    this.doorPause = 0; this.pendingDoor = null;
    this.repathT = 0; this.stuckT = 0; this._lastPos = new THREE.Vector3();
    this.looked = 0; this.watched = false; this.lit = 0; this.dist = 99; this.los = false;
    this.glimpse = null; this.searchData = null; this.stalkData = null;
    this.lookAt = null; this.twitch = 0.2;
    this.onCatch = null; this.onVanish = null; this.onLost = null; this.onSpotted = null;
    this.vanishT = 0;
    this.perceiveT = 0;
    this.listenDetect = 0;
    this.root.visible = false;
    this.hearingMul = 1;
  }

  get present() { return this.state !== 'hidden' && this.root.visible; }
  get head() { return _h.set(this.pos.x, this.pos.y + (this.mode === 'stoop' || this.mode === 'run' ? 1.95 : 2.25), this.pos.z); }

  setState(s, data = {}) {
    this.state = s; this.stateT = 0; this.path = null; this.goalCb = null;
    if (s === 'hidden') {
      this.root.visible = false; this.awareness = 0;
      if (this.breath) { this.breath.stop(0.4); this.breath = null; }
      this.breathGain = 0;
      return;
    }
    this.root.visible = true;
    Object.assign(this, data);
  }

  spawnAt(p, yaw = 0, state = 'roam') {
    this.pos.copy(p); this.pos.y = this.house.floorAt(p.x, p.z);
    this.yaw = yaw; this.speed = 0;
    this.setState(state);
    this.root.visible = true;
    this._syncModel(0);
  }

  hide() { this.setState('hidden'); this.glimpse = null; this.stalkData = null; this.searchData = null; }

  vanish(player, dark = 0.16) {
    // pop out of existence behind a flashlight stutter
    if (player && player.fl.on) { player.fl.forcedOff = true; setTimeout(() => { player.fl.forcedOff = false; }, dark * 1000); }
    this.vanishT = dark * 0.6;
    this.onVanish?.(this);
  }

  goTo(target, speed, cb) {
    this.goal = target.clone(); this.moveSpeed = speed; this.goalCb = cb || null;
    this.path = this.house.findPath(this.pos.x, this.pos.z, target.x, target.z);
    this.pi = 1;
    if (!this.path) { this.goalCb = null; cb?.(false); }
  }

  // ---------------------------------------------------------------- perception
  perceive(dt, P) {
    const H = this.house;
    const e = P.eye;
    const d = Math.hypot(e.x - this.pos.x, e.z - this.pos.z);
    this.dist = d;
    const headY = this.pos.y + 1.9;
    this.los = Math.abs(e.y - headY) < 3.5 && !H.losBlocked(this.pos.x, this.pos.z, e.x, e.z, Math.min(e.y, headY) + 0.1);
    // is the player looking at me / lighting me?
    const f = P.forward(_v);
    const to = _w.set(this.pos.x - e.x, (this.pos.y + 1.6) - e.y, this.pos.z - e.z);
    const dl = to.length(); to.divideScalar(dl);
    const dot = f.dot(to);
    this.inView = this.los && dot > Math.cos(0.62);
    this.watched = this.los && dot > Math.cos(0.2) && dl < 26;
    const aim = P._aim;
    const la = Math.acos(Math.min(1, Math.max(-1, aim.dot(to))));
    this.lit = (P.fl.level > 0.3 && this.los && la < 0.55) ? (1 - la / 0.55) * Math.max(0, 1 - dl / 24) : 0;

    if (this.state === 'hidden' || this.state === 'scripted' || this.state === 'glimpse') return;
    // sight
    if (P.hiding) return;
    const fwd = _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const dir = _w.set(e.x - this.pos.x, 0, e.z - this.pos.z).normalize();
    const inFov = fwd.dot(dir) > Math.cos(1.1) || d < 2.2;
    const lightOn = P.fl.level > 0.3;
    const range = (lightOn ? 17 : P.crouch > 0.5 ? 3.2 : 6.5) * (0.8 + this.aggression * 0.4);
    if (this.los && inFov && d < range) {
      const rate = (1.8 * (1 - d / range) + 0.5) * (lightOn ? 1.4 : 1) * (0.7 + this.aggression * 0.6);
      this.awareness += dt * rate;
      this.lastKnown.set(P.pos.x, P.floorY, P.pos.z);
      this.lostT = 0;
    } else {
      this.awareness = Math.max(0, this.awareness - dt * 0.12);
    }
  }

  hear(n, P) {
    if (this.state === 'hidden' || this.state === 'scripted' || this.state === 'glimpse' || this.state === 'catch') return false;
    const d = Math.hypot(n.pos.x - this.pos.x, n.pos.z - this.pos.z) + Math.abs(n.pos.y - this.pos.y) * 1.5;
    const walls = this.house.wallsBetween(this.pos.x, this.pos.z, n.pos.x, n.pos.z);
    const r = n.radius * this.hearingMul * (0.8 + this.aggression * 0.5) / (1 + walls * 0.55);
    if (d > r) return false;
    if (this.state === 'chase') return true;
    this.lastKnown.copy(n.pos);
    this.awareness = Math.max(this.awareness, 0.35 + (1 - d / r) * 0.4);
    if (this.state !== 'search' || d < r * 0.5) this._investigate(n.pos);
    return true;
  }

  _investigate(p) {
    this.setState('investigate');
    this.audio.play('growl', { pos: this.head.clone(), gain: 0.45, rate: 0.9 + Math.random() * 0.2 });
    this.goTo(p, 1.9 + this.aggression * 0.7, () => this._startSearch(p));
  }

  _startSearch(center, knownSpot = null) {
    this.setState('search');
    const H = this.house;
    const room = H.roomAt(center.x, center.z);
    const pts = [];
    const spots = H.hideSpots.filter(s => s.room === room?.id || s.front.distanceTo(center) < 4.5)
      .sort((a, b) => a.front.distanceTo(center) - b.front.distanceTo(center));
    if (knownSpot) spots.unshift(knownSpot);
    for (let i = 0; i < 3; i++) {
      const p = room ? H.randomPointIn(room.id) : center.clone();
      pts.push({ kind: 'look', p });
    }
    for (const s of spots.slice(0, 2)) pts.splice(Math.floor(Math.random() * (pts.length + 1)), 0, { kind: 'spot', spot: s, p: s.front });
    if (knownSpot) { pts.unshift({ kind: 'spot', spot: knownSpot, p: knownSpot.front, sure: true }); }
    this.searchData = { pts, i: 0, t: 0, listen: 0, dur: 18 + this.aggression * 10 };
    this._nextSearchPoint();
  }

  _nextSearchPoint() {
    const S = this.searchData;
    if (!S || S.i >= S.pts.length) { this.leave(); return; }
    const pt = S.pts[S.i++];
    S.cur = pt; S.listen = 0; S.arrived = false; S.pointT = 0;
    this.goTo(pt.p, 1.5 + this.aggression * 0.4, (ok) => { if (ok === false) this._nextSearchPoint(); else S.arrived = true; });
  }

  leave() {
    const H = this.house;
    const far = ['basement', 'study', 'master', 'kitchen', 'laundry'].map(id => H.randomPointIn(id))
      .sort((a, b) => b.distanceTo(this.pos) - a.distanceTo(this.pos))[0];
    this.setState('leave');
    this.goTo(far, 1.35, () => { this.hide(); this.onLost?.('left'); });
  }

  // called when the player starts climbing into a hiding spot
  noteHide(spot) {
    this.sawHide = (this.state === 'chase' || this.state === 'investigate') && this.los && this.dist < 9 && this.root.visible ? spot : null;
  }

  chase() {
    if (this.state !== 'chase') {
      this.setState('chase');
      this.onSpotted?.(this);
    }
  }

  // ---------------------------------------------------------------- update
  update(dt, P, t) {
    if (this.vanishT > 0) {
      this.vanishT -= dt;
      if (this.vanishT <= 0) { this.hide(); }
      return;
    }
    if (this.state === 'hidden') { this._syncModel(dt); return; }
    this.stateT += dt;
    this.perceiveT -= dt;
    if (this.perceiveT <= 0) { this.perceive(Math.max(dt, 0.08), P); this.perceiveT = 0.08; }
    this.lookAt = null;
    const H = this.house;
    const eye = P.eye;

    switch (this.state) {
      case 'glimpse': {
        const g = this.glimpse;
        this.mode = 'lurk'; this.speed = 0;
        this.lookAt = eye.clone();
        if (this.watched || this.lit > 0.35) this.looked += dt * (this.lit > 0.35 ? 2.2 : 1);
        const near = this.dist < (g?.near ?? 3.5);
        if (this.looked > (g?.hold ?? 0.45) || near || this.stateT > (g?.maxT ?? 14)) {
          const seen = this.looked > 0.2 || near;
          this.looked = 0;
          if (g?.onEnd) g.onEnd(seen);
          if (seen) this.vanish(P); else this.hide();
        }
        break;
      }
      case 'stalk': {
        const S = this.stalkData || (this.stalkData = { t: 0, dur: 30 });
        S.t += dt;
        this.lookAt = eye.clone();
        if (this.watched && this.dist < 20) {
          // frozen while watched, then gone
          this.mode = 'lurk'; this.speed = 0; this.looked += dt;
          if (this.looked > 0.55) { this.looked = 0; this.onLost?.('revealed'); this.vanish(P); }
          break;
        }
        this.looked = Math.max(0, this.looked - dt);
        // target: behind the player, out of view
        const f = P.forward(_v); f.y = 0; f.normalize();
        const tgt = _w.set(P.pos.x - f.x * 5.5, 0, P.pos.z - f.z * 5.5);
        this.repathT -= dt;
        if (this.repathT <= 0) {
          this.repathT = 0.5;
          const near = H.nearestWalkablePoint(tgt.x, tgt.z);
          if (near && (!this.goal || this.goal.distanceTo(near) > 1.2 || !this.path)) this.goTo(near, 1.6);
        }
        const match = Math.min(2.3, P.speed * 1.08 + (this.dist > 9 ? 1.2 : 0));
        this.moveSpeed = P.speed < 0.2 && this.dist < 9 ? 0 : Math.max(match, 0.6);
        this.mode = this.moveSpeed > 0.1 ? 'stoop' : 'lurk';
        if (this.dist < 1.8 && !this.inView) { this.onLost?.('touched'); this.vanish(P, 0.05); break; }
        if (S.t > S.dur) { this.leave(); break; }
        if (this.awareness > 1.3 && this.aggression > 0.55) this.chase();
        break;
      }
      case 'roam': {
        if (!this.path) {
          if (this.idleT === undefined || this.idleT <= 0) {
            this.idleT = 1.5 + Math.random() * 3;
            const target = this.roamTarget ? this.roamTarget() : H.randomPointIn(H.rooms[(Math.random() * 9) | 0].id);
            this.goTo(target, 1.25 + this.aggression * 0.35, () => { this.idleT = 1.5 + Math.random() * 3; });
          } else { this.idleT -= dt; this.mode = 'lurk'; if (Math.random() < dt * 0.15) this.audio.play('bones_crack', { pos: this.head.clone(), gain: 0.5 }); }
        }
        this._aware();
        break;
      }
      case 'investigate': this._aware(); break;
      case 'search': {
        const S = this.searchData;
        S.t += dt; S.pointT = (S.pointT || 0) + dt;
        if (!S.arrived && S.pointT > 7) { this._nextSearchPoint(); break; }
        this._aware();
        if (this.state !== 'search') break;
        if (S.arrived && S.cur?.kind === 'spot') {
          // stand at the hiding spot, listen
          const spot = S.cur.spot;
          this.mode = 'lurk'; this.speed = 0;
          this.lookAt = spot.view.clone();
          this._face(spot.view, dt, 4);
          S.listen += dt;
          if (P.hiding && (P.hiding === spot || P.hiding.front.distanceTo(this.pos) < 2.6)) {
            const mic = this.audio.mic.level;
            const same = P.hiding === spot;
            const rate = ((P.holding ? 0.03 : 0.5 + (1 - P.breath) * 0.4) + mic * 3.2 + (S.cur.sure && same ? 0.8 : 0)) * (same ? 1 : 0.45);
            this.listenDetect += dt * rate * (0.7 + this.aggression * 0.6);
            this.listening = P.hiding;
            if (this.listenDetect > 1) { this._rip(P.hiding, P); break; }
          }
          if (S.listen > (S.cur.sure ? 2.2 : 3 + Math.random() * 2)) {
            // sometimes it opens the door anyway
            if (S.cur.sure || (Math.random() < 0.3 + this.aggression * 0.3 && spot.type === 'wardrobe')) {
              if (P.hiding === spot) { this._rip(spot, P); break; }
              this._openEmpty(spot);
            }
            this.listenDetect = 0;
            this._nextSearchPoint();
          }
        } else if (S.arrived && S.cur?.kind === 'look') {
          this.mode = 'lurk';
          S.listen += dt;
          this.yaw += Math.sin(t * 1.3) * dt * 1.5;
          if (S.listen > 1.5 + Math.random()) this._nextSearchPoint();
        }
        if (S.t > S.dur) this.leave();
        break;
      }
      case 'chase': {
        this.lookAt = eye.clone();
        if (P.hiding) {
          // sawHide was decided the moment you started climbing in (noteHide)
          const known = this.sawHide === P.hiding ? this.sawHide : null;
          this._startSearch(known ? known.front.clone() : this.lastKnown.clone(), known);
          break;
        }
        if (this.los) { this.lastKnown.set(P.pos.x, P.floorY, P.pos.z); this.lostT = 0; }
        else this.lostT += dt;
        this.repathT -= dt;
        const tgt = this.los ? P.pos : this.lastKnown;
        if (this.repathT <= 0 || !this.path) {
          this.repathT = 0.35;
          this.goTo(_v.set(tgt.x, 0, tgt.z), 3.35 + this.aggression * 0.7);
          if (!this.path) this.path = [this.pos.clone(), new THREE.Vector3(tgt.x, 0, tgt.z)];
        }
        this.mode = 'run';
        if (this.dist < 1.05 && this.los && Math.abs(P.floorY - this.pos.y) < 1) { this._catch(P); break; }
        if (this.lostT > 3.5 + this.aggression * 2) { this.sawHide = null; this._startSearch(this.lastKnown.clone()); }
        break;
      }
      case 'leave': break;
      case 'scripted': if (this.scriptFn) this.scriptFn(dt, this, P); break;
      case 'catch': this.mode = 'scream'; this.speed = 0; this.lookAt = eye.clone(); break;
    }

    if (this.state !== 'glimpse' && this.state !== 'scripted' && this.state !== 'catch') this._follow(dt, P);
    this._sounds(dt, P);
    this._syncModel(dt);
  }

  _aware() {
    if (this.awareness > 1) { this.chase(); return; }
    if (this.awareness > 0.55 && this.state !== 'investigate' && this.state !== 'search') this._investigate(this.lastKnown.clone());
    if (this.awareness > 0.3) this.lookAt = this.lastKnown.clone().setY(this.lastKnown.y + 1.5);
  }

  _catch(P) {
    this.state = 'catch'; this.stateT = 0; this.path = null;
    this.onCatch?.(this);
  }

  _rip(spot, P) {
    this.state = 'catch'; this.path = null;
    this.audio.play('door_slam', { pos: spot.view.clone(), gain: 1 });
    spot.setOpen(1);
    if (spot.leaves) spot.leaves.forEach(l => l.visible = true);
    this.onCatch?.(this, spot);
  }

  _openEmpty(spot) {
    this.audio.play('handle_rattle', { pos: spot.view.clone(), gain: 0.6 });
    let k = 0;
    const id = setInterval(() => { k += 0.08; spot.setOpen(Math.min(1, k)); if (k >= 1) { clearInterval(id); setTimeout(() => { let c = 1; const id2 = setInterval(() => { c -= 0.1; spot.setOpen(Math.max(0, c)); if (c <= 0) clearInterval(id2); }, 30); }, 1400); } }, 30);
    this.audio.play('door_creak_2', { pos: spot.view.clone(), gain: 0.7, rate: 1.4 });
  }

  _face(p, dt, rate) {
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * rate);
  }

  _follow(dt, P) {
    const H = this.house;
    if (this.doorPause > 0) { this.doorPause -= dt; this.speed = 0; if (this.doorPause <= 0 && this.pendingDoor) { this.pendingDoor = null; } return; }
    if (!this.path || this.pi >= this.path.length) {
      if (this.path && this.pi >= this.path.length) { this.path = null; const cb = this.goalCb; this.goalCb = null; cb?.(true); }
      this.speed += (0 - this.speed) * Math.min(1, dt * 6);
      if (this.state !== 'search' && this.state !== 'roam' && this.mode !== 'run') this.mode = this.speed > 0.2 ? this.mode : 'idle';
      return;
    }
    const wp = this.path[this.pi];
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.35) { this.pi++; return; }
    // doors in the way
    for (const door of H.doors) {
      if (door.front || door.open > 0.55) continue;
      const c = door.center;
      if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) > 1.25) continue;
      const nx = door.o.line === 'z' ? 0 : 1, nz = door.o.line === 'z' ? 1 : 0;
      const s1 = (this.pos.x - c.x) * nx + (this.pos.z - c.z) * nz, s2 = (wp.x - c.x) * nx + (wp.z - c.z) * nz;
      const next = this.path[Math.min(this.pi + 1, this.path.length - 1)];
      const s3 = (next.x - c.x) * nx + (next.z - c.z) * nz;
      if (Math.sign(s1) !== Math.sign(s2) || Math.sign(s1) !== Math.sign(s3)) {
        const fast = this.state === 'chase';
        door.target = 1; door.speed = fast ? 6 : 1.1;
        door.byEntity = true;
        this.audio.play(fast ? 'door_slam' : 'handle_rattle', { pos: c.clone(), gain: fast ? 1 : 0.55 });
        if (!fast) this.audio.play(Math.random() < 0.5 ? 'door_creak_1' : 'door_creak_2', { pos: c.clone(), gain: 0.7, delay: 0.5 });
        this.doorPause = fast ? 0.15 : 1.1;
        this.pendingDoor = door;
        return;
      }
    }
    const sp = this.moveSpeed;
    this.speed += (sp - this.speed) * Math.min(1, dt * (this.state === 'chase' ? 5 : 3));
    const step = Math.min(d, this.speed * dt);
    this.pos.x += dx / d * step; this.pos.z += dz / d * step;
    H.collide(this.pos, 0.24, this.pos.y + 0.3, this.pos.y + 2.0, true);
    this.pos.y += (H.floorAt(this.pos.x, this.pos.z) - this.pos.y) * Math.min(1, dt * 10);
    this._face(wp, dt, this.state === 'chase' ? 9 : 5);
    // stoop near doorways, in the stairwell and basement
    if (this.mode !== 'run' || this.speed < 2) {
      let nearDoor = H.inBasement(this.pos.x);
      for (const door of H.doors) if (Math.hypot(door.center.x - this.pos.x, door.center.z - this.pos.z) < 1.5) { nearDoor = true; break; }
      this.mode = this.speed > 2.2 ? 'run' : (nearDoor || this.state === 'search' || this.state === 'stalk') ? 'stoop' : 'walk';
    }
    // stuck?
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      if (this._lastPos.distanceTo(this.pos) < 0.2 && sp > 0.3) { this.path = this.goal ? this.house.findPath(this.pos.x, this.pos.z, this.goal.x, this.goal.z) : null; this.pi = 1; }
      this._lastPos.copy(this.pos); this.stuckT = 0;
    }
  }

  _sounds(dt, P) {
    // footsteps
    const stride = this.mode === 'run' ? 1.7 : this.mode === 'stoop' ? 0.95 : 1.2;
    this.stepAcc += this.speed * dt;
    if (this.stepAcc > stride && this.root.visible) {
      this.stepAcc = 0; this.stepSide *= -1;
      const g = this.mode === 'run' ? 1.5 : this.state === 'stalk' ? 0.7 : 0.95;
      const fp = _v.set(this.pos.x + Math.cos(this.yaw) * 0.12 * this.stepSide, this.pos.y + 0.05, this.pos.z - Math.sin(this.yaw) * 0.12 * this.stepSide);
      this.audio.play(this.audio.variant('step', 6), { pos: fp.clone(), gain: g, rate: (this.mode === 'run' ? 0.95 : 0.85) + Math.random() * 0.1, reverb: 0.4 });
      if (this.house.roomAt(this.pos.x, this.pos.z)?.surface === 'wood' && Math.random() < 0.18)
        this.audio.play(this.audio.variant('creak', 3), { pos: fp.clone(), gain: 0.7, rate: 0.8 + Math.random() * 0.2 });
    }
    // breathing
    let bg = 0;
    if (this.root.visible) {
      if (this.state === 'chase') bg = 1;
      else if (this.state === 'search' || this.state === 'investigate') bg = 0.85;
      else if (this.state === 'roam' || this.state === 'leave') bg = 0.55;
      else if (this.state === 'stalk') bg = this.dist < 4 ? 0.35 : 0;
    }
    this._breath(bg);
    if (this.breath) this.breath.setPos(this.head);
  }

  _breath(g) {
    if (g > 0 && !this.breath) this.breath = this.audio.play('monster_breath', { pos: this.head.clone(), loop: true, gain: 0, fadeIn: 0.8, ref: 1.0, rolloff: 1.6 });
    if (this.breath) {
      if (g <= 0 && this.breathGain <= 0.01) { this.breath.stop(0.6); this.breath = null; this.breathGain = 0; return; }
      if (Math.abs(g - this.breathGain) > 0.02) { this.breathGain = g; this.breath.setGain(g, 0.4); }
    }
  }

  _syncModel(dt) {
    const r = this.root;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw;
    this.model.update(dt, { speed: this.speed, mode: this.mode, lookAt: this.lookAt, light: this.lit, twitch: this.twitch + (this.state === 'chase' ? 0.3 : 0) });
  }

  // phantom (only the TV and the mirror can see it)
  showPhantom(p, yaw, lookAt) {
    const ph = this.phantom;
    ph.root.visible = true;
    ph.root.position.copy(p); ph.root.rotation.y = yaw;
    ph.update(0.016, { speed: 0, mode: 'lurk', lookAt, light: 0.2, twitch: 0.3 });
  }
  updatePhantom(dt, lookAt, mode = 'lurk') { if (this.phantom.root.visible) this.phantom.update(dt, { speed: 0, mode, lookAt, light: 0.3, twitch: 0.35 }); }
  hidePhantom() { this.phantom.root.visible = false; }
}

function safeCreate(factory) {
  try {
    const m = factory();
    if (!m || !m.root || typeof m.update !== 'function') return null;
    if (typeof m.setLayer !== 'function') m.setLayer = (n) => m.root.traverse(o => o.layers.set(n));
    return m;
  } catch (e) { console.error('[entity] model factory failed', e); return null; }
}

// A crude stand-in used only if entity-model.js is missing or throws.
function fallbackModel() {
  const root = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x8c918e, roughness: 0.45 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.9, 6, 12), skin); body.position.y = 1.5; root.add(body);
  const head = new THREE.Group(); head.position.y = 2.2; root.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin); skull.scale.set(0.85, 1.25, 0.95); head.add(skull);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), dark); s.position.set(sx * 0.045, 0.03, 0.105); head.add(s);
    const pm = new THREE.MeshBasicMaterial({ color: 0xffffff }); const p = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), pm);
    p.position.set(sx * 0.045, 0.03, 0.13); head.add(p); eyes.push(pm);
  }
  const limbs = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 1.3, 8), skin); arm.position.set(sx * 0.24, 1.35, 0); root.add(arm); limbs.push(arm);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 1.1, 8), skin); leg.position.set(sx * 0.1, 0.55, 0); root.add(leg); limbs.push(leg);
  }
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  let ph = 0;
  const q = new THREE.Quaternion(), m = new THREE.Matrix4();
  return {
    root, height: 2.4,
    update(dt, s) {
      ph += dt * (s.speed || 0) * 3;
      limbs.forEach((l, i) => { l.rotation.x = Math.sin(ph + i * Math.PI / 2) * Math.min(0.6, s.speed * 0.3); });
      body.rotation.x = s.mode === 'stoop' || s.mode === 'run' ? 0.5 : 0.1;
      head.position.y = s.mode === 'stoop' || s.mode === 'run' ? 1.95 : 2.2;
      head.rotation.z = 0.4;
      eyes.forEach(e => e.color.setScalar(0.2 + (s.light || 0) * 3));
      if (s.lookAt) {
        root.updateMatrixWorld();
        const hp = head.getWorldPosition(new THREE.Vector3());
        m.lookAt(s.lookAt, hp, UP); q.setFromRotationMatrix(m);
        const inv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
        head.quaternion.copy(inv.multiply(q));
        head.rotateZ(0.4);
      }
    },
    setLayer(n) { root.traverse(o => o.layers.set(n)); },
    clone() { return fallbackModel(); },
    dispose() {},
  };
}
