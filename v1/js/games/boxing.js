import { THREE, clamp, lerp, rand, pick, P_COLORS, PAL, box, cyl, ball, labelSprite, sfx, gradientBG, canvasTex, texMat, blobShadow } from '../common.js';

const MOVES = { y: { n: 'JAB', c: '#ffdd00' }, x: { n: 'HOOK', c: '#4cc9f0' }, z: { n: 'UPPER', c: '#ff6fb5' } };
const HP = 10, WAVES = 6, BOSS = new Set([3, 6]);

export default class Boxing {
  init(ctx) {
    this.c = ctx; const { scene, camera, ui } = ctx;
    gradientBG(scene, '#12062e', '#5a1f7a'); scene.fog = new THREE.Fog(0x3a1660, 40, 110);
    const ring = box(30, 1, 60, 0xe84a5f, 0.02); ring.position.set(0, -0.5, -18); scene.add(ring);
    const matTex = canvasTex(128, 256, (g, w, h) => { g.fillStyle = '#f5f5f5'; g.fillRect(0, 0, w, h); g.fillStyle = '#ff6fb5'; g.font = '44px "Comic Neue", Comic Sans MS, sans-serif'; g.textAlign = 'center'; g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2); g.fillText('WII-DUO', 0, 12); g.restore(); g.strokeStyle = '#4cc9f0'; g.lineWidth = 6; g.strokeRect(4, 4, w - 8, h - 8); });
    const mat = new THREE.Mesh(new THREE.BoxGeometry(26, 0.1, 56), texMat(matTex)); mat.position.set(0, 0.03, -18); scene.add(mat);
    // crowd of blocky fans + spotlights
    this.crowd = [];
    for (let r = 0; r < 3; r++) for (let i = 0; i < 16; i++) {
      const f = new THREE.Group(); const col = [PAL.pink, PAL.blue, PAL.yellow, PAL.green, PAL.orange, PAL.purple][(i + r) % 6];
      const b = box(1.6, 1.8, 1.2, col, 0.08); b.position.y = 0.9; f.add(b); const hd = ball(0.7, 0xffcc99, 0.1); hd.position.y = 2.3; f.add(hd);
      f.position.set(-30 + i * 4 + (r % 2) * 2, 1 + r * 1.6, -46 - r * 4); f.userData = { base: f.position.y, ph: rand(0, 6) }; scene.add(f); this.crowd.push(f);
    }
    for (const sx of [-12, 0, 12]) { const cone = new THREE.Mesh(new THREE.ConeGeometry(7, 26, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffcc, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false })); cone.position.set(sx, 13, -14); scene.add(cone); }
    for (const sx of [-14, 14]) for (const sz of [-44, 8]) { const p = cyl(0.5, 0.5, 5, PAL.yellow, 0.05); p.position.set(sx, 2.5, sz); scene.add(p); }
    for (const sx of [-14, 14]) for (const k of [1.5, 3, 4.5]) { const r = box(0.25, 0.25, 52, k > 3 ? PAL.pink : 0xffffff, 0.1); r.position.set(sx, k, -18); scene.add(r); }
    // boxers
    this.boxers = [-1, 1].map((sx, i) => {
      const g = new THREE.Group();
      const body = box(2.2, 3, 1.5, P_COLORS[i], 0.06); body.position.y = 2; g.add(body);
      const head = ball(0.95, 0xffcc99, 0.1); head.position.y = 4.2; g.add(head);
      const band = box(2, 0.4, 2, PAL.white, 0.08); band.position.y = 4.7; g.add(band);
      const gloves = [-1, 1].map((s) => { const gl = ball(0.75, i ? 0xcc0044 : 0x0077cc, 0.12); gl.position.set(s * 1.5, 2.6, -1.4); g.add(gl); return gl; });
      g.userData = { gloves, base: gloves.map((gl) => gl.position.clone()), t: 0, move: null, hand: 0 };
      g.add(blobShadow(4)); g.position.set(sx * 5, 0, 4); scene.add(g); return g;
    });
    this.enemies = []; this.flying = []; this.wave = 0; this.hp = HP; this.score = 0; this.mult = 1; this.lastP = -1; this.block = [false, false];
    this.spawnQ = 0; this.waveActive = false; this.gap = 0; this.time = 0; this.hurt = 0;
    camera.position.set(0, 9, 15); camera.lookAt(0, 2, -8);
    this.hud = ui.hud(`
      <div class="hudtop"><div class="pill" id="hp"></div><div class="pill y" id="wv"></div><div class="pill" id="sc"></div></div>
      <div class="hudbottom"><div class="say" id="say">Swing to punch! Alternate players for a big combo!</div></div>`);
    this.$ = (s) => this.hud.querySelector(s);
    this.nextWave();
  }

  nextWave() {
    this.wave++; this.spawnQ = BOSS.has(this.wave) ? 1 : 2 + this.wave; this.gap = 0; this.waveActive = true; this.waveSpeed = 3.2 + this.wave * 0.5;
    this.c.ui.toast(BOSS.has(this.wave) ? 'BOSS DUMMY!' : `WAVE ${this.wave}`, 1000);
  }
  spawn() {
    const boss = BOSS.has(this.wave), seq = boss ? Array.from({ length: 3 }, () => pick(Object.keys(MOVES))) : [pick(Object.keys(MOVES))];
    const g = new THREE.Group(), s = boss ? 1.6 : 1;
    const body = cyl(1.1, 1.4, 3.4, boss ? PAL.purple : PAL.orange, 0.06); body.position.y = 1.7; g.add(body);
    const head = ball(1, 0xffe0b0, 0.1); head.position.y = 4.1; g.add(head);
    for (const sx of [-0.35, 0.35]) { const e = ball(0.16, 0x111111, 0); e.position.set(sx, 4.25, 0.9); g.add(e); }
    const mouth = box(0.7, 0.14, 0.1, 0x111111, 0); mouth.position.set(0, 3.8, 0.95); g.add(mouth);
    g.add(blobShadow(3.2));
    if (boss) { const crown = cyl(1, 0.8, 0.8, PAL.yellow, 0.1); crown.position.y = 5.4; g.add(crown); }
    g.scale.setScalar(s); g.position.set(rand(-7, 7), 0, -38); this.c.scene.add(g);
    const lab = labelSprite(MOVES[seq[0]].n, MOVES[seq[0]].c); lab.scale.multiplyScalar(1.7); lab.position.set(0, 7.4, 0); g.add(lab);
    this.enemies.push({ g, seq, idx: 0, hp: seq.length, boss, lab, wob: rand(0, 6), atk: 0 });
  }
  setLabel(e) {
    const m = MOVES[e.seq[e.idx]]; const cv = e.lab.userData.canvas, g = cv.getContext('2d');
    const w = cv.width, h = cv.height; g.clearRect(0, 0, w, h);
    g.fillStyle = '#111'; g.beginPath(); g.roundRect(4, 8, w - 4, h - 8, 22); g.fill();
    g.fillStyle = m.c; g.strokeStyle = '#111'; g.lineWidth = 8; g.beginPath(); g.roundRect(4, 4, w - 16, h - 16, 22); g.fill(); g.stroke();
    g.fillStyle = '#111'; g.font = `${h * 0.5}px "Comic Neue", Comic Sans MS, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(m.n + (e.seq.length > 1 ? ` ${e.idx + 1}/${e.seq.length}` : ''), (w - 12) / 2, h / 2 - 6); e.lab.material.map.needsUpdate = true;
  }

  update(dt) {
    const c = this.c; this.time += dt; this.hurt -= dt;
    // spawn
    if (this.waveActive && this.spawnQ > 0) { this.gap -= dt; if (this.gap <= 0) { this.spawn(); this.spawnQ--; this.gap = rand(1.6, 2.6); } }
    if (this.waveActive && this.spawnQ === 0 && this.enemies.length === 0) {
      this.waveActive = false;
      if (this.wave >= WAVES) return this.end(true);
      this.wait = 1.2;
    }
    if (!this.waveActive && this.wait > 0) { this.wait -= dt; if (this.wait <= 0) this.nextWave(); }
    // blocking
    this.block = c.remotes.map((r) => !!r.state.buttons.b);
    // punches
    c.swings.forEach((sw, i) => {
      let s = sw.update(dt);
      const e = c.edges[i]; // keyboard/testing fallbacks: A = jab
      if (!s && e.a) s = { axis: 'y', sign: 1, power: 1 };
      if (!s) return;
      this.punch(i, s.axis);
    });
    // enemies approach
    for (const e of this.enemies) {
      e.wob += dt * 4; e.g.position.z += this.waveSpeed * (e.boss ? 0.45 : 1) * dt; e.g.rotation.z = Math.sin(e.wob) * 0.08;
      e.g.position.y = Math.abs(Math.sin(e.wob * 1.2)) * 0.3;
      if (e.g.position.z > -1.5) { // reached the ring edge: swing at the nearest player
        e.atk += dt; e.g.scale.setScalar((e.boss ? 1.6 : 1) * (1 + Math.max(0, e.atk - 0.5) * 0.4)); e.g.children[0].material.color.setHex(e.atk > 0.5 ? 0xff2222 : (e.boss ? PAL.purple : PAL.orange));
        if (e.atk > 0.9) {
          e.atk = 0; const i = e.g.position.x < 0 ? 0 : 1;
          if (this.block[i]) { c.rumble(i, 40); this.say('BLOCKED! 🛡️'); sfx(180, 0.06, 'square'); }
          else { this.hp -= e.boss ? 2 : 1; this.hurt = 0.3; this.mult = 1; c.rumble(i, 250); c.ui.toast('OUCH!', 500); sfx(120, 0.2, 'sawtooth', 0.07); c.fx.shake(0.8, 0.35); c.fx.burst(this.boxers[i].position.clone().add(new THREE.Vector3(0, 4, 0)), 0xff2222, 12, 8, 0.35, 10); }
          e.g.position.z -= 4;
        }
      }
    }
    for (const f of this.flying) { f.life -= dt; f.vy -= 40 * dt; f.g.position.x += f.vx * dt; f.g.position.y += f.vy * dt; f.g.position.z += f.vz * dt; f.g.rotation.z += dt * 12; if (f.life <= 0) this.c.scene.remove(f.g); }
    this.flying = this.flying.filter((f) => f.life > 0);
    this.crowd.forEach((f) => { const u = f.userData; f.position.y = u.base + Math.abs(Math.sin(this.time * (this.mult > 2 ? 6 : 3) + u.ph)) * (this.mult > 2 ? 0.9 : 0.35); });
    // boxer animation
    this.boxers.forEach((b, i) => {
      const u = b.userData; u.t = Math.max(0, u.t - dt * 5);
      const up = u.hand; const gl = u.gloves[up], base = u.base[up];
      const k = Math.sin(u.t * Math.PI); // 0..1..0
      gl.position.copy(base);
      if (u.move === 'y') gl.position.z -= k * 3.5; else if (u.move === 'x') { gl.position.x += (up ? -1 : 1) * -k * 2.6; gl.position.z -= k * 1.6; } else if (u.move === 'z') { gl.position.y += k * 2.2; gl.position.z -= k * 1.4; }
      if (this.block[i]) { u.gloves.forEach((g2, j) => g2.position.set((j ? 1 : -1) * 0.6, 4.1, -1.3)); }
      b.rotation.z = this.hurt > 0 ? Math.sin(this.hurt * 60) * 0.06 : 0;
    });
    // HUD
    this.$('#hp').textContent = '❤️'.repeat(Math.max(0, this.hp)) + '🖤'.repeat(Math.max(0, HP - this.hp));
    this.$('#wv').textContent = `WAVE ${Math.min(this.wave, WAVES)}/${WAVES}`;
    this.$('#sc').textContent = `${this.score}  x${this.mult}`;
    if (this.hp <= 0) this.end(false);
  }
  say(t) { this.$('#say').textContent = t; }

  punch(i, axis) {
    const c = this.c, b = this.boxers[i].userData;
    b.move = axis; b.t = 1; b.hand = 1 - b.hand;
    if (this.block[i]) return;
    // best target: nearest enemy in punching range whose current move matches, on or near this side
    const range = this.enemies.filter((e) => e.g.position.z > -14).sort((a, z) => z.g.position.z - a.g.position.z);
    const tgt = range.find((e) => e.seq[e.idx] === axis);
    if (!tgt) { if (range.length) { this.mult = 1; this.say(`Wrong punch! Needs a ${MOVES[range[0].seq[range[0].idx]].n}`); } sfx(160, 0.05, 'square'); return; }
    // alternate-player combo
    this.mult = this.lastP === i ? 1 : Math.min(6, this.mult + 1); this.lastP = i;
    tgt.idx++; this.score += 10 * this.mult; c.rumble(i, 80); sfx(300 + this.mult * 60, 0.09, 'square', 0.06);
    tgt.g.position.z -= 2.4; tgt.g.rotation.x = -0.3;
    const hp = tgt.g.position.clone().add(new THREE.Vector3(0, 4, 1)); c.fx.burst(hp, [0xffdd00, 0x4cc9f0, 0xff6fb5][['y', 'x', 'z'].indexOf(axis)], 10, 9, 0.3, 10); c.fx.popup(['POW!', 'BAM!', 'WHAM!', 'BOOM!'][Math.floor(Math.random() * 4)], hp, '#ffdd00'); c.fx.shake(0.25, 0.15);
    if (tgt.idx >= tgt.seq.length) { // down!
      this.score += 50 * this.mult; this.enemies = this.enemies.filter((e) => e !== tgt); this.flying.push({ g: tgt.g, vx: (tgt.g.position.x < 0 ? -1 : 1) * rand(10, 18), vy: 22, vz: -rand(8, 14), life: 1.2 }); tgt.lab.visible = false; c.fx.shake(0.5, 0.3); sfx(800, 0.18, 'square', 0.06, 300);
      this.say(this.mult > 1 ? `COMBO x${this.mult}! Keep switching players!` : 'KO!');
    } else this.setLabel(tgt);
  }
  end(win) {
    if (this.over) return; this.over = true;
    this.c.finish(win, [win ? 'All waves cleared! Champions!!' : 'The dummies won this round.', `Wave: ${Math.min(this.wave, WAVES)}/${WAVES}`, `Score: ${this.score}`]);
  }
  dispose() {}
}
