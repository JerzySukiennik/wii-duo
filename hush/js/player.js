// First-person controller: movement + collision, head bob, footsteps, stamina, crouch,
// flashlight (battery, flicker, dying), breath holding, hiding, interaction ray.
import * as THREE from 'three';

const EYE = 1.62, EYE_CROUCH = 0.98, RADIUS = 0.28;

export class Player {
  constructor(camera, scene, house, audio, M) {
    this.cam = camera; this.house = house; this.audio = audio;
    this.pos = new THREE.Vector3(4.4, 0, 2.5);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI / 2; this.pitch = 0;
    this.crouch = 0; this.stamina = 1; this.exhausted = false;
    this.breath = 1; this.holding = false; this.holdT = 0;
    this.stepDist = 0; this.stepSide = 1; this.bob = 0;
    this.eyeY = EYE; this.floorY = 0;
    this.speed = 0; this.moving = false; this.sprinting = false;
    this.hiding = null; this.hideAnim = null;
    this.locked = false;       // input disabled (cutscenes)
    this.lookLocked = false;
    this.noises = [];          // {pos, radius, t, kind}
    this.shake = 0; this.roll = 0;
    this.lookTarget = null;    // cutscene camera override: {pos, strength}
    this.hasLight = false;

    // flashlight
    const L = this.light = new THREE.SpotLight(0xfff0dc, 0, 28, 0.66, 0.75, 2);
    L.map = M.cookie;
    L.castShadow = true;
    L.shadow.mapSize.set(1024, 1024);
    L.shadow.bias = -0.0005; L.shadow.normalBias = 0.025;
    L.shadow.camera.near = 0.15; L.shadow.camera.far = 26;
    scene.add(L); scene.add(L.target);
    // a faint bounce so the room around the beam isn't pitch black
    this.bounce = new THREE.PointLight(0xffe8d0, 0, 6, 2);
    scene.add(this.bounce);
    this.fl = { on: false, battery: 1, flicker: 0, dead: false, deadPresses: 0, deadNeed: 4, base: 60, forcedOff: false, level: 0 };
    this._aim = new THREE.Vector3(0, 0, -1);
    this._ray = new THREE.Raycaster();
    this._ray.far = 1.9;
    this._ray.camera = camera; // sprites (pickup glints) need it
    this.focus = null;
  }

