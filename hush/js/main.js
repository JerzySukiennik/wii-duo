// HUSH — boot, loop, input, game flow (wake → explore → fuses → power → escape),
// catches, the third night, the ending.
import * as THREE from 'three';
import { loadMaterials, scrawlTexture } from './textures.js';
import { buildHouse, PHANTOM, BASE_FLOOR } from './house.js';
import { AudioEngine } from './audio.js';
import { Post } from './post.js';
import { Player } from './player.js';
import { Entity } from './ai.js';
import { Director } from './director.js';
import { Weather } from './weather.js';
import { WiiControl } from './wii.js';

const Q = new URLSearchParams(location.search);
const AUTO = Q.has('auto');       // automated tests: no pointer lock, starts immediately
const SKIP = Q.has('skip');       // skip the intro
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- UI
let capTimer = null;
const ui = {
  caption(text, sec = 4) {
    const el = $('caption');
    clearTimeout(capTimer);
    if (!text) { el.classList.remove('show'); return; }
    el.textContent = text; el.classList.add('show');
    if (sec > 0) capTimer = setTimeout(() => el.classList.remove('show'), sec * 1000);
  },
  objective(text) {
    const el = $('objective');
    if (!text) { el.classList.remove('show'); return; }
    el.textContent = text; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  },
  prompt(text) { $('prompt').textContent = text || ''; $('reticle').classList.toggle('active', !!text); },
  black(v, dur = 1.5) { const el = $('black'); el.style.transition = `opacity ${dur}s`; el.style.opacity = v; },
  flash(v, dur = 0.08) { const el = $('flash'); el.style.transition = 'none'; el.style.opacity = v; requestAnimationFrame(() => { el.style.transition = `opacity ${dur}s`; el.style.opacity = 0; }); },
  clock(show, text = '3:07 AM') { $('clock').querySelector('span').textContent = text; $('clock').classList.toggle('show', show); },
  hideView(type) { $('hide-slats').classList.toggle('on', type === 'wardrobe'); $('hide-bed').classList.toggle('on', type === 'bed'); },
};

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
$('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x010203, 0.085);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.04, 200);
scene.add(camera);
const post = new Post(renderer);

const G = {
  scene, camera, renderer, post, ui, time: 0, paused: false, started: false,
  state: { phase: 'loading', stage: 'wake', fuses: 0, inserted: false, power: false, wakes: 0, flags: {} },
  timers: [],
};
window.__hush = G;
G.after = (sec, fn) => { G.timers.push({ at: G.time + sec, fn }); };
G.sleep = (sec) => new Promise(r => G.after(sec, r));

// ---------------------------------------------------------------- input
const keys = {};
const input = { f: 0, b: 0, l: 0, r: 0, sprint: 0, crouch: 0, hold: 0 };
addEventListener('keydown', (e) => {
  if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
  keys[e.code] = true;
  if (G.state.phase !== 'play') return;
  if (e.code === 'KeyF') G.player.toggleLight();
  if (e.code === 'KeyE') interact();
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement && !G.paused && G.player) G.player.look(e.movementX, e.movementY);
});
addEventListener('mousedown', (e) => {
  if (G.state.phase === 'play' && document.pointerLockElement === renderer.domElement && e.button === 0) interact();
});
function readInput(dt = 1 / 60) {
  input.f = keys.KeyW || keys.ArrowUp; input.b = keys.KeyS || keys.ArrowDown;
  input.l = keys.KeyA || keys.ArrowLeft; input.r = keys.KeyD || keys.ArrowRight;
  input.sprint = keys.ShiftLeft || keys.ShiftRight; input.crouch = keys.KeyC || keys.ControlLeft;
  input.hold = keys.Space;
  G.wiiPoll = G.wii?.poll(dt, input) || null;
  if (G.autoInput) Object.assign(input, G.autoInput);
  return input;
}
function lock() { if (!AUTO) renderer.domElement.requestPointerLock?.(); }
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && G.started && !AUTO && !G.wii?.active && !['ending', 'over'].includes(G.state.phase)) pause(true);
  if (locked) pause(false);
});
function pause(p) {
  if (G.paused === p) return;
  G.paused = p;
  $('pause').classList.toggle('hidden', !p);
  if (p) G.audio?.suspend(); else G.audio?.resume();
  document.title = p ? 'HUSH — it is still there' : 'HUSH';
}
$('pause').addEventListener('click', () => lock());
// if the browser refused the lock (e.g. the mic prompt ate the click), ask for a fresh click
document.addEventListener('pointerlockerror', () => { if (G.started && !AUTO && !G.wii?.active) pause(true); });
// the tab keeps a secret while you're away
document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.started) document.title = pickOne(['it is behind you', 'come back', 'i can hear you', 'HUSH']);
  else document.title = 'HUSH';
});
const pickOne = (a) => a[(Math.random() * a.length) | 0];

