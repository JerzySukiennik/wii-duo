// Storm: rain streaks outside, moonlight through windows, lightning (sky + window lights +
// thunder). Other systems can hook a flash (`onFlash`) to reveal things for a split second.
import * as THREE from 'three';

export class Weather {
  constructor(scene, house, audio) {
    this.scene = scene; this.house = house; this.audio = audio;
    this.flash = 0; this.seq = null; this.next = 8 + Math.random() * 10;
    this.listeners = new Set();
    this.rate = 1; // multiplier on how often lightning strikes

    // moonlight / lightning through the main windows
    this.winLights = [];
    for (const w of house.windows.filter(w => w.light)) {
      const L = new THREE.SpotLight(0x7b8fb8, 0, 11, 0.95, 1, 1.4);
      L.position.copy(w.center).addScaledVector(w.outN, 2.2).add(new THREE.Vector3(0, 1.3, 0));
      L.target.position.copy(w.center).addScaledVector(w.outN, -3.2).add(new THREE.Vector3(0, -1.4, 0));
      scene.add(L); scene.add(L.target);
      this.winLights.push({ L, base: 0.9 * (w.width / 1.6) });
    }
    this.hemi = new THREE.HemisphereLight(0x46587a, 0x16110c, 0.11);
    scene.add(this.hemi);
    this.hemiBase = 0.11;

    // rain: vertical streaks animated in the vertex shader, only outside the house
    const N = 4200, pos = new Float32Array(N * 6), seed = new Float32Array(N * 2);
    let k = 0;
    while (k < N) {
      const x = -14 + Math.random() * 50, z = -12 + Math.random() * 40;
      if (x > -0.4 && x < 20.4 && z > -0.4 && z < 14.4) continue;
      const y = Math.random() * 14;
      pos.set([x, y, z, x + 0.02, y - 0.45, z + 0.01], k * 6);
      seed[k * 2] = seed[k * 2 + 1] = Math.random();
      k++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.rainU = { uTime: { value: 0 }, uFlash: { value: 0 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false, fog: false,
      vertexShader: `attribute float seed; uniform float uTime; varying float vA;
        void main(){ vec3 p = position; p.y = mod(p.y - uTime*9. - seed*14., 14.) - 0.5; vA = 0.25 + seed*0.25;
          gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.); }`,
      fragmentShader: `uniform float uFlash; varying float vA;
        void main(){ gl_FragColor = vec4(vec3(0.45,0.5,0.6)*(0.25 + uFlash*3.), vA*(0.35+uFlash)); }`,
    });
    this.rain = new THREE.LineSegments(g, m);
    this.rain.frustumCulled = false;
    scene.add(this.rain);
    this.skyBase = new THREE.Color(0x0a1220);
    this.skyFlash = new THREE.Color(0x8fa4c8);
  }

  onFlash(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // pattern: list of [time, level]; thunder follows after `delay`
  strike({ intensity = 1, delay = 0.4 + Math.random() * 2.2, big = false } = {}) {
    const pat = big
      ? [[0, 1], [0.05, 0.1], [0.11, 1.2], [0.19, 0.3], [0.26, 0.9], [0.42, 0]]
      : [[0, 0.8], [0.06, 0], [0.14, 1], [0.24, 0]];
    this.seq = { t: 0, pat, intensity };
    const id = delay < 0.8 ? 'thunder_1' : delay < 1.8 ? 'thunder_2' : 'thunder_3';
    this.audio.play(id, { gain: big ? 1.1 : 0.85, bus: 'amb', delay, reverb: 0.2 });
    for (const fn of this.listeners) fn({ big });
  }

  update(dt, t) {
    this.rainU.uTime.value = t;
    this.next -= dt * this.rate;
    if (this.next <= 0 && !this.seq) { this.strike({ big: Math.random() < 0.3 }); this.next = 14 + Math.random() * 26; }
    let f = 0;
    if (this.seq) {
      const s = this.seq; s.t += dt;
      let lvl = 0;
      for (const [tt, v] of s.pat) if (s.t >= tt) lvl = v;
      f = lvl * s.intensity;
      if (s.t > s.pat[s.pat.length - 1][0]) this.seq = null;
    }
    this.flash = f;
    this.rainU.uFlash.value = f;
    this.house.sky.material.color.copy(this.skyBase).lerp(this.skyFlash, Math.min(1, f));
    for (const w of this.winLights) w.L.intensity = w.base * (1 + f * 55);
    this.hemi.intensity = this.hemiBase + f * 0.35;
    for (const w of this.house.windows) {
      const m = w.drops.material.map; m.offset.y += dt * 0.015; m.offset.x = Math.sin(t * 0.1 + w.center.x) * 0.02;
      w.drops.material.opacity = 0.3 + f * 0.5;
    }
  }
}
