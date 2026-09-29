// The house: layout data → geometry (merged per material), doors, furniture, colliders,
// nav grid + A*, hide spots, pickup spots, windows, exterior, special props (mirror, TV,
// phone, clock, breaker box, front door).
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const T = 0.16;          // wall thickness
export const BASE_FLOOR = -3.2; // basement floor
export const PHANTOM = 2;       // camera layer only the TV feed and the mirror can see

const STAIR_X0 = 20.25, STAIR_X1 = 24.35;

// ---------------------------------------------------------------- layout
const ROOMS = [
  { id: 'master', name: 'bedroom', x0: 0, z0: 0, x1: 7, z1: 5, wall: 'wallpaperBlue', floor: 'floorWood', surface: 'wood' },
  { id: 'bath', name: 'bathroom', x0: 7, z0: 0, x1: 10.5, z1: 5, wall: 'tilesWall', floor: 'tilesFloor', surface: 'tile' },
  { id: 'kid', name: "kid's room", x0: 10.5, z0: 0, x1: 16, z1: 5, wall: 'wallKid', floor: 'floorWood', surface: 'wood' },
  { id: 'study', name: 'study', x0: 16, z0: 0, x1: 20, z1: 5, wall: 'wallStudy', floor: 'floorDark', surface: 'wood' },
  { id: 'hall', name: 'hallway', x0: 0, z0: 5, x1: 20, z1: 7, wall: 'wallpaperGreen', floor: 'floorWood', surface: 'wood' },
  { id: 'kitchen', name: 'kitchen', x0: 0, z0: 7, x1: 6, z1: 14, wall: 'wallKitchen', floor: 'linoleum', surface: 'tile' },
  { id: 'living', name: 'living room', x0: 6, z0: 7, x1: 14, z1: 14, wall: 'wallpaperRed', floor: 'floorWood', surface: 'wood' },
  { id: 'foyer', name: 'entrance', x0: 14, z0: 7, x1: 20, z1: 11, wall: 'wallpaperOchre', floor: 'tilesFloor', surface: 'tile' },
  { id: 'laundry', name: 'laundry', x0: 14, z0: 11, x1: 20, z1: 14, wall: 'wallPlain', floor: 'concreteFloor', surface: 'concrete' },
  { id: 'stairs', name: 'stairs', x0: 20, z0: 11.8, x1: 24.6, z1: 13.2, wall: 'concreteWall', floor: null, surface: 'wood', y0: BASE_FLOOR, y1: 2.7, openEast: true },
  { id: 'basement', name: 'basement', x0: 24.6, z0: 8.5, x1: 32.6, z1: 16.5, wall: 'concreteWall', floor: 'concreteFloor', surface: 'concrete', y0: BASE_FLOOR, y1: -0.9 },
];
for (const r of ROOMS) { r.y0 ??= 0; r.y1 ??= 2.7; }

// Openings. line 'z' = wall along x at z=at; line 'x' = wall along z at x=at.
const OPEN = [
  // exterior windows
  { line: 'z', at: 0, from: 2.2, to: 3.8, bottom: 0.9, top: 2.1, kind: 'window', out: -1, light: true },
  { line: 'x', at: 0, from: 1.6, to: 3.4, bottom: 0.9, top: 2.1, kind: 'window', out: -1, light: true },
  { line: 'z', at: 0, from: 8.4, to: 9.2, bottom: 1.5, top: 2.1, kind: 'window', out: -1 },
  { line: 'z', at: 0, from: 12.4, to: 14.0, bottom: 0.9, top: 2.1, kind: 'window', out: -1, light: true },
  { line: 'z', at: 0, from: 17.4, to: 18.9, bottom: 0.9, top: 2.1, kind: 'window', out: -1, light: true },
  { line: 'x', at: 20, from: 5.3, to: 6.7, bottom: 0.35, top: 2.35, kind: 'window', out: 1, light: true, id: 'w_hall' },
  { line: 'x', at: 0, from: 9.0, to: 10.8, bottom: 0.95, top: 2.1, kind: 'window', out: -1, light: true, id: 'w_kitchen' },
  { line: 'z', at: 14, from: 2.0, to: 3.6, bottom: 0.95, top: 2.1, kind: 'window', out: 1 },
  { line: 'z', at: 14, from: 8.0, to: 12.0, bottom: 0.6, top: 2.25, kind: 'window', out: 1, light: true, id: 'w_living' },
  { line: 'z', at: 14, from: 17.0, to: 18.0, bottom: 1.4, top: 2.0, kind: 'window', out: 1 },
  // doors
  { line: 'z', at: 5, from: 3.0, to: 3.9, bottom: 0, top: 2.1, kind: 'door', id: 'd_master', hinge: 'from', into: 'master' },
  { line: 'z', at: 5, from: 8.3, to: 9.2, bottom: 0, top: 2.1, kind: 'door', id: 'd_bath', hinge: 'to', into: 'bath' },
  { line: 'z', at: 5, from: 12.6, to: 13.5, bottom: 0, top: 2.1, kind: 'door', id: 'd_kid', hinge: 'to', into: 'kid' },
  { line: 'z', at: 5, from: 17.6, to: 18.5, bottom: 0, top: 2.1, kind: 'door', id: 'd_study', hinge: 'from', into: 'study' },
  { line: 'z', at: 7, from: 2.2, to: 3.1, bottom: 0, top: 2.1, kind: 'door', id: 'd_kitchen', hinge: 'from', into: 'kitchen' },
  { line: 'x', at: 6, from: 10.0, to: 10.9, bottom: 0, top: 2.1, kind: 'door', id: 'd_kitliv', hinge: 'from', into: 'living' },
  { line: 'z', at: 11, from: 15.8, to: 16.7, bottom: 0, top: 2.1, kind: 'door', id: 'd_laundry', hinge: 'from', into: 'laundry' },
  { line: 'x', at: 20, from: 12.05, to: 12.95, bottom: 0, top: 2.1, kind: 'door', id: 'd_basement', hinge: 'from', into: 'laundry' },
  { line: 'x', at: 20, from: 8.5, to: 9.5, bottom: 0, top: 2.15, kind: 'door', id: 'd_front', hinge: 'to', into: 'foyer', locked: true, front: true },
  // archways
  { line: 'z', at: 7, from: 9.0, to: 11.0, bottom: 0, top: 2.25, kind: 'arch' },
  { line: 'z', at: 7, from: 15.6, to: 17.4, bottom: 0, top: 2.25, kind: 'arch' },
  { line: 'x', at: 14, from: 8.3, to: 9.7, bottom: 0, top: 2.25, kind: 'arch' },
  { line: 'x', at: 24.6, from: 11.8, to: 13.2, bottom: BASE_FLOOR, top: -0.9, kind: 'arch' },
];

const WALLS = [
  { line: 'z', at: 0, from: 0, to: 20 }, { line: 'z', at: 5, from: 0, to: 20 }, { line: 'z', at: 7, from: 0, to: 20 },
  { line: 'z', at: 11, from: 14, to: 20 }, { line: 'z', at: 14, from: 0, to: 20 },
  { line: 'x', at: 0, from: 0, to: 14 }, { line: 'x', at: 7, from: 0, to: 5 }, { line: 'x', at: 10.5, from: 0, to: 5 },
  { line: 'x', at: 16, from: 0, to: 5 }, { line: 'x', at: 20, from: 0, to: 14 }, { line: 'x', at: 6, from: 7, to: 14 },
  { line: 'x', at: 14, from: 7, to: 14 },
  { line: 'z', at: 11.8, from: 20, to: 24.6, y0: BASE_FLOOR, y1: 2.7 }, { line: 'z', at: 13.2, from: 20, to: 24.6, y0: BASE_FLOOR, y1: 2.7 },
  { line: 'z', at: 8.5, from: 24.6, to: 32.6, y0: BASE_FLOOR, y1: -0.9 }, { line: 'z', at: 16.5, from: 24.6, to: 32.6, y0: BASE_FLOOR, y1: -0.9 },
  { line: 'x', at: 32.6, from: 8.5, to: 16.5, y0: BASE_FLOOR, y1: -0.9 }, { line: 'x', at: 24.6, from: 8.5, to: 16.5, y0: BASE_FLOOR, y1: -0.9 },
];

// ---------------------------------------------------------------- geometry buckets
class Buckets {
  constructor() { this.b = new Map(); }
  get(k) { let v = this.b.get(k); if (!v) { v = { p: [], n: [], u: [] }; this.b.set(k, v); } return v; }
  tri(k, a, b, c, n, ua, ub, uc) {
    const v = this.get(k);
    v.p.push(...a, ...b, ...c); v.n.push(...n, ...n, ...n); v.u.push(...ua, ...ub, ...uc);
  }
  // generic quad p0..p3 (xyz arrays) with uv0..uv3; winding fixed to face normal n
  quad(k, p0, p1, p2, p3, n, uv) {
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (c[0] * n[0] + c[1] * n[1] + c[2] * n[2] < 0) {
      [p1, p3] = [p3, p1]; uv = [uv[0], uv[3], uv[2], uv[1]];
    }
    this.tri(k, p0, p1, p2, n, uv[0], uv[1], uv[2]);
    this.tri(k, p0, p2, p3, n, uv[0], uv[2], uv[3]);
  }
  // vertical rectangle from (ax,az) to (bx,bz), y0..y1, facing (nx,nz). UV in metres.
  vquad(k, ax, az, bx, bz, y0, y1, nx, nz) {
    if (y1 - y0 < 0.001 || (Math.abs(bx - ax) + Math.abs(bz - az)) < 0.001) return;
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    const ua = alongX ? ax : az, ub = alongX ? bx : bz;
    this.quad(k, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [nx, 0, nz],
      [[ua, y0], [ub, y0], [ub, y1], [ua, y1]]);
  }
  hquad(k, x0, z0, x1, z1, y, up) {
    const ny = up ? 1 : -1;
    this.quad(k, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, ny, 0],
      [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
  }
  // axis-aligned box (optionally rotated about Y by ry around its centre), y = bottom
  box(k, w, h, d, cx, y, cz, ry = 0, faces = 63) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const P = (lx, ly, lz) => [cx + lx * c + lz * s, y + ly, cz - lx * s + lz * c];
    const N = (lx, ly, lz) => [lx * c + lz * s, ly, -lx * s + lz * c];
    const hw = w / 2, hd = d / 2;
    const F = [
      // +x
      [P(hw, 0, -hd), P(hw, 0, hd), P(hw, h, hd), P(hw, h, -hd), N(1, 0, 0), [[0, 0], [d, 0], [d, h], [0, h]]],
      // -x
      [P(-hw, 0, hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(-hw, h, hd), N(-1, 0, 0), [[0, 0], [d, 0], [d, h], [0, h]]],
      // +y
      [P(-hw, h, -hd), P(hw, h, -hd), P(hw, h, hd), P(-hw, h, hd), N(0, 1, 0), [[0, 0], [w, 0], [w, d], [0, d]]],
      // -y
      [P(-hw, 0, hd), P(hw, 0, hd), P(hw, 0, -hd), P(-hw, 0, -hd), N(0, -1, 0), [[0, 0], [w, 0], [w, d], [0, d]]],
      // +z
      [P(-hw, 0, hd), P(hw, 0, hd), P(hw, h, hd), P(-hw, h, hd), N(0, 0, 1), [[0, 0], [w, 0], [w, h], [0, h]]],
      // -z
      [P(hw, 0, -hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(hw, h, -hd), N(0, 0, -1), [[0, 0], [w, 0], [w, h], [0, h]]],
    ];
    F.forEach((f, i) => { if (faces & (1 << i)) this.quad(k, f[0], f[1], f[2], f[3], f[4], f[5]); });
  }
  geo(k, geometry, matrix, uvScale = 1) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(matrix);
    const v = this.get(k);
    const p = g.attributes.position.array, n = g.attributes.normal.array, u = g.attributes.uv?.array;
    for (let i = 0; i < p.length; i++) { v.p.push(p[i]); v.n.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) { v.u.push(u ? u[i * 2] * uvScale : 0, u ? u[i * 2 + 1] * uvScale : 0); }
  }
  build(M, parent) {
    for (const [k, v] of this.b) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(v.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(v.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(v.u, 2));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, M[k]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = 'static:' + k;
      parent.add(mesh);
    }
  }
}

const tmpM = new THREE.Matrix4();
const mat4 = (x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  tmpM.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz)).clone();