// ---------------------------------------------------------------- boot
async function boot() {
  const setL = (t) => { $('loading-text').textContent = t; };
  setL('building the house…');
  const M = await loadMaterials(renderer, (p) => setL(`building the house… ${Math.round(p * 100)}%`));
  G.M = M;
  const house = G.house = buildHouse(scene, M);
  setL('listening…');
  const audio = G.audio = new AudioEngine();
  audio.house = house;
  await audio.init((p) => setL(`listening… ${Math.round(p * 100)}%`));
  let factory = null;
  try { factory = (await import('./entity-model.js')).createEntityModel; } catch (e) { console.warn('[entity] model missing, using stand-in', e); }
  G.player = new Player(camera, scene, house, audio, M);
  G.rumble = (ms) => G.wii?.rumble(ms);
  G.entity = new Entity(scene, house, audio, factory);
  G.weather = new Weather(scene, house, audio);
  G.director = new Director(G);
  const spike0 = G.director.spike.bind(G.director);
  G.director.spike = (v) => { spike0(v); if (v >= 0.6) G.rumble(v >= 0.9 ? 500 : 220); };
  setupWorld();
  setupWii();
  G.entity.onCatch = (E, spot) => caught(spot);
  G.entity.onSpotted = () => {
    audio.play(Math.random() < 0.5 ? 'stinger_1' : 'stinger_2', { gain: 0.9, bus: 'scare' });
    G.director.spike(1);
    if (G.director.firstTime('run')) ui.caption('Run. Hide.', 2.5);
  };
  G.entity.onVanish = () => { audio.play('sub_hit', { gain: 0.35, bus: 'music', rate: 1.3 }); };
  // warm up shaders so the first scare doesn't hitch
  G.player.teleport(4.4, 2.5, Math.PI / 2);
  G.player.update(0.016, readInput(), 0);
  renderer.compile(scene, camera);
  post.render(scene, camera, 0);
  $('loading').classList.add('hidden');
  G.state.phase = 'title';
  if (AUTO) { begin(); return; }
  $('title').classList.remove('hidden');
}

function setupWorld() {
  const H = G.house, M = G.M;
  // power lights (all present from the start so the shader never recompiles mid-scare)
  G.power = [];
  for (const id of ['master', 'hallW', 'living', 'kitchen', 'foyer', 'basement']) {
    const lamp = H.lamps.find(l => l.id === id);
    const L = new THREE.PointLight(0xffd3a0, 0, id === 'basement' ? 8 : 10, 1.6);
    L.position.copy(lamp.pos).add(new THREE.Vector3(0, -0.3, 0));
    scene.add(L);
    G.power.push({ lamp, L, level: 0, target: 0 });
  }
  for (const l of H.lamps) if (!G.power.find(p => p.lamp === l)) G.power.push({ lamp: l, L: null, level: 0, target: 0 });

  // alarm clock with glowing digits next to the flashlight
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  G.clockCanvas = cv;
  const clockTex = new THREE.CanvasTexture(cv); clockTex.colorSpace = THREE.SRGBColorSpace;
  G.clockTex = clockTex;
  drawClock('3:07');
  const clockBody = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.07), M.plastic);
  clockBody.position.set(6.72, 0.59, 1.35); clockBody.rotation.y = -Math.PI / 2 - 0.25; scene.add(clockBody);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.065), new THREE.MeshBasicMaterial({ map: clockTex, fog: false }));
  face.position.set(0, 0, 0.0355); clockBody.add(face);

  // flashlight on the nightstand
  const fl = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.018, 0.17, 12), M.darkMetal); fl.add(body);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.021, 0.05, 12), M.darkMetal); head.position.y = 0.1; fl.add(head);
  // a tiny charging LED so you can find it in the dark
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 4), new THREE.MeshBasicMaterial({ color: 0x33ff66, fog: false }));
  led.position.set(0.021, 0.02, 0); fl.add(led);
  fl.rotation.z = Math.PI / 2; fl.rotation.y = 0.6; fl.position.set(6.62, 0.575, 1.1);
  scene.add(fl);
  G.flashItem = fl;
  H.interactables.push({ obj: fl, kind: 'flashlight', enabled: () => !G.player.hasLight });

  // pickups: 4 fuses + batteries, spread across rooms (never in the basement)
  const glintTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,240,210,1)'); gr.addColorStop(0.15, 'rgba(255,220,170,.6)'); gr.addColorStop(1, 'rgba(255,200,150,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(255,245,230,.9)'; g.fillRect(31, 4, 2, 56); g.fillRect(4, 31, 56, 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const spots = H.pickupSpots.filter(s => s.room !== 'basement').sort(() => Math.random() - 0.5);
  const byRoom = new Set(); const fuseSpots = [];
  for (const s of spots) { if (fuseSpots.length < 4 && !byRoom.has(s.room) && s.room !== 'master') { fuseSpots.push(s); byRoom.add(s.room); } }
  const rest = spots.filter(s => !fuseSpots.includes(s));
  const batSpots = [rest[0], rest[1], H.pickupSpots.find(s => s.kind === 'battery')].filter(Boolean);
  G.pickups = [];
  const mkPickup = (kind, s) => {
    const g = new THREE.Group();
    if (kind === 'fuse') {
      const cer = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.03, 16), M.porcelain); cer.position.y = 0.035; g.add(cer);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 12), M.metal); cap.position.y = 0.01; g.add(cap);
      const win = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.004, 16), new THREE.MeshStandardMaterial({ color: 0x6a4a20, roughness: 0.1, metalness: 0.3, emissive: 0x100500 }));
      win.position.y = 0.052; g.add(win);
      g.scale.setScalar(1.4);
    } else {
      for (const dx of [-0.019, 0.019]) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.06, 14), M.plastic); c.position.set(dx, 0.017, 0); c.rotation.z = Math.PI / 2; c.rotation.y = Math.PI / 2; g.add(c);
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 8), M.metal); t.position.set(dx, 0.017, 0.033); t.rotation.x = Math.PI / 2; g.add(t);
      }
    }
    g.position.copy(s.pos); g.rotation.y = Math.random() * 6;
    g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, fog: false }));
    glint.scale.setScalar(0.16); glint.position.set(0, 0.06, 0); g.add(glint);
    scene.add(g);
    const it = { kind, obj: g, glint, taken: false, spot: s };
    H.interactables.push({ obj: g, kind: 'pickup', pickup: it, enabled: () => !it.taken });
    G.pickups.push(it);
  };
  fuseSpots.forEach(s => mkPickup('fuse', s));
  batSpots.forEach(s => mkPickup('battery', s));
  G.fuseMeshes = [];

  // TV feed camera, high in the corner of the living room
  const fc = G.feedCam = new THREE.PerspectiveCamera(62, 4 / 3, 0.1, 30);
  fc.position.set(6.35, 2.5, 7.35); fc.lookAt(11.5, 0.9, 12.2);
  fc.layers.enable(PHANTOM);
  // your body, visible only to the TV and the mirror
  const dummy = new THREE.Group();
  const dm = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.62, 4, 10), dm); torso.position.y = 1.1; dummy.add(torso);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshStandardMaterial({ color: 0x8a7465, roughness: 0.7 })); hd.position.y = 1.62; dummy.add(hd);
  for (const sx of [-1, 1]) { const lg = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.7, 4, 8), dm); lg.position.set(sx * 0.1, 0.42, 0); dummy.add(lg); }
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8), dm); arm.position.set(0.24, 1.2, -0.2); arm.rotation.x = -1.2; dummy.add(arm);
  dummy.traverse(o => o.layers.set(PHANTOM));
  scene.add(dummy);
  G.dummy = dummy;
  // lights only the phantom-layer cameras see: the TV's infrared and the flashlight bouncing off the mirror
  G.irLight = new THREE.PointLight(0xe4ecf2, 0, 12, 1.1);
  G.irLight.layers.set(PHANTOM);
  scene.add(G.irLight);

  // walls that get written on after you've been caught
  G.scrawls = [
    { text: 'IT HEARS YOU', pos: [6.35, 1.55, 5.095], ry: 0, w: 2.2, wake: 1 },
    { text: 'HUSH', pos: [1.2, 1.7, 0.095], ry: 0, w: 1.6, wake: 1 },
    { text: "DON'T BREATHE", pos: [12.4, 1.6, 7.095], ry: 0, w: 2.4, wake: 2 },
    { text: '3:07', pos: [5.905, 1.6, 8.9], ry: -Math.PI / 2, w: 1.3, wake: 2 },
    { text: 'STAY', pos: [26.5, BASE_FLOOR + 1.4, 16.415], ry: Math.PI, w: 1.6, wake: 2 },
  ].map((s, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.w * 0.375), new THREE.MeshStandardMaterial({ map: scrawlTexture(s.text, 11 + i), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(...s.pos); m.rotation.y = s.ry; m.visible = false; m.receiveShadow = true;
    scene.add(m);
    return { ...s, mesh: m };
  });
}

