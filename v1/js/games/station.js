import { THREE, clamp, lerp, rand, P_COLORS, PAL, canvasTex, stripeTex, texMat, sfx } from '../common.js';

// ---------------------------------------------------------------------------
// Space Station Repair — two robot arms, one broken hull panel.
// Stages per panel: 1) carry it to the bay together  2) bolt it down in sync
// 3) plug both cables. Debris drifts through and knocks things about.
// ---------------------------------------------------------------------------
const L1 = 9.5, L2 = 9.5, ROUNDS = 3, O2_START = 170, O2_BONUS = 26;
const STAGES = ['CARRY', 'BOLTS', 'CABLES'];

const std = (color, metal = 0.6, rough = 0.4, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...extra });
const mesh = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; };
const wpos = (o) => o.getWorldPosition(new THREE.Vector3());

function makeEnv(renderer) {
  const es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(60, 16, 12), new THREE.MeshBasicMaterial({ color: 0x0a1226, side: THREE.BackSide })));
  const card = (x, y, z, w, h, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); es.add(m); };
  card(-22, 26, 22, 34, 14, 0xfff0d0); card(32, -8, 18, 22, 26, 0x3b78ff); card(0, -34, 12, 50, 10, 0x6a4a9a); card(0, 26, -34, 34, 22, 0xffffff); card(-34, -6, -10, 12, 30, 0xff9a5a);
  const pm = new THREE.PMREMGenerator(renderer); const t = pm.fromScene(es, 0.02).texture; pm.dispose(); return t;
}
const glowTex = () => canvasTex(64, 64, (g, w, h) => { const r = g.createRadialGradient(32, 32, 1, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
let _glow;
function glow(color, size) {
  _glow = _glow || glowTex();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: _glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size); return s;
}

// ---------------------------------------------------------------- arm ----
class Arm {
  constructor(scene, side, color) {
    this.side = side; this.base = new THREE.Vector2(side * 11.5, -8.7);
    this.g = new THREE.Vector2(side * 5, -1);       // where the claw is drawn
    this.ctl = this.g.clone();                       // where the player is steering
    this.vel = new THREE.Vector2(); this.stun = 0; this.open = 0.6; this.twist = 0;
    const paint = std(color, 0.35, 0.35), steel = std(0x9aa3b5, 0.85, 0.3), dark = std(0x2a2f3d, 0.7, 0.5), white = std(0xe6eaf2, 0.4, 0.4);
    // turret
    const turret = mesh(new THREE.CylinderGeometry(2.1, 2.5, 1.5, 20), dark); turret.rotation.x = Math.PI / 2; turret.position.set(this.base.x, this.base.y, 0.4); scene.add(turret);
    const dome = mesh(new THREE.SphereGeometry(1.5, 16, 10), steel); dome.position.set(this.base.x, this.base.y, 1.1); scene.add(dome);
    // upper arm
    this.up = new THREE.Group();
    const ub = mesh(new THREE.CylinderGeometry(0.7, 0.8, 1, 16), paint); ub.rotation.z = Math.PI / 2; ub.scale.y = L1; ub.position.x = L1 / 2; this.up.add(ub);
    const piston = mesh(new THREE.CylinderGeometry(0.22, 0.22, L1 * 0.6, 8), steel); piston.rotation.z = Math.PI / 2; piston.position.set(L1 * 0.5, 0.95, 0.15); this.up.add(piston);
    for (const x of [0.6, L1 - 0.6]) { const c = mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.35, 16), dark); c.rotation.z = Math.PI / 2; c.position.x = x; this.up.add(c); }
    scene.add(this.up);
    // forearm
    this.fo = new THREE.Group();
    const fb = mesh(new THREE.CylinderGeometry(0.35, 0.55, 1, 14), white); fb.rotation.z = -Math.PI / 2; fb.scale.y = L2; fb.position.x = L2 / 2; this.fo.add(fb);
    const stripe = mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.9, 14), paint); stripe.rotation.z = Math.PI / 2; stripe.position.x = 1.6; this.fo.add(stripe);
    scene.add(this.fo);
    // joints
    this.elbow = mesh(new THREE.SphereGeometry(0.95, 16, 12), steel); scene.add(this.elbow);
    this.led = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color })); this.elbow.add(this.led); this.led.position.set(0, 0, 0.9);
    // claw
    this.claw = new THREE.Group(); this.claw.rotation.order = 'ZXY';
    const wrist = mesh(new THREE.SphereGeometry(0.65, 12, 10), dark); this.claw.add(wrist);
    const palm = mesh(new THREE.BoxGeometry(0.9, 1.5, 0.7), steel); palm.position.x = 0.6; this.claw.add(palm);
    this.fingers = [1, -1].map((s) => { const p = new THREE.Group(); p.position.set(0.9, s * 0.65, 0); const f = mesh(new THREE.BoxGeometry(1.5, 0.32, 0.5), paint); f.position.x = 0.7; p.add(f); this.claw.add(p); return p; });
    scene.add(this.claw);
    this.glow = glow(color, 3.2); this.claw.add(this.glow); this.glow.position.x = 1.2;
  }
  // reach the claw to this.g
  solve() {
    const d = this.g.clone().sub(this.base); const len = clamp(d.length(), 0.6, L1 + L2 - 0.05);
    d.setLength(len); this.g.copy(this.base).add(d);
    const a = Math.atan2(d.y, d.x), cosA = clamp((L1 * L1 + len * len - L2 * L2) / (2 * L1 * len), -1, 1);
    const sh = a + Math.acos(cosA) * (this.side > 0 ? -1 : 1);
    const ex = this.base.x + Math.cos(sh) * L1, ey = this.base.y + Math.sin(sh) * L1;
    this.up.position.set(this.base.x, this.base.y, 1.1); this.up.rotation.z = sh;
    this.fo.position.set(ex, ey, 1.1); const fa = Math.atan2(this.g.y - ey, this.g.x - ex); this.fo.rotation.z = fa;
    this.elbow.position.set(ex, ey, 1.1);
    this.claw.position.set(this.g.x, this.g.y, 1.1); this.claw.rotation.z = fa; this.claw.rotation.x = this.twist;
    this.fingers[0].rotation.z = -this.open; this.fingers[1].rotation.z = this.open;
  }
}

