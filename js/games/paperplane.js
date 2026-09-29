import { THREE, clamp, lerp, rand, P_COLORS, PAL, box, cyl, ball, toy, gradientBG, checkerTex, stripeTex, texMat, blobShadow } from '../common.js';

const MAXLEN = 11, SEG = 12, GOAL = 1400, HP = 5;

function makePlane(color) {
  // paper plane: flat dart of two wing triangles + a keel
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 0, -1.6,   -1.2, 0, 0.9,   0, 0, 0.5,
    0, 0, -1.6,    0, 0, 0.5,     1.2, 0, 0.9,
    0, 0, -1.6,    0, 0, 0.5,     0, -0.5, 0.6,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, flatShading: true }));
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x111111 }));
  m.add(edge); m.scale.setScalar(1.5);
  return m;
}

export default class PaperPlane {
  init(ctx) {
    this.c = ctx; const { scene, camera, ui } = ctx;
    gradientBG(scene, '#2f7fff', '#c8f0ff');
    scene.fog = new THREE.Fog(0xc8f0ff, 50, 190);
    this.groundTex = checkerTex('#6be675', '#4fcf5f', [60, 300]);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 3000), texMat(this.groundTex));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -14, -1400); scene.add(ground);
    this.sun = ball(14, 0xfff3a0, 0); this.sun.material = new THREE.MeshBasicMaterial({ color: 0xfff3a0, fog: false }); scene.add(this.sun);
    this.deco = [];
    for (let i = 0; i < 70; i++) {
      const cl = new THREE.Group();
      for (let k = 0; k < 4; k++) { const b = box(rand(4, 9), rand(2, 3.4), rand(3, 5), 0xffffff, 0.04); b.position.set(k * 3.4 - 5, rand(-.6, .6), rand(-1, 1)); cl.add(b); }
      cl.position.set(rand(-100, 100), rand(14, 46), -rand(0, 1600)); scene.add(cl); this.deco.push(cl);
    }
    for (let i = 0; i < 50; i++) {
      const h = cyl(0, rand(10, 24), rand(12, 26), i % 3 ? PAL.orange : PAL.purple, 0.03);
      h.position.set((Math.random() < .5 ? -1 : 1) * rand(34, 110), -6, -rand(0, 1600)); scene.add(h);
      const cap = cyl(0, 4, 5, 0xffffff, 0.03); cap.position.set(h.position.x, h.position.y + 8, h.position.z); cap.scale.setScalar(0.6); scene.add(cap);
    }
    // wind streaks give a real sense of speed
    this.streaks = Array.from({ length: 40 }, () => { const m = box(0.08, 0.08, rand(3, 7), 0xffffff, 0); m.position.set(rand(-30, 30), rand(-4, 22), -rand(0, 60)); m.material.transparent = true; m.material.opacity = 0.5; scene.add(m); return m; });
    this.planes = [makePlane(P_COLORS[0]), makePlane(P_COLORS[1])];
    this.st = [{ x: -4, y: 6, vx: 0, vy: 0 }, { x: 4, y: 6, vx: 0, vy: 0 }];
    this.planes.forEach((p) => scene.add(p));
    this.shadows = [blobShadow(3), blobShadow(3)]; this.shadows.forEach((sh) => { sh.position.y = -13.9; scene.add(sh); });
    this.trailT = 0;
    this.segs = Array.from({ length: SEG }, () => { const s = box(0.14, 0.14, 1, PAL.yellow, 0.35); scene.add(s); return s; });
    this.pts = Array.from({ length: SEG + 1 }, () => new THREE.Vector3());
    this.z = 0; this.speed = 18; this.hp = HP; this.inv = 0; this.rings = 0; this.score = 0;
    this.walls = []; this.nextWall = -40; this.ringObjs = [];
    this.hurt = 0; this.tightSay = 0;
    this.hud = ui.hud(`
      <div class="hudtop">
        <div class="pill" id="hp"></div>
        <div class="pill y" id="dist"></div>
        <div class="pill" id="rg"></div>
      </div>
      <div class="hudbottom"><div class="say" id="say">Fly through the holes TOGETHER!</div></div>`);
    this.$ = (s) => this.hud.querySelector(s);
    camera.position.set(0, 9, 14); this.cam = { x: 0, y: 8 };
    ui.toast('GO GO GO!');
    this.sayT = 3;
  }

  spawnWall(zw) {
    const gw = rand(11, 14), gh = 8, gx = rand(-9, 9), gy = rand(4.5, 10);
    const grp = new THREE.Group(); grp.position.z = zw;
    const col = [PAL.pink, PAL.yellow, PAL.purple, PAL.orange][this.walls.length % 4];
    const W = 48, YB = -14, YT = 26, t = 2;
    const x0 = gx - gw / 2, x1 = gx + gw / 2, y0 = gy - gh / 2, y1 = gy + gh / 2;
    const add = (xa, xb, ya, yb) => {
      if (xb - xa < 0.1 || yb - ya < 0.1) return;
      const m = box(xb - xa, yb - ya, t, col, 0.02); m.position.set((xa + xb) / 2, (ya + yb) / 2, 0); grp.add(m);
    };
    add(-W / 2, x0, YB, YT); add(x1, W / 2, YB, YT); add(x0, x1, YB, y0); add(x0, x1, y1, YT);
    const st = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, t + 0.3), texMat(stripeTex('#ffdd00', '#111', [Math.max(1, w / 3), Math.max(1, h / 3)]))); m.position.set(x, y, 0); grp.add(m); };
    st(gw + 1.2, 0.6, gx, y1 + 0.3); st(gw + 1.2, 0.6, gx, y0 - 0.3); st(0.6, gh, x0 - 0.3, gy); st(0.6, gh, x1 + 0.3, gy);
    this.c.scene.add(grp);
    const w = { z: zw, gx, gy, gw, gh, grp, hitT: 0 };
    this.walls.push(w);
    // a golden ring between this wall and the next
    const rz = zw - 20, rx = clamp(gx + rand(-5, 5), -12, 12), ry = clamp(gy + rand(-2, 2), 3, 12);
    const ring = toy(new THREE.TorusGeometry(2.6, 0.5, 8, 20), PAL.yellow, 0.1); ring.material = new THREE.MeshBasicMaterial({ color: 0xffe14a });
    ring.position.set(rx, ry, rz); this.c.scene.add(ring);
    this.ringObjs.push({ mesh: ring, x: rx, y: ry, z: rz, got: false });
  }

  inGap(w, x, y, margin = 0) {
    return Math.abs(x - w.gx) < w.gw / 2 - margin && Math.abs(y - w.gy) < w.gh / 2 - margin;
  }

  update(dt) {
    const c = this.c;
    // --- controls ---
    this.st.forEach((s, i) => {
      const t = c.tilts[i].read();
      s.vx = lerp(s.vx, t.x * 22, Math.min(1, dt * 4));
      s.vy = lerp(s.vy, t.y * 14, Math.min(1, dt * 4));
      s.x = clamp(s.x + s.vx * dt, -19, 19); s.y = clamp(s.y + s.vy * dt, 1.2, 15);
    });
    // tether: pull together if too far apart
    const [a, b] = this.st;
    let dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
    this.taut = dist > MAXLEN;
    if (this.taut) {
      const pull = (dist - MAXLEN) * 0.5, nx = dx / dist, ny = dy / dist;
      a.x += nx * pull; a.y += ny * pull; b.x -= nx * pull; b.y -= ny * pull;
      dx = b.x - a.x; dy = b.y - a.y; dist = Math.hypot(dx, dy);
    }
    this.speed = 18 + Math.min(14, -this.z / 100);
    this.z -= this.speed * (this.taut ? 0.75 : 1) * dt;
    this.inv -= dt; this.hurt -= dt;

    // --- planes ---
    this.planes.forEach((p, i) => {
      const s = this.st[i];
      p.position.set(s.x, s.y, this.z);
      p.rotation.set(s.vy * 0.03, 0, -s.vx * 0.045);
      p.visible = !(this.inv > 0 && Math.floor(this.inv * 14) % 2);
    });

    // --- rope (slack sags, taut goes straight) ---
    const slack = Math.max(0, MAXLEN - dist);
    for (let k = 0; k <= SEG; k++) {
      const u = k / SEG, sag = Math.sin(Math.PI * u);
      this.pts[k].set(lerp(a.x, b.x, u), lerp(a.y, b.y, u) - sag * slack * 0.35, this.z + 1.2 + sag * slack * 0.25);
    }
    this.segs.forEach((s, k) => {
      const p = this.pts[k], q = this.pts[k + 1];
      s.position.copy(p).lerp(q, 0.5); s.lookAt(q); s.scale.z = p.distanceTo(q);
      s.children[0].material.color?.set?.(0x111111);
      s.material.color.setHex(this.taut ? PAL.pink : PAL.yellow);
    });

    // --- walls & rings ---
    while (this.nextWall > this.z - 220) { this.spawnWall(this.nextWall); this.nextWall -= 42; }
    for (const w of this.walls) {
      w.grp.position.z = w.z;
      if (Math.abs(w.z - this.z) < 1.4 && this.inv <= 0) {
        const planeHit = this.st.some((s) => !this.inGap(w, s.x, s.y, 0.6));
        const ropeHit = this.pts.some((p) => Math.abs(p.z - w.z) < 1.6 && !this.inGap(w, p.x, p.y, 0.1));
        if (planeHit || ropeHit) this.hit(ropeHit && !planeHit ? 'SNAGGED!' : 'BONK!');
      }
    }
    this.walls = this.walls.filter((w) => { if (w.z > this.z + 30) { c.scene.remove(w.grp); return false; } return true; });
    for (const r of this.ringObjs) {
      r.mesh.rotation.y += dt * 2;
      if (!r.got && Math.abs(r.z - this.z) < 1.2) {
        const okA = Math.hypot(this.st[0].x - r.x, this.st[0].y - r.y) < 4.2, okB = Math.hypot(this.st[1].x - r.x, this.st[1].y - r.y) < 4.2;
        if (okA || okB) { r.got = true; r.mesh.visible = false; this.rings += okA && okB ? 2 : 1; c.fx.burst(r.mesh.position.clone(), 0xffe14a, 18, 8, 0.4, 6); c.fx.popup(okA && okB ? '+2 ★' : '+1 ★', r.mesh.position.clone().add(new THREE.Vector3(0, 2, 0))); this.say(okA && okB ? 'DOUBLE RING! ⭐⭐' : 'Ring! ⭐'); c.rumble(okA ? 0 : 1, 80); }
      }
    }
    this.ringObjs = this.ringObjs.filter((r) => { if (r.z > this.z + 30) { c.scene.remove(r.mesh); return false; } return true; });
    this.deco.forEach((d) => { if (d.position.z > this.z + 40) d.position.z -= 1650; });

    // --- polish: trails, streaks, shadows, sun ---
    this.trailT -= dt;
    if (this.trailT <= 0) { this.trailT = 0.05; this.planes.forEach((pl, i) => c.fx.burst(pl.position.clone().add(new THREE.Vector3(0, 0, 1.6)), i ? 0xffc2e6 : 0xc2f0ff, 1, 1.5, 0.22, 0)); }
    this.streaks.forEach((m) => { m.position.z += this.speed * 1.6 * dt; if (m.position.z > this.z + 30) { m.position.set(this.z * 0 + rand(-30, 30), rand(-4, 22), this.z - rand(60, 140)); } });
    this.planes.forEach((pl, i) => { this.shadows[i].position.set(pl.position.x, -13.9, pl.position.z); this.shadows[i].scale.setScalar(clamp(1.4 - (pl.position.y + 13) / 40, 0.5, 1.2)); });
    this.sun.position.set(-60, 55, this.z - 300);
    this.groundTex.offset.y = (this.z * 0.02) % 1;
    // --- camera ---
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    this.cam.x = lerp(this.cam.x, mx * 0.6, dt * 3); this.cam.y = lerp(this.cam.y, my * 0.55 + 4, dt * 3);
    c.camera.position.set(this.cam.x, this.cam.y + 2, this.z + 19 + (this.hurt > 0 ? Math.sin(this.hurt * 60) * 0.3 : 0));
    c.camera.lookAt(this.cam.x * 0.9, this.cam.y - 1.5, this.z - 12);

    // --- HUD ---
    this.sayT -= dt;
    if (this.sayT <= 0) this.$('#say').textContent = this.taut ? 'STRING IS TIGHT! Fly closer!' : 'Stay close. Both through the hole!';
    const dtot = Math.max(0, Math.floor(-this.z));
    this.$('#hp').textContent = '❤️'.repeat(this.hp) + '🖤'.repeat(HP - this.hp);
    this.$('#dist').textContent = `${dtot} / ${GOAL} m`;
    this.$('#rg').textContent = `⭐ ${this.rings}`;
    if (this.over) return;
    if (this.hp <= 0) { this.over = true; c.finish(false, [`You flew ${dtot} m!`, 'The string won this round.', `⭐ ${this.rings} rings`]); }
    else if (dtot >= GOAL) { this.over = true; c.finish(true, [`${GOAL} m, no string tangles!`, `⭐ ${this.rings} rings · ❤️ ${this.hp} left`]); }
  }

  say(t) { this.$('#say').textContent = t; this.sayT = 1.2; }
  hit(msg) {
    this.hp = Math.max(0, this.hp - 1); this.inv = 1.6; this.hurt = 0.4; this.say(msg + ' 💥'); this.c.ui.toast(msg, 700);
    this.c.rumble(0, 250); this.c.rumble(1, 250);
    this.c.fx.shake(0.7, 0.4);
    this.planes.forEach((pl) => this.c.fx.burst(pl.position.clone(), 0xffffff, 10, 7, 0.35, 10));
  }
  dispose() {}
}