function drawClock(text, on = true) {
  const g = G.clockCanvas.getContext('2d');
  g.fillStyle = '#060000'; g.fillRect(0, 0, 256, 128);
  if (on) {
    g.font = 'bold 92px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#ff1a0a'; g.shadowBlur = 18; g.fillStyle = '#ff2a14';
    g.fillText(text, 128, 68);
  }
  G.clockTex.needsUpdate = true;
}

// ---------------------------------------------------------------- start
$('begin').addEventListener('click', () => begin());
$('again').addEventListener('click', () => location.reload());

async function begin() {
  $('title').classList.add('hidden');
  // fullscreen + pointer lock must be requested inside the click gesture, never awaited
  if (!AUTO) {
    try { const r = document.documentElement.requestFullscreen?.(); r?.catch?.(() => {}); } catch {}
    lock();
  }
  await G.audio.resume();
  if ($('mic-toggle').checked) {
    const ok = await G.audio.enableMic();
    if (!ok) ui.caption('No microphone. It will have to listen harder.', 4);
  }
  G.started = true;
  if (!AUTO) setTimeout(() => { if (document.pointerLockElement !== renderer.domElement && !G.wii?.active) pause(true); }, 1200);
  G.director.startAmbience();
  G.state.phase = 'play';
  if (SKIP || AUTO) {
    ui.black(0, 0.5);
    G.player.teleport(4.4, 2.5, Math.PI / 2);
    if (!Q.has('dark')) { G.player.hasLight = true; G.player.fl.on = true; }
    G.state.stage = 'explore';
    G.director.ambientOnly = true;
    return;
  }
  wakeSequence(true);
}

