import { THREE, clamp, lerp, rand, pick, P_COLORS, PAL, box, cyl, ball, toy, gradientBG, canvasTex, checkerTex, texMat, sfx , snd } from '../common.js';

const COLORS = [
  { n: 'RED', h: 0xff2a2a }, { n: 'BLUE', h: 0x2a6bff }, { n: 'GREEN', h: 0x22cc44 },
  { n: 'YELLOW', h: 0xffdd00 }, { n: 'PURPLE', h: 0xaa44ff }, { n: 'WHITE', h: 0xffffff },
];
const ROUNDS = [
  { wires: 3, seq: 2, radius: 4.4, time: 50, speed: 0.5 },
  { wires: 4, seq: 2, radius: 3.8, time: 50, speed: 0.65 },
  { wires: 5, seq: 3, radius: 3.2, time: 55, speed: 0.8 },
  { wires: 6, seq: 3, radius: 2.7, time: 55, speed: 0.95 },
];
const css = (h) => '#' + h.toString(16).padStart(6, '0');

export default class Bomb {
  static pointer = [1];
  init(ctx) {
    this.c = ctx; const { scene, camera, ui } = ctx;
    gradientBG(scene, '#1a2a4a', '#4a3a6a');
    const table = new THREE.Mesh(new THREE.BoxGeometry(70, 1, 34), texMat(checkerTex('#c98d4f', '#b87b3f', [14, 7]))); table.position.set(0, -9.5, -4); scene.add(table);
    for (let i = 0; i < 6; i++) { const t = box(rand(1, 3), rand(3, 9), 1, [PAL.pink, PAL.blue, PAL.purple, PAL.green][i % 4], 0.04); t.position.set(-22 + i * 9, -3 + t.geometry.parameters.height / 2 - 5, -14); scene.add(t); }
    this.bomb = box(26, 15, 3, 0xd23a3a, 0.03); this.bomb.position.z = -1.6; scene.add(this.bomb);
    const face = box(24, 13, 0.3, 0x2a2a3a, 0); face.position.z = 0.05; scene.add(face);
    for (const sx of [-1, 1]) { const dyn = cyl(1.4, 1.4, 12, PAL.orange, 0.05); dyn.position.set(sx * 14.6, 0, -1.6); scene.add(dyn); }
    this.lcdC = document.createElement('canvas'); this.lcdC.width = 256; this.lcdC.height = 80;
    this.lcdT = new THREE.CanvasTexture(this.lcdC);
    const lcd = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.5), new THREE.MeshBasicMaterial({ map: this.lcdT })); lcd.position.set(0, 6.2, 0.3); scene.add(lcd);
    this.led = ball(0.5, 0xff2222, 0.1); this.led.material = new THREE.MeshBasicMaterial({ color: 0xff2222 }); this.led.position.set(-6.5, 6.2, 0.4); scene.add(this.led);
    this.lastTick = -1; this.lcdT0 = 0;
    this.zone = toy(new THREE.TorusGeometry(1, 0.045, 8, 48), 0x66ff66, 0.1); scene.add(this.zone);
    this.hand = new THREE.Group();
    const hb = ball(0.55, P_COLORS[0], 0.2); this.hand.add(hb);
    for (let i = 0; i < 3; i++) { const f = box(0.25, 1.2, 0.25, P_COLORS[0], 0.2); f.position.set((i - 1) * 0.4, 0.8, 0); this.hand.add(f); }
    this.hand.position.z = 1.2; scene.add(this.hand);
    camera.position.set(0, 0.5, 25); camera.lookAt(0, 0, 0);
    this.ray = new THREE.Raycaster();
    this.round = 0; this.strikes = 0; this.total = 0; this.t = 0;
    this.hud = ui.hud(`
      <div class="hudtop"><div class="pill" id="tm"></div><div class="pill y" id="rd"></div><div class="pill" id="sk"></div></div>
      <div class="hudbottom" style="flex-direction:column;align-items:center">
        <div class="say" id="clue"></div><div class="say" id="say" style="font-size:22px;background:#fff"></div></div>`);
    this.$ = (s) => this.hud.querySelector(s);
    this.wires = []; this.newRound();
  }

  newRound() {
    const cfg = this.cfg = ROUNDS[this.round];
    this.wires.forEach((w) => this.c.scene.remove(w.mesh)); this.wires = [];
    const cols = COLORS.slice().sort(() => Math.random() - 0.5).slice(0, cfg.wires);
    const span = 20, step = span / (cfg.wires - 1 || 1);
    cols.forEach((col, i) => {
      const w = box(0.7, 9, 0.5, col.h, 0.18);
      w.position.set(-span / 2 + i * step, 0.5, 0.5); this.c.scene.add(w);
      for (const sy of [-1, 1]) { const cap = box(1.1, 0.7, 0.9, 0xbbbbbb, 0.15); cap.position.set(0, sy * 4.6, 0); w.add(cap); }
      const pick = box(2.2, 9.6, 1, 0xffffff, 0); pick.material.visible = false; pick.position.copy(w.position); w.userData.pick = pick;
      this.wires.push({ col, mesh: w, cut: false, pick });
      this.c.scene.add(pick);
    });
    this.order = cols.slice().sort(() => Math.random() - 0.5).slice(0, cfg.seq).map((c) => c.n);
    this.next = 0; this.time = cfg.time; this.zone.scale.setScalar(cfg.radius);
    this.setClue();
    this.c.ui.toast(`BOMB ${this.round + 1}`, 900);
  }
  setClue() {
    const parts = this.order.map((n, i) => {
      const col = COLORS.find((c) => c.n === n);
      return `<span style="${i < this.next ? 'opacity:.3;text-decoration:line-through' : ''};color:#000;background:${css(col.h)};padding:0 8px;border:2px solid #000">${n}</span>`;
    });
    this.$('#clue').innerHTML = 'CUT: ' + parts.join(' &rarr; ');
  }
  say(t) { this.$('#say').textContent = t; }

  update(dt) {
    const c = this.c; this.t += dt; this.time -= dt;
    // steady zone drifts along a lissajous; P1's tilt drives the hand
    const sp = this.cfg.speed, R = this.cfg.radius;
    const zx = Math.sin(this.t * sp) * (11 - R), zy = Math.cos(this.t * sp * 0.75) * (5 - R * 0.35);
    this.zone.position.set(zx, zy, 1);
    const t = c.tilts[0].read();
    const hx = t.x * 11, hy = t.y * 5.5;
    this.hand.position.x = lerp(this.hand.position.x, hx, 0.35); this.hand.position.y = lerp(this.hand.position.y, hy, 0.35);
    const dist = Math.hypot(this.hand.position.x - zx, this.hand.position.y - zy);
    this.stable = dist < R * 0.85;
    this.zone.material.color.setHex(this.stable ? 0x66ff66 : 0xff4444);
    this.hand.rotation.z = Math.sin(this.t * 20) * (this.stable ? 0.02 : 0.25);

    // P2 cuts with the pointer
    const r2 = c.remotes[1], pt = r2.state.pointer;
    if (c.edges[1].a && pt.valid) {
      this.ray.setFromCamera({ x: pt.x * 2 - 1, y: -(pt.y * 2 - 1) }, c.camera);
      const hit = this.ray.intersectObjects(this.wires.filter((w) => !w.cut).map((w) => w.pick), false)[0];
      if (hit) this.tryCut(this.wires.find((w) => w.pick === hit.object));
    }
    // shake the uncut wires a little when the hand is wobbly
    this.wires.forEach((w, i) => { if (!w.cut) w.mesh.rotation.z = this.stable ? 0 : Math.sin(this.t * 30 + i) * 0.06; });
    if (!this.stable) this.say('P1: keep the hand inside the ring!'); else this.say('P2: point at a wire and press A!');

    const left = Math.max(0, this.time), sec = Math.ceil(left), fast = left < 10;
    if (sec !== this.lastTick) { this.lastTick = sec; snd(fast ? 'bomb_beep_fast' : 'bomb_tick', { vol: fast ? 0.9 : 0.7 }); }
    this.led.material.color.setHex(Math.floor(this.t * (fast ? 8 : 2)) % 2 ? 0xff2222 : 0x440000);
    this.lcdT0 -= dt;
    if (this.lcdT0 <= 0) {
      this.lcdT0 = 0.1; const g = this.lcdC.getContext('2d');
      g.fillStyle = '#100'; g.fillRect(0, 0, 256, 80); g.fillStyle = fast && Math.floor(this.t * 4) % 2 ? '#ff8080' : '#ff2222';
      g.font = '64px VT323, monospace'; g.textAlign = 'center'; g.fillText(`${String(Math.floor(left / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}.${String(Math.floor((left * 10) % 10))}`, 128, 56);
      g.font = '22px VT323, monospace'; g.fillStyle = '#f66'; g.textAlign = 'left'; g.fillText('X'.repeat(this.strikes) + '-'.repeat(3 - this.strikes), 8, 22);
      this.lcdT.needsUpdate = true;
    }
    this.$('#tm').textContent = `${Math.max(0, Math.ceil(this.time))}s`; this.$('#tm').className = 'pill' + (this.time < 10 ? ' r' : '');
    this.$('#rd').textContent = `BOMB ${Math.min(this.round + 1, ROUNDS.length)}/${ROUNDS.length}`;
    this.$('#sk').textContent = '💥'.repeat(this.strikes) + '⬜'.repeat(3 - this.strikes);
    if (this.time <= 0) this.end(false, 'BOOM! The timer hit zero.');
  }

  tryCut(w) {
    const c = this.c;
    if (!this.stable) { this.time -= 5; c.rumble(0, 250); c.rumble(1, 250); c.ui.toast('TOO WOBBLY!', 800); c.fx.shake(0.5, 0.3); snd('wire_wrong', { vol: 0.6, rate: 1.3 }); this.say('The hand shook! -5s'); return; }
    if (w.col.n === this.order[this.next]) {
      w.cut = true; w.mesh.scale.y = 0.35; w.mesh.position.y = 3; w.mesh.rotation.z = 0.4; w.mesh.material.color.setHex(0x333333);
      this.next++; this.setClue(); c.rumble(1, 80); snd('wire_snip', { pan: 0.4, jitter: 0.1 });
      c.fx.burst(w.mesh.position.clone().add(new THREE.Vector3(0, 0, 1)), w.col.h, 16, 9, 0.3, 12); c.fx.popup('SNIP!', w.mesh.position.clone().add(new THREE.Vector3(0, 4, 2)));
      if (this.next >= this.order.length) {
        this.total += Math.max(0, Math.ceil(this.time)); this.round++;
        if (this.round >= ROUNDS.length) this.end(true, 'All 4 bombs defused! 🎉');
        else { c.ui.toast('DEFUSED!', 900); snd('defuse_ok'); this.newRound(); }
      }
    } else {
      this.strikes++; this.time -= 8; c.rumble(0, 350); c.rumble(1, 350); c.ui.toast('WRONG WIRE!', 900); c.fx.shake(0.9, 0.5); snd('wire_wrong'); snd('explosion', { vol: 0.5 }); c.fx.burst(new THREE.Vector3(0, 0, 2), 0xff5522, 26, 12, 0.5, 8);
      if (this.strikes >= 3) this.end(false, 'BOOM! Three wrong wires.');
    }
  }
  end(win, line) {
    if (this.over) return; this.over = true;
    this.c.finish(win, [line, `Bombs defused: ${this.round}/${ROUNDS.length}`, `Time bonus: ${this.total}s`]);
  }
  dispose() {}
}
