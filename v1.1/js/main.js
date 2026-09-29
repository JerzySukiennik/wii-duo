import * as THREE from 'three';
import { WiimoteHub, VirtualWiimote, VIRTUAL_KEYMAPS } from './wiimote.js';
import { Tilt, Swing, sfx, snd, loadSounds, stopLoops, lights, settings, saveSettings, Fx, music } from './common.js';
import { GAMES } from './games/index.js';

const $ = (s) => document.querySelector(s);
const hub = new WiimoteHub();
const renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: true });
renderer.setPixelRatio(0.6); // chunky low-res 90s pixels
let scene = new THREE.Scene();
let camera = new THREE.PerspectiveCamera(58, 1, 0.1, 600);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
addEventListener('keydown', (e) => {
  if (/^(Arrow|Space|Enter|Backspace)/.test(e.code)) e.preventDefault();
});

// ---------- UI helpers exposed to games ----------
let toastTimer;
const ui = {
  hud(html) { const h = $('#hud'); h.innerHTML = html; return h; },
  toast(text, ms = 1100) {
    const t = $('#toast'); t.classList.remove('hidden'); t.textContent = text;
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  },
  meter(el, frac) {
    el.firstElementChild.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
    el.classList.toggle('warn', frac < 0.5 && frac >= 0.25);
    el.classList.toggle('bad', frac < 0.25);
  },
};

// ---------- menu ----------
const cardsEl = $('#cards');
GAMES.forEach((g, i) => {
  const el = document.createElement('div');
  el.className = 'card box';
  el.innerHTML = `${g.id === 'hush' ? '<span class="new">NEW!</span>' : ''}<div class="titlebar"><span>${i + 1}_${g.id}.exe</span><span class="x">x</span></div><div class="body"><span class="emoji">${g.emoji}</span><h3>${g.title}</h3><p>${g.tag}</p><div class="how">${g.how}</div></div>`;
  el.onclick = () => startGame(g);
  el._game = g;
  cardsEl.appendChild(el);
});
$('#hint').innerHTML = 'C:\\> Real Wiimotes: pair in Bluetooth (hold 1+2), hit Connect.<br>C:\\> No remotes? Keyboard mode!<br><b>P1</b> WASD tilt F/G mouse ZXC swing<br><b>P2</b> arrows tilt Enter/RShift IJKL BNM swing';
try { const n = (+localStorage.getItem('wd-visits') || 0) + 1; localStorage.setItem('wd-visits', n); $('#visits').textContent = String(n).padStart(6, '0'); } catch {}

$('#connect').onclick = async () => {
  try { await hub.request(); } catch (e) { if (e.name !== 'NotFoundError') ui.toast(e.message.slice(0, 40)); }
};
$('#kbd').onclick = () => {
  if (!hub.remotes[0]) hub.useVirtual(0, new VirtualWiimote(0, VIRTUAL_KEYMAPS[0], true));
  if (!hub.remotes[1]) hub.useVirtual(1, new VirtualWiimote(1, VIRTUAL_KEYMAPS[1]));
};
hub.addEventListener('change', () => {
  hub.remotes.forEach((r, i) => {
    if (r && r.kind === 'wiimote' && !r._irAsked) { r._irAsked = true; r.enableIR().catch(() => {}); r.rumble(200); }
    const c = $('#chip' + i);
    c.className = 'chip ' + (r ? 'on' : 'off');
    c.textContent = r ? `P${i + 1}: ${r.kind === 'wiimote' ? 'WIIMOTE OK' : 'KEYBOARD OK'}` : `P${i + 1}: NO SIGNAL`;
  });
  cardsEl.classList.toggle('locked', !bothReady());
  [...cardsEl.children].forEach((c) => c.classList.toggle('locked', !bothReady() && !c._game.solo));
});
hub.restore().catch(() => {});
const bothReady = () => hub.remotes[0] && hub.remotes[1];

// ---------- cursors ----------
const cursors = [0, 1].map((i) => {
  const c = document.createElement('div'); c.className = 'cursor c' + i;
  $('#cursors').appendChild(c); return c;
});