// lying in bed → eyes open → sit up → stand
async function wakeSequence(first) {
  const P = G.player, S = G.state;
  S.phase = 'cut';
  P.locked = true; P.lookLocked = true; P.freezeEye = true;
  G.audio.duck('amb', 0.8, 0.5); G.audio.duck('music', 0.7, 0.5);
  ui.black(1, 0.01); ui.prompt('');
  ui.clock(true, '3:07 AM');
  G.audio.play('clock_chime', { pos: G.house.clockPos.clone(), gain: 0.5, delay: 0.8 });
  await G.sleep(2.8);
  ui.clock(false);
  await G.sleep(1.2);
  P.pos.set(5.75, 0, 2.5); P.floorY = 0; P.eyeY = 0.78; P.yaw = Math.PI / 2 + 0.3; P.pitch = 1.25;
  G.weather.strike({ big: true, delay: 1.5 });
  // blink
  for (const [v, d, w] of [[0.55, 0.25, 0.45], [1, 0.15, 0.6], [0.3, 0.4, 0.9], [0.85, 0.2, 0.35], [0, 1.2, 1.2]]) { ui.black(v, d); await G.sleep(w); }
  if (first) ui.caption('3:07 AM. The power is out.', 4);
  else ui.caption(S.wakes === 1 ? 'Again.' : 'It is closer every time.', 3.5);
  // sit up, stand
  const from = { x: P.pos.x, eye: P.eyeY, pitch: P.pitch, yaw: P.yaw };
  const to = { x: 4.4, eye: 1.62, pitch: 0.05, yaw: Math.PI / 2 };
  const dur = 2.8;
  for (let t = 0; t < dur; t += 1 / 60) {
    const k = t / dur, e = k * k * (3 - 2 * k);
    P.pos.x = from.x + (to.x - from.x) * Math.max(0, (e - 0.35) / 0.65);
    P.eyeY = from.eye + (to.eye - from.eye) * e;
    P.pitch = from.pitch + (to.pitch - from.pitch) * Math.min(1, e * 1.6);
    P.yaw = from.yaw + (to.yaw - from.yaw) * e;
    await G.sleep(1 / 60);
  }
  G.audio.play('creak_2', { gain: 0.5 });
  P.locked = false; P.lookLocked = false; P.freezeEye = false;
  S.phase = 'play';
  if (first) {
    S.stage = 'explore';
    G.director.ambientOnly = true;
    await G.sleep(2);
    if (!P.hasLight) ui.caption('Your flashlight. On the nightstand, by the clock.', 5);
  } else {
    G.director.active = S.stage === 'fuses' || S.stage === 'escape';
    G.director.setCycle('calm');
    ui.objective(objectiveText());
  }
}

function objectiveText() {
  const S = G.state;
  if (S.stage === 'explore') return 'the breaker box is in the basement';
  if (S.stage === 'fuses') return S.fuses < 4 ? `find the fuses — ${S.fuses}/4` : 'back to the breaker box';
  if (S.stage === 'escape') return 'get out. the front door.';
  return '';
}

// ---------------------------------------------------------------- interaction
function interact() {
  const P = G.player, f = P.focus, S = G.state, H = G.house, a = G.audio;
  if (!f || P.locked) return;
  switch (f.kind) {
    case 'door': {
      const d = f.door;
      if (d.front) {
        if (!S.power) { a.play('handle_rattle', { pos: d.center.clone(), gain: 0.8 }); ui.caption('Locked. The smart lock is dead without power.', 3.5); P.noise(5); return; }
        escape(); return;
      }
      const opening = d.open < 0.5;
      d.target = opening ? 1 : 0; d.speed = 1.9; d.openedByPlayer = opening;
      a.play(opening ? 'door_creak_1' : 'door_close', { pos: d.center.clone(), gain: opening ? 0.35 : 0.6, rate: opening ? 1.6 : 1, offset: opening ? 0.3 : 0 });
      P.noise(opening ? 3.5 : 5, 'door');
      return;
    }
    case 'hide': {
      const spot = f.spot;
      G.entity.noteHide(spot);
      P.enterHide(spot, () => {
        ui.hideView(spot.type);
        if (G.director.firstTime('hideTip')) ui.caption('Hold SPACE to hold your breath. Stay quiet.', 4);
      });
      return;
    }
    case 'unhide': ui.hideView(null); P.exitHide(); return;
    case 'flashlight': {
      P.hasLight = true; P.fl.on = true; G.flashItem.visible = false;
      a.play('pickup', { gain: 0.6 }); a.play('switch_click', { gain: 0.6, delay: 0.3 });
      ui.caption('F — flashlight.', 3);
      ui.objective(objectiveText());
      return;
    }
    case 'pickup': {
      const it = f.pickup; it.taken = true; it.obj.visible = false;
      a.play('pickup', { gain: 0.7 });
      P.noise(1.5, 'pickup');
      if (it.kind === 'battery') {
        P.fl.battery = Math.min(1, P.fl.battery + 0.55);
        ui.caption('Batteries. The light steadies.', 2.5);
      } else {
        S.fuses++;
        ui.caption(S.fuses < 4 ? `A fuse. (${S.fuses}/4)` : 'That is all four.', 2.5);
        G.entity.aggression = Math.min(1, G.entity.aggression + 0.12);
        G.director.spike(0.3);
        if (S.stage === 'explore') { /* picked up before seeing the box */ }
        ui.objective(objectiveText());
        // every fuse wakes the house a little more
        if (S.stage === 'fuses' && S.fuses === 2) G.after(6, () => { if (!G.director.phoneRinging) G.director.big.find(e => e.id === 'phone').run(); });
      }
      return;
    }
    case 'breaker': return breaker();
    case 'phone': if (G.director.phoneRinging) G.director.answerPhone(); return;
    case 'tv': if (H.tv.on) G.director.tvOff(); return;
  }
}

function promptFor(f) {
  if (!f) return '';
  const S = G.state;
  switch (f.kind) {
    case 'door': return f.door.front ? 'open' : f.door.open < 0.5 ? 'open' : 'close';
    case 'hide': return f.spot.type === 'bed' ? 'hide under the bed' : `hide in the ${f.spot.label}`;
    case 'unhide': return 'E — get out';
    case 'flashlight': return 'take flashlight';
    case 'pickup': return f.pickup.kind === 'fuse' ? 'take fuse' : 'take batteries';
    case 'breaker': return S.power ? '' : S.inserted ? 'pull the lever' : S.fuses >= 4 ? 'insert fuses' : 'look';
    case 'phone': return G.director.phoneRinging ? 'answer' : '';
    case 'tv': return G.house.tv.on ? 'turn off' : '';
  }
  return '';
}