// ---------------------------------------------------------------- build
export function buildHouse(scene, M) {
  const root = new THREE.Group(); root.name = 'house'; scene.add(root);
  const B = new Buckets();
  const colliders = [];      // {x0,z0,x1,z1,y0,y1,opaque,solid,tag}
  const interactables = [];  // {obj, kind, prompt(), use(), enabled()}
  const hideSpots = [];
  const pickupSpots = [];
  const doors = [];
  const windows = [];
  const lamps = [];          // fixture meshes that glow when the power returns
  const house = { root, colliders, interactables, hideSpots, pickupSpots, doors, windows, lamps, rooms: ROOMS, M };

  const addCol = (x0, z0, x1, z1, y0, y1, opaque, tag, solid = true) => {
    const c = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y0, y1, opaque, solid, tag };
    colliders.push(c); return c;
  };
  const roomById = Object.fromEntries(ROOMS.map(r => [r.id, r]));

  // ---- walls: faces per room side, with openings cut
  for (const r of ROOMS) {
    const sides = [
      { line: 'z', at: r.z0, from: r.x0, to: r.x1, n: [0, 1] },
      { line: 'z', at: r.z1, from: r.x0, to: r.x1, n: [0, -1] },
      { line: 'x', at: r.x0, from: r.z0, to: r.z1, n: [1, 0] },
      { line: 'x', at: r.x1, from: r.z0, to: r.z1, n: [-1, 0] },
    ];
    for (const s of sides) {
      if (r.openEast && s.line === 'x' && s.at === r.x1) continue;
      const lo = s.from + T / 2, hi = s.to - T / 2;
      const ops = OPEN.filter(o => o.line === s.line && Math.abs(o.at - s.at) < 1e-3 && o.to > lo && o.from < hi)
        .sort((a, b) => a.from - b.from);
      const cuts = [lo];
      for (const o of ops) { cuts.push(Math.max(lo, o.from), Math.min(hi, o.to)); }
      cuts.push(hi);
      const off = T / 2;
      const face = (a, b, y0, y1) => {
        if (s.line === 'z') B.vquad(r.wall, a, s.at + s.n[1] * off, b, s.at + s.n[1] * off, y0, y1, 0, s.n[1]);
        else B.vquad(r.wall, s.at + s.n[0] * off, a, s.at + s.n[0] * off, b, y0, y1, s.n[0], 0);
      };
      // solid segments
      for (let i = 0; i < cuts.length; i += 2) if (cuts[i + 1] - cuts[i] > 0.001) face(cuts[i], cuts[i + 1], r.y0, r.y1);
      // above/below openings
      for (const o of ops) {
        const a = Math.max(lo, o.from), b = Math.min(hi, o.to);
        if (o.top < r.y1) face(a, b, Math.max(o.top, r.y0), r.y1);
        if (o.bottom > r.y0) face(a, b, r.y0, Math.min(o.bottom, r.y1));
      }
      // baseboard
      if (r.id !== 'stairs' && r.id !== 'bath') {
        for (let i = 0; i < cuts.length; i += 2) {
          const a = cuts[i], b = cuts[i + 1];
          if (b - a < 0.05) continue;
          const len = b - a, mid = (a + b) / 2, bo = off + 0.012;
          if (s.line === 'z') B.box('baseboard', len, 0.1, 0.024, mid, r.y0, s.at + s.n[1] * bo);
          else B.box('baseboard', 0.024, 0.1, len, s.at + s.n[0] * bo, r.y0, mid);
        }
      }
    }
    // floor + ceiling
    if (r.floor) B.hquad(r.floor, r.x0, r.z0, r.x1, r.z1, r.y0, true);
    if (r.id === 'stairs') {
      // sloped ceiling following the stairs
      const yA = 2.7, yB = -0.9;
      B.quad('concreteWall', [r.x0, yA, r.z0], [r.x1, yB, r.z0], [r.x1, yB, r.z1], [r.x0, yA, r.z1],
        new THREE.Vector3(3.6, -4.6, 0).normalize().toArray(), [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]]);
    } else B.hquad('ceiling', r.x0, r.z0, r.x1, r.z1, r.y1, false);
  }

  // ---- wall colliders (openings that are passable are cut out; windows are solid)
  for (const w of WALLS) {
    const y0 = w.y0 ?? 0, y1 = w.y1 ?? 2.7;
    const ops = OPEN.filter(o => o.line === w.line && Math.abs(o.at - w.at) < 1e-3 && o.kind !== 'window' && o.to > w.from && o.from < w.to)
      .sort((a, b) => a.from - b.from);
    let cur = w.from;
    const seg = (a, b) => {
      if (b - a < 0.01) return;
      const ea = a === w.from ? T / 2 : 0, eb = b === w.to ? T / 2 : 0;
      if (w.line === 'z') addCol(a - ea, w.at - T / 2, b + eb, w.at + T / 2, y0, y1, true, 'wall');
      else addCol(w.at - T / 2, a - ea, w.at + T / 2, b + eb, y0, y1, true, 'wall');
    };
    for (const o of ops) { seg(cur, o.from); cur = o.to; }
    seg(cur, w.to);
  }

  // ---- openings: jambs, casings, windows, doors
  for (const o of OPEN) {
    const along = o.line === 'z' ? 'x' : 'z';
    const P = (a, y, n) => o.line === 'z' ? [a, y, o.at + n] : [o.at + n, y, a];
    const wallMat = (side) => {
      // the room on the given side of the wall (side = -1 or +1 along the wall normal)
      const probeA = (o.from + o.to) / 2;
      const px = o.line === 'z' ? probeA : o.at + side * 0.3, pz = o.line === 'z' ? o.at + side * 0.3 : probeA;
      const r = roomAt(px, pz);
      return r ? r.wall : 'wallPlain';
    };
    const jm = o.kind === 'window' ? 'woodPaint' : wallMat(1);
    const yb = o.bottom, yt = o.top;
    // jambs (faces spanning the wall thickness)
    for (const [a, nd] of [[o.from, 1], [o.to, -1]]) {
      const n = o.line === 'z' ? [nd, 0, 0] : [0, 0, nd];
      B.quad(jm, P(a, yb, -T / 2), P(a, yb, T / 2), P(a, yt, T / 2), P(a, yt, -T / 2), n,
        [[0, yb], [T, yb], [T, yt], [0, yt]]);
    }
    // lintel underside
    if (!(o.kind === 'arch' && o.top >= -0.9 && o.at === 24.6)) {
      B.quad(jm, P(o.from, yt, -T / 2), P(o.to, yt, -T / 2), P(o.to, yt, T / 2), P(o.from, yt, T / 2), [0, -1, 0],
        [[o.from, 0], [o.to, 0], [o.to, T], [o.from, T]]);
    }
    if (o.kind === 'window') {
      // sill board, frame, muntins, glass
      const inside = -o.out;
      const w = o.to - o.from, h = yt - yb, mid = (o.from + o.to) / 2, fw = 0.05;
      const fb = (len, hh, a, y, horiz) => {
        if (o.line === 'z') B.box('woodPaint', horiz ? len : fw, hh, 0.07, a, y, o.at);
        else B.box('woodPaint', 0.07, hh, horiz ? len : fw, o.at, y, a);
      };
      if (o.line === 'z') B.box('woodPaint', w + 0.12, 0.03, T + 0.08, mid, yb - 0.03, o.at + inside * 0.04);
      else B.box('woodPaint', T + 0.08, 0.03, w + 0.12, o.at + inside * 0.04, yb - 0.03, mid);
      fb(w, fw, mid, yb, true); fb(w, fw, mid, yt - fw, true);
      fb(fw, h, o.from + fw / 2, yb, false); fb(fw, h, o.to - fw / 2, yb, false);
      fb(0.035, h, mid, yb, false);
      fb(w, 0.035, mid, yb + h * 0.55, true);
      // glass + rain drops (dynamic, not merged)
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.glass);
      const drops = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
        map: M.drops.clone(), transparent: true, opacity: 0.35, depthWrite: false, fog: false, color: 0x8899aa, side: THREE.DoubleSide }));
      drops.material.map.repeat.set(w / 1.2, h / 1.2);
      drops.material.map.needsUpdate = true;
      for (const m of [gl, drops]) {
        m.position.set(...P(mid, yb + h / 2, m === drops ? inside * 0.004 : 0));
        if (o.line === 'x') m.rotation.y = Math.PI / 2;
        m.renderOrder = 2;
        root.add(m);
      }
      const outN = o.line === 'z' ? new THREE.Vector3(0, 0, o.out) : new THREE.Vector3(o.out, 0, 0);
      const center = new THREE.Vector3(...P(mid, yb + h / 2, 0));
      windows.push({ ...o, center, outN, width: w, height: h, drops, glass: gl });
    }
    if (o.kind === 'door' || o.kind === 'arch') {
      // casing trim on both faces
      if (!(o.at === 24.6)) for (const side of [-1, 1]) {
        const d = side * (T / 2 + 0.012), cw = 0.07;
        const cb = (len, hh, a, y, horiz) => {
          if (o.line === 'z') B.box('woodPaint', horiz ? len : cw, hh, 0.024, a, y, o.at + d);
          else B.box('woodPaint', 0.024, hh, horiz ? len : cw, o.at + d, y, a);
        };
        cb(o.to - o.from + cw * 2, cw, (o.from + o.to) / 2, yt, true);
        cb(cw, yt - yb, o.from - cw / 2, yb, false);
        cb(cw, yt - yb, o.to + cw / 2, yb, false);
      }
    }
    if (o.kind === 'door') doors.push(makeDoor(o));
  }

  function makeDoor(o) {
    const w = o.to - o.from, h = o.top - o.bottom - 0.02;
    const hx = o.line === 'z' ? (o.hinge === 'from' ? o.from : o.to) : o.at;
    const hz = o.line === 'z' ? o.at : (o.hinge === 'from' ? o.from : o.to);
    const pivot = new THREE.Group();
    pivot.position.set(hx, o.bottom, hz);
    const base = o.line === 'z' ? (o.hinge === 'from' ? 0 : Math.PI) : (o.hinge === 'from' ? -Math.PI / 2 : Math.PI / 2);
    const leafW = w - 0.02;
    const leaf = new THREE.Group();
    const mk = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; leaf.add(m); return m; };
    const slab = mk(new THREE.BoxGeometry(leafW, h, 0.045), o.front ? M.woodDark : M.woodPaint, 0.01 + leafW / 2, h / 2, 0);
    scaleBoxUV(slab.geometry, leafW, h, 0.045);
    // raised panels
    const pm = o.front ? M.woodDark : M.woodPaint;
    for (const [py, ph] of [[0.25, 0.8], [1.2, 0.72]]) for (const sz of [-1, 1]) {
      mk(new THREE.BoxGeometry(leafW - 0.22, ph, 0.012), pm, 0.01 + leafW / 2, py + ph / 2, sz * 0.026);
    }
    for (const sz of [-1, 1]) {
      mk(new THREE.SphereGeometry(0.03, 12, 8), M.metal, leafW - 0.07, 0.98, sz * 0.06);
      mk(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 8).rotateX(Math.PI / 2), M.metal, leafW - 0.07, 0.98, sz * 0.035);
    }
    let led = null;
    if (o.front) {
      mk(new THREE.BoxGeometry(0.07, 0.16, 0.03), M.plastic, leafW - 0.08, 1.12, 0.04);
      led = mk(new THREE.BoxGeometry(0.012, 0.012, 0.012), new THREE.MeshBasicMaterial({ color: 0x100000 }), leafW - 0.08, 1.17, 0.056);
      mk(new THREE.BoxGeometry(0.07, 0.16, 0.03), M.plastic, leafW - 0.08, 1.12, -0.04);
    }
    mergeGroup(leaf, led);
    pivot.add(leaf);
    root.add(pivot);
    // choose swing direction toward the "into" room
    const into = roomById[o.into];
    const cx = (into.x0 + into.x1) / 2, cz = (into.z0 + into.z1) / 2;
    let sign = 1, best = Infinity;
    for (const s of [1, -1]) {
      const th = base + s * Math.PI / 2;
      const mx = hx + Math.cos(th) * w / 2, mz = hz - Math.sin(th) * w / 2;
      const d = (mx - cx) ** 2 + (mz - cz) ** 2;
      if (d < best) { best = d; sign = s; }
    }
    const door = {
      id: o.id, o, pivot, leaf, base, sign, w, open: 0, target: 0, speed: 1.6, locked: !!o.locked, front: !!o.front, led,
      center: new THREE.Vector3(o.line === 'z' ? (o.from + o.to) / 2 : o.at, 1.0, o.line === 'z' ? o.at : (o.from + o.to) / 2),
      col: addCol(0, 0, 0, 0, o.bottom, o.bottom + 2.1, true, 'door'),
      maxOpen: 0.95,
    };
    door.setOpen = (v) => { door.open = v; updateDoor(door); };
    leaf.traverse(m => { if (m.isMesh) m.userData.door = door; });
    updateDoor(door);
    interactables.push({ obj: leaf, kind: 'door', door });
    return door;
  }

  function updateDoor(d) {
    const th = d.base + d.sign * d.open * d.maxOpen * Math.PI / 2;
    d.pivot.rotation.y = th;
    const hx = d.pivot.position.x, hz = d.pivot.position.z;
    const ex = hx + Math.cos(th) * d.w, ez = hz - Math.sin(th) * d.w;
    const c = d.col;
    c.x0 = Math.min(hx, ex) - 0.04; c.x1 = Math.max(hx, ex) + 0.04;
    c.z0 = Math.min(hz, ez) - 0.04; c.z1 = Math.max(hz, ez) + 0.04;
    c.opaque = d.open < 0.35;
    c.passableForNav = true;
  }
  house.updateDoor = updateDoor;

  // ---------------------------------------------------------------- furniture helpers
  const solidBox = (k, w, h, d, cx, y, cz, ry = 0, opaque = h > 1.5, tag = 'furn') => {
    B.box(k, w, h, d, cx, y, cz, ry);
    const rw = Math.abs(Math.cos(ry)) * w + Math.abs(Math.sin(ry)) * d, rd = Math.abs(Math.sin(ry)) * w + Math.abs(Math.cos(ry)) * d;
    return addCol(cx - rw / 2, cz - rd / 2, cx + rw / 2, cz + rd / 2, y, y + h, opaque, tag);
  };
  const deco = (k, w, h, d, cx, y, cz, ry = 0) => B.box(k, w, h, d, cx, y, cz, ry);
  const spot = (x, y, z, room, kind = 'surface') => pickupSpots.push({ pos: new THREE.Vector3(x, y, z), room, kind });
  // upright cylinders sit on y; rotated ones (rails, pipes) are centred on y
  const cyl = (k, r0, r1, h, x, y, z, seg = 16, rx = 0, rz = 0, ry = 0) =>
    B.geo(k, new THREE.CylinderGeometry(r0, r1, h, seg), mat4(x, (rx || rz) ? y : y + h / 2, z, ry, rx, rz));
  const sphere = (k, r, x, y, z, sx = 1, sy = 1, sz = 1) => B.geo(k, new THREE.SphereGeometry(r, 16, 12), mat4(x, y, z, 0, 0, 0, sx, sy, sz));

  // table: top + 4 legs
  const table = (k, w, d, h, cx, cz, ry = 0, y0 = 0, top = 0.04) => {
    deco(k, w, top, d, cx, y0 + h - top, cz, ry);
    const c = Math.cos(ry), s = Math.sin(ry);
    for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const px = lx * (w / 2 - 0.05), pz = lz * (d / 2 - 0.05);
      deco(k, 0.045, h - top, 0.045, cx + px * c + pz * s, y0, cz - px * s + pz * c);
    }
    const rw = Math.abs(c) * w + Math.abs(s) * d, rd = Math.abs(s) * w + Math.abs(c) * d;
    addCol(cx - rw / 2, cz - rd / 2, cx + rw / 2, cz + rd / 2, y0, y0 + h, false, 'table');
  };
  const chair = (k, cx, cz, ry, y0 = 0) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    const L = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    deco(k, 0.44, 0.04, 0.42, cx, y0 + 0.44, cz, ry);
    for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [0.19, 0.18], [-0.19, 0.18]]) { const [px, pz] = L(lx, lz); deco(k, 0.035, 0.44, 0.035, px, y0, pz); }
    const [bx, bz] = L(0, -0.19);
    deco(k, 0.44, 0.5, 0.035, bx, y0 + 0.48, bz, ry);
    addCol(cx - 0.24, cz - 0.24, cx + 0.24, cz + 0.24, y0, y0 + 0.9, false, 'chair');
  };
  const books = (x0, x1, y, z, depthAxis = 'x', seed = 1) => {
    let a = x0, i = seed;
    const pal = ['book', 'woodDark', 'paper', 'toyRed', 'toyBlue', 'fabricSofa'];
    while (a < x1 - 0.03) {
      i = (i * 9301 + 49297) % 233280; const r = i / 233280;
      const w = 0.025 + r * 0.03, h = 0.18 + ((i >> 3) % 10) * 0.012;
      if (r > 0.93) { a += 0.08; continue; }
      if (depthAxis === 'x') deco(pal[i % pal.length], 0.16, h, w, z, y, a + w / 2);
      else deco(pal[i % pal.length], w, h, 0.16, a + w / 2, y, z);
      a += w + 0.004;
    }
  };
  const shelfUnit = (k, cx, cz, w, d, h, n, alongZ, seed, y0 = 0) => {
    const bw = alongZ ? d : w, bd = alongZ ? w : d;
    deco(k, bw, 0.03, bd, cx, y0 + h - 0.03, cz);
    // sides + shelves
    if (alongZ) { deco(k, d, h, 0.03, cx, y0, cz - w / 2 + 0.015); deco(k, d, h, 0.03, cx, y0, cz + w / 2 - 0.015); }
    else { deco(k, 0.03, h, d, cx - w / 2 + 0.015, y0, cz); deco(k, 0.03, h, d, cx + w / 2 - 0.015, y0, cz); }
    for (let i = 0; i < n; i++) {
      const y = y0 + 0.05 + i * (h - 0.1) / n;
      deco(k, bw, 0.025, bd, cx, y, cz);
      if (seed) {
        if (alongZ) books(cz - w / 2 + 0.05, cz + w / 2 - 0.05, y + 0.025, cx, 'x', seed + i);
        else books(cx - w / 2 + 0.05, cx + w / 2 - 0.05, y + 0.025, cz, 'z', seed + i);
      }
    }
    addCol(cx - bw / 2, cz - bd / 2, cx + bw / 2, cz + bd / 2, y0, y0 + h, h > 1.5, 'shelf');
  };

  // wardrobe with two hinged louvred doors (dynamic) → hide spot
  const wardrobe = (id, x0, z0, x1, z1, facing, h = 2.05, k = 'woodDark', label = 'wardrobe', y0 = 0) => {
    const w = x1 - x0, d = z1 - z0;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const th = 0.03;
    const fx = facing === '+x' ? 1 : facing === '-x' ? -1 : 0, fz = facing === '+z' ? 1 : facing === '-z' ? -1 : 0;
    // shell: back, sides, top, bottom (open at the front)
    if (fx) {
      deco(k, th, h, d, cx - fx * (w / 2 - th / 2), y0, cz);
      deco(k, w, h, th, cx, y0, z0 + th / 2); deco(k, w, h, th, cx, y0, z1 - th / 2);
    } else {
      deco(k, w, h, th, cx, y0, cz - fz * (d / 2 - th / 2));
      deco(k, th, h, d, x0 + th / 2, y0, cz); deco(k, th, h, d, x1 - th / 2, y0, cz);
    }
    deco(k, w, th, d, cx, y0 + h - th, cz); deco(k, w, 0.08, d, cx, y0, cz);
    deco(k, w + 0.04, 0.05, d + 0.04, cx, y0 + h, cz); // crown
    // hanging rail + an old coat
    if (fx) cyl('metal', 0.012, 0.012, d - 0.1, cx, y0 + 1.75, cz, 8, Math.PI / 2);
    else cyl('metal', 0.012, 0.012, w - 0.1, cx, y0 + 1.75, cz, 8, 0, Math.PI / 2);
    B.geo('fabricBlanket', new THREE.CylinderGeometry(0.12, 0.2, 0.95, 10, 1, true), mat4(cx - fx * 0.05 + (fz ? -w * 0.28 : 0), y0 + 1.22, cz - fz * 0.05 + (fx ? -d * 0.28 : 0)));
    const col = addCol(x0, z0, x1, z1, y0, y0 + h, true, 'wardrobe');
    // two louvred doors hinged at the ends of the front span, swinging outward
    const span = fx ? d : w;
    const leafW = span / 2 - 0.012, leafH = h - 0.12;
    const frontX = cx + fx * w / 2, frontZ = cz + fz * d / 2;
    const hinges = fx ? [[frontX, z0 + 0.006, 0, 1], [frontX, z1 - 0.006, 0, -1]] : [[x0 + 0.006, frontZ, 1, 0], [x1 - 0.006, frontZ, -1, 0]];
    const pivots = [], doorMeshes = [];
    for (const [hx, hz, dx, dz] of hinges) {
      const pivot = new THREE.Group();
      pivot.position.set(hx, y0 + 0.08, hz);
      const base = Math.atan2(-dz, dx); // local +X points along the span
      let sgn = 1;
      for (const s of [1, -1]) { const t = base + s * 1.2; if (Math.cos(t) * fx + (-Math.sin(t)) * fz > 0) sgn = s; }
      pivot.rotation.y = base;
      pivot.userData = { base, sgn };
      const leaf = new THREE.Group(); pivot.add(leaf);
      const mkL = (geo, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, M[k]); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = m.receiveShadow = true; leaf.add(m); return m; };
      // frame
      mkL(new THREE.BoxGeometry(leafW, 0.08, 0.025), leafW / 2, 0.04, 0);
      mkL(new THREE.BoxGeometry(leafW, 0.08, 0.025), leafW / 2, leafH - 0.04, 0);
      mkL(new THREE.BoxGeometry(leafW, 0.3, 0.025), leafW / 2, leafH * 0.5, 0);
      mkL(new THREE.BoxGeometry(0.06, leafH, 0.025), 0.03, leafH / 2, 0);
      mkL(new THREE.BoxGeometry(0.06, leafH, 0.025), leafW - 0.03, leafH / 2, 0);
      // louvres
      for (const [ya, yb] of [[0.08, leafH * 0.5 - 0.15], [leafH * 0.5 + 0.15, leafH - 0.08]]) {
        for (let y = ya + 0.03; y < yb - 0.01; y += 0.055) mkL(new THREE.BoxGeometry(leafW - 0.12, 0.05, 0.006), leafW / 2, y, 0, 0.9);
      }
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), M.metal); knob.position.set(leafW - 0.06, leafH * 0.5, 0.03); leaf.add(knob);
      const knob2 = knob.clone(); knob2.position.z = -0.03; leaf.add(knob2);
      mergeGroup(leaf);
      root.add(pivot);
      pivots.push(pivot); doorMeshes.push(leaf);
    }
    const outDist = (fx ? w : d) / 2 + 0.55;
    const hs = {
      id, type: 'wardrobe', label, room: roomAt(cx, cz)?.id,
      view: new THREE.Vector3(cx - fx * 0.02, y0 + 1.55, cz - fz * 0.02),
      yaw: Math.atan2(-fx, -fz), // camera yaw that looks out through the doors
      exit: new THREE.Vector3(cx + fx * outDist, y0, cz + fz * outDist),
      front: new THREE.Vector3(cx + fx * (outDist - 0.05), y0, cz + fz * (outDist - 0.05)),
      pivots, leaves: doorMeshes, open: 0, col,
      setOpen(v) { this.open = v; for (const p of pivots) p.rotation.y = p.userData.base + p.userData.sgn * v * 1.45; },
    };
    hideSpots.push(hs);
    for (const m of doorMeshes) interactables.push({ obj: m, kind: 'hide', spot: hs });
    return hs;
  };

  // ---------------------------------------------------------------- MASTER BEDROOM
  // bed: headboard on east wall
  solidBox('woodDark', 2.2, 0.32, 1.72, 5.85, 0, 2.5, 0, false, 'bed');
  deco('fabricBed', 2.05, 0.2, 1.62, 5.88, 0.32, 2.5);
  deco('fabricBlanket', 1.5, 0.08, 1.7, 5.45, 0.5, 2.5);
  deco('fabricBlanket', 1.5, 0.3, 0.04, 5.45, 0.25, 1.64); deco('fabricBlanket', 1.5, 0.3, 0.04, 5.45, 0.25, 3.36);
  deco('fabricBed', 0.42, 0.13, 0.62, 6.55, 0.52, 2.08, 0.05); deco('fabricBed', 0.42, 0.13, 0.62, 6.55, 0.52, 2.92, -0.04);
  deco('woodDark', 0.07, 1.25, 1.8, 6.95, 0, 2.5);
  for (const z of [1.25, 3.75]) { solidBox('woodFurn', 0.42, 0.55, 0.42, 6.7, 0, z, 0, false); deco('woodDark', 0.36, 0.02, 0.005, 6.49, 0.3, z); }
  spot(6.62, 0.56, 3.72, 'master');
  // lamp on south nightstand
  cyl('porcelain', 0.06, 0.08, 0.28, 6.7, 0.55, 3.8, 16); cyl('fabricBed', 0.1, 0.16, 0.2, 6.7, 0.83, 3.8, 16);
  // dresser
  solidBox('woodFurn', 1.3, 0.85, 0.5, 5.25, 0, 0.33, 0, false);
  for (let i = 0; i < 3; i++) { deco('woodDark', 1.2, 0.012, 0.004, 5.25, 0.25 + i * 0.25, 0.585); deco('metal', 0.1, 0.018, 0.02, 5.25, 0.14 + i * 0.25, 0.59); }
  spot(5.6, 0.86, 0.3, 'master');
  // rug
  deco('rug', 2.4, 0.012, 2.0, 3.3, 0.001, 2.6);
  // chair with coat heaped on it: a silhouette that reads as someone sitting
  chair('woodDark', 0.75, 0.75, Math.PI * 0.75);
  sphere('fabricBlanket', 0.28, 0.72, 0.72, 0.73, 1, 0.8, 1);
  sphere('fabricBlanket', 0.17, 0.62, 1.1, 0.64, 1, 1.2, 1);
  wardrobe('wd_master', 0.08, 3.65, 0.7, 4.85, '+x', 2.05, 'woodDark', 'wardrobe');

  // ---------------------------------------------------------------- BATHROOM
  // tub
  deco('porcelain', 1.7, 0.55, 0.06, 7.93, 0, 0.83); deco('porcelain', 1.7, 0.55, 0.06, 7.93, 0, 0.11);
  deco('porcelain', 0.06, 0.55, 0.78, 8.75, 0, 0.47); deco('porcelain', 0.06, 0.55, 0.78, 7.11, 0, 0.47);
  deco('porcelain', 1.6, 0.1, 0.7, 7.93, 0, 0.47);
  addCol(7.08, 0.08, 8.8, 0.88, 0, 0.55, false, 'tub');
  cyl('metal', 0.012, 0.012, 1.72, 7.93, 2.05, 0.9, 8, 0, Math.PI / 2);
  // shower curtain (dynamic so a shape can press against it)
  const curtain = makeCurtain(1.6, 1.45, 0xd6d8cf, 0.82);
  curtain.position.set(7.93, 1.3, 0.9);
  root.add(curtain);
  house.curtain = curtain;
  // toilet
  deco('porcelain', 0.38, 0.4, 0.55, 10.13, 0, 1.65); deco('porcelain', 0.18, 0.4, 0.45, 10.33, 0.4, 1.65);
  deco('whitePlastic', 0.4, 0.03, 0.5, 10.1, 0.4, 1.65);
  addCol(9.9, 1.35, 10.45, 1.95, 0, 0.8, false, 'toilet');
  // vanity + mirror
  solidBox('woodPaint', 0.5, 0.82, 0.8, 10.17, 0, 3.0, 0, false);
  deco('porcelain', 0.52, 0.05, 0.84, 10.16, 0.82, 3.0);
  cyl('metal', 0.012, 0.012, 0.18, 10.35, 0.87, 3.0, 8);
  spot(10.12, 0.88, 2.72, 'bath');
  deco('frame', 0.03, 0.78, 0.82, 10.405, 1.1, 3.0);
  const mirror = new Reflector(new THREE.PlaneGeometry(0.7, 0.66), {
    clipBias: 0.003, textureWidth: 512, textureHeight: 512, color: 0x8a8d88,
  });
  mirror.position.set(10.386, 1.49, 3.0); mirror.rotation.y = -Math.PI / 2;
  mirror.camera.layers.enable(PHANTOM);
  root.add(mirror);
  house.mirror = mirror;
  deco('metal', 0.03, 0.03, 0.6, 10.44, 1.2, 4.3); deco('fabricBed', 0.02, 0.6, 0.45, 10.42, 0.62, 4.3);

  // ---------------------------------------------------------------- KID'S ROOM
  // bed on legs (you can crawl under)
  const kb = { x0: 14.25, x1: 15.95, z0: 0.09, z1: 1.0 };
  deco('woodPaint', kb.x1 - kb.x0, 0.07, kb.z1 - kb.z0, (kb.x0 + kb.x1) / 2, 0.36, (kb.z0 + kb.z1) / 2);
  for (const [x, z] of [[kb.x0 + 0.04, kb.z0 + 0.04], [kb.x1 - 0.04, kb.z0 + 0.04], [kb.x1 - 0.04, kb.z1 - 0.04], [kb.x0 + 0.04, kb.z1 - 0.04]]) deco('woodPaint', 0.06, 0.36, 0.06, x, 0, z);
  deco('woodPaint', 0.05, 0.85, kb.z1 - kb.z0, kb.x1 - 0.02, 0, (kb.z0 + kb.z1) / 2);
  deco('woodPaint', 0.05, 0.6, kb.z1 - kb.z0, kb.x0 + 0.02, 0, (kb.z0 + kb.z1) / 2);
  deco('fabricBed', 1.6, 0.14, 0.86, (kb.x0 + kb.x1) / 2, 0.43, (kb.z0 + kb.z1) / 2);
  deco('fabricKid', 1.15, 0.05, 0.9, 14.85, 0.57, (kb.z0 + kb.z1) / 2);
  deco('fabricKid', 1.15, 0.35, 0.03, 14.85, 0.24, kb.z1 + 0.01);
  deco('fabricBed', 0.3, 0.1, 0.5, 15.7, 0.57, 0.55);
  const kidBedCol = addCol(kb.x0, kb.z0, kb.x1, kb.z1, 0, 0.6, false, 'bed');
  const underBed = {
    id: 'bed_kid', type: 'bed', label: 'bed', room: 'kid',
    view: new THREE.Vector3(15.05, 0.2, 0.52), yaw: 0, // facing +z (out from under the bed)
    exit: new THREE.Vector3(15.05, 0, 1.55), front: new THREE.Vector3(15.05, 0, 1.45), col: kidBedCol, pivots: [], open: 0, setOpen() {},
  };
  underBed.yaw = Math.atan2(-0, -1); // look out toward +z
  hideSpots.push(underBed);
  const bedHit = new THREE.Mesh(new THREE.BoxGeometry(kb.x1 - kb.x0, 0.45, kb.z1 - kb.z0), new THREE.MeshBasicMaterial({ visible: false }));
  bedHit.position.set((kb.x0 + kb.x1) / 2, 0.22, (kb.z0 + kb.z1) / 2);
  root.add(bedHit);
  interactables.push({ obj: bedHit, kind: 'hide', spot: underBed });
  // doll on the bed (head can turn)
  const doll = new THREE.Group();
  const dress = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 12), M.toyRed); dress.position.y = 0.1; doll.add(dress);
  const dollHead = new THREE.Group(); dollHead.position.y = 0.26; doll.add(dollHead);
  const dh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), M.dollSkin); dollHead.add(dh);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), M.black); e.position.set(sx * 0.027, 0.01, 0.066); dollHead.add(e); }
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), M.woodDark); hair.position.y = 0.01; hair.rotation.x = -0.3; dollHead.add(hair);
  doll.position.set(15.55, 0.57, 0.5); doll.rotation.y = -Math.PI / 2 - 0.4;
  doll.traverse(m => { if (m.isMesh) m.castShadow = true; });
  root.add(doll);
  house.doll = { root: doll, head: dollHead };
  // rocking horse (dynamic)
  const horse = new THREE.Group();
  const hb = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.18), M.woodPaint); hb.position.y = 0.46; horse.add(hb);
  const hn = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.13), M.woodPaint); hn.position.set(0.3, 0.63, 0); hn.rotation.z = -0.35; horse.add(hn);
  const hh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.12), M.woodPaint); hh.position.set(0.4, 0.78, 0); horse.add(hh);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), M.black); eye.position.set(0.44, 0.81, sx * 0.062); horse.add(eye);
    for (const lx of [-0.22, 0.22]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), M.woodPaint); l.position.set(lx, 0.25, sx * 0.08); l.rotation.z = lx > 0 ? -0.18 : 0.18; horse.add(l); }
    const rocker = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.018, 6, 24, 0.9), M.woodDark);
    rocker.rotation.z = -Math.PI / 2 - 0.45; rocker.position.set(0, 0.92, sx * 0.08); horse.add(rocker);
  }
  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.04), M.book); mane.position.set(0.28, 0.8, 0); mane.rotation.z = -0.4; horse.add(mane);
  horse.position.set(11.6, 0, 3.9); horse.rotation.y = 0.5;
  horse.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  root.add(horse);
  addCol(11.2, 3.6, 12.0, 4.2, 0, 0.9, false, 'horse');
  house.horse = horse;
  // toy box, desk, chair, shelf
  solidBox('toyBlue', 0.7, 0.42, 0.42, 12.0, 0, 4.6, 0, false); deco('toyRed', 0.72, 0.04, 0.44, 12.0, 0.42, 4.6);
  spot(12.0, 0.47, 4.55, 'kid');
  table('woodPaint', 0.55, 1.1, 0.68, 15.62, 3.3);
  chair('woodPaint', 15.1, 3.3, -Math.PI / 2);
  spot(15.65, 0.69, 3.0, 'kid');
  // music box on the desk
  deco('woodFurn', 0.14, 0.08, 0.1, 15.62, 0.68, 3.65);
  house.musicBoxPos = new THREE.Vector3(15.62, 0.75, 3.65);
  deco('woodPaint', 0.25, 0.03, 1.2, 10.72, 1.45, 3.2); // wall shelf
  for (let i = 0; i < 5; i++) { sphere(i % 2 ? 'toyRed' : 'toyBlue', 0.06, 10.72, 1.54, 2.75 + i * 0.22); }
  wardrobe('wd_kid', 10.58, 1.05, 11.18, 2.3, '+x', 1.9, 'woodPaint', 'wardrobe');
  // crayon drawings on the wall (flat quads)
  house.drawings = [];

  // ---------------------------------------------------------------- STUDY
  table('woodDark', 0.62, 1.5, 0.76, 19.6, 1.8);
  deco('plastic', 0.4, 0.34, 0.38, 19.62, 0.76, 1.55); // CRT
  deco('black', 0.005, 0.26, 0.3, 19.41, 0.8, 1.55);
  deco('paper', 0.3, 0.01, 0.22, 19.55, 0.76, 2.2, 0.3); deco('paper', 0.3, 0.01, 0.22, 19.5, 0.77, 2.3, -0.2);
  spot(19.55, 0.78, 2.45, 'study');
  shelfUnit('woodDark', 16.3, 2.1, 2.6, 0.36, 2.0, 5, true, 17);
  spot(16.3, 0.87, 1.4, 'study');
  chair('darkMetal', 18.95, 1.8, -Math.PI / 2);
  solidBox('paper', 0.5, 0.4, 0.4, 19.5, 0, 4.4, 0.1, false); deco('paper', 0.45, 0.35, 0.35, 19.52, 0.4, 4.42, -0.2);
  deco('rug', 1.6, 0.012, 2.0, 18.1, 0.001, 2.2);

  // ---------------------------------------------------------------- HALLWAY
  deco('rug', 17.6, 0.01, 0.8, 10.2, 0.001, 6.0);
  // grandfather clock at the west end
  solidBox('woodDark', 0.46, 2.1, 0.5, 0.33, 0, 6.0, 0, true);
  deco('woodDark', 0.5, 0.12, 0.56, 0.35, 2.1, 6.0);
  cyl('paper', 0.17, 0.17, 0.02, 0.575, 1.72, 6.0, 24, 0, Math.PI / 2);
  deco('black', 0.005, 0.2, 0.012, 0.59, 1.72, 6.0, 0.4); deco('black', 0.005, 0.14, 0.012, 0.59, 1.72, 6.0, 2.1);
  deco('glass', 0.005, 1.0, 0.3, 0.585, 0.5, 6.0);
  house.clockPos = new THREE.Vector3(0.4, 1.5, 6.0);
  const pendulum = new THREE.Group();
  const pRod = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.7, 0.01), M.metal); pRod.position.y = -0.35; pendulum.add(pRod);
  const pBob = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 16).rotateZ(Math.PI / 2), M.metal); pBob.position.y = -0.72; pendulum.add(pBob);
  pendulum.position.set(0.5, 1.45, 6.0);
  root.add(pendulum);
  house.pendulum = pendulum;
  // side table + vase
  table('woodFurn', 0.8, 0.35, 0.78, 5.6, 6.76);
  cyl('porcelain', 0.05, 0.08, 0.3, 5.75, 0.78, 6.76, 14);
  spot(5.35, 0.79, 6.76, 'hall');
  // picture frames
  const frames = [[1.6, 5, 1], [6.2, 5, 1], [11.0, 5, 1], [15.2, 5, 1], [7.4, 7, -1], [13.0, 7, -1], [18.7, 7, -1], [4.3, 7, -1]];
  house.frames = [];
  for (const [x, zWall, n] of frames) {
    const z = zWall + n * (T / 2 + 0.015);
    deco('frame', 0.5, 0.64, 0.03, x, 1.3, z);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.54), M.canvas.clone());
    pic.position.set(x, 1.62, z + n * 0.017); if (n < 0) pic.rotation.y = Math.PI;
    root.add(pic);
    house.frames.push(pic);
  }

  // ---------------------------------------------------------------- KITCHEN
  // counters along west wall (sink under the window) and along south wall
  solidBox('woodPaint', 0.6, 0.86, 5.9, 0.38, 0, 10.75, 0, false);
  deco('tilesFloor', 0.64, 0.04, 5.94, 0.4, 0.86, 10.75);
  deco('metal', 0.45, 0.02, 0.6, 0.42, 0.885, 9.9);
  cyl('metal', 0.015, 0.015, 0.3, 0.2, 0.9, 9.9, 8);
  for (let z = 8.0; z < 13.6; z += 0.6) deco('woodDark', 0.004, 0.7, 0.004, 0.685, 0.08, z);
  solidBox('woodPaint', 3.4, 0.86, 0.6, 2.4, 0, 13.62, 0, false);
  deco('tilesFloor', 3.4, 0.04, 0.64, 2.4, 0.86, 13.6);
  // stove
  deco('whitePlastic', 0.6, 0.02, 0.58, 1.2, 0.9, 13.62);
  for (const [x, z] of [[1.05, 13.5], [1.35, 13.5], [1.05, 13.75], [1.35, 13.75]]) cyl('darkMetal', 0.08, 0.08, 0.012, x, 0.92, z, 16);
  // upper cabinets (avoid window)
  for (const [z0, z1] of [[7.5, 8.9], [10.9, 13.9]]) deco('woodPaint', 0.35, 0.7, z1 - z0, 0.26, 1.55, (z0 + z1) / 2);
  // fridge
  solidBox('whitePlastic', 0.75, 1.8, 0.7, 4.55, 0, 13.55, 0, true);
  deco('metal', 0.03, 0.5, 0.02, 4.25, 0.9, 13.19);
  // table + chairs
  table('woodFurn', 1.3, 0.85, 0.76, 3.2, 10.6);
  chair('woodFurn', 2.35, 10.6, -Math.PI / 2); chair('woodFurn', 4.05, 10.6, Math.PI / 2);
  chair('woodFurn', 3.2, 9.8, Math.PI); chair('woodFurn', 3.2, 11.45, 0);
  spot(0.42, 0.92, 12.4, 'kitchen'); spot(3.0, 0.77, 10.45, 'kitchen'); spot(3.2, 0.92, 13.55, 'kitchen');
  // pantry = hide spot
  wardrobe('wd_pantry', 4.85, 7.08, 5.92, 7.72, '+z', 2.1, 'woodPaint', 'pantry');
  // wall phone
  const phone = new THREE.Group();
  const pb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.06), M.whitePlastic); phone.add(pb);
  const handset = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05), M.whitePlastic); handset.position.set(-0.05, 0, 0.05); phone.add(handset);
  phone.position.set(3.95, 1.45, 7.12);
  root.add(phone);
  house.phone = { root: phone, handset, pos: phone.position.clone() };
  interactables.push({ obj: pb, kind: 'phone' }, { obj: handset, kind: 'phone' });

  // ---------------------------------------------------------------- LIVING ROOM
  // upright piano on the north wall
  solidBox('woodDark', 1.45, 1.25, 0.58, 7.25, 0, 7.4, 0, false);
  deco('woodDark', 1.45, 0.05, 0.25, 7.25, 0.72, 7.8);
  deco('porcelain', 1.3, 0.02, 0.16, 7.25, 0.74, 7.76);
  for (let i = 0; i < 26; i++) deco('black', 0.012, 0.012, 0.09, 6.64 + i * 0.048, 0.76, 7.73);
  spot(7.5, 1.26, 7.4, 'living');
  house.pianoPos = new THREE.Vector3(7.25, 0.9, 7.6);
  // sofa facing east (toward TV)
  solidBox('fabricSofa', 0.9, 0.42, 2.0, 8.95, 0, 12.0, 0, false);
  deco('fabricSofa', 0.22, 0.85, 2.0, 8.61, 0, 12.0); deco('fabricSofa', 0.9, 0.6, 0.2, 8.95, 0, 11.0); deco('fabricSofa', 0.9, 0.6, 0.2, 8.95, 0, 13.0);
  deco('fabricSofa', 0.66, 0.14, 0.95, 9.05, 0.42, 11.52); deco('fabricSofa', 0.66, 0.14, 0.95, 9.05, 0.42, 12.49);
  table('woodFurn', 0.95, 0.6, 0.42, 11.0, 12.0);
  spot(10.9, 0.43, 11.85, 'living');
  // TV stand + TV (screen = live feed)
  solidBox('woodDark', 0.45, 0.5, 1.6, 13.7, 0, 12.0, 0, false);
  deco('plastic', 0.06, 0.66, 1.12, 13.78, 0.52, 12.0);
  const feedRT = new THREE.WebGLRenderTarget(320, 240, { type: THREE.HalfFloatType });
  const screenMat = new THREE.ShaderMaterial({
    uniforms: { tFeed: { value: feedRT.texture }, uOn: { value: 0 }, uTime: { value: 0 }, uFeed: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec2 vUv; uniform sampler2D tFeed; uniform float uOn, uTime, uFeed;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        vec2 uv = vUv; float line = floor(uv.y*240.);
        uv.x += (h(vec2(line, floor(uTime*24.)))-.5)*0.012*uFeed;
        vec3 feed = texture2D(tFeed, uv).rgb;
        float lum = dot(feed, vec3(.3,.59,.11));
        feed = vec3(pow(lum*2.2, 0.75))*vec3(.82,.96,.9); // night-vision camera
        float n = h(vUv*vec2(320.,240.) + floor(uTime*30.)*vec2(1.7,9.1));
        vec3 stat = vec3(n);
        vec3 col = mix(stat*0.9, feed*0.92 + (n-.5)*0.14, uFeed);
        col *= 0.85 + 0.15*sin(vUv.y*480.+uTime*8.);
        float vig = smoothstep(0.75, 0.25, length(vUv-.5));
        gl_FragColor = vec4(col*uOn*vig*1.6, 1.);
      }`,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.58), screenMat);
  screen.position.set(13.745, 0.85, 12.0); screen.rotation.y = -Math.PI / 2;
  root.add(screen);
  const tvLight = new THREE.PointLight(0x9fb4c8, 0, 6, 1.6); tvLight.position.set(13.2, 0.9, 12.0); root.add(tvLight);
  house.tv = { screen, mat: screenMat, rt: feedRT, light: tvLight, pos: new THREE.Vector3(13.6, 0.85, 12.0), on: false };
  interactables.push({ obj: screen, kind: 'tv' });
  // armchair by the window, turned slightly toward the room
  solidBox('fabricSofa', 0.8, 0.42, 0.8, 7.0, 0, 13.2, 0.6, false);
  deco('fabricSofa', 0.8, 0.9, 0.18, 6.93, 0, 13.52, 0.6);
  shelfUnit('woodDark', 6.3, 8.9, 1.2, 0.34, 2.0, 5, true, 31);
  spot(6.3, 1.25, 8.6, 'living');
  // floor lamp
  cyl('darkMetal', 0.15, 0.15, 0.02, 8.25, 0, 13.55, 16); cyl('darkMetal', 0.012, 0.012, 1.5, 8.25, 0.02, 13.55, 8);
  cyl('fabricBed', 0.14, 0.22, 0.28, 8.25, 1.45, 13.55, 16);
  deco('rug', 3.2, 0.012, 2.4, 11.0, 0.001, 12.0);
  // curtains on the big window
  house.curtains = [];
  for (const [x, w] of [[8.35, 0.9], [11.65, 0.9]]) {
    const c = makeCurtain(w, 2.3, 0x4a2a2a, 1.0);
    c.position.set(x, 1.2, 13.84); root.add(c); house.curtains.push(c);
  }
  cyl('woodDark', 0.02, 0.02, 4.8, 10.0, 2.36, 13.84, 8, 0, Math.PI / 2);

  // ---------------------------------------------------------------- FOYER
  // coat rack with coats (a figure you will look at twice)
  cyl('woodDark', 0.2, 0.22, 0.03, 19.45, 0, 7.55, 16); cyl('woodDark', 0.025, 0.025, 1.8, 19.45, 0.03, 7.55, 8);
  sphere('fabricBlanket', 0.2, 19.45, 1.45, 7.55, 1, 1.7, 0.9);
  sphere('woodDark', 0.13, 19.45, 1.78, 7.55, 1.1, 0.8, 1.1);
  B.geo('fabricSofa', new THREE.CylinderGeometry(0.16, 0.26, 1.0, 12, 1, true), mat4(19.43, 1.0, 7.6));
  addCol(19.2, 7.3, 19.7, 7.8, 0, 1.9, false, 'rack');
  solidBox('woodDark', 1.4, 0.9, 0.42, 18.5, 0, 10.7, 0, false);
  spot(18.2, 0.91, 10.7, 'foyer');
  deco('rug', 1.2, 0.012, 1.6, 19.2, 0.001, 9.0);

  // ---------------------------------------------------------------- LAUNDRY
  solidBox('whitePlastic', 0.65, 0.85, 0.62, 14.5, 0, 13.6, 0, false);
  solidBox('whitePlastic', 0.65, 0.85, 0.62, 15.2, 0, 13.6, 0, false);
  for (const x of [14.5, 15.2]) cyl('darkMetal', 0.2, 0.2, 0.01, x, 0.45, 13.29, 20, Math.PI / 2);
  shelfUnit('woodFurn', 14.28, 12.1, 1.5, 0.36, 1.8, 4, true, 0);
  for (let i = 0; i < 6; i++) deco(i % 2 ? 'toyBlue' : 'whitePlastic', 0.12, 0.25, 0.1, 14.28, 0.52, 11.55 + i * 0.2);
  spot(14.3, 0.95, 12.3, 'laundry');
  cyl('fabricBed', 0.22, 0.2, 0.4, 16.9, 0, 13.5, 12);

  // ---------------------------------------------------------------- STAIRS
  const nSteps = 16;
  const run = (STAIR_X1 - STAIR_X0) / nSteps, rise = -BASE_FLOOR / nSteps;
  for (let i = 0; i < nSteps; i++) {
    const x = STAIR_X0 + (i + 0.5) * run;
    const top = -(i + 0.5) * rise; // tread top; the walkable ramp passes through each tread's middle
    deco('woodDark', run + 0.02, 0.04, 1.24, x, top - 0.04, 12.5);
    const fillH = top - 0.04 - BASE_FLOOR;
    if (fillH > 0.01) deco('concreteWall', run, fillH, 1.24, x, BASE_FLOOR, 12.5);
  }
  B.hquad('floorDark', 20, 11.8, STAIR_X0, 13.2, 0, true);
  B.hquad('concreteFloor', STAIR_X1, 11.8, 24.6, 13.2, BASE_FLOOR, true);
  // handrail
  const railLen = Math.hypot(STAIR_X1 - STAIR_X0, -BASE_FLOOR);
  B.geo('woodDark', new THREE.CylinderGeometry(0.025, 0.025, railLen, 8),
    mat4((STAIR_X0 + STAIR_X1) / 2, 0.9 + BASE_FLOOR / 2, 11.93, 0, 0, Math.atan2(STAIR_X1 - STAIR_X0, -BASE_FLOOR)));

  // ---------------------------------------------------------------- BASEMENT
  const BF = BASE_FLOOR;
  // breaker box on the east wall
  const breaker = new THREE.Group();
  const bbox = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.8, 0.6), M.darkMetal); breaker.add(bbox);
  const slots = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 14).rotateZ(Math.PI / 2), M.black);
    s.position.set(-0.075, 0.2 - (i >> 1) * 0.16, (i % 2 ? 0.1 : -0.1)); breaker.add(s); slots.push(s);
  }
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.05), M.toyRed); lever.position.set(-0.09, -0.22, 0); lever.rotation.z = -0.5; breaker.add(lever);
  breaker.position.set(32.45, BF + 1.45, 12.5);
  breaker.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  root.add(breaker);
  house.breaker = { root: breaker, slots, lever, pos: breaker.position.clone(), filled: 0 };
  interactables.push({ obj: bbox, kind: 'breaker' });
  // water heater + pipes
  cyl('metal', 0.36, 0.36, 1.75, 31.9, BF, 9.3, 20);
  cyl('rust', 0.03, 0.03, 7.6, 28.6, -1.1, 9.0, 8, 0, Math.PI / 2);
  cyl('rust', 0.045, 0.045, 7.6, 28.6, -1.2, 9.25, 8, 0, Math.PI / 2);
  cyl('metal', 0.03, 0.03, 0.7, 31.9, BF + 1.75, 9.3, 8);
  addCol(31.5, 8.9, 32.3, 9.7, BF, BF + 1.8, true, 'heater');
  // shelves with jars
  shelfUnit('woodFurn', 26.2, 8.8, 2.4, 0.4, 1.9, 4, false, 0, BF);
  for (let i = 0; i < 14; i++) cyl(i % 3 ? 'glass' : 'toyRed', 0.05, 0.05, 0.16, 25.2 + (i % 7) * 0.3, BF + 0.08 + (i > 6 ? 0.45 : 0), 8.8, 10);
  // workbench
  table('woodDark', 1.8, 0.7, 0.9, 29.9, 8.95, 0, BF);
  deco('darkMetal', 0.3, 0.12, 0.2, 29.3, BF + 0.9, 8.9);
  spot(30.3, BF + 0.91, 8.9, 'basement', 'battery');
  // furniture under dust sheets
  B.geo('sheet', drapedBox(1.9, 0.85, 0.9, 7), mat4(25.75, BF, 15.55, 0.08));   // sofa
  addCol(24.8, 15.1, 26.7, 16.0, BF, BF + 0.9, false, 'sheet');
  B.geo('sheet', drapedBox(1.0, 0.75, 1.0, 13), mat4(31.05, BF, 15.75, -0.3)); // armchair
  addCol(30.5, 15.2, 31.6, 16.3, BF, BF + 0.8, false, 'sheet');
  B.geo('sheet', drapedBox(0.7, 1.3, 0.5, 21), mat4(29.3, BF, 16.05, 0.1));     // cabinet
  addCol(28.95, 15.8, 29.65, 16.4, BF, BF + 1.3, false, 'sheet');
  // the one that looks like someone standing under a sheet. It moves while you're away.
  const shroud = new THREE.Mesh(sheetFigure(), M.sheet);
  shroud.castShadow = shroud.receiveShadow = true;
  shroud.position.set(27.9, BF, 15.75); shroud.rotation.y = Math.PI + 0.3;
  root.add(shroud);
  const shroudCol = addCol(27.6, 15.45, 28.2, 16.05, BF, BF + 1.9, true, 'shroud');
  house.shroud = { mesh: shroud, col: shroudCol, spots: [[27.9, 15.75], [31.6, 11.2], [26.4, 10.4], [25.6, 13.9], [29.8, 13.6]], i: 0 };
  // a chair in the middle facing the corner
  chair('woodFurn', 29.4, 12.0, Math.PI * 0.8, BF);
  // hanging bulb
  cyl('darkMetal', 0.004, 0.004, 0.3, 28.6, -1.2, 12.5, 4);
  // locker = hide spot
  wardrobe('wd_locker', 31.92, 13.4, 32.52, 14.4, '-x', 1.95, 'darkMetal', 'locker', BF);

  // ---------------------------------------------------------------- lamps (glow when the power returns)
  const lampSpots = [
    { id: 'master', p: [3.5, 2.6, 2.5] }, { id: 'hallW', p: [4.5, 2.62, 6.0] }, { id: 'hallE', p: [14.5, 2.62, 6.0] },
    { id: 'kitchen', p: [3.0, 2.62, 10.5] }, { id: 'living', p: [10.5, 2.62, 10.5] }, { id: 'foyer', p: [17.0, 2.62, 9.0] },
    { id: 'kid', p: [13.2, 2.62, 2.5] }, { id: 'basement', p: [28.6, -1.32, 12.5] },
  ];
  for (const l of lampSpots) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(l.id === 'basement' ? 0.05 : 0.14, 16, 10, 0, Math.PI * 2, 0, l.id === 'basement' ? Math.PI : Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xd8d2c0, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4 }));
    m.position.set(...l.p); if (l.id !== 'basement') { m.rotation.x = Math.PI; m.position.y = 2.7; }
    root.add(m);
    lamps.push({ id: l.id, mesh: m, pos: new THREE.Vector3(...l.p) });
  }

  // ---------------------------------------------------------------- bulkhead over the upper stairwell (seen from outside)
  const yAt = (x) => 2.7 - 3.6 * (x - 20) / 4.6;
  const xb = 20 + 2.7 * 4.6 / 3.6;
  B.quad('concreteWall', [20, 0, 11.72], [xb, 0, 11.72], [xb, 0.02, 11.72], [20, yAt(20) + 0.1, 11.72], [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  B.quad('concreteWall', [20, 0, 13.28], [xb, 0, 13.28], [xb, 0.02, 13.28], [20, yAt(20) + 0.1, 13.28], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  B.quad('woodDark', [20, yAt(20) + 0.1, 11.72], [xb, 0.02, 11.72], [xb, 0.02, 13.28], [20, yAt(20) + 0.1, 13.28],
    new THREE.Vector3(3.6, 4.6, 0).normalize().toArray(), [[0, 0], [4, 0], [4, 1.5], [0, 1.5]]);

  // ---------------------------------------------------------------- exterior
  const shape = new THREE.Shape();
  shape.moveTo(-80, 80); shape.lineTo(80, 80); shape.lineTo(80, -80); shape.lineTo(-80, -80); shape.lineTo(-80, 80);
  const hole = new THREE.Path();
  // shape coords (x, -z)
  const outline = [[0, 0], [20, 0], [20, 11.8], [xb, 11.8], [xb, 13.2], [20, 13.2], [20, 14], [0, 14]];
  hole.moveTo(outline[0][0], -outline[0][1]);
  for (let i = 1; i < outline.length; i++) hole.lineTo(outline[i][0], -outline[i][1]);
  hole.lineTo(outline[0][0], -outline[0][1]);
  shape.holes.push(hole);
  const groundGeo = new THREE.ShapeGeometry(shape);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, M.ground);
  ground.position.y = -0.02; ground.receiveShadow = true;
  root.add(ground);
  // sky dome
  const skyGeo = new THREE.SphereGeometry(90, 32, 16);
  const sky = new THREE.Mesh(skyGeo, M.sky); sky.position.set(10, 0, 7); root.add(sky);
  house.sky = sky;
  // trees (silhouette cards)
  const rnd = mulberry(42);
  const trees = [];
  for (let i = 0; i < 46; i++) {
    let x, z;
    do { x = -30 + rnd() * 80; z = -26 + rnd() * 66; } while (x > -6 && x < 36 && z > -6 && z < 21);
    const h = 9 + rnd() * 9;
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.55, h), i % 2 ? M.tree : M.tree2);
      m.position.set(x, h / 2 - 0.1, z); m.rotation.y = rnd() * Math.PI + k * Math.PI / 2;
      root.add(m); trees.push(m);
    }
  }
  mergeLoose(root, trees);
  // fence
  for (let x = -12; x <= 34; x += 2.4) { B.box('fence', 0.12, 1.3, 0.12, x, 0, -9); B.box('fence', 0.12, 1.3, 0.12, x, 0, 24); }
  for (let z = -9; z <= 24; z += 2.4) { B.box('fence', 0.12, 1.3, 0.12, -12, 0, z); B.box('fence', 0.12, 1.3, 0.12, 36, 0, z); }
  B.box('fence', 46, 0.08, 0.05, 12, 1.0, -9); B.box('fence', 46, 0.08, 0.05, 12, 1.0, 24);
  B.box('fence', 0.05, 0.08, 33, -12, 1.0, 7.5); B.box('fence', 0.05, 0.08, 33, 36, 1.0, 7.5);
  // a swing set in the back yard, visible from the kid's room window
  for (const x of [11.2, 13.6]) for (const s of [-1, 1]) B.geo('rust', new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), mat4(x, 1.2, -6 + s * 0.5, 0, s * 0.22, 0));
  B.geo('rust', new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), mat4(12.4, 2.45, -6, 0, 0, Math.PI / 2));
  const swing = new THREE.Group();
  for (const dx of [-0.2, 0.2]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.8, 4), M.darkMetal); r.position.set(dx, -0.9, 0); swing.add(r); }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.2), M.woodDark); seat.position.y = -1.8; swing.add(seat);
  swing.position.set(12.4, 2.45, -6); root.add(swing);
  house.swing = swing;

  B.build(M, root);

  // ---------------------------------------------------------------- queries
  function roomAt(x, z) {
    for (const r of ROOMS) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r;
    return null;
  }
  house.roomAt = roomAt;
  house.roomById = roomById;
  house.floorAt = (x, z) => {
    if (z > 11.8 && z < 13.2 && x > 20) {
      if (x <= STAIR_X0) return 0;
      if (x >= STAIR_X1) return BASE_FLOOR;
      return BASE_FLOOR * (x - STAIR_X0) / (STAIR_X1 - STAIR_X0);
    }
    if (x > 24.6) return BASE_FLOOR;
    return 0;
  };
  house.inBasement = (x) => x > 20.1;

  // 2D segment vs AABB (slab test). returns true if blocked.
  const segHitsBox = (ax, az, bx, bz, c) => {
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dz = bz - az;
    for (const [p, d, lo, hi] of [[ax, dx, c.x0, c.x1], [az, dz, c.z0, c.z1]]) {
      if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; }
      else {
        let ta = (lo - p) / d, tb = (hi - p) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) return false;
      }
    }
    return true;
  };
  // Line of sight at eye level (y), through opaque colliders only.
  house.losBlocked = (ax, az, bx, bz, y = 1.5, ignore = null) => {
    for (const c of colliders) {
      if (!c.opaque || c === ignore) continue;
      if (y < c.y0 || y > c.y1) continue;
      if (segHitsBox(ax, az, bx, bz, c)) return true;
    }
    return false;
  };
  // Sound occlusion: count walls between two points (doors count as half)
  house.wallsBetween = (ax, az, bx, bz) => {
    let n = 0;
    for (const c of colliders) {
      if (c.tag !== 'wall' && c.tag !== 'door') continue;
      if (c.tag === 'door' && !c.opaque) continue;
      if (segHitsBox(ax, az, bx, bz, c)) n += c.tag === 'door' ? 0.6 : 1;
    }
    return n;
  };
  house.segHitsBox = segHitsBox;

  // circle push-out against solid colliders at a given height band
  house.collide = (pos, r, y0, y1, ignoreDoors = false) => {
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const c of colliders) {
        if (!c.solid) continue;
        if (ignoreDoors && c.tag === 'door') continue;
        if (y1 < c.y0 || y0 > c.y1) continue;
        const nx = Math.max(c.x0, Math.min(pos.x, c.x1)), nz = Math.max(c.z0, Math.min(pos.z, c.z1));
        const dx = pos.x - nx, dz = pos.z - nz, d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-10) { const d = Math.sqrt(d2), k = (r - d) / d; pos.x += dx * k; pos.z += dz * k; }
          else {
            // centre inside the box: push out along the smallest axis
            const pl = [pos.x - c.x0 + r, c.x1 - pos.x + r, pos.z - c.z0 + r, c.z1 - pos.z + r];
            const i = pl.indexOf(Math.min(...pl));
            if (i === 0) pos.x = c.x0 - r; else if (i === 1) pos.x = c.x1 + r; else if (i === 2) pos.z = c.z0 - r; else pos.z = c.z1 + r;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
  };

  // ---------------------------------------------------------------- nav grid + A*
  const NAV = { x0: -0.5, z0: -0.5, cell: 0.25, w: 136, h: 70 };
  NAV.blocked = new Uint8Array(NAV.w * NAV.h);
  NAV.cost = new Float32Array(NAV.w * NAV.h);
  const margin = 0.26;
  for (let j = 0; j < NAV.h; j++) for (let i = 0; i < NAV.w; i++) {
    const x = NAV.x0 + (i + 0.5) * NAV.cell, z = NAV.z0 + (j + 0.5) * NAV.cell;
    const idx = j * NAV.w + i;
    const room = roomAt(x, z);
    if (!room) { NAV.blocked[idx] = 1; continue; }
    const fy = house.floorAt(x, z);
    let b = 0, near = 0;
    for (const c of colliders) {
      if (!c.solid || c.tag === 'door') continue;
      if (c.y1 < fy + 0.2 || c.y0 > fy + 1.8) continue;
      const dx = Math.max(c.x0 - x, 0, x - c.x1), dz = Math.max(c.z0 - z, 0, z - c.z1);
      const d = Math.hypot(dx, dz);
      if (d < margin) { b = 1; break; }
      if (d < 0.6) near = 1;
    }
    NAV.blocked[idx] = b;
    NAV.cost[idx] = near ? 1.6 : 1;
  }
  house.nav = NAV;
  const cellOf = (x, z) => [Math.floor((x - NAV.x0) / NAV.cell), Math.floor((z - NAV.z0) / NAV.cell)];
  const center = (i, j) => [NAV.x0 + (i + 0.5) * NAV.cell, NAV.z0 + (j + 0.5) * NAV.cell];
  const walkable = (i, j) => i >= 0 && j >= 0 && i < NAV.w && j < NAV.h && !NAV.blocked[j * NAV.w + i];
  const nearestWalkable = (i, j) => {
    if (walkable(i, j)) return [i, j];
    for (let r = 1; r < 10; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (walkable(i + di, j + dj)) return [i + di, j + dj];
    }
    return null;
  };
  house.walkableAt = (x, z) => { const [i, j] = cellOf(x, z); return walkable(i, j); };
  house.nearestWalkablePoint = (x, z) => {
    const [i, j] = cellOf(x, z); const n = nearestWalkable(i, j); if (!n) return null;
    const [cx, cz] = center(n[0], n[1]); return new THREE.Vector3(cx, house.floorAt(cx, cz), cz);
  };
  // grid line walkability (for path smoothing)
  const lineWalkable = (ax, az, bx, bz) => {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (NAV.cell * 0.5));
    for (let k = 0; k <= n; k++) {
      const t = k / Math.max(1, n);
      const [i, j] = cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
      if (!walkable(i, j)) return false;
    }
    return true;
  };
  house.lineWalkable = lineWalkable;
  const gScore = new Float32Array(NAV.w * NAV.h), came = new Int32Array(NAV.w * NAV.h), stamp = new Uint32Array(NAV.w * NAV.h), closed = new Uint32Array(NAV.w * NAV.h);
  let stampN = 1;
  house.findPath = (sx, sz, tx, tz) => {
    const s0 = nearestWalkable(...cellOf(sx, sz)), t0 = nearestWalkable(...cellOf(tx, tz));
    if (!s0 || !t0) return null;
    stampN++;
    const W = NAV.w;
    const sIdx = s0[1] * W + s0[0], tIdx = t0[1] * W + t0[0];
    const heap = [];
    const push = (idx, f) => { heap.push([f, idx]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const hfn = (idx) => { const i = idx % W, j = (idx / W) | 0; const dx = Math.abs(i - t0[0]), dz = Math.abs(j - t0[1]); return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)); };
    stamp[sIdx] = stampN; gScore[sIdx] = 0; came[sIdx] = -1;
    push(sIdx, hfn(sIdx));
    let found = false, iter = 0;
    while (heap.length && iter++ < 20000) {
      const [, cur] = pop();
      if (closed[cur] === stampN) continue;
      closed[cur] = stampN;
      if (cur === tIdx) { found = true; break; }
      const ci = cur % W, cj = (cur / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!walkable(ni, nj)) continue;
        if (di && dj && (!walkable(ci + di, cj) || !walkable(ci, cj + dj))) continue;
        const nIdx = nj * W + ni;
        if (closed[nIdx] === stampN) continue;
        const g = gScore[cur] + (di && dj ? 1.414 : 1) * NAV.cost[nIdx];
        if (stamp[nIdx] !== stampN || g < gScore[nIdx]) {
          stamp[nIdx] = stampN; gScore[nIdx] = g; came[nIdx] = cur;
          push(nIdx, g + hfn(nIdx));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = tIdx; c !== -1; c = came[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map(c => { const [x, z] = center(c % W, (c / W) | 0); return new THREE.Vector3(x, 0, z); });
    // string pulling
    const out = [pts[0]];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !lineWalkable(pts[a].x, pts[a].z, pts[b].x, pts[b].z)) b--;
      out.push(pts[b]); a = b;
    }
    for (const p of out) p.y = house.floorAt(p.x, p.z);
    return out;
  };

  // random walkable point inside a room
  house.randomPointIn = (roomId, rnd = Math.random) => {
    const r = roomById[roomId];
    for (let k = 0; k < 40; k++) {
      const x = r.x0 + 0.5 + rnd() * (r.x1 - r.x0 - 1), z = r.z0 + 0.5 + rnd() * (r.z1 - r.z0 - 1);
      if (house.walkableAt(x, z)) return new THREE.Vector3(x, house.floorAt(x, z), z);
    }
    return new THREE.Vector3((r.x0 + r.x1) / 2, house.floorAt((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2), (r.z0 + r.z1) / 2);
  };

  return house;
}

// ---------------------------------------------------------------- helpers
// A dust sheet thrown over a box: rounded top, skirt that flares and pools, vertical folds.
function drapedBox(w, h, d, seed) {
  const g = new THREE.BoxGeometry(w, h, d, 18, 10, 12);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position, rnd = mulberry(seed);
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ty = y / h;
    // round the top edges
    const ex = Math.abs(x) / (w / 2), ez = Math.abs(z) / (d / 2);
    const edge = Math.max(ex, ez);
    if (ty > 0.75) y -= Math.pow(Math.max(0, edge - 0.55) / 0.45, 2) * h * 0.18;
    // skirt flares near the floor
    const flare = 1 + Math.pow(1 - ty, 3) * 0.12;
    x *= flare; z *= flare;
    // folds hang vertically, stronger toward the floor
    const ang = Math.atan2(z, x);
    const fold = (Math.sin(ang * 11 + ph[0]) * 0.6 + Math.sin(ang * 23 + ph[1]) * 0.4) * 0.018 * (1.2 - ty);
    const r = Math.hypot(x, z) || 1;
    x += x / r * fold; z += z / r * fold;
    y += Math.sin(x * 7 + ph[2]) * Math.sin(z * 6) * 0.01 * ty;
    if (y < 0.004) y = 0.004;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

// Lathe profile of a person standing under a sheet: skirt, hips, shoulders, neck, head.
function sheetFigure() {
  const prof = [[0.46, 0], [0.4, 0.06], [0.33, 0.35], [0.27, 0.8], [0.25, 1.05], [0.3, 1.3], [0.33, 1.42], [0.3, 1.5],
    [0.15, 1.58], [0.1, 1.63], [0.12, 1.68], [0.14, 1.76], [0.13, 1.86], [0.08, 1.94], [0.0, 1.97]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(prof, 40);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ang = Math.atan2(z, x);
    const ty = y / 1.97;
    // shoulders wider than deep; head tilted a little to one side
    x *= 1.0; z *= 0.62;
    if (y > 1.55) { x += (y - 1.55) * 0.35; }
    const fold = Math.sin(ang * 9 + y * 1.5) * 0.02 * (1.1 - ty) + Math.sin(ang * 17) * 0.008;
    const r = Math.hypot(x, z) || 1;
    if (y < 1.5) { x += x / r * fold; z += z / r * fold; }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function mulberry(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Collapse a group's meshes into one mesh per material (keeps `keep` untouched).
function mergeGroup(group, keep = null) {
  const byMat = new Map();
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const meshes = [];
  group.traverse(o => { if (o.isMesh && o !== keep) meshes.push(o); });
  for (const m of meshes) {
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(g);
    m.parent.remove(m);
  }
  for (const [mat, gs] of byMat) {
    const mesh = new THREE.Mesh(mergeGeometries(gs), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
}
function mergeLoose(parent, meshes) {
  const byMat = new Map();
  for (const m of meshes) {
    m.updateMatrixWorld(true);
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(g);
    parent.remove(m);
  }
  for (const [mat, gs] of byMat) { const mesh = new THREE.Mesh(mergeGeometries(gs), mat); mesh.frustumCulled = false; parent.add(mesh); }
}

// BoxGeometry UVs → metres so textures keep their real-world scale
export function scaleBoxUV(g, w, h, d) {
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
  uv.needsUpdate = true;
}

// A fabric panel with folds; `sway` animates it. Returned mesh has .userData.update(t, amount, pushPoint)
function makeCurtain(w, h, color, opacity) {
  const g = new THREE.PlaneGeometry(w, h, 24, 16);
  const base = g.attributes.position.array.slice();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide, transparent: opacity < 1, opacity });
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  const pos = g.attributes.position;
  const apply = (t, amt, push) => {
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const fold = Math.sin(x * 22) * 0.035 * (0.6 + 0.4 * (0.5 - y / h));
      const sway = amt * Math.sin(t * 1.3 + x * 3 + y * 1.5) * 0.12 * (0.5 - y / h);
      let bulge = 0;
      if (push) {
        const dx = x - push.x, dy = y - push.y;
        bulge = push.amount * Math.exp(-(dx * dx * 8 + dy * dy * 3));
      }
      pos.setXYZ(i, x, y, fold + sway + bulge);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
  };
  apply(0, 0, null);
  m.userData.update = apply;
  return m;
}
