import { THREE, clamp, lerp, rand, P_COLORS, PAL, box, cyl, ball, toy, canvasTex, stripeTex, texMat, blobShadow, labelSprite } from '../common.js';

const DOORS = [-40, -90, -140], LOOT_Z = -178, W = 9, TIME = 150;

export default class Heist {
  static pointer = [1];
  init(ctx) {
    this.c = ctx; const { scene, camera, ui } = ctx;
    scene.background = new THREE.Color(0x140a2a); scene.fog = new THREE.Fog(0x140a2a, 30, 90);
    const tile = canvasTex(64, 64, (g, w, hh) => { g.fillStyle = '#2a1f4d'; g.fillRect(0, 0, w, hh); g.strokeStyle = '#a06bff'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, hh - 3); g.fillStyle = '#3b2f66'; g.fillRect(8, 8, w - 16, hh - 16); }, [6, 46]);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 2, 1, 230), texMat(tile)); floor.position.set(0, -0.5, -95); scene.add(floor);
    const wallTex = canvasTex(64, 64, (g, w, hh) => { g.fillStyle = '#ff6fb5'; g.fillRect(0, 0, w, hh); g.fillStyle = '#e2559a'; g.fillRect(0, 0, w, 6); g.fillRect(0, hh - 6, w, 6); g.fillStyle = '#ffd0ea'; g.fillRect(28, 20, 8, 24); }, [1, 40]);
    for (const sx of [-1, 1]) { const wall = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 230), texMat(wallTex)); wall.position.set(sx * (W + 1), 3, -95); scene.add(wall); }
    this.lampsL = [];
    for (let z = 0; z > -230; z -= 10) for (const sx of [-1, 1]) { const l = box(0.4, 0.4, 1.4, 0xffee88, 0); l.material = new THREE.MeshBasicMaterial({ color: 0xffee88 }); l.position.set(sx * (W - 0.1), 5, z); scene.add(l); }
    this.guardShadows = [];
    // drone
    this.drone = new THREE.Group();
    this.drone.add(box(1.6, 0.6, 1.6, P_COLORS[0], 0.1));
    this.rotors = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => { const r = box(1.4, 0.08, 0.25, 0xffffff, 0.2); r.position.set(x * 1.1, 0.5, z * 1.1); this.drone.add(r); return r; });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 3, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = -1.6; this.drone.add(beam);
    this.drone.position.set(0, 3, 4); scene.add(this.drone); this.dp = { x: 0, z: 4 };
    this.dshadow = blobShadow(3.2); scene.add(this.dshadow);
    // guards
    this.guards = [];
    const gz = [-18, -28, -60, -72, -110, -122, -155];
    gz.forEach((z, i) => {
      const g = new THREE.Group();
      g.add(box(1.4, 2.4, 1.2, PAL.orange, 0.06)); const head = ball(0.7, 0xffcc99, 0.1); head.position.y = 1.8; g.add(head);
      const hat = box(1.6, 0.4, 1.6, 0x222266, 0.06); hat.position.y = 2.4; g.add(hat);
      const cone = new THREE.Mesh(new THREE.CircleGeometry(10, 16, -0.52, 1.04), new THREE.MeshBasicMaterial({ color: 0xffee00, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      cone.rotation.x = -Math.PI / 2; cone.position.y = 0.08; g.add(cone); g.userData.cone = cone;
      const ex = labelSprite('!', '#ff2222', '#fff', 96, 96); ex.position.set(0, 4.4, 0); ex.visible = false; g.add(ex); g.userData.ex = ex;
      const sh = blobShadow(2.6); sh.position.y = -1.1; g.add(sh);
      g.position.set(0, 1.2, z); scene.add(g);
      this.guards.push({ g, z, ph: rand(0, 6), sp: rand(0.5, 0.9), amp: rand(4.5, 7.5), heading: 0, spot: false });
    });
    // doors
    this.doors = DOORS.map((z) => {
      const d = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 6, 1), texMat(stripeTex('#ff2a2a', '#5a0010', [12, 1]))); d.position.set(0, 3, z); scene.add(d);
      const lock = ball(1.2, PAL.yellow, 0.1); lock.position.set(0, 3, z + 0.8); scene.add(lock);
      return { z, mesh: d, lock, open: false, y: 0 };
    });
    const ped = cyl(2.4, 3, 1.4, 0xffffff, 0.05); ped.position.set(0, 0.7, LOOT_Z); scene.add(ped);
    for (let i = 0; i < 14; i++) { const coin = cyl(0.6, 0.6, 0.2, PAL.yellow, 0.1); coin.position.set(rand(-6, 6), 0.1 + (i % 3) * 0.2, LOOT_Z + rand(-4, 5)); coin.rotation.x = rand(-0.4, 0.4); scene.add(coin); }
    this.loot = toy(new THREE.OctahedronGeometry(1.6), PAL.yellow, 0.08); this.loot.position.set(0, 2.2, LOOT_Z); scene.add(this.loot);
    this.hackNodes = []; this.hacking = null;
    this.alarm = 0; this.time = TIME; this.doorsOpen = 0;
    this.hud = ui.hud(`
      <div class="hudtop"><div class="pill" id="tm"></div><div style="text-align:center"><div class="tag" style="color:#f00">ALARM</div><div class="meter" id="al"><i></i></div></div><div class="pill y" id="dr"></div></div>
      <div class="hudbottom"><div class="say" id="say"></div></div>`);
    this.$ = (s) => this.hud.querySelector(s);
    this.say('P1: fly the drone (tilt). P2: hack doors (point + A).');
    camera.position.set(0, 16, 20); ui.toast('SHHH...', 900);
  }
  say(t) { this.$('#say').textContent = t; }

  startHack(door) {
    const n = 3 + DOORS.indexOf(door.z);
    this.hacking = { door, n, next: 1, t: 9 };
    this.clearNodes();
    for (let i = 1; i <= n; i++) {
      const el = document.createElement('div'); el.className = 'node' + (i === 1 ? ' next' : ''); el.textContent = i;
      const pos = { x: rand(0.18, 0.82), y: rand(0.22, 0.72) };
      el.style.left = pos.x * 100 + 'vw'; el.style.top = pos.y * 100 + 'vh'; document.body.appendChild(el);
      this.hackNodes.push({ el, pos, i });
    }
    this.say('P2: HACK IT! Point at 1, 2, 3... and press A!');
  }
  clearNodes() { this.hackNodes.forEach((n) => n.el.remove()); this.hackNodes = []; }

  update(dt) {
    const c = this.c; this.time -= dt;
    // --- drone (P1 tilt) ---
    const t = c.tilts[0].read();
    this.dp.x = clamp(this.dp.x + t.x * 15 * dt, -W + 1, W - 1);
    let nz = this.dp.z - t.y * 15 * dt;
    const blocking = this.doors.find((d) => !d.open && this.dp.z >= d.z + 1.6 && nz < d.z + 1.6);
    if (blocking) nz = blocking.z + 1.6;
    this.dp.z = clamp(nz, LOOT_Z, 8);
    this.drone.position.set(this.dp.x, 3 + Math.sin(performance.now() / 200) * 0.15, this.dp.z);
    this.drone.rotation.set(t.y * -0.3, 0, -t.x * 0.4);
    this.rotors.forEach((r) => (r.rotation.y += dt * 40));

    // --- guards + alarm ---
    let seen = false;
    this.guards.forEach((gd, i) => {
      const x = Math.sin(performance.now() / 1000 * gd.sp + gd.ph) * gd.amp;
      const vx = Math.cos(performance.now() / 1000 * gd.sp + gd.ph);
      gd.g.position.x = x; gd.g.rotation.y = Math.PI / 2; // cone faces down the corridor (-z)
      const dx = this.dp.x - x, dz = this.dp.z - gd.z;
      const dist = Math.hypot(dx, dz), ang = Math.atan2(dx, -dz); // 0 = straight toward -z
      const sees = dist < 10 && Math.abs(ang) < 0.55 && dz < 0.5;
      gd.g.userData.cone.material.color.setHex(sees ? 0xff2222 : 0xffee00);
      gd.g.userData.cone.material.opacity = sees ? 0.55 : 0.3;
      gd.g.userData.ex.visible = sees; gd.g.userData.ex.position.y = 4.4 + Math.sin(performance.now() / 60) * 0.15;
      if (sees && !gd.spot) { gd.spot = true; c.fx.shake(0.25, 0.2); c.fx.burst(gd.g.position.clone().add(new THREE.Vector3(0, 4, 0)), 0xff2222, 6, 5, 0.25, 6); } else if (!sees) gd.spot = false;
      seen = seen || sees;
    });
    this.alarm = clamp(this.alarm + (seen ? 42 : -9) * dt, 0, 100);
    if (seen && Math.random() < dt * 4) c.rumble(0, 60);

    // --- doors / hacking ---
    const near = this.doors.find((d) => !d.open && Math.abs(this.dp.z - d.z) < 7);
    if (near && !this.hacking) this.startHack(near);
    if (this.hacking) {
      const h = this.hacking; h.t -= dt;
      const pt = c.remotes[1].state.pointer;
      if (c.edges[1].a && pt.valid) {
        const px = pt.x, py = pt.y;
        const hit = this.hackNodes.find((n) => Math.hypot((n.pos.x - px) * innerWidth, (n.pos.y - py) * innerHeight) < 55);
        if (hit) {
          if (hit.i === h.next) {
            hit.el.className = 'node done'; h.next++; c.rumble(1, 50);
            const nx = this.hackNodes.find((n) => n.i === h.next); if (nx) nx.el.className = 'node next';
            if (h.next > h.n) { h.door.open = true; this.doorsOpen++; c.fx.burst(h.door.mesh.position.clone(), 0x66ff88, 26, 10, 0.35, 5); c.fx.shake(0.3, 0.25); this.clearNodes(); this.hacking = null; c.ui.toast('DOOR OPEN!', 900); this.say('Sneak on!'); }
          } else { this.alarm = clamp(this.alarm + 12, 0, 100); c.rumble(1, 150); c.ui.toast('WRONG!', 500); }
        }
      }
      if (this.hacking && h.t <= 0) { this.alarm = clamp(this.alarm + 15, 0, 100); this.clearNodes(); this.startHack(h.door); }
    }
    this.doors.forEach((d) => {
      d.y = lerp(d.y, d.open ? 7 : 0, dt * 3); d.mesh.position.y = 3 + d.y; d.lock.visible = !d.open;
    });
    this.loot.rotation.y += dt * 2; this.loot.position.y = 2.2 + Math.sin(performance.now() / 300) * 0.3;

    this.dshadow.position.set(this.dp.x, 0.08, this.dp.z);
    // --- camera ---
    c.camera.position.set(this.dp.x * 0.4, 17, this.dp.z + 17);
    c.camera.lookAt(this.dp.x * 0.4, 0, this.dp.z - 7);

    // --- HUD + end ---
    this.$('#tm').textContent = `${Math.max(0, Math.ceil(this.time))}s`;
    const al = this.$('#al'); al.firstElementChild.style.width = this.alarm + '%';
    al.classList.toggle('warn', this.alarm > 40 && this.alarm <= 70); al.classList.toggle('bad', this.alarm > 70);
    this.$('#dr').textContent = `🔓 ${this.doorsOpen}/${DOORS.length}`;
    if (!this.hacking && this.doorsOpen < DOORS.length && this.time > 0) this.say('P1: sneak past the yellow cones. Doors ahead!');
    if (this.alarm >= 100) this.end(false, 'ALARM! The guards caught the drone.');
    else if (this.time <= 0) this.end(false, 'Time is up. The vault got away.');
    else if (this.dp.z <= LOOT_Z + 3) { c.fx.burst(this.loot.position.clone(), 0xffe14a, 40, 12, 0.5, 8); this.end(true, 'You stole the shiny thing! 💎'); }
  }
  end(win, line) {
    if (this.over) return; this.over = true; this.clearNodes();
    this.c.finish(win, [line, `Doors hacked: ${this.doorsOpen}/${DOORS.length}`, `Time left: ${Math.max(0, Math.round(this.time))}s`]);
  }
  dispose() { this.clearNodes(); }
}