function breaker() {
  const S = G.state, a = G.audio, B = G.house.breaker;
  if (S.power) return;
  if (S.stage === 'explore') {
    S.stage = 'fuses';
    ui.objective(objectiveText());
    basementSlam();
    if (S.fuses < 4) { ui.caption(S.fuses ? `Four fuses are missing. You have ${S.fuses}.` : 'Four fuses are missing.', 3.5); return; }
  }
  if (S.fuses < 4) { ui.caption(`${S.fuses} of 4. Find the rest.`, 2.5); return; }
  if (!S.inserted) {
    S.inserted = true;
    B.slots.forEach((s, i) => {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.04, 14).rotateZ(Math.PI / 2), G.M.porcelain);
      f.position.copy(s.position).add(new THREE.Vector3(-0.02, 0, 0)); B.root.add(f);
    });
    a.play('pickup', { gain: 0.7 }); a.play('pickup', { gain: 0.6, delay: 0.25, rate: 0.9 });
    ui.caption('Pull the lever.', 2.5);
    return;
  }
  powerOn();
}

async function basementSlam() {
  const a = G.audio, H = G.house, D = G.director;
  await G.sleep(1.4);
  const d = H.doors.find(d => d.id === 'd_basement');
  d.target = 0; d.speed = 9;
  await G.sleep(0.12);
  a.play('door_slam', { pos: d.center.clone(), gain: 1.3 });
  G.player.shake = 0.8; D.spike(1);
  // something runs across the floor above
  for (let i = 0; i < 9; i++) a.play(a.variant('step', 6), { pos: new THREE.Vector3(18 - i * 1.4, 0.2, 9 - i * 0.3), gain: 1.3, delay: 0.6 + i * 0.32, rate: 0.95 });
  await G.sleep(4);
  D.ambientOnly = false;
  D.active = true;
  D.cycle = { name: 'calm', t: 0, dur: 14 };
  G.entity.aggression = 0.3;
}

async function powerOn() {
  const S = G.state, a = G.audio, H = G.house, D = G.director, P = G.player;
  S.power = true;
  D.active = false;
  if (G.entity.state !== 'hidden') G.entity.hide();
  const lever = H.breaker.lever;
  for (let k = 0; k <= 1; k += 0.1) { lever.rotation.z = -0.5 + k; await G.sleep(0.02); }
  a.play('breaker', { pos: H.breaker.pos.clone(), gain: 1.2 });
  G.hum = a.play('electric_hum', { pos: H.breaker.pos.clone(), loop: true, gain: 0.6 });
  await G.sleep(0.6);
  // the house wakes up
  for (const p of G.power) { p.target = 1; p.flick = 1.5; }
  drawClock('12:00');
  G.clockBlink = true;
  H.doors.find(d => d.front).led.material.color.set(0x19ff5a);
  D.tvOn();
  ui.caption('The power is back. The front door — now.', 4);
  S.stage = 'escape';
  ui.objective(objectiveText());
  await G.sleep(7);
  // …and then the bulbs go, one by one, toward you
  const order = G.power.slice().sort((x, y) => y.lamp.pos.distanceTo(P.pos) - x.lamp.pos.distanceTo(P.pos));
  for (const p of order) {
    a.play('bulb_pop', { pos: p.lamp.pos.clone(), gain: 1 });
    p.target = 0; p.level = 0;
    await G.sleep(0.75);
  }
  D.tvOff(false);
  G.hum?.stop(0.4);
  await G.sleep(0.3);
  D.flashDie();
  P.fl.deadNeed = 6;
  // it comes for you
  await G.sleep(5);
  G.entity.aggression = 1;
  const E = G.entity;
  E.spawnAt(H.randomPointIn('master'), 0, 'roam');
  E.roamTarget = () => H.randomPointIn(H.roomAt(P.pos.x, P.pos.z)?.id === 'stairs' ? 'laundry' : (H.roomAt(P.pos.x, P.pos.z)?.id || 'foyer'));
  a.play('growl', { pos: new THREE.Vector3(3.5, 2, 2.5), gain: 1.2 });
  D.active = true;
  D.cycle = { name: 'hunt', t: 0, dur: 9999 };
}

async function escape() {
  const S = G.state, a = G.audio, P = G.player, H = G.house;
  if (S.phase !== 'play') return;
  S.phase = 'ending';
  P.locked = true;
  G.entity.hide(); G.director.active = false;
  const d = H.doors.find(d => d.front); d.locked = false; d.target = 1; d.speed = 0.8;
  a.play('door_creak_2', { pos: d.center.clone(), gain: 1 });
  P.lookTarget = { pos: new THREE.Vector3(24, 1.6, 9), strength: 0.04 };
  const f = $('flash'); f.style.transition = 'opacity 3s'; f.style.opacity = 1;
  G.audio.duck('amb', 0, 3); G.audio.duck('music', 0, 2);
  await G.sleep(3.5);
  a.stopAll(1);
  ui.black(1, 0.01); f.style.transition = 'opacity 2s'; f.style.opacity = 0;
  document.exitPointerLock?.();
  await G.sleep(2.5);
  ui.clock(true, '5:41 AM');
  $('clock').querySelector('span').style.color = '#b9b3a6';
  await G.sleep(3);
  ui.clock(false);
  await G.sleep(1.5);
  a.say('see you tomorrow night', { rate: 0.5 });
  $('clock').querySelector('span').style.color = '';
  ui.clock(true, '3:07 AM'); await G.sleep(0.35); ui.clock(false);
  S.phase = 'over';
  showEnd('You got out.', 'The storm passed at 5:41. Nobody believed you about the house.');
}

