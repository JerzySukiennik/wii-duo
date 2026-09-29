// Materials: Poly Haven CC0 PBR sets + procedural canvas textures (damask wallpaper,
// flashlight cookie, wall scrawls). Geometry in this game carries UVs in metres, so every
// texture's `repeat` is 1 / (tile size in metres).
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
let maxAniso = 4;

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function loadTex(url, srgb, tile) {
  return new Promise((resolve) => {
    loader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = maxAniso;
      t.repeat.set(1 / tile, 1 / tile);
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

async function pbrSet(key, tile, withDiff = true) {
  const [map, normalMap, roughnessMap] = await Promise.all([
    withDiff ? loadTex(`textures/${key}_diff.jpg`, true, tile) : null,
    loadTex(`textures/${key}_nor.jpg`, false, tile),
    loadTex(`textures/${key}_rough.jpg`, false, tile),
  ]);
  return { map, normalMap, roughnessMap };
}

function canvasTex(canvas, tile, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  t.repeat.set(1 / tile, 1 / tile);
  return t;
}

// Deterministic PRNG so the house looks the same every run.
function mulberry(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Victorian damask: a mirrored ornament on a half-drop grid, multiplied with a real
// grime scan so it reads as old paper, not vector art.
function damask(base, ink, grime, seed) {
  const S = 1024;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  const rnd = mulberry(seed);
  const motif = (cx, cy, s) => {
    g.save(); g.translate(cx, cy); g.scale(s, s);
    for (const side of [-1, 1]) {
      g.save(); g.scale(side, 1);
      g.beginPath();
      g.moveTo(0, -120);
      g.bezierCurveTo(40, -100, 70, -60, 48, -20);
      g.bezierCurveTo(90, -30, 110, 10, 80, 40);
      g.bezierCurveTo(60, 60, 30, 50, 22, 30);
      g.bezierCurveTo(40, 70, 30, 110, 0, 130);
      g.lineTo(0, -120);
      g.fill();
      g.beginPath();
      g.moveTo(10, -60); g.bezierCurveTo(30, -40, 20, -10, 6, 0);
      g.moveTo(60, 0); g.bezierCurveTo(80, 10, 75, 30, 58, 28);
      g.lineWidth = 5; g.stroke();
      g.beginPath(); g.arc(70, -70, 9, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(95, 60, 6, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    g.restore();
  };
  g.fillStyle = ink; g.strokeStyle = base;
  const cell = S / 4;
  for (let y = -1; y <= 4; y++) for (let x = -1; x <= 4; x++) {
    const ox = (y % 2) * cell / 2;
    motif(x * cell + ox + cell / 2, y * cell + cell / 2, 0.55);
  }
  // thin stripes between columns
  g.globalAlpha = 0.25; g.fillStyle = ink;
  for (let x = 0; x < 4; x++) g.fillRect(x * cell + 2, 0, 3, S);
  g.globalAlpha = 1;
  if (grime) {
    // overlay keeps the mid-tones; a light multiply adds the grime without crushing it
    g.globalCompositeOperation = 'overlay';
    g.drawImage(grime, 0, 0, S, S);
    g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.3;
    g.drawImage(grime, 0, 0, S, S);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  // water stains and a faded band where furniture once stood
  for (let i = 0; i < 9; i++) {
    const x = rnd() * S, y = S * (0.55 + rnd() * 0.45), r = 40 + rnd() * 160;
    const grd = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    grd.addColorStop(0, 'rgba(60,45,20,0.18)'); grd.addColorStop(0.85, 'rgba(60,45,20,0.10)');
    grd.addColorStop(1, 'rgba(40,30,10,0.0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return c;
}

// Uneven LED-flashlight cookie: hot core, dark ring, soft outer halo, lens smudges.
function cookie() {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0.00, '#ffffff');
  grd.addColorStop(0.12, '#f6f3ec');
  grd.addColorStop(0.19, '#b3afa6');
  grd.addColorStop(0.25, '#d6d2c8');
  grd.addColorStop(0.40, '#8f8b84');
  grd.addColorStop(0.70, '#4a4845');
  grd.addColorStop(0.92, '#1c1b1a');
  grd.addColorStop(1.00, '#000000');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  const rnd = mulberry(7);
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 26; i++) {
    const x = S / 2 + (rnd() - 0.5) * S * 0.7, y = S / 2 + (rnd() - 0.5) * S * 0.7, r = 6 + rnd() * 30;
    const s = g.createRadialGradient(x, y, 0, x, y, r);
    s.addColorStop(0, `rgba(120,118,112,${0.25 + rnd() * 0.3})`); s.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = s; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Scrawled wall writing (used as decals after you've been caught).
export function scrawlTexture(text, seed = 1) {
  const W = 1024, H = 384;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rnd = mulberry(seed);
  g.clearRect(0, 0, W, H);
  g.font = `bold ${text.length > 12 ? 92 : 130}px "Special Elite", "Courier New", monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const letters = text.split('');
  const widths = letters.map(l => g.measureText(l).width * 1.05);
  let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < letters.length; i++) {
    g.save();
    g.translate(x + widths[i] / 2, H / 2 + (rnd() - 0.5) * 24);
    g.rotate((rnd() - 0.5) * 0.18);
    g.fillStyle = `rgba(${70 + rnd() * 40 | 0},${8 + rnd() * 10 | 0},${6 + rnd() * 8 | 0},0.92)`;
    g.fillText(letters[i], 0, 0);
    // drips
    if (rnd() < 0.55 && letters[i] !== ' ') {
      const dx = (rnd() - 0.5) * widths[i] * 0.5, len = 30 + rnd() * 110;
      g.fillRect(dx, 30, 3 + rnd() * 3, len);
      g.beginPath(); g.arc(dx + 2.5, 30 + len, 4, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    x += widths[i];
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noiseCanvas(size, base, spread, seed) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const rnd = mulberry(seed);
  for (let i = 0; i < size * size; i++) {
    const v = base + (rnd() - 0.5) * spread;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.max(0, Math.min(255, v));
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Bare-tree silhouette on transparent background, for the yard seen through windows.
function treeCanvas(seed) {
  const W = 512, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rnd = mulberry(seed);
  g.strokeStyle = '#000'; g.lineCap = 'round';
  const branch = (x, y, ang, len, w, depth) => {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + (rnd() - 0.5) * len * 0.4, (y + y2) / 2, x2, y2); g.stroke();
    if (depth <= 0 || w < 1) return;
    const n = 2 + (rnd() * 2 | 0);
    for (let i = 0; i < n; i++) branch(x2, y2, ang + (rnd() - 0.5) * 1.3, len * (0.62 + rnd() * 0.2), w * 0.62, depth - 1);
  };
  branch(W / 2, H, -Math.PI / 2 + (rnd() - 0.5) * 0.15, 340, 34, 7);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function weaveCanvas(seed) {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S), rnd = mulberry(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const warp = ((x >> 1) + (y >> 2)) % 2 ? 1 : 0;
    const v = 150 + warp * 30 + (rnd() - 0.5) * 50 + Math.sin(y * 0.09) * 10;
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v)); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // stains
  for (let k = 0; k < 7; k++) {
    const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 50;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(70,55,35,0.25)'); gr.addColorStop(1, 'rgba(70,55,35,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  return c;
}

function dropsCanvas() {
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const rnd = mulberry(99);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * S, y = rnd() * S, r = 1 + rnd() * 4;
    g.fillStyle = `rgba(200,210,230,${0.15 + rnd() * 0.35})`;
    g.beginPath(); g.ellipse(x, y, r * 0.8, r, 0, 0, Math.PI * 2); g.fill();
    if (rnd() < 0.25) { g.fillRect(x - 0.6, y, 1.2, 10 + rnd() * 50); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export async function loadMaterials(renderer, onProgress = () => {}) {
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const sets = {};
  const plan = [
    ['floor_wood', 1.6], ['wallpaper', 2.2], ['wall_paint', 2.4], ['wall_plain', 2.6], ['ceiling', 2.5],
    ['tiles_floor', 2.0], ['tiles_wall', 1.0], ['linoleum', 1.4], ['carpet', 1.8], ['concrete_floor', 3.0],
    ['concrete_wall', 2.5], ['wood_furn', 1.2], ['wood_dark', 2.0],
  ];
  let done = 0;
  await Promise.all(plan.map(async ([k, tile]) => {
    sets[k] = await pbrSet(k, tile);
    onProgress(++done / (plan.length + 2));
  }));
  sets.fabric = await pbrSet('fabric', 0.6, false);
  const grime = await loadImage('textures/wallpaper_diff.jpg');
  onProgress(1);

  const std = (o) => new THREE.MeshStandardMaterial(o);
  const fromSet = (s, extra = {}) => std({
    map: s.map, normalMap: s.normalMap, roughnessMap: s.roughnessMap, roughness: 1, metalness: 0, ...extra,
  });

  const wpTex = (base, ink, seed) => canvasTex(damask(base, ink, grime, seed), 1.6);
  const weave = canvasTex(weaveCanvas(5), 0.35);
  const ns = new THREE.Vector2(0.6, 0.6);

  const M = {
    floorWood: fromSet(sets.floor_wood, { color: 0x8a6a52, normalScale: ns }),
    floorDark: fromSet(sets.wood_dark, { color: 0xb0a090 }),
    linoleum: fromSet(sets.linoleum, { color: 0xa89a80 }),
    tilesFloor: fromSet(sets.tiles_floor, { color: 0x9a8f86 }),
    tilesWall: fromSet(sets.tiles_wall, { color: 0xc9c7bd, roughness: 0.5 }),
    carpet: fromSet(sets.carpet, { color: 0x6e3a30 }),
    concreteFloor: fromSet(sets.concrete_floor, { color: 0x77736c }),
    concreteWall: fromSet(sets.concrete_floor, { color: 0x5c5a55 }),
    ceiling: fromSet(sets.ceiling, { color: 0xb8b2a6 }),
    wallPlain: fromSet(sets.wall_plain, { color: 0xa7a28f }),
    wallKitchen: fromSet(sets.wall_plain, { color: 0xb3a57a }),
    wallStudy: fromSet(sets.wall_plain, { color: 0x77816f }),
    wallKid: fromSet(sets.wall_paint, { color: 0xd8c0bc }),
    wallpaperGreen: std({ map: wpTex('#5d6a55', '#3b4636', 3), normalMap: sets.wallpaper.normalMap, roughnessMap: sets.wallpaper.roughnessMap, roughness: 1 }),
    wallpaperRed: std({ map: wpTex('#7a4a44', '#4f2a27', 5), normalMap: sets.wallpaper.normalMap, roughnessMap: sets.wallpaper.roughnessMap, roughness: 1 }),
    wallpaperBlue: std({ map: wpTex('#5f6a78', '#3c4552', 9), normalMap: sets.wallpaper.normalMap, roughnessMap: sets.wallpaper.roughnessMap, roughness: 1 }),
    wallpaperOchre: std({ map: wpTex('#8a7650', '#5d4c2c', 13), normalMap: sets.wallpaper.normalMap, roughnessMap: sets.wallpaper.roughnessMap, roughness: 1 }),
    woodFurn: fromSet(sets.wood_furn, { color: 0x9c8070 }),
    woodDark: fromSet(sets.wood_furn, { color: 0x4a3328 }),
    woodPaint: fromSet(sets.wood_dark, { color: 0xe8e2d4 }), // painted door/trim wood
    baseboard: fromSet(sets.wood_dark, { color: 0xcfc6b4 }),
    fabricBed: std({ map: weave, color: 0x9a958a, normalMap: sets.fabric.normalMap, roughnessMap: sets.fabric.roughnessMap, roughness: 1 }),
    fabricBlanket: std({ map: weave, color: 0x5e5064, normalMap: sets.fabric.normalMap, roughnessMap: sets.fabric.roughnessMap, roughness: 1 }),
    fabricSofa: std({ map: weave, color: 0x46503f, normalMap: sets.fabric.normalMap, roughnessMap: sets.fabric.roughnessMap, roughness: 1 }),
    fabricKid: std({ map: weave, color: 0x8c6e7c, normalMap: sets.fabric.normalMap, roughnessMap: sets.fabric.roughnessMap, roughness: 1 }),
    sheet: std({ map: weave, color: 0xa9a59c, normalMap: sets.fabric.normalMap, roughnessMap: sets.fabric.roughnessMap, roughness: 1 }),
    rug: fromSet(sets.carpet, { color: 0x7b4034 }),
    porcelain: std({ color: 0xe6e3dc, roughness: 0.18, metalness: 0 }),
    metal: std({ color: 0x8a8d90, roughness: 0.35, metalness: 0.9 }),
    darkMetal: std({ color: 0x2e3032, roughness: 0.5, metalness: 0.8 }),
    rust: std({ color: 0x5a3a28, roughness: 0.8, metalness: 0.4 }),
    plastic: std({ color: 0x2a2a2a, roughness: 0.4 }),
    whitePlastic: std({ color: 0xd0cdc4, roughness: 0.45 }),
    black: std({ color: 0x050505, roughness: 0.3 }),
    book: std({ color: 0x6b3a2e, roughness: 0.8 }),
    paper: std({ color: 0xcfc8b5, roughness: 0.9 }),
    toyRed: std({ color: 0x8a2a24, roughness: 0.5 }),
    toyBlue: std({ color: 0x2c4a6a, roughness: 0.5 }),
    dollSkin: std({ color: 0xd9c1ae, roughness: 0.3 }),
    frame: std({ color: 0x3a2a1e, roughness: 0.5, metalness: 0.2 }),
    canvas: std({ color: 0x2a2620, roughness: 0.9 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x88a0b8, roughness: 0.05, metalness: 0, transmission: 0,
      transparent: true, opacity: 0.18, depthWrite: false, envMapIntensity: 1 }),
    ground: std({ map: canvasTex(noiseCanvas(256, 38, 30, 3), 4), color: 0x2e3b2a, roughness: 1 }),
    fence: std({ color: 0x3a3530, roughness: 1 }),
  };
  M.sky = new THREE.MeshBasicMaterial({ color: 0x0a1220, fog: false, side: THREE.BackSide });
  M.tree = new THREE.MeshBasicMaterial({ map: treeCanvas(4), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, color: 0x000000, fog: false });
  M.tree2 = new THREE.MeshBasicMaterial({ map: treeCanvas(11), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, color: 0x000000, fog: false });
  M.drops = dropsCanvas();
  M.cookie = cookie();
  return M;
}
