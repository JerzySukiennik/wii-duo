import { THREE, clamp, lerp, rand, P_COLORS, PAL, box, cyl, ball, toy, sfx, gradientBG, canvasTex, checkerTex, texMat, blobShadow , snd, loopSnd } from '../common.js';

const LOGS = 4, TIME = 90, BEAT = 0.75, WINDOW = 0.3;

export default class Lumberjacks {
  init(ctx) {
    this.c = ctx; const { scene, camera, ui } = ctx;
    gradientBG(scene, '#3a9bff', '#d8f4ff'); scene.fog = new THREE.Fog(0xd8f4ff, 45, 120);
    const ground = new THREE.Mesh(new THREE.BoxGeometry(140, 1, 90), texMat(checkerTex('#6be675', '#5bd566', [28, 18]))); ground.position.set(0, -0.5, -10); scene.add(ground);
    const sun = ball(6, 0xfff3a0, 0); sun.material = new THREE.MeshBasicMaterial({ color: 0xfff3a0, fog: false }); sun.position.set(-30, 30, -60); scene.add(sun);
    this.clouds = Array.from({ length: 7 }, () => { const cl = new THREE.Group(); for (let k = 0; k < 3; k++) { const b = box(rand(4, 7), 2, 2.5, 0xffffff, 0.04); b.position.set(k * 3 - 3, rand(-.4, .4), 0); cl.add(b); } cl.position.set(rand(-60, 60), rand(16, 30), -rand(25, 50)); scene.add(cl); return cl; });
    const cabin = box(9, 6, 7, 0xb5683a, 0.03); cabin.position.set(-26, 3, -18); scene.add(cabin); const roof = cyl(0, 7, 4, 0xcc2222, 0.04); roof.rotation.y = Math.PI / 4; roof.position.set(-26, 8, -18); scene.add(roof);
    for (let i = 0; i < 24; i++) { const f = ball(0.25, [PAL.pink, PAL.yellow, 0xffffff, PAL.purple][i % 4], 0.1); f.position.set(rand(-30, 30), 0.3, rand(-4, 14)); scene.add(f); }
    for (let i = 0; i < 26; i++) { // background pines
      const tr = new THREE.Group(); const h = rand(6, 11);
      const trunk = cyl(0.5, 0.6, 2.5, 0x8a5a2b, 0.05); trunk.position.y = 1.2; tr.add(trunk);
      for (let k = 0; k < 3; k++) { const cn = cyl(0, 2.6 - k * 0.5, 3.4, i % 3 ? 0x1fa64a : 0x158a3a, 0.04); cn.position.y = 3.5 + k * 1.7; tr.add(cn); }
      tr.scale.setScalar(h / 8); tr.position.set(rand(-45, 45), 0, -rand(14, 38)); scene.add(tr);
    }
    // sawhorses + log
    for (const sx of [-6, 6]) { const l = box(1, 3, 4, 0x8a5a2b, 0.05); l.position.set(sx, 1.5, 0); scene.add(l); }
    this.log = new THREE.Group();
    this.logMesh = cyl(1.7, 1.7, 15, 0xc98d4f, 0.04); this.logMesh.rotation.z = Math.PI / 2; this.log.add(this.logMesh);
    const rings = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#e8bd85'; g.fillRect(0, 0, w, h); g.strokeStyle = '#b07a3e'; g.lineWidth = 3; for (let r = 6; r < 32; r += 7) { g.beginPath(); g.arc(32, 32, r, 0, 7); g.stroke(); } });
    for (const s of [-1, 1]) { const ring = cyl(1.4, 1.4, 0.05, 0xe8bd85, 0); ring.material = new THREE.MeshLambertMaterial({ map: rings }); ring.rotation.z = Math.PI / 2; ring.position.x = s * 7.52; this.log.add(ring); }
    this.notch = box(0.5, 0.2, 3.3, 0x3a1f0a, 0); this.notch.position.set(0, 1.7, 0); this.log.add(this.notch);
    this.log.position.set(0, 4.3, 0); scene.add(this.log);
    // lumberjacks (blocky)
    this.men = [-1, 1].map((sx, i) => {
      const g = new THREE.Group();
      const body = box(1.8, 2.6, 1.4, P_COLORS[i], 0.06); body.position.y = 1.3; g.add(body);
      const head = ball(0.8, 0xffcc99, 0.1); head.position.y = 3.3; g.add(head);
      const hat = box(1.7, 0.7, 1.7, i ? 0xcc2222 : 0x222288, 0.06); hat.position.y = 4.0; g.add(hat);
      const arm = box(0.6, 0.6, 2.4, P_COLORS[i], 0.08); arm.position.set(-sx * 0.2, 2.4, -1.2); g.add(arm); g.userData.arm = arm;
      const sh = blobShadow(3.4); g.add(sh); g.position.set(sx * 10.5, 0, 1.5); g.rotation.y = sx * -Math.PI / 2 + Math.PI / 2 * 0; scene.add(g); return g;
    });
    // saw
    this.saw = new THREE.Group();
    const blade = box(11, 1.4, 0.15, 0xdddddd, 0.15); this.saw.add(blade);
    for (let i = -5; i <= 5; i++) { const t = box(0.4, 0.4, 0.2, 0xaaaaaa, 0); t.position.set(i, -0.8, 0); t.rotation.z = Math.PI / 4; this.saw.add(t); }
    for (const s of [-1, 1]) { const h = box(0.7, 1.6, 0.7, 0x8a5a2b, 0.1); h.position.set(s * 5.8, 0.7, 0); this.saw.add(h); }
    this.saw.position.set(0, 5.2, 1.8); scene.add(this.saw);
    // sawdust particles
    this.dust = []; const dg = new THREE.BoxGeometry(0.22, 0.22, 0.22), dm = new THREE.MeshBasicMaterial({ color: 0xf5deb3 });
    for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(dg, dm); m.visible = false; scene.add(m); this.dust.push({ m, vx: 0, vy: 0, life: 0 }); }
    camera.position.set(0, 8.5, 27); camera.lookAt(0, 3.5, 0);
    this.t = 0; this.time = TIME; this.logsDone = 0; this.progress = 0; this.combo = 0; this.best = 0; this.hits = 0; this.score = 0;
    this.beatN = 0; this.claimed = new Set(); this.flash = [0, 0]; this.thick = 1;
    this.hud = ui.hud(`
      <div class="hudtop"><div class="pill" id="tm"></div><div style="text-align:center"><div class="tag">LOG ${'<span id="ln"></span>'}</div><div class="meter" id="pg"><i></i></div></div><div class="pill y" id="cb"></div></div>
      <div class="hudbottom"><div class="say" id="say">Swing when the saw reaches YOUR side!</div></div>`);
    this.$ = (s) => this.hud.querySelector(s);
    this.birds = loopSnd('birds_loop', { vol: 0.45 });
    this.startT = 1.2; // count-in before beat 0
    ui.toast('SAW TOGETHER!', 900);
  }

  update(dt) {
    const c = this.c; this.t += dt; this.time -= dt;
    // metronome: saw slides between the men; beat n belongs to player n%2 (saw at their side)
    const bt = this.t - this.startT, beat = Math.floor(bt / BEAT + 0.5); // nearest beat index
    const phase = bt / BEAT; // beat k happens at phase == k
    const sawX = bt < 0 ? 0 : -Math.cos(Math.PI * phase) * 3.8; // even beats -> left (-), odd -> right (+)
    this.saw.position.x = lerp(this.saw.position.x, sawX, 0.6);
    this.saw.position.y = 5.2 - this.progress * 0.5; this.log.position.y = 4.3;
    if (bt >= 0 && beat !== this.lastBeat) { this.lastBeat = beat; snd('metronome_tick', { rate: beat % 2 ? 1.2 : 0.92, pan: beat % 2 ? 0.6 : -0.6, vol: 0.7 }); }

    // swings
    c.swings.forEach((sw, i) => {
      const s = sw.update(dt);
      if (!s && !(c.edges[i].a)) return; // A also works as a fallback "swing" for testing
      if (bt < -WINDOW) return;
      const target = Math.round(bt / BEAT), err = Math.abs(bt - target * BEAT);
      const mine = ((target % 2) + 2) % 2 === i;
      if (mine && err < WINDOW && !this.claimed.has(target)) {
        this.claimed.add(target);
        const perfect = err < 0.12;
        this.combo++; this.best = Math.max(this.best, this.combo); this.hits++;
        const gain = (perfect ? 0.07 : 0.045) * (1 + Math.min(this.combo, 20) * 0.04) / this.thick;
        this.progress += gain; this.score += (perfect ? 20 : 10) + this.combo;
        this.flash[i] = 0.25; c.rumble(i, perfect ? 90 : 50); this.burst(sawX);
        c.fx.burst(new THREE.Vector3(this.saw.position.x * 0.9, 3.8, 2), 0xf5deb3, perfect ? 12 : 6, 7, 0.28, 16);
        if (perfect) c.fx.popup('PERFECT!', new THREE.Vector3(i ? 6 : -6, 8, 2), '#66ff88');
        if (this.combo > 0 && this.combo % 5 === 0) c.fx.popup(`x${this.combo}!`, new THREE.Vector3(0, 9, 2), '#ff9ad2');
        this.$('#say').textContent = perfect ? 'PERFECT!' : 'Nice!';
        snd(['saw_pull_1', 'saw_pull_2'], { pan: i ? 0.6 : -0.6, jitter: 0.1 }); if (perfect) snd('wood_chop', { vol: 0.6, pan: i ? 0.4 : -0.4 });
      } else if (!mine || err >= WINDOW) {
        if (this.combo > 0) this.$('#say').textContent = mine ? 'Too early/late!' : 'Wait for YOUR side!';
        this.combo = 0; c.rumble(i, 30);
      }
    });
    // missed beats break combo
    const lateBeat = Math.floor((bt - WINDOW) / BEAT);
    if (lateBeat >= 0 && !this.claimed.has(lateBeat) && lateBeat !== this.missedBeat) {
      this.missedBeat = lateBeat;
      if (this.combo > 0) this.$('#say').textContent = 'Missed the beat!';
      this.combo = 0;
    }
    // log cut -> next log
    if (this.progress >= 1) {
      this.logsDone++; this.progress = 0; this.thick += 0.35; this.score += 100; c.ui.toast('TIMBER!', 900); snd('log_crash'); c.fx.shake(0.6, 0.4); c.fx.burst(new THREE.Vector3(0, 4, 2), 0xc98d4f, 30, 11, 0.5, 14);
      this.logMesh.scale.y = 1; this.log.scale.set(1, this.thick, this.thick);
      if (this.logsDone >= LOGS) this.end(true);
    }
    this.clouds.forEach((cl) => { cl.position.x += dt * 0.8; if (cl.position.x > 70) cl.position.x = -70; });
    this.notch.scale.set(1 + this.progress * 14, 1, 1); this.notch.position.y = 1.7 - this.progress * 0.3;
    // arms follow saw; flashes
    this.men.forEach((m, i) => { this.flash[i] = Math.max(0, this.flash[i] - dt); m.userData.arm.position.z = -1.2 - this.flash[i] * 3; });
    this.dust.forEach((d) => { if (d.life > 0) { d.life -= dt; d.vy -= 20 * dt; d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.visible = d.life > 0 && d.m.position.y > 0; } });
    // HUD
    this.$('#tm').textContent = `${Math.max(0, Math.ceil(this.time))}s`; this.$('#tm').className = 'pill' + (this.time < 15 ? ' r' : '');
    this.$('#ln').textContent = `${Math.min(this.logsDone + 1, LOGS)}/${LOGS}`;
    c.ui.meter(this.$('#pg'), this.progress);
    this.$('#cb').textContent = `COMBO x${this.combo}`;
    if (this.time <= 0) this.end(false);
  }
  burst(x) {
    let n = 0; for (const d of this.dust) { if (d.life > 0) continue; d.life = rand(0.4, 0.8); d.m.position.set(x + rand(-0.5, 0.5), 3.6, 1.8); d.vx = rand(-4, 4); d.vy = rand(4, 9); d.m.visible = true; if (++n > 7) break; }
  }
  end(win) {
    if (this.over) return; this.over = true;
    this.c.finish(win, [win ? `All ${LOGS} logs sawn! Timber!!` : `Only ${this.logsDone}/${LOGS} logs. The saw is tired.`, `Best combo: x${this.best}`, `Score: ${this.score}`]);
  }
  dispose() { this.birds?.stop(); }
}