function showEnd(title, sub) {
  $('end-title').textContent = title; $('end-sub').textContent = sub;
  $('end').classList.remove('hidden');
  document.exitPointerLock?.();
}

// ---------------------------------------------------------------- caught
async function caught(spot) {
  const S = G.state, P = G.player, E = G.entity, a = G.audio, D = G.director;
  if (S.phase !== 'play') return;
  S.phase = 'caught';
  P.locked = true; P.lookLocked = true;
  ui.prompt(''); ui.caption('');
  jumpscare();
  await G.sleep(1.35);
  ui.black(1, 0.01);
  a.stopAll(0.05);
  a.play('tinnitus', { gain: 0.5, bus: 'scare' });
  P.lookTarget = null;
  ui.hideView(null);
  E.hide(); D.tvOff(false); E.hidePhantom();
  G.post.u.uDistort.value = 0; G.post.u.uRed.value = 0; G.post.u.uCA.value = 0;
  await G.sleep(2.8);
  S.wakes++;
  if (P.hiding) { P.hiding.setOpen?.(0); if (P.hiding.leaves) P.hiding.leaves.forEach(l => l.visible = true); P.hiding = null; }
  if (S.wakes >= 3) return thirdNight();
  // the house changes
  for (const s of G.scrawls) if (s.wake <= S.wakes) s.mesh.visible = true;
  for (const d of G.house.doors) if (!d.front) { d.setOpen(S.wakes === 1 ? 1 : 0); d.target = d.open; }
  if (S.wakes === 2) for (const pic of G.house.frames) pic.material.color.set(0x050303);
  E.aggression = Math.min(1, E.aggression + 0.15);
  P.fl.dead = false; P.fl.forcedOff = false;
  G.director.startAmbience();
  wakeSequence(false);
}

// the face lands in front of the camera, mouth open
function jumpscare() {
  const P = G.player, E = G.entity, a = G.audio, u = G.post.u;
  const eye = P.eye.clone();
  const f = P.forward(new THREE.Vector3()); f.y = 0; f.normalize();
  E.state = 'catch'; E.root.visible = true; E.mode = 'scream';
  E.yaw = Math.atan2(-f.x, -f.z);
  const place = () => {
    const want = eye.clone().addScaledVector(f, 0.58);
    E.model.update(0, { speed: 0, mode: 'scream', lookAt: eye, light: 1, twitch: 1 });
    E.root.position.copy(E.pos); E.root.rotation.y = E.yaw; E.root.updateMatrixWorld(true);
    let head = null;
    if (E.model.headWorldPosition) head = E.model.headWorldPosition(new THREE.Vector3());
    if (!head) { const b = new THREE.Box3().setFromObject(E.root); head = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y - 0.16, (b.min.z + b.max.z) / 2); }
    E.pos.add(want.sub(head));
  };
  E.pos.copy(eye).addScaledVector(f, 0.8); E.pos.y = P.floorY;
  place(); place();
  P.lookTarget = { pos: eye.clone().addScaledVector(f, 1), strength: 1 };
  a.duck('amb', 0.1, 0.05); a.duck('music', 0, 0.05);
  a.play('scream', { gain: 1.25, bus: 'scare' });
  G.rumble(1400);
  a.play('sub_hit', { gain: 1.1, bus: 'scare' });
  a.play(Math.random() < 0.5 ? 'stinger_1' : 'stinger_2', { gain: 0.8, bus: 'scare' });
  ui.flash(0.5, 0.25);
  P.shake = 1.2;
  G.scare = { t: 0, eye, f };
}

// keep the face pinned to the centre of the view while it screams, lunging closer
function pinFace(dt) {
  const s = G.scare, E = G.entity;
  if (!E.model.headWorldPosition) return;
  const dist = Math.max(0.42, 0.62 - s.t * 0.25);
  const want = _g1.copy(s.eye).addScaledVector(s.f, dist);
  E.root.position.copy(E.pos); E.root.updateMatrixWorld(true);
  const head = E.model.headWorldPosition(_g2);
  E.pos.add(want.sub(head).multiplyScalar(Math.min(1, dt * 30)));
  E.root.position.copy(E.pos);
}
const _g1 = new THREE.Vector3(), _g2 = new THREE.Vector3();