// ---------- game lifecycle ----------
let mode = 'menu';           // menu | play | over
let game = null, gameDef = null, ctx = null;
const edges = [{}, {}];
let pointerGame = false;
let readyT = 0;
function showReady(on) {
  const r = $('#ready'); r.classList.toggle('hidden', !on);
  if (on) { $('#rTitle').textContent = `${gameDef.id}.exe`; $('#rHow').innerHTML = `<b>${gameDef.title}</b><br>${gameDef.how}`; }
}

function disposeScene() {
  scene.traverse((o) => {
    o.geometry?.dispose?.();
    const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); });
  });
}

async function startGame(def) {
  if (mode !== 'menu') return;
  if (def.href) { music.stop(); snd('ui_select'); setTimeout(() => (location.href = def.href), 350); mode = 'loading'; return; } // standalone page (Hush)
  if (!bothReady()) { ui.toast('Need 2 remotes!', 900); snd('hack_wrong', { vol: 0.7 }); return; }
  mode = 'loading';
  let mod;
  try { mod = await def.load(); } catch (e) { console.error(e); ui.toast('Oops, game broke!'); mode = 'menu'; return; }
  snd('ui_select'); music.play(def.id);
  gameDef = def;
  $('#menu').classList.add('hidden');
  $('#overlay').classList.add('hidden');
  beginRun(mod.default);
}

function beginRun(G) {
  stopLoops();
  if (game) { game.dispose?.(); disposeScene(); }
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 600);
  lights(scene);
  $('#hud').innerHTML = '';
  const remotes = hub.remotes;
  ctx = {
    THREE, scene, camera, renderer, ui, remotes, hub,
    tilts: remotes.map((r) => new Tilt(r)),
    swings: remotes.map((r) => new Swing(r)),
    edges,
    fx: new Fx(scene),
    finish: (win, lines = []) => finish(win, lines),
    rumble: (i, ms) => remotes[i]?.rumble(ms),
  };
  game = new G();
  pointerGame = G.pointer || false; // true (both) or [player indexes]
  edges[0] = {}; edges[1] = {};
  remotes.forEach((r) => r.consume());
  game.init(ctx);
  music.play(gameDef.id);
  readyT = 3.0; showReady(true); mode = 'ready';
}

function finish(win, lines) {
  if (mode !== 'play') return;
  mode = 'over';
  pointerGame = true;
  const o = $('#overlay');
  o.className = win ? 'win' : 'lose';
  $('#ovT').textContent = win ? 'YOU WIN!!' : 'GAME OVER';
  $('#ovL').innerHTML = lines.join('<br>');
  $('#ovK').innerHTML = '<button class="btn green" id="again">Again! (A)</button><button class="btn" id="tomenu">Menu (Home)</button>';
  $('#again').onclick = () => { if (mode !== 'over') return; $('#overlay').classList.add('hidden'); beginRun(game.constructor); };
  $('#tomenu').onclick = () => { if (mode === 'over') toMenu(); };
  music.stop();
  stopLoops(); music.stop(); snd(win ? 'win_jingle' : 'lose_sting');
  hub.remotes.forEach((r) => r.rumble(win ? 150 : 500));
}