  get eye() { return _e.set(this.pos.x, this.floorY + this.eyeY, this.pos.z); }
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }

  noise(radius, kind = 'step', pos = null) {
    this.noises.push({ pos: (pos || this.pos).clone(), radius, kind, t: performance.now() });
  }

  look(dx, dy) {
    if (this.lookLocked) return;
    const s = 0.0022;
    this.yaw -= dx * s; this.pitch -= dy * s;
    if (this.hiding) {
      const lim = this.hiding.type === 'bed' ? 0.75 : 0.55;
      let d = this.yaw - this.hiding.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      d = Math.max(-lim, Math.min(lim, d)); this.yaw = this.hiding.yaw + d;
      this.pitch = Math.max(-0.35, Math.min(this.hiding.type === 'bed' ? 0.15 : 0.35, this.pitch));
    } else this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  toggleLight() {
    if (!this.hasLight) return;
    const f = this.fl;
    this.audio.play('switch_click', { gain: 0.5, bus: 'ui' });
    if (f.dead) { f.deadPresses++; this.shake = Math.max(this.shake, 0.15); return 'shake'; }
    if (f.battery <= 0) return;
    f.on = !f.on;
  }

  update(dt, input, t) {
    const H = this.house;
    // ------------------------------------------------ hiding animation / hidden
    if (this.hideAnim) {
      const a = this.hideAnim;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur), e = k * k * (3 - 2 * k);
      this.pos.lerpVectors(a.fromPos, a.toPos, e);
      this.eyeY = a.fromEye + (a.toEye - a.fromEye) * e;
      let dy = a.toYaw - a.fromYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw = a.fromYaw + dy * e;
      this.pitch = a.fromPitch * (1 - e);
      if (a.spot.setOpen) a.spot.setOpen(a.entering ? (k < 0.5 ? k * 2 : 2 - k * 2) : (k < 0.5 ? k * 2 : 2 - k * 2));
      if (k >= 1) { this.hideAnim = null; a.done?.(); }
    } else if (!this.hiding && !this.locked) {
      this._move(dt, input);
    }
    if (!this.hiding && !this.hideAnim && !this.freezeEye) {
      const fy = H.floorAt(this.pos.x, this.pos.z);
      this.floorY += (fy - this.floorY) * Math.min(1, dt * 14);
      const tgtEye = EYE - (EYE - EYE_CROUCH) * this.crouch;
      this.eyeY += (tgtEye - this.eyeY) * Math.min(1, dt * 10);
    }

    // ------------------------------------------------ breath
    const wantHold = input.hold && !this.locked;
    if (wantHold && this.breath > 0.02 && !this.holding && this.breath > 0.15) { this.holding = true; this.holdT = 0; }
    if (this.holding) {
      this.holdT += dt;
      this.breath -= dt / 10;
      if (!wantHold || this.breath <= 0) {
        this.holding = false;
        const hard = this.breath <= 0.02;
        this.audio.play('gasp', { gain: hard ? 1.0 : 0.45, bus: 'voice', rate: hard ? 0.95 : 1.1 });
        if (this.holdT > 1.5) this.noise(hard ? 7 : 3, 'gasp');
      }
    } else this.breath = Math.min(1, this.breath + dt / 6);

    // ------------------------------------------------ camera
    const cam = this.cam;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake;
    const bobY = Math.sin(this.bob * 2) * 0.03 * Math.min(1, this.speed / 2) * (this.sprinting ? 1.8 : 1);
    const bobX = Math.cos(this.bob) * 0.02 * Math.min(1, this.speed / 2);
    cam.position.set(this.pos.x, this.floorY + this.eyeY + bobY, this.pos.z);
    const rx = this.pitch + (Math.random() - 0.5) * sh * 0.08, ry = this.yaw + (Math.random() - 0.5) * sh * 0.08;
    this.roll += ((input.strafe || 0) * -0.012 - this.roll) * Math.min(1, dt * 5);
    cam.rotation.set(rx, ry, this.roll + bobX * 0.3, 'YXZ');
    if (this.lookTarget) {
      // cutscene: pull the view toward a point
      const lt = this.lookTarget;
      const m = new THREE.Matrix4().lookAt(cam.position, lt.pos, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      cam.quaternion.slerp(q, Math.min(1, lt.strength));
      const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
      this.yaw = e.y; this.pitch = e.x;
    }
    cam.updateMatrixWorld();

    // ------------------------------------------------ flashlight
    this._updateLight(dt, t);

    // ------------------------------------------------ interaction focus
    this.focus = null;
    if (!this.locked && !this.hideAnim) {
      const ray = this._ray;
      ray.set(cam.getWorldPosition(_a), cam.getWorldDirection(_b));
      ray.far = this.hiding ? 3 : 1.9;
      let best = null;
      for (const it of H.interactables) {
        if (it.enabled && !it.enabled()) continue;
        if (this.hiding && it.spot !== this.hiding) continue;
        const hits = ray.intersectObject(it.obj, true);
        if (hits.length && (!best || hits[0].distance < best.d)) best = { it, d: hits[0].distance, p: hits[0].point };
      }
      if (best && !this.hiding) {
        const e = this.eye;
        const ignore = best.it.door ? best.it.door.col : (best.it.spot?.col || null);
        if (H.losBlocked(e.x, e.z, best.p.x - (best.p.x - e.x) * 0.08, best.p.z - (best.p.z - e.z) * 0.08, Math.min(best.p.y, 2.5), ignore)) best = null;
      }
      if (this.hiding) best = { it: { kind: 'unhide', spot: this.hiding } };
      this.focus = best?.it || null;
    }
  }

  _move(dt, input) {
    const H = this.house;
    const fwd = (input.f ? 1 : 0) - (input.b ? 1 : 0), str = (input.r ? 1 : 0) - (input.l ? 1 : 0);
    input.strafe = str;
    const wantCrouch = input.crouch;
    this.crouch += ((wantCrouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 8);
    let target = 1.75;
    this.sprinting = false;
    if (input.sprint && fwd > 0 && !this.exhausted && this.crouch < 0.3) { target = 3.9; this.sprinting = true; }
    if (this.crouch > 0.5) target = 0.95;
    if (this.fearSlow) target *= this.fearSlow;
    // stamina
    if (this.sprinting && (fwd || str)) { this.stamina -= dt / 5.5; if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; } }
    else { this.stamina = Math.min(1, this.stamina + dt / (this.moving ? 9 : 6)); if (this.stamina > 0.4) this.exhausted = false; }

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let dx = -sy * fwd + cy * str, dz = -cy * fwd - sy * str;
    const len = Math.hypot(dx, dz);
    if (len > 0) { dx /= len; dz /= len; }
    const accel = len > 0 ? 9 : 11;
    this.vel.x += (dx * target - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (dz * target - this.vel.z) * Math.min(1, dt * accel);
    const before = _c.copy(this.pos);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    H.collide(this.pos, RADIUS, this.floorY + 0.25, this.floorY + 1.7);
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    this.speed = moved / Math.max(dt, 1e-4);
    this.moving = this.speed > 0.2;
    // footsteps
    this.bob += moved * (this.sprinting ? 3.4 : 4.2);
    this.stepDist += moved;
    const stride = this.sprinting ? 1.05 : this.crouch > 0.5 ? 0.6 : 0.78;
    if (this.stepDist > stride) {
      this.stepDist = 0; this.stepSide *= -1;
      const room = H.roomAt(this.pos.x, this.pos.z);
      const surf = room?.surface || 'wood';
      const rate = surf === 'tile' ? 1.18 : surf === 'concrete' ? 0.88 : surf === 'carpet' ? 0.8 : 1.0;
      const g = this.sprinting ? 0.85 : this.crouch > 0.5 ? 0.12 : 0.32;
      this.audio.play(this.audio.variant('pstep', 4), { gain: g, rate: rate * (0.94 + Math.random() * 0.12), bus: 'sfx', pan: this.stepSide * 0.15, reverb: 0.25 });
      this.noise(this.sprinting ? 11 : this.crouch > 0.5 ? 1.2 : 4, 'step');
      if (surf === 'wood' && Math.random() < (this.crouch > 0.5 ? 0.03 : 0.07)) {
        this.audio.play(this.audio.variant('creak', 3), { gain: 0.35, bus: 'sfx', rate: 0.9 + Math.random() * 0.2, reverb: 0.3 });
        this.noise(6, 'creak');
      }
    }
  }

  _updateLight(dt, t) {
    const f = this.fl, L = this.light, cam = this.cam;
    // flashlight sways with lag behind the view
    const want = cam.getWorldDirection(_b);
    this._aim.lerp(want, Math.min(1, dt * 14)).normalize();
    const right = _a.set(1, 0, 0).applyQuaternion(cam.quaternion);
    L.position.copy(cam.position).addScaledVector(right, 0.16).add(_c.set(0, -0.14, 0));
    L.target.position.copy(L.position).addScaledVector(this._aim, 6);
    L.target.updateMatrixWorld();
    if (f.on && !f.dead) f.battery = Math.max(0, f.battery - dt / 560);
    if (f.battery <= 0 && f.on) { f.on = false; }
    let k = (f.on && !f.dead && !f.forcedOff) ? 1 : 0;
    if (k) {
      // weak battery: dimmer, warmer, stutters
      const low = f.battery < 0.25 ? 1 - f.battery / 0.25 : 0;
      k *= 1 - low * 0.55;
      const fl = Math.max(f.flicker, low * 0.35);
      if (fl > 0) {
        const n = Math.random();
        if (n < fl * 0.18) k *= 0.05 + Math.random() * 0.3;
        else if (n < fl * 0.4) k *= 0.6 + Math.random() * 0.3;
      }
      L.color.setRGB(1, 0.94 - low * 0.12, 0.86 - low * 0.25);
    }
    if (f.dead && f.deadPresses >= f.deadNeed) { f.dead = false; f.on = true; f.deadPresses = 0; this.onRevive?.(); }
    f.level += (k - f.level) * Math.min(1, dt * 40);
    L.intensity = f.base * f.level;
    this.bounce.intensity = 0.35 * f.level;
    this.bounce.position.copy(cam.position).addScaledVector(this._aim, 1.2);
  }

  // ------------------------------------------------ hiding
  enterHide(spot, done) {
    this.audio.play(spot.type === 'bed' ? 'creak_2' : 'door_creak_1', { pos: spot.view, gain: 0.35, rate: 1.5 });
    this.hideAnim = {
      spot, entering: true, t: 0, dur: spot.type === 'bed' ? 1.1 : 0.9,
      fromPos: this.pos.clone(), toPos: new THREE.Vector3(spot.view.x, this.floorY, spot.view.z),
      fromEye: this.eyeY, toEye: spot.view.y - this.floorY,
      fromYaw: this.yaw, toYaw: spot.yaw, fromPitch: this.pitch,
      done: () => { this.hiding = spot; spot.setOpen(0); if (spot.leaves) spot.leaves.forEach(l => l.visible = false); done?.(); },
    };
    this.vel.set(0, 0, 0);
    this.noise(2.5, 'hide');
  }
  exitHide(done) {
    const spot = this.hiding; if (!spot) return;
    this.hiding = null;
    if (spot.leaves) spot.leaves.forEach(l => l.visible = true);
    this.audio.play(spot.type === 'bed' ? 'creak_1' : 'door_creak_2', { pos: spot.view, gain: 0.35, rate: 1.6 });
    const yawOut = spot.yaw;
    this.hideAnim = {
      spot, entering: false, t: 0, dur: 0.8,
      fromPos: this.pos.clone(), toPos: spot.exit.clone().setY(this.floorY),
      fromEye: this.eyeY, toEye: EYE, fromYaw: this.yaw, toYaw: yawOut, fromPitch: this.pitch,
      done: () => { spot.setOpen(0); done?.(); },
    };
    this.noise(3, 'hide');
  }

  teleport(x, z, yaw, pitch = 0) {
    this.pos.set(x, 0, z); this.floorY = this.house.floorAt(x, z); this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = pitch; this.hiding = null; this.hideAnim = null;
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3();