// third catch: you wake up and cannot move
async function thirdNight() {
  const P = G.player, E = G.entity, a = G.audio, S = G.state, H = G.house;
  S.phase = 'cut';
  G.director.active = false; G.director.ambientOnly = false;
  P.freezeEye = true;
  ui.clock(true, '3:07 AM');
  await G.sleep(2.5); ui.clock(false);
  P.pos.set(5.75, 0, 2.5); P.floorY = 0; P.eyeY = 0.78; P.yaw = Math.PI / 2; P.pitch = 0.35;
  P.fl.on = false; P.hasLight = false;
  G.director.startAmbience();
  G.audio.duck('amb', 0.8, 0.5); G.audio.duck('music', 0.7, 0.5);
  E.aggression = 1;
  E.spawnAt(new THREE.Vector3(4.1, 0, 2.5), -Math.PI / 2, 'scripted');
  E.scriptFn = (dt, e) => { e.mode = 'lurk'; e.speed = 0; e.lookAt = P.eye.clone(); };
  for (const [v, d, w] of [[0.5, 0.3, 0.5], [0.9, 0.2, 0.5], [0, 1.5, 1.6]]) { ui.black(v, d); await G.sleep(w); }
  P.lookLocked = false; P.locked = true;
  ui.caption("You can't move.", 4);
  G.weather.strike({ big: true, delay: 0.2 });
  G.director.spike(1);
  await G.sleep(5);
  // it walks around the bed to your side
  const pts = [new THREE.Vector3(4.2, 0, 3.8), new THREE.Vector3(5.2, 0, 3.75), new THREE.Vector3(5.9, 0, 3.6)];
  let i = 0;
  E.scriptFn = (dt, e) => {
    const wp = pts[i]; e.lookAt = P.eye.clone();
    if (!wp) { e.mode = 'reach'; e.speed = 0; e._face(P.pos, dt, 3); return; }
    const dx = wp.x - e.pos.x, dz = wp.z - e.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.1) { i++; return; }
    e.mode = 'stoop'; e.speed = 0.55;
    e.pos.x += dx / d * Math.min(d, 0.55 * dt); e.pos.z += dz / d * Math.min(d, 0.55 * dt);
    e.yaw = Math.atan2(dx, dz);
    e._sounds(dt, P);
  };
  await G.sleep(6.5);
  P.lookTarget = { pos: E.head.clone(), strength: 0.06 };
  await G.sleep(2.5);
  S.phase = 'play';
  caughtFinal();
}
async function caughtFinal() {
  const S = G.state, a = G.audio;
  S.phase = 'caught';
  G.player.locked = true; G.player.lookLocked = true;
  jumpscare();
  await G.sleep(1.5);
  ui.black(1, 0.01); a.stopAll(0.05);
  a.play('tinnitus', { gain: 0.5, bus: 'scare' });
  G.entity.hide();
  G.post.u.uDistort.value = 0; G.post.u.uRed.value = 0; G.post.u.uCA.value = 0;
  await G.sleep(3);
  S.phase = 'over';
  showEnd('It stays.', 'You woke up three times. It was patient every time.');
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let frameN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  G.wiiDt = dt;
  if (G.wii?.active && (G.state.phase === 'title' || G.paused || G.state.phase === 'over')) wiiMenu();
  if (G.state.phase === 'loading' || G.state.phase === 'title') return;
  if (G.paused) return;
  step(dt);
  render();
}
requestAnimationFrame(frame);

function step(dt) {
  G.time += dt;
  const t = G.time, P = G.player, E = G.entity, H = G.house, S = G.state, D = G.director, a = G.audio;
  // timers
  for (let i = G.timers.length - 1; i >= 0; i--) if (G.timers[i].at <= t) { const tm = G.timers.splice(i, 1)[0]; tm.fn(); }
  const inp = readInput(dt);
  const w = G.wiiPoll;
  if (w) {
    if (!P.locked) P.look(w.look[0], w.look[1]);
    const pr = w.pressed;
    if (S.phase === 'play') {
      if (pr.one) P.toggleLight();
      if (pr.a) interact();
    }
    if (pr.home || pr.plus) { if (S.phase === 'play') pause(true); }
  }
  P.update(dt, inp, t);
  // doors
  for (const d of H.doors) {
    if (Math.abs(d.target - d.open) > 0.001) {
      const s = Math.sign(d.target - d.open);
      d.open = Math.abs(d.target - d.open) < d.speed * dt ? d.target : d.open + s * d.speed * dt;
      H.updateDoor(d);
    }
  }
  if (S.phase === 'play' || S.phase === 'cut' || S.phase === 'caught') E.update(dt, P, t);
  if (S.phase === 'play' || S.phase === 'cut') D.update(dt);
  G.weather.update(dt, t);
  a.setListener(camera, new THREE.Vector3(P.pos.x, P.floorY + 1.5, P.pos.z));
  a.update(dt);

  // scripted: the hallway silhouette on your first trip down the hall
  if (S.stage === 'explore' && !S.flags.hall && S.phase === 'play' && H.roomAt(P.pos.x, P.pos.z)?.id === 'hall' && P.forward(_f).x > 0.75 && P.pos.x < 11) {
    S.flags.hall = true;
    D.revealAt(new THREE.Vector3(19.1, 0, 6.0), 'gone');
  }
  // interaction prompt
  if (S.phase === 'play') ui.prompt(promptFor(P.focus)); else ui.prompt('');
  // heartbeat in your hand
  if (G.wii?.active && D.fear > 0.45) {
    const beat = Math.floor(D.heartPhase);
    if (beat !== G.lastBeat) { G.lastBeat = beat; G.rumble(45 + D.fear * 60); }
  }
  // hiding overlay follows the player state
  if (!P.hiding && !P.hideAnim) ui.hideView(null);

  // power lamps
  for (const p of G.power) {
    let lvl = p.target;
    if (p.flick > 0) { p.flick -= dt; lvl *= Math.random() < 0.5 ? 0.1 : 1; }
    if (lvl && Math.random() < 0.004) lvl *= 0.2;
    p.level += (lvl - p.level) * Math.min(1, dt * 25);
    p.lamp.mesh.material.emissiveIntensity = p.level * 3;
    if (p.L) p.L.intensity = p.level * 5;
  }
  if (G.clockBlink) drawClockBlink(t);
  // pendulum
  H.pendulum.rotation.x = Math.sin(t * Math.PI) * 0.12;
  // fuses glint when your light finds them
  for (const it of G.pickups) {
    if (it.taken) continue;
    const wp = it.obj.position;
    const to = _f.set(wp.x - camera.position.x, wp.y - camera.position.y, wp.z - camera.position.z);
    const d = to.length(); to.divideScalar(d);
    const lit = P.fl.level > 0.3 && d < 9 ? Math.max(0, (to.dot(P._aim) - 0.93) / 0.07) : 0;
    it.glint.material.opacity = lit * (0.55 + 0.45 * Math.sin(t * 9 + wp.x)) * Math.min(1, 1.6 - d / 9);
    it.glint.material.rotation = t * 0.6;
  }
  // phantoms: your stand-in body follows you
  G.dummy.position.set(P.pos.x, P.floorY, P.pos.z); G.dummy.rotation.y = P.yaw + Math.PI;
  // the mirror only renders when it could be seen
  const nearBath = P.pos.x > 7 && P.pos.x < 10.6 && P.pos.z < 7.2 && Math.abs(P.floorY) < 0.5;
  H.mirror.visible = nearBath;
  // the phantom-only light: infrared for the TV camera, mirror bounce for the bathroom
  const ir = G.irLight;
  if (H.tv.on && H.tv.mat.uniforms.uFeed.value > 0) { ir.position.copy(G.feedCam.position).add(_f.set(0.3, -0.3, 0.3)); ir.intensity = 16; ir.distance = 16; }
  else if (nearBath && P.fl.level > 0.3) { ir.position.set(P.pos.x, P.floorY + 1.7, P.pos.z).addScaledVector(P.forward(_f), -0.3); ir.intensity = 1.6 * P.fl.level; ir.distance = 5; }
  else ir.intensity = 0;
  // jumpscare animation
  if (G.scare) {
    G.scare.t += dt;
    pinFace(dt);
    const k = G.scare.t;
    const u = G.post.u;
    // the face must read clearly for the first ~0.5 s; then the image tears apart
    const tear = Math.max(0, k - 0.45);
    u.uDistort.value = Math.min(0.45, tear * 1.2) * (0.7 + 0.3 * Math.sin(k * 40));
    u.uRed.value = 0.12 + Math.min(0.4, tear) * (0.6 + 0.4 * Math.sin(k * 30));
    u.uCA.value = 0.15 + Math.random() * 0.2 + tear;
    u.uStatic.value = 0.15 + tear * 0.8;
    if (S.phase !== 'caught') { G.scare = null; u.uDistort.value = 0; u.uRed.value = 0; u.uCA.value = 0; }
  }
  // debug readout
  if (G.debugHud) G.debugHud(dt);
}
const _f = new THREE.Vector3();
let blinkOn = true;
function drawClockBlink(t) { const on = Math.floor(t * 1.5) % 2 === 0; if (on !== blinkOn) { blinkOn = on; drawClock('12:00', on); } }