function toMenu() {
  stopLoops();
  showReady(false);
  if (game) { game.dispose?.(); game = null; disposeScene(); }
  scene = new THREE.Scene();
  $('#hud').innerHTML = ''; $('#overlay').classList.add('hidden'); $('#toast').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  mode = 'menu'; pointerGame = true; music.play('menu');
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const rs = hub.remotes;
  rs.forEach((r, i) => { if (r) edges[i] = Object.assign(edges[i], r.consume()); });

  if (mode === 'menu') menuTick();
  else if (mode === 'play') {
    rs.forEach((r, i) => { if (r && edges[i].minus) ctx.tilts[i].recenter(); });
    if (edges[0].home || edges[1].home) toMenu();
    else {
      ctx.dt = dt; ctx.fx.unshake(camera);
      try { game.update(dt); } catch (e) { console.error(e); }
      ctx.fx.update(dt); ctx.fx.applyShake(camera);
    }
  } else if (mode === 'ready') {
    readyT -= dt; const n = Math.ceil(readyT);
    $('#rNum').textContent = n > 0 ? n : 'GO!';
    if (n !== ctx.lastN) { ctx.lastN = n; snd(n > 0 ? 'count_beep' : 'count_go'); }
    if (edges[0].home || edges[1].home) { showReady(false); toMenu(); }
    else if (readyT <= 0 || (readyT < 2.2 && (edges[0].a || edges[1].a))) { showReady(false); ctx.tilts.forEach((t) => t.recenter()); rs.forEach((r) => r.consume()); mode = 'play'; }
  } else if (mode === 'over') {
    if (edges[0].home || edges[1].home) toMenu();
    else {
      // A presses whatever button the pointer is over (default: Again)
      for (let i = 0; i < 2; i++) {
        if (!edges[i].a || !rs[i]) continue;
        const p = rs[i].state.pointer, el = p.valid ? document.elementFromPoint(p.x * innerWidth, p.y * innerHeight) : null;
        const btn = el && el.closest('#tomenu, #again');
        if (btn?.id === 'tomenu') { toMenu(); break; }
        $('#again').onclick(); break;
      }
    }
  }
  edges[0] = {}; edges[1] = {};

  // pointer cursors (menu, result screen and pointer games)
  cursors.forEach((c, i) => {
    const r = rs[i], pg = pointerGame === true || (Array.isArray(pointerGame) && pointerGame.includes(i));
    const show = r && r.state.pointer.valid && (pg || mode === 'menu' || mode === 'over');
    c.style.display = show ? 'grid' : 'none';
    if (show) {
      c.style.left = r.state.pointer.x * innerWidth + 'px'; c.style.top = r.state.pointer.y * innerHeight + 'px';
      c.classList.toggle('press', !!r.state.buttons.a);
    }
  });

  renderer.setClearColor(0xfff4d6);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function menuTick() {
  const rs = hub.remotes;
  let hot = null;
  for (let i = 0; i < 2; i++) {
    const r = rs[i]; if (!r || !r.state.pointer.valid) continue;
    const px = r.state.pointer.x * innerWidth, py = r.state.pointer.y * innerHeight;
    for (const el of cardsEl.children) {
      const b = el.getBoundingClientRect();
      if (px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) {
        if (!el.classList.contains('hot')) snd('ui_click', { vol: 0.5 });
        el.classList.add('hot');
        if (edges[i].a) { hot = el._game; }
      } else if (i === 1 || !rs[1]) { /* handled below */ }
    }
  }
  // clear hot state for cards no pointer is over
  for (const el of cardsEl.children) {
    const b = el.getBoundingClientRect();
    const over = rs.some((r) => r && r.state.pointer.valid && r.state.pointer.x * innerWidth >= b.left && r.state.pointer.x * innerWidth <= b.right && r.state.pointer.y * innerHeight >= b.top && r.state.pointer.y * innerHeight <= b.bottom);
    if (!over) el.classList.remove('hot');
  }
  if (hot) startGame(hot);
}

// real sounds: menu essentials first, everything else in the background
loadSounds(['music_menu', 'ui_click', 'ui_select', 'count_beep', 'count_go', 'win_jingle', 'lose_sting', 'popup_pop']).then(() => loadSounds());
toMenu();
// browsers only allow audio after a gesture: start the menu tune on the first one
const firstGesture = () => { removeEventListener('pointerdown', firstGesture); removeEventListener('keydown', firstGesture); if (mode === 'menu') music.play('menu'); };
addEventListener('pointerdown', firstGesture); addEventListener('keydown', firstGesture);
const mus = $('#mus'); const musLabel = () => (mus.textContent = music.on ? '🔊 Music ON' : '🔇 Music OFF');
musLabel(); mus.onclick = () => { music.toggle(); musLabel(); if (music.on) music.play(mode === 'menu' ? 'menu' : gameDef?.id); };
requestAnimationFrame(frame);
window.__wd = { hub, get ctx() { return ctx; }, get game() { return game; }, startGame: (id) => startGame(GAMES.find((g) => g.id === id)), settings, saveSettings };