// ------------------------------------------------------------- the game ----
export default class Station {
  init(ctx) {
    this.c = ctx; const { scene, camera, ui, renderer } = ctx;
    this.renderer = renderer;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    this.env = makeEnv(renderer); scene.environment = this.env;
    scene.background = new THREE.Color(0x02030a);

    // lighting: warm key with shadows, cold fill, blue Earth bounce
    const key = new THREE.DirectionalLight(0xfff0d8, 2.4); key.position.set(-14, 22, 20); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -24, right: 24, top: 16, bottom: -16, near: 5, far: 70 }); key.shadow.bias = -0.0008; scene.add(key);
    const fill = new THREE.PointLight(0x4a7bff, 900, 90); fill.position.set(22, -10, 14); scene.add(fill);
    this.alarm = new THREE.PointLight(0xff2a2a, 0, 60); this.alarm.position.set(0, 6, 8); scene.add(this.alarm);

    // deep space: stars, Earth with a cloud shell, moon, drifting debris dust
    const sp = new Float32Array(900 * 3); for (let i = 0; i < 900; i++) { sp[i * 3] = rand(-110, 110); sp[i * 3 + 1] = rand(-70, 70); sp[i * 3 + 2] = -rand(40, 90); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.45, fog: false })); scene.add(this.stars);
    const earthTex = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#1b5fd8'; g.fillRect(0, 0, w, h); g.fillStyle = '#2fbf5b';
      for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(rand(0, w), rand(10, h - 10), rand(8, 26), rand(5, 14), rand(0, 3), 0, 7); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,.75)'; for (let i = 0; i < 30; i++) { g.beginPath(); g.ellipse(rand(0, w), rand(0, h), rand(10, 30), rand(2, 5), 0, 0, 7); g.fill(); }
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 20), new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.9, metalness: 0 }));
    this.earth.position.set(34, -40, -62); scene.add(this.earth);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(31.4, 32, 20), new THREE.MeshBasicMaterial({ color: 0x6fb8ff, transparent: true, opacity: 0.18, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })); atmo.position.copy(this.earth.position); scene.add(atmo);
    const moon = mesh(new THREE.SphereGeometry(5, 16, 12), std(0xcfcfd8, 0.0, 0.95)); moon.position.set(-44, 24, -70); scene.add(moon);
    const sunGlow = glow(0xfff0c0, 60); sunGlow.position.set(-46, 34, -60); scene.add(sunGlow);

    // hull wall with plating, glowing seams and depth
    const plate = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#3c4054'; g.fillRect(0, 0, w, h); g.strokeStyle = '#20232f'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
      g.fillStyle = '#7a8098'; for (const [x, y] of [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
      g.fillStyle = '#262a38'; for (let i = 0; i < 4; i++) g.fillRect(40, 34 + i * 16, 48, 6);
      g.fillStyle = 'rgba(0,0,0,.18)'; for (let i = 0; i < 40; i++) g.fillRect(rand(0, w), rand(0, h), rand(2, 18), 1);
    }, [8, 5]);
    const wall = mesh(new THREE.BoxGeometry(46, 28, 1), new THREE.MeshStandardMaterial({ map: plate, metalness: 0.55, roughness: 0.55 }), false); wall.position.set(0, 0, -1.6); wall.receiveShadow = true; scene.add(wall);
    for (const y of [-11.4, 11.6]) { const st = mesh(new THREE.BoxGeometry(46, 0.9, 0.5), new THREE.MeshStandardMaterial({ map: stripeTex('#ffdd00', '#151515', [23, 1]), metalness: 0.2, roughness: 0.6 }), false); st.position.set(0, y, -1); scene.add(st); }
    this.lamps = [];
    for (let i = 0; i < 9; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0x33aa55 })); l.position.set(-20 + i * 5, 10.2, -0.9); scene.add(l);
      const gl = glow(0x33aa55, 2.6); gl.position.copy(l.position); scene.add(gl); this.lamps.push({ l, gl });
    }
    // foreground truss + console silhouettes for depth
    const truss = std(0x14161f, 0.6, 0.6);
    const top = mesh(new THREE.BoxGeometry(60, 1.2, 1.6), truss, false); top.position.set(0, 12.4, 9); scene.add(top);
    const bot = mesh(new THREE.BoxGeometry(60, 2.4, 2), truss, false); bot.position.set(0, -12.6, 9); scene.add(bot);
    for (let i = -6; i <= 6; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshBasicMaterial({ color: [0xffaa22, 0x44ff88, 0xff4466][Math.abs(i) % 3] })); b.position.set(i * 3.6, -11.6, 10.1); scene.add(b); }

    // arms
    this.arms = [new Arm(scene, -1, P_COLORS[0]), new Arm(scene, 1, P_COLORS[1])];

    // repair panel
    this.panel = new THREE.Group(); scene.add(this.panel);
    const yellow = std(0xffc21f, 0.35, 0.4);
    this.panel.add(mesh(new THREE.BoxGeometry(9, 4.2, 0.9), yellow));
    const rim = mesh(new THREE.BoxGeometry(9.2, 0.35, 1), new THREE.MeshStandardMaterial({ map: stripeTex('#ffdd00', '#151515', [4, 1]), metalness: 0.3, roughness: 0.5 }), false); rim.position.y = 2.1; this.panel.add(rim);
    const rim2 = rim.clone(); rim2.position.y = -2.1; this.panel.add(rim2);
    this.handles = [P_COLORS[0], P_COLORS[1]].map((col, i) => {
      const grp = new THREE.Group(); grp.position.set((i ? 1 : -1) * 5.1, 0, 0.7);
      const post = mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.2, 8), std(0x9aa3b5, 0.8, 0.3)); post.rotation.z = Math.PI / 2; post.position.x = (i ? -1 : 1) * -0.4; grp.add(post);
      const bulb = mesh(new THREE.SphereGeometry(0.75, 14, 10), std(col, 0.3, 0.3)); grp.add(bulb);
      const g2 = glow(col, 3.4); grp.add(g2); this.panel.add(grp); grp.userData.glow = g2; return grp;
    });
    this.bolts = [[-3.6, 1.35], [-3.6, -1.35], [3.6, 1.35], [3.6, -1.35]].map(([x, y]) => {
      const b = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 6), std(0xb8c0d0, 0.9, 0.25)); b.rotation.x = Math.PI / 2; b.position.set(x, y, 0.65); this.panel.add(b); return b;
    });
    this.ports = [-1.9, 1.9].map((x) => {
      const p = mesh(new THREE.BoxGeometry(1.2, 1.2, 0.4), std(0x1a1d28, 0.6, 0.5)); p.position.set(x, 0, 0.6); this.panel.add(p);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.34, 12), new THREE.MeshBasicMaterial({ color: 0x66d0ff })); hole.position.z = 0.22; p.add(hole); p.userData.hole = hole; return p;
    });

    // landing bay (rebuilt every round)
    this.bay = new THREE.Group(); scene.add(this.bay);
    this.cables = [0, 1].map((i) => {
      const segs = Array.from({ length: 12 }, () => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1, 6), new THREE.MeshStandardMaterial({ color: P_COLORS[i], metalness: 0.2, roughness: 0.5 })); m.visible = false; scene.add(m); return m; });
      return { segs, pts: Array.from({ length: 13 }, () => new THREE.Vector3()) };
    });

    this.rings = [0, 1].map((i) => { const r = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.11, 8, 28), new THREE.MeshBasicMaterial({ color: P_COLORS[i] })); r.visible = false; scene.add(r); return r; });

    // debris + warnings
    this.debris = []; this.warns = []; this.spawnT = 6;
    this.rockMat = std(0x8a7f74, 0.1, 0.9); this.junkMat = std(0x3a6bd0, 0.7, 0.35);

    camera.fov = 46; camera.updateProjectionMatrix(); camera.position.set(0, 0, 34);
    this.o2 = O2_START; this.round = 0; this.time = 0; this.hits = 0; this.zoom = 0;
    this.hud = ui.hud(`
      <div class="hudtop">
        <div style="text-align:center"><div class="tag">O2</div><div class="meter" id="o2m"><i></i></div></div>
        <div style="display:flex;gap:8px;align-items:center"><span class="pill" id="s0">1 CARRY</span><span class="pill" id="s1">2 BOLTS</span><span class="pill" id="s2">3 CABLES</span></div>
        <div style="display:flex;gap:8px"><span class="pill y" id="rd"></span><span class="pill" id="ht"></span></div>
      </div>
      <div class="hudbottom"><div class="say" id="say"></div></div>`);
    this.$ = (s) => this.hud.querySelector(s);
    this.whineT = 0;
    this.newRound();
  }

  // ------------------------------------------------------------- rounds ----
  newRound() {
    const r = this.round, sc = this.c.scene;
    this.stage = 0; this.hold = 0; this.done = [0, 0, 0, 0]; this.plug = [0, 0]; this.plugged = [false, false];
    this.attached = [false, false]; this.pv = new THREE.Vector2(); this.rv = 0;
    // bay
    this.bay.clear();
    const sx = rand(-3, 3), sy = rand(0.5, 3.5), sr = r === 0 ? 0 : rand(-0.32, 0.32) * (r === 1 ? 0.8 : 1.1);
    this.bay.position.set(sx, sy, -1.1); this.bay.rotation.z = sr; this.bayPos = new THREE.Vector2(sx, sy); this.bayRot = sr;
    const dark = std(0x0b0d14, 0.4, 0.8), metal = std(0x6c7488, 0.85, 0.35);
    const back = mesh(new THREE.BoxGeometry(9.4, 4.6, 0.4), dark); back.position.z = -0.35; this.bay.add(back);
    for (const [w, h, x, y] of [[10.6, 0.7, 0, 2.65], [10.6, 0.7, 0, -2.65], [0.7, 5.2, -5.15, 0], [0.7, 5.2, 5.15, 0]]) { const s = mesh(new THREE.BoxGeometry(w, h, 1.6), metal); s.position.set(x, y, 0.4); this.bay.add(s); }
    this.bayGlow = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 4.8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })); this.bayGlow.position.z = 0.1; this.bay.add(this.bayGlow);
    this.bayEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(9.6, 4.8, 0.2)), new THREE.LineBasicMaterial({ color: 0xffffff })); this.bayEdge.position.z = 1.3; this.bay.add(this.bayEdge);
    // fresh panel floating in front of the bay
    this.panel.position.set(rand(-3, 3), -3.2, 0.5); this.panel.rotation.z = rand(-0.15, 0.15);
    this.bolts.forEach((b) => { b.material.color.setHex(0xb8c0d0); b.userData.done = 0; b.position.z = 0.65; });
    this.ports.forEach((p) => p.userData.hole.material.color.setHex(0x66d0ff));
    this.cables.forEach((cb) => cb.segs.forEach((s) => (s.visible = false)));
    this.drift = 0.6 + r * 0.45; this.debrisRate = [0, 4.5, 3.2][r]; this.spawnT = r === 0 ? 999 : 4;
    this.say(r === 0 ? 'Grab the panel: hold A next to YOUR glowing handle.' : `Panel ${r + 1}: the bay is crooked, and things are flying about!`);
    this.c.ui.toast(`PANEL ${r + 1}`, 900); sfx(300, 0.15, 'triangle', 0.05, 200);
  }
  say(t) { this.$('#say').textContent = t; }
  handlePos(i) { return wpos(this.handles[i]); }

  // ------------------------------------------------------------- update ----
  update(dt) {
    const c = this.c; this.time += dt; this.o2 -= dt;
    const A = c.remotes.map((r) => !!r.state.buttons.a), B = c.remotes.map((r) => !!r.state.buttons.b);
    const carrying = this.stage === 0 && this.attached[0] && this.attached[1];

    // ---- steer claws (velocity + inertia so arms feel heavy) ----
    this.arms.forEach((a, i) => {
      a.stun = Math.max(0, a.stun - dt);
      const t = a.stun > 0 ? { x: 0, y: 0 } : c.tilts[i].read();
      const top = (this.attached[i] ? 8.5 : 15) * (a.stun > 0 ? 0 : 1);
      a.vel.x = lerp(a.vel.x, t.x * top, Math.min(1, dt * 5.5)); a.vel.y = lerp(a.vel.y, t.y * top, Math.min(1, dt * 5.5));
      a.ctl.x = clamp(a.ctl.x + a.vel.x * dt, -17, 17); a.ctl.y = clamp(a.ctl.y + a.vel.y * dt, -9.5, 9);
      this.whineT -= dt;
      if (this.whineT <= 0 && a.vel.length() > 3) { this.whineT = 0.1; sfx(120 + a.vel.length() * 9 + i * 30, 0.06, 'sawtooth', 0.01); }
    });

    if (this.stage === 0) this.stageCarry(dt, A, carrying);
    else if (this.stage === 1) this.stageBolts(dt, B);
    else if (this.stage === 2) this.stageCables(dt, A);

    // displayed claw: follows the held handle, otherwise the player's point
    this.arms.forEach((a, i) => {
      if (this.stage === 0 && this.attached[i]) { const h = this.handlePos(i); a.g.set(h.x, h.y); } else a.g.copy(a.ctl);
      a.open = lerp(a.open, (this.stage === 0 ? this.attached[i] : (this.stage === 1 ? B[i] : A[i])) ? 0.05 : 0.6, Math.min(1, dt * 14));
      a.solve();
      a.led.material.color.setHex(a.stun > 0 ? 0xff2222 : P_COLORS[i]);
      a.glow.material.opacity = a.stun > 0 ? 0.2 : 0.9;
    });

    this.debrisTick(dt);
    this.ambience(dt);
    this.updateHud();
    if (this.o2 <= 0) this.finishOnce(false);
  }

  // stage 1: pick up together and slot it in
  stageCarry(dt, A, carrying) {
    const c = this.c;
    this.arms.forEach((a, i) => {
      const hp = this.handlePos(i), near = Math.hypot(a.ctl.x - hp.x, a.ctl.y - hp.y) < 2.6;
      const was = this.attached[i];
      if (A[i] && a.stun <= 0 && (was || near)) { this.attached[i] = true; if (!was) { c.rumble(i, 70); sfx(160, 0.09, 'square', 0.06); c.fx.burst(new THREE.Vector3(hp.x, hp.y, 1.5), 0xffffff, 6, 4, 0.2, 0); } }
      else { if (was) a.ctl.copy(a.g); this.attached[i] = false; }
      this.handles[i].userData.glow.material.opacity = this.attached[i] ? 0.25 : 0.7 + Math.sin(this.time * 6) * 0.3;
    });
    const p = this.panel;
    if (this.attached[0] && this.attached[1]) {
      const [a0, a1] = this.arms;
      // keep the two claws a sane distance apart
      const dx = a1.ctl.x - a0.ctl.x, dy = a1.ctl.y - a0.ctl.y, d = Math.hypot(dx, dy) || 1, want = clamp(d, 8, 12);
      if (Math.abs(want - d) > 0.001) { const k = (want - d) / 2 / d; a0.ctl.x -= dx * k; a0.ctl.y -= dy * k; a1.ctl.x += dx * k; a1.ctl.y += dy * k; }
      const tx = (a0.ctl.x + a1.ctl.x) / 2, ty = (a0.ctl.y + a1.ctl.y) / 2, tr = Math.atan2(a1.ctl.y - a0.ctl.y, a1.ctl.x - a0.ctl.x);
      // spring-damper: the panel has weight and swings a little
      this.pv.x += ((tx - p.position.x) * 70 - this.pv.x * 13) * dt; this.pv.y += ((ty - p.position.y) * 70 - this.pv.y * 13) * dt;
      p.position.x += this.pv.x * dt; p.position.y += this.pv.y * dt;
      this.rv += (((tr - p.rotation.z) * 60) - this.rv * 10) * dt; p.rotation.z += this.rv * dt;
      p.position.z = lerp(p.position.z, 1, 0.1);
      const dp = Math.hypot(p.position.x - this.bayPos.x, p.position.y - this.bayPos.y);
      const da = Math.abs(((p.rotation.z - this.bayRot + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const ok = dp < 1.2 && da < 0.15, near = dp < 5;
      this.hold = ok ? this.hold + dt : Math.max(0, this.hold - dt * 2);
      const col = ok ? 0x66ff88 : near ? 0xffdd55 : 0xffffff;
      this.bayGlow.material.color.setHex(col); this.bayEdge.material.color.setHex(col); this.bayGlow.material.opacity = ok ? 0.5 : 0.18;
      this.say(ok ? 'HOLD IT STEADY... 👌' : near ? 'Match the bay: keep it level and centered!' : 'Carry it to the glowing bay. Move together, smoothly!');
      if (this.hold > 0.7) this.snapIn();
    } else {
      // free-floating: drifts, tumbles slowly, bounces off the walls
      this.pv.x += Math.sin(this.time * 1.1) * this.drift * dt * 1.6; this.pv.y += Math.cos(this.time * 0.8) * this.drift * dt;
      this.pv.multiplyScalar(0.985); p.position.x += this.pv.x * dt * 2; p.position.y += this.pv.y * dt * 2;
      if (Math.abs(p.position.x) > 13) { p.position.x = Math.sign(p.position.x) * 13; this.pv.x *= -0.6; }
      if (Math.abs(p.position.y) > 6.5) { p.position.y = Math.sign(p.position.y) * 6.5; this.pv.y *= -0.6; }
      this.rv = lerp(this.rv, Math.sin(this.time * 0.5) * 0.25, dt); p.rotation.z += this.rv * dt;
      p.position.z = lerp(p.position.z, 0.5, 0.1); this.hold = 0;
      this.bayGlow.material.color.setHex(0xffffff); this.bayEdge.material.color.setHex(0xffffff);
    }
  }

  snapIn() {
    const c = this.c, p = this.panel;
    p.position.set(this.bayPos.x, this.bayPos.y, -0.15); p.rotation.z = this.bayRot;
    this.stage = 1; this.attached = [false, false]; this.arms.forEach((a) => a.ctl.copy(a.g));
    this.bayGlow.material.opacity = 0.05; this.bayEdge.material.color.setHex(0x66ff88);
    c.rumble(0, 160); c.rumble(1, 160); c.fx.shake(0.45, 0.25); sfx(90, 0.25, 'square', 0.09, -30); sfx(600, 0.06, 'square', 0.05);
    c.fx.burst(new THREE.Vector3(this.bayPos.x, this.bayPos.y, 2), 0xffffff, 26, 10, 0.3, 2); c.ui.toast('CLUNK!', 700);
    this.say('Now: BOTH hold B on your own bolts at the same time!');
  }

  // stage 2: only turns while BOTH players are holding B on a bolt
  stageBolts(dt, B) {
    const c = this.c, holding = [false, false], target = [null, null];
    this.arms.forEach((a, i) => {
      const idx = (i === 0 ? [0, 1] : [2, 3]).find((k) => this.done[k] < 1);
      if (idx === undefined) { holding[i] = true; return; }
      const bp = wpos(this.bolts[idx]);
      target[i] = idx; holding[i] = a.stun <= 0 && Math.hypot(a.ctl.x - bp.x, a.ctl.y - bp.y) < 1.9 && B[i];
      if (holding[i]) { a.ctl.x = lerp(a.ctl.x, bp.x, 0.25); a.ctl.y = lerp(a.ctl.y, bp.y, 0.25); }
    });
    const sync = holding[0] && holding[1];
    this.arms.forEach((a, i) => {
      const idx = target[i]; if (idx === null) return;
      const bolt = this.bolts[idx], before = this.done[idx];
      if (sync && holding[i]) {
        this.done[idx] = Math.min(1, before + dt * 0.4); a.twist += dt * 12; bolt.rotation.y += dt * 12; bolt.position.z = 0.65 - this.done[idx] * 0.22;
        if (Math.floor(before * 10) !== Math.floor(this.done[idx] * 10)) { sfx(880 + i * 120, 0.03, 'square', 0.035); c.rumble(i, 30); }
        if (Math.random() < dt * 40) c.fx.burst(wpos(bolt).add(new THREE.Vector3(0, 0, 0.6)), 0xffe14a, 2, 5, 0.18, 10);
      } else if (holding[i]) this.done[idx] = Math.max(0, before - dt * 0.05);
      bolt.material.color.setHex(this.done[idx] >= 1 ? 0x44ff77 : this.done[idx] > 0 ? 0xffcc33 : 0xb8c0d0);
      if (this.done[idx] >= 1 && before < 1) { c.fx.burst(wpos(bolt), 0x44ff77, 16, 8, 0.28, 8); c.fx.popup('TIGHT!', wpos(bolt).add(new THREE.Vector3(0, 2, 2))); sfx(1200, 0.12, 'square', 0.06, 300); }
    });
    this.say(sync ? 'Turning turning turning!' : holding[0] || holding[1] ? 'Wait for your buddy! You both need to hold B!' : 'Move your claw over a bolt, hold B.');
    if (this.done.every((v) => v >= 1)) {
      this.stage = 2; this.arms.forEach((a) => a.ctl.copy(a.g)); c.ui.toast('CABLES!', 800); sfx(700, 0.1, 'triangle', 0.06, 300);
      this.say('Plug your cable: hold A with the claw inside the glowing ring.');
    }
  }

  // stage 3: track the ring around your port and hold A to seat the cable
  stageCables(dt, A) {
    const c = this.c;
    this.arms.forEach((a, i) => {
      const port = wpos(this.ports[i]), ang = this.time * (1.3 + i * 0.35) * (i ? -1 : 1) + i;
      const ring = new THREE.Vector2(port.x + Math.cos(ang) * 1.25, port.y + Math.sin(ang) * 1.25 * 0.7);
      this.ring = this.ring || [new THREE.Vector2(), new THREE.Vector2()]; this.ring[i].copy(ring);
      const inside = !this.plugged[i] && a.stun <= 0 && Math.hypot(a.ctl.x - ring.x, a.ctl.y - ring.y) < 1.5;
      this.rings[i].visible = !this.plugged[i]; this.rings[i].position.set(ring.x, ring.y, 1.7); this.rings[i].scale.setScalar(0.9 + this.plug[i] * 0.25 + Math.sin(this.time * 8) * 0.04);
      this.rings[i].material.color.setHex(inside ? 0x66ff88 : P_COLORS[i]);
      if (this.plugged[i]) return;
      if (inside && A[i]) this.plug[i] = Math.min(1, this.plug[i] + dt / 2.4); else this.plug[i] = Math.max(0, this.plug[i] - dt * 0.7);
      if (inside && A[i] && Math.random() < dt * 25) c.fx.burst(new THREE.Vector3(port.x, port.y, 1.6), 0x66d0ff, 2, 4, 0.16, 6);
      if (this.plug[i] >= 1) { this.plugged[i] = true; this.ports[i].userData.hole.material.color.setHex(0x44ff77); c.rumble(i, 140); c.fx.burst(new THREE.Vector3(port.x, port.y, 1.6), 0x44ff77, 20, 9, 0.3, 6); c.fx.popup('LINKED!', new THREE.Vector3(port.x, port.y + 2.5, 2)); sfx(1000, 0.14, 'square', 0.06, 400); }
    });
    this.updateCables(A);
    const left = this.plugged.filter((v) => !v).length;
    this.say(left === 2 ? 'Hold A inside your ring. It moves: follow it!' : left === 1 ? 'One cable in! Help your buddy... by not moving.' : '');
    if (left === 0) { this.rings.forEach((r) => (r.visible = false)); this.panelDone(); }
  }

  updateCables(A) {
    this.cables.forEach((cb, i) => {
      const anchor = wpos(this.panel).add(new THREE.Vector3((i ? 1 : -1) * 4.2, -2.4, 0.9));
      const port = wpos(this.ports[i]).add(new THREE.Vector3(0, 0, 0.5));
      const end = this.plugged[i] ? port : new THREE.Vector3(this.arms[i].g.x, this.arms[i].g.y, 1.2);
      const slack = this.plugged[i] ? 0.5 : 1.6;
      for (let k = 0; k <= 12; k++) { const u = k / 12; cb.pts[k].set(lerp(anchor.x, end.x, u), lerp(anchor.y, end.y, u) - Math.sin(Math.PI * u) * slack, lerp(anchor.z, end.z, u) + Math.sin(Math.PI * u) * 0.6); }
      cb.segs.forEach((s, k) => { const a = cb.pts[k], b = cb.pts[k + 1]; s.visible = true; s.position.copy(a).lerp(b, 0.5); s.scale.set(1, a.distanceTo(b), 1); s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); });
    });
  }

  panelDone() {
    const c = this.c; this.round++; this.o2 += O2_BONUS; c.ui.toast('PANEL FIXED!', 1000); sfx(523, 0.12, 'square', 0.06); sfx(784, 0.2, 'square', 0.06);
    c.fx.shake(0.5, 0.35); c.fx.burst(new THREE.Vector3(this.bayPos.x, this.bayPos.y, 2), 0x66ff88, 40, 12, 0.4, 5);
    this.bayGlow.material.color.setHex(0x66ff88); this.bayGlow.material.opacity = 0.4;
    if (this.round >= ROUNDS) return this.finishOnce(true);
    this.stage = 3; this.holdT = 1.4;
    this.next = () => this.newRound();
  }

  // ------------------------------------------------------------ hazards ----
  debrisTick(dt) {
    const c = this.c;
    if (this.stage === 3) { this.holdT -= dt; if (this.holdT <= 0) { this.stage = 0; this.next(); } return; }
    // spawn with a visible warning first
    if (this.debrisRate) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = this.debrisRate * rand(0.7, 1.3);
        const fromLeft = Math.random() < 0.5, y = rand(-6, 7);
        const w = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.warnTex || (this.warnTex = canvasTex(64, 64, (g, ww, hh) => { g.fillStyle = '#ff2a2a'; g.beginPath(); g.moveTo(32, 4); g.lineTo(60, 58); g.lineTo(4, 58); g.closePath(); g.fill(); g.lineWidth = 4; g.strokeStyle = '#111'; g.stroke(); g.fillStyle = '#fff'; g.font = '38px sans-serif'; g.textAlign = 'center'; g.fillText('!', 32, 52); })), depthTest: false }));
        w.scale.setScalar(2.2); w.position.set(fromLeft ? -15.5 : 15.5, y, 4); c.scene.add(w); this.warns.push({ w, t: 1.3, fromLeft, y });
        sfx(880, 0.1, 'square', 0.05); sfx(660, 0.1, 'square', 0.05);
      }
    }
    for (const wn of this.warns) {
      wn.t -= dt; wn.w.material.opacity = Math.floor(wn.t * 8) % 2 ? 1 : 0.35;
      if (wn.t <= 0) { wn.dead = true; c.scene.remove(wn.w); this.spawnDebris(wn.fromLeft, wn.y); }
    }
    this.warns = this.warns.filter((w) => !w.dead);
    for (const d of this.debris) {
      d.m.position.x += d.v.x * dt; d.m.position.y += d.v.y * dt; d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt; d.m.rotation.z += d.spin.z * dt;
      // vs claws
      this.arms.forEach((a, i) => {
        const dd = Math.hypot(d.m.position.x - a.g.x, d.m.position.y - a.g.y);
        if (dd < d.r + 1.1 && a.stun <= 0 && d.cool <= 0) {
          const nx = (a.g.x - d.m.position.x) / (dd || 1), ny = (a.g.y - d.m.position.y) / (dd || 1);
          a.stun = 0.6; a.vel.set(nx * 11, ny * 11); if (!this.attached[i]) { a.ctl.x += nx * 1.5; a.ctl.y += ny * 1.5; }
          d.v.x = -nx * 7; d.v.y = -ny * 7; d.cool = 0.5; this.hit(i, d, 3);
        }
      });
      // vs panel
      const p = this.panel, dxp = (d.m.position.x - p.position.x) / 5.2, dyp = (d.m.position.y - p.position.y) / 2.6;
      if (this.stage <= 1 && d.cool <= 0 && dxp * dxp + dyp * dyp < (1 + d.r / 4) ** 2) {
        d.cool = 0.6; const imp = 0.5;
        if (this.stage === 0) { this.pv.x += d.v.x * imp * 3; this.pv.y += d.v.y * imp * 3; this.rv += (Math.random() - 0.5) * 3; }
        d.v.multiplyScalar(-0.5); this.hit(-1, d, 4);
      }
      d.cool -= dt;
    }
    this.debris = this.debris.filter((d) => { const out = Math.abs(d.m.position.x) > 24 || Math.abs(d.m.position.y) > 16; if (out) c.scene.remove(d.m); return !out; });
  }
  spawnDebris(fromLeft, y) {
    const c = this.c, junk = Math.random() < 0.35;
    const m = junk ? mesh(new THREE.BoxGeometry(3, 0.12, 1.8), this.junkMat) : mesh(new THREE.IcosahedronGeometry(rand(0.9, 1.5), 0), this.rockMat);
    m.position.set(fromLeft ? -21 : 21, y, 0.8); c.scene.add(m);
    const sp = rand(6, 9.5) * (1 + this.round * 0.15), aim = rand(-0.12, 0.12);
    this.debris.push({ m, v: new THREE.Vector2((fromLeft ? 1 : -1) * sp, aim * sp), spin: new THREE.Vector3(rand(-3, 3), rand(-3, 3), rand(-4, 4)), r: junk ? 1.5 : 1.2, cool: 0 });
  }
  hit(who, d, dmg) {
    const c = this.c; this.hits++; this.o2 -= dmg;
    c.fx.shake(0.7, 0.35); c.fx.burst(d.m.position.clone().add(new THREE.Vector3(0, 0, 1)), 0xffb060, 16, 10, 0.3, 8); sfx(100, 0.2, 'sawtooth', 0.08, -40); sfx(240, 0.08, 'square', 0.05);
    c.ui.toast(who >= 0 ? 'BONK!' : 'PANEL HIT!', 650); if (who >= 0) c.rumble(who, 260); else { c.rumble(0, 180); c.rumble(1, 180); }
    c.fx.popup(`-${dmg} O2`, d.m.position.clone().add(new THREE.Vector3(0, 2, 2)), '#ff8080');
  }

  // ------------------------------------------------------------- visuals ----
  ambience(dt) {
    const c = this.c, low = this.o2 < 30;
    this.earth.rotation.y += dt * 0.02; this.stars.rotation.z += dt * 0.0015;
    this.lamps.forEach((o, i) => {
      const on = low ? Math.floor(this.time * 4 + i) % 2 : Math.floor(this.time * 1.2 + i) % 9 !== 0;
      const col = low ? (on ? 0xff2a2a : 0x330000) : (on ? 0x33cc66 : 0x113322);
      o.l.material.color.setHex(col); o.gl.material.color.setHex(col); o.gl.material.opacity = on ? 0.9 : 0.15;
    });
    this.alarm.intensity = low ? 400 * (0.5 + 0.5 * Math.sin(this.time * 8)) : 0;
    // camera: slow drift + gentle push-in on the current job
    this.zoom = lerp(this.zoom, this.stage === 0 ? 0 : 1.6, dt * 1.2);
    c.camera.position.set(Math.sin(this.time * 0.35) * 0.7, Math.cos(this.time * 0.27) * 0.45, 34 - this.zoom);
    c.camera.lookAt(0, 0.4, 0);
  }

  updateHud() {
    const c = this.c;
    c.ui.meter(this.$('#o2m'), clamp(this.o2 / 90, 0, 1));
    [0, 1, 2].forEach((i) => {
      const el = this.$('#s' + i), cur = this.stage === i, done = this.stage > i;
      el.style.opacity = cur ? 1 : done ? 0.55 : 0.4; el.style.color = done ? '#66ff88' : cur ? '#ffff00' : '#88aa88'; el.textContent = `${done ? '✔' : i + 1} ${STAGES[i]}`;
    });
    this.$('#rd').textContent = `PANEL ${Math.min(this.round + 1, ROUNDS)}/${ROUNDS}`;
    this.$('#ht').textContent = `💥 ${this.hits}`;
  }

  finishOnce(win) {
    if (this.over) return; this.over = true;
    const o2 = Math.max(0, Math.round(this.o2)), stars = !win ? 0 : (o2 > 70 && this.hits <= 2 ? 3 : o2 > 30 ? 2 : 1);
    this.c.finish(win,
      win ? [`All ${ROUNDS} panels fixed!`, '★'.repeat(stars) + '☆'.repeat(3 - stars), `${Math.round(this.time)}s · ${o2}s of air left · ${this.hits} bonks`]
          : ['The station ran out of air!', `Panels fixed: ${this.round}/${ROUNDS}`]);
  }

  dispose() { this.renderer.shadowMap.enabled = false; this.env?.dispose?.(); this.c.scene.environment = null; }
}