function render() {
  frameN++;
  const H = G.house;
  if (H.tv.on && H.tv.mat.uniforms.uFeed.value > 0 && frameN % 2 === 0) {
    const tvOn = H.tv.screen.visible; H.tv.screen.visible = false;
    renderer.setRenderTarget(H.tv.rt); renderer.render(scene, G.feedCam); renderer.setRenderTarget(null);
    H.tv.screen.visible = tvOn;
  }
  H.tv.mat.uniforms.uTime.value = G.time;
  post.render(scene, camera, G.time);
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  post.setSize(s.x, s.y);
});

// ---------------------------------------------------------------- test hooks
G.hooks = {
  tp(x, z, yaw = 0, pitch = 0) { G.player.teleport(x, z, yaw, pitch); },
  fire(id) { const e = [...G.director.ambient, ...G.director.big].find(e => e.id === id); return e ? e.run() : 'no such event'; },
  stage(s) { G.state.stage = s; if (s === 'fuses') { G.director.active = true; G.director.ambientOnly = false; } ui.objective(objectiveText()); },
  catchMe() { caught(null); },
  hunt() { G.director.active = true; G.director.setCycle('hunt'); },
  fuses(n = 4) { G.state.fuses = n; G.pickups.filter(p => p.kind === 'fuse').slice(0, n).forEach(p => { p.taken = true; p.obj.visible = false; }); },
  power() { G.state.fuses = 4; G.state.inserted = true; powerOn(); },
  escape, thirdNight,
  async step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { step(dt); await null; await null; } render(); },
};

boot().catch((e) => { console.error(e); $('loading-text').textContent = 'failed to load: ' + e.message; });

// ---------------------------------------------------------------- Wii Remote
function setupWii() {
  const wii = G.wii = new WiiControl();
  const btn = $('wii-connect'), st = $('wii-status');
  const refresh = (on) => {
    if (!wii.supported) { st.textContent = 'Wii Remote needs Chrome or Edge (WebHID).'; return; }
    btn.classList.toggle('hidden', on);
    st.innerHTML = on
      ? 'Wii Remote connected. <b>A</b> begins.<br>Pointer turns · D-pad walks · A use · B hold breath · 1 flashlight · 2 crouch · − sprint · Home pause'
      : 'Wake it with 1+2 (pair it in Bluetooth settings first), then connect.';
    if (on) { $('title').querySelector('.keys')?.classList.add('dim'); ui.caption('Wii Remote ready.', 2); }
  };
  wii.onChange = refresh;
  if (wii.supported) btn.classList.remove('hidden');
  refresh(wii.active);
  btn.addEventListener('click', async () => {
    try { await wii.connect(); } catch (e) { if (e.name !== 'NotFoundError') st.textContent = 'Could not connect: ' + e.message; }
  });
}
// menu / pause / end buttons: A confirms
function wiiMenu() {
  const r = G.wii.remote; if (!r) return;
  const pr = r.consume();
  if (!pr.a) return;
  if (G.state.phase === 'title') begin();
  else if (G.state.phase === 'over') location.reload();
  else if (G.paused) { pause(false); }
}
