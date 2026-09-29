// HUSH — "the Visitor". Procedural creature: SDF-sculpted body polygonised with
// surface nets at load, skinned to a THREE.Skeleton, animated fully procedurally.
//
// Contract (DESIGN.md):
//   createEntityModel() -> { root, height, update(dt, state), setLayer(n), clone(), dispose() }
// Extras:
//   headWorldPosition(out) -> out   world position of the face centre (between the eyes)
//   eyeWorldPosition(out)  -> out   same point, alias
//
// Origin at the feet, faces +Z, ~2.42 m tall standing. Geometry is generated once and
// shared by every instance (clones only get their own skeleton + eyeshine material).
import * as THREE from 'three';

// ----------------------------------------------------------------------------------
// small math helpers (scalar, allocation free)
// ----------------------------------------------------------------------------------
const D2R = Math.PI / 180;
const sq = (v) => v * v;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }
function sph(x, y, z, cx, cy, cz, r) { const dx = x - cx, dy = y - cy, dz = z - cz; return Math.sqrt(dx * dx + dy * dy + dz * dz) - r; }
function ell(x, y, z, cx, cy, cz, rx, ry, rz) {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz);
  const qx = px / rx, qy = py / ry, qz = pz / rz;
  const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1;
}
// tapered capsule between points a and b
function cone(x, y, z, a, b, ra, rb) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = x - a[0], pay = y - a[1], paz = z - a[2];
  const t = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
}
function boxDist(x, y, z, x0, y0, z0, x1, y1, z1) {
  const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1), dz = Math.max(z0 - z, 0, z - z1);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ----------------------------------------------------------------------------------
// anatomy (bind pose, metres, left side: +x). Arms in a slight A-pose.
// ----------------------------------------------------------------------------------
const ARM_A = 16 * D2R, SA = Math.sin(ARM_A), CA = Math.cos(ARM_A);
const SHO = [0.205, 1.905, -0.04];
const ELB = [SHO[0] + 0.52 * SA, SHO[1] - 0.52 * CA, -0.04];
const WRI = [ELB[0] + 0.50 * SA, ELB[1] - 0.50 * CA, -0.04];
const KNU = [WRI[0] + 0.10 * SA, WRI[1] - 0.10 * CA, -0.04];
const HIP = [0.10, 1.16, 0.0];
const KNE = [0.11, 0.65, 0.025];
const ANK = [0.115, 0.15, -0.035];
const BALL = [0.12, 0.03, 0.095];
const FZ = [0.027, 0.009, -0.009, -0.027];            // finger spread along z (index first)
const FLEN = [0.19, 0.22, 0.20, 0.165];               // finger lengths (no thumb)
const PHAL = [0.42, 0.33, 0.25];
const EYE_X = 0.036, EYE_Y = 2.300, EYE_Z = 0.058, EYE_R = 0.0105;
// asymmetric sockets (left a touch bigger and lower) — [x, y, z, rx, ry, rz] and eyeball [x, y, z, r]
const SOCK = [[EYE_X, EYE_Y - 0.003, 0.098, 0.0238, 0.0208, 0.044], [-(EYE_X - 0.0015), EYE_Y + 0.004, 0.097, 0.0212, 0.0176, 0.04]];
const EYEBALL = [[EYE_X, EYE_Y - 0.003, EYE_Z - 0.002, 0.0102], [-(EYE_X - 0.0015), EYE_Y + 0.004, EYE_Z + 0.001, 0.0094]];
const HINGE = [0, 2.232, -0.018];
const MOUTH_Y0 = 2.203, MOUTH_W = 0.05;
const mouthY = (X) => MOUTH_Y0 - 0.9 * X * X;
const slitHalf = (z) => 0.0015 + 0.075 * Math.max(0, z - HINGE[2]);
const FACE_CENTER = [0, EYE_Y + 0.004, 0.092];      // "between the eyes", on the face surface
const HEAD_TOP = 2.42;

// ----------------------------------------------------------------------------------
// skeleton definition
// ----------------------------------------------------------------------------------
const BONES = [];   // {name, parent, pos:[x,y,z]}
const BI = {};
function addBone(name, parent, pos) { BI[name] = BONES.length; BONES.push({ name, parent: parent == null ? -1 : BI[parent], pos }); }
addBone('hips', null, [0, 1.19, -0.015]);
addBone('spine1', 'hips', [0, 1.34, -0.025]);
addBone('spine2', 'spine1', [0, 1.50, -0.03]);
addBone('chest', 'spine2', [0, 1.67, -0.035]);
addBone('neck1', 'chest', [0, 1.92, -0.035]);
addBone('neck2', 'neck1', [0, 2.07, -0.02]);
addBone('head', 'neck2', [0, 2.19, -0.01]);
addBone('jaw', 'head', HINGE.slice());
const mirror = (p, s) => [p[0] * s, p[1], p[2]];
const fingerGeo = [];  // per side, per finger: {base, dir, joints:[p0,p1,p2,tip]}
for (const [side, s] of [['L', 1], ['R', -1]]) {
  addBone('clav' + side, 'chest', mirror([0.03, 1.92, -0.03], s));
  addBone('uarm' + side, 'clav' + side, mirror(SHO, s));
  addBone('farm' + side, 'uarm' + side, mirror(ELB, s));
  addBone('hand' + side, 'farm' + side, mirror(WRI, s));
  const fl = [];
  for (let f = 0; f < 4; f++) {
    const dir = new THREE.Vector3(SA * s, -CA, FZ[f] * 1.4).normalize();
    const base = new THREE.Vector3(KNU[0] * s, KNU[1], KNU[2] + FZ[f]);
    const j = [base.clone()];
    let acc = base.clone();
    for (let k = 0; k < 3; k++) { acc = acc.clone().addScaledVector(dir, FLEN[f] * PHAL[k]); j.push(acc); }
    for (let k = 0; k < 3; k++) addBone(`f${f}${k}${side}`, k === 0 ? 'hand' + side : `f${f}${k - 1}${side}`, j[k].toArray());
    fl.push({ base, dir, joints: j });
  }
  fingerGeo.push(fl);
  addBone('thigh' + side, 'hips', mirror(HIP, s));
  addBone('shin' + side, 'thigh' + side, mirror(KNE, s));
  addBone('foot' + side, 'shin' + side, mirror(ANK, s));
  addBone('toes' + side, 'foot' + side, mirror(BALL, s));
}
const NB = BONES.length;

// ----------------------------------------------------------------------------------
// SDF sculpt — body (symmetric, evaluated on X = |x|)
// ----------------------------------------------------------------------------------
let VERT = null;  // spine vertebra list [y, z], computed lazily
function sdTorsoBase(X, y, z) {
  let rib = smin(ell(X, y, z, 0, 1.655, -0.02, 0.148, 0.215, 0.112), ell(X, y, z, 0, 1.80, -0.03, 0.125, 0.13, 0.10), 0.05);
  // rib ridges (slanting down toward the front)
  const th = Math.atan2(X, z + 0.02);
  const front = sstep(-0.02, 0.09, z);
  const archY = 1.47 + 0.12 * front * (1 - sstep(0.0, 0.10, X));
  const v = y + 0.11 * (1 + Math.cos(th)) * 0.5 + 0.004 * Math.sin(th * 5.0);
  const r0 = 0.5 + 0.5 * Math.cos(2 * Math.PI * v / 0.041);
  const r = r0 * r0 * r0 * r0;
  const side = sstep(0.03, 0.11, X);                            // ribs show most on the flanks
  const mask = sstep(archY - 0.005, archY + 0.035, y) * (1 - sstep(1.70 + 0.12 * (1 - front) + 0.05 * side, 1.86, y)) * (1 - sstep(2.0, 2.6, th)) * sstep(0.015, 0.04, X + (1 - front) * 0.1) * (0.55 + 0.45 * side);
  rib -= 0.0048 * mask * (r - 0.25);
  rib = smax(rib, archY - y, 0.03);
  let abd = ell(X, y, z, 0, 1.40, -0.04, 0.098, 0.17, 0.062);
  abd = smax(abd, -ell(X, y, z, 0, 1.40, 0.082, 0.075, 0.11, 0.06), 0.03);              // scaphoid (sunken) belly
  let d = smin(rib, abd, 0.03);
  d = smin(d, ell(X, y, z, 0, 1.15, -0.028, 0.112, 0.09, 0.078), 0.045);                // pelvis
  d = smin(d, cone(X, y, z, [0.095, 1.245, -0.065], [0.112, 1.232, 0.035], 0.016, 0.02), 0.02); // iliac crest
  d = smin(d, ell(X, y, z, 0.052, 1.10, -0.07, 0.048, 0.062, 0.038), 0.03);             // buttock
  d = smin(d, ell(X, y, z, 0.085, 1.775, -0.118, 0.055, 0.072, 0.02), 0.02);            // scapula
  d = smin(d, cone(X, y, z, [0.012, 1.905, 0.068], [0.165, 1.925, 0.0], 0.0105, 0.012), 0.012); // clavicle
  d = smin(d, cone(X, y, z, [0.03, 2.0, -0.05], [0.185, 1.915, -0.045], 0.028, 0.03), 0.03);    // trapezius
  d = smax(d, -sph(X, y, z, 0, 1.925, 0.085, 0.022), 0.012);                            // sternal notch
  return d;
}
function sdTorso(X, y, z) {
  const b = boxDist(X, y, z, 0, 0.98, -0.2, 0.23, 2.05, 0.14);
  if (b > 0.04) return b;
  let d = sdTorsoBase(X, y, z);
  if (X < 0.035 && z < -0.04 && y > 1.1 && y < 1.99) {
    for (let i = 0; i < VERT.length; i++) {
      const vy = VERT[i][0];
      if (Math.abs(y - vy) > 0.04) continue;
      d = smin(d, ell(X, y, z, 0, vy, VERT[i][1], 0.013, 0.011, 0.012), 0.012);
    }
  }
  return d;
}
function sdNeck(X, y, z) {
  const b = boxDist(X, y, z, 0, 1.84, -0.1, 0.08, 2.3, 0.09);
  if (b > 0.04) return b;
  let d = cone(X, y, z, [0, 1.88, -0.035], [0, 2.24, -0.012], 0.041, 0.033);
  d = smin(d, cone(X, y, z, [0.042, 2.2, -0.03], [0.016, 1.935, 0.048], 0.0095, 0.0085), 0.018); // SCM cords
  d = smin(d, cone(X, y, z, [0, 2.12, 0.012], [0, 1.95, 0.026], 0.012, 0.011), 0.012);             // trachea
  d = smin(d, sph(X, y, z, 0, 2.065, 0.024, 0.013), 0.01);                                         // larynx
  for (let i = 0; i < 4; i++) d = smin(d, sph(X, y, z, 0, 1.95 + i * 0.045, -0.072 + i * 0.008, 0.012), 0.012);
  return d;
}
function sdRoundBox(px, py, pz, hx, hy, hz, r) {
  const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r, qz = Math.abs(pz) - hz + r;
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
function sdArm(X, y, z) {
  const b = boxDist(X, y, z, 0.13, 0.76, -0.1, 0.6, 2.0, 0.03);
  if (b > 0.04) return b;
  let d = sph(X, y, z, SHO[0] + 0.008, SHO[1] - 0.008, SHO[2], 0.045);
  d = smin(d, sph(X, y, z, 0.19, 1.935, -0.035, 0.021), 0.015);                      // acromion
  d = smin(d, cone(X, y, z, SHO, ELB, 0.035, 0.025), 0.03);
  d = smin(d, sph(X, y, z, ELB[0], ELB[1], ELB[2] - 0.017, 0.025), 0.016);           // olecranon
  d = smin(d, sph(X, y, z, ELB[0] - 0.02, ELB[1] + 0.01, ELB[2], 0.017), 0.012);     // epicondyle
  d = smin(d, cone(X, y, z, ELB, WRI, 0.028, 0.018), 0.02);
  d = smin(d, cone(X, y, z, [ELB[0], ELB[1], ELB[2] - 0.012], [WRI[0], WRI[1], WRI[2] - 0.012], 0.014, 0.012), 0.012); // ulna ridge
  d = smin(d, sph(X, y, z, WRI[0], WRI[1], WRI[2] - 0.014, 0.016), 0.01);             // ulna head
  if (y < WRI[1] + 0.04) {
    const px = X - WRI[0], py = y - WRI[1], pz = z - WRI[2];
    const u = px * SA - py * CA, v = px * CA + py * SA;
    d = smin(d, sdRoundBox(u - 0.055, v, pz, 0.05, 0.0105, 0.034, 0.009), 0.014);   // palm
    for (let f = 0; f < 4; f++) {
      const du = u - 0.1, dv = v - 0.004, dw = pz - FZ[f];
      d = smin(d, Math.sqrt(du * du + dv * dv + dw * dw) - 0.0102, 0.006);          // knuckles
    }
  }
  return d;
}
function sdLeg(X, y, z) {
  const b = boxDist(X, y, z, 0.0, -0.02, -0.14, 0.21, 1.3, 0.14);
  if (b > 0.04) return b;
  let d = cone(X, y, z, [0.094, 1.19, 0.0], KNE, 0.06, 0.037);
  d = smin(d, sph(X, y, z, 0.142, 1.10, -0.005, 0.026), 0.025);                                     // trochanter
  d = smin(d, sph(X, y, z, KNE[0], KNE[1] + 0.012, KNE[2] + 0.03, 0.027), 0.012);                   // patella
  d = smin(d, sph(X, y, z, KNE[0] + 0.022, KNE[1] - 0.004, KNE[2] - 0.002, 0.032), 0.015);          // condyles
  d = smin(d, sph(X, y, z, KNE[0] - 0.022, KNE[1] - 0.004, KNE[2] - 0.002, 0.032), 0.015);
  d = smin(d, cone(X, y, z, KNE, ANK, 0.039, 0.022), 0.02);
  d = smin(d, ell(X, y, z, KNE[0], KNE[1] - 0.15, KNE[2] - 0.028, 0.032, 0.11, 0.028), 0.025);      // calf
  d = smin(d, cone(X, y, z, [KNE[0], KNE[1] - 0.04, KNE[2] + 0.027], [ANK[0], ANK[1] + 0.04, ANK[2] + 0.02], 0.012, 0.01), 0.012); // tibia crest
  d = smin(d, sph(X, y, z, ANK[0] + 0.022, ANK[1], ANK[2], 0.017), 0.01);                           // malleoli
  d = smin(d, sph(X, y, z, ANK[0] - 0.02, ANK[1] + 0.008, ANK[2], 0.016), 0.01);
  d = smin(d, sph(X, y, z, ANK[0], ANK[1] - 0.035, ANK[2] - 0.042, 0.023), 0.02);                   // raised heel
  d = smin(d, cone(X, y, z, ANK, [BALL[0] + 0.018, BALL[1] + 0.004, BALL[2]], 0.025, 0.016), 0.02);  // foot
  d = smin(d, cone(X, y, z, ANK, [BALL[0] - 0.02, BALL[1] + 0.004, BALL[2] - 0.01], 0.023, 0.015), 0.02);
  return d;
}
function sdBody(x, y, z) {
  const X = Math.abs(x);
  let d = smin(sdTorso(X, y, z), sdNeck(X, y, z), 0.03);
  d = smin(d, sdArm(X, y, z), 0.028);
  d = smin(d, sdLeg(X, y, z), 0.035);
  return d;
}

// ----------------------------------------------------------------------------------
// SDF sculpt — head (with the mouth slit carved as a wedge; bind pose = mouth ~10° open)
// ----------------------------------------------------------------------------------
function sdHeadNoMouth(X, y, z) {
  let d = ell(X, y, z, 0, 2.318, -0.032, 0.068, 0.098, 0.098);                               // cranium (narrow, gaunt)
  d = smin(d, ell(X, y, z, 0, 2.34, -0.082, 0.058, 0.072, 0.076), 0.05);                       // swept-back occiput
  d = smin(d, ell(X, y, z, 0, 2.255, 0.03, 0.056, 0.11, 0.068), 0.05);                         // long flat face
  d = smin(d, cone(X, y, z, [0, 2.336, 0.086], [0.05, 2.33, 0.07], 0.012, 0.009), 0.025);      // brow
  d = smin(d, ell(X, y, z, 0.05, 2.272, 0.052, 0.016, 0.012, 0.026), 0.02);                    // cheekbone
  d = smin(d, ell(X, y, z, 0, 2.18, 0.035, 0.045, 0.065, 0.055), 0.035);                       // lower face
  d = smin(d, cone(X, y, z, [0.05, 2.21, -0.025], [0.014, 2.13, 0.06], 0.012, 0.01), 0.025);   // jawline
  d = smin(d, sph(X, y, z, 0, 2.132, 0.062, 0.016), 0.025);                                    // chin
  d = smin(d, cone(X, y, z, [0, 2.305, 0.09], [0, 2.255, 0.1], 0.007, 0.0065), 0.012);         // flat nasal ridge
  d = smax(d, -ell(X, y, z, 0.064, 2.215, 0.048, 0.02, 0.035, 0.03), 0.025);                   // hollow cheeks
  d = smax(d, -sph(X, y, z, 0.079, 2.312, 0.028, 0.021), 0.025);                                // sunken temples
  d = smax(d, -ell(X, y, z, 0.008, 2.248, 0.098, 0.003, 0.009, 0.02), 0.003);                  // nostril slits
  return d;
}
function sdHead(x, y, z) {
  const X = Math.abs(x);
  let d = sdHeadNoMouth(X, y, z);
  const S = x >= 0 ? SOCK[0] : SOCK[1];
  d = smax(d, -ell(x, y, z, S[0], S[1], S[2], S[3], S[4], S[5]), 0.01);                        // deep sockets
  const ht = slitHalf(z), my = mouthY(X);
  const ex = X - MOUTH_W;
  const slit = Math.max(Math.abs(y - my) - ht, ex, 0.012 - z);
  d = smax(d, -slit, 0.0025);
  return d;
}

// ----------------------------------------------------------------------------------
// surface nets polygoniser
// ----------------------------------------------------------------------------------
function surfaceNets(sdf, x0, y0, z0, x1, y1, z1, h) {
  const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1, nz = Math.ceil((z1 - z0) / h) + 1;
  const F = new Float32Array(nx * ny * nz);
  let n = 0;
  for (let k = 0; k < nz; k++) { const z = z0 + k * h; for (let j = 0; j < ny; j++) { const y = y0 + j * h; for (let i = 0; i < nx; i++) F[n++] = sdf(x0 + i * h, y, z); } }
  const sx = 1, sy = nx, sz = nx * ny;
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cell = new Int32Array(cx * cy * cz).fill(-1);
  const verts = [];
  const EA = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3], EB = [1, 3, 3, 2, 5, 7, 7, 6, 4, 5, 6, 7];
  // corner c -> (c&1, (c>>1)&1, (c>>2)&1); edges listed via EA/EB (a subset covering all 12 edges)
  const E12 = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const base = i + j * sy + k * sz;
    let mask = 0;
    for (let c = 0; c < 8; c++) { const v = F[base + (c & 1) * sx + ((c >> 1) & 1) * sy + ((c >> 2) & 1) * sz]; cv[c] = v; if (v < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let ax = 0, ay = 0, az = 0, cnt = 0;
    for (let e = 0; e < 12; e++) {
      const a = E12[e][0], b = E12[e][1];
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      ax += (a & 1) + ((b & 1) - (a & 1)) * t;
      ay += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
      az += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
      cnt++;
    }
    cell[i + j * cx + k * cx * cy] = verts.length / 3;
    verts.push(x0 + (i + ax / cnt) * h, y0 + (j + ay / cnt) * h, z0 + (k + az / cnt) * h);
  }
  const quads = [];
  const C = (i, j, k) => cell[i + j * cx + k * cx * cy];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = F[i + j * sy + k * sz] < 0;
    if (i < cx && j > 0 && k > 0 && j < cy && k < cz && v0 !== (F[i + 1 + j * sy + k * sz] < 0))
      quads.push(C(i, j - 1, k - 1), C(i, j, k - 1), C(i, j, k), C(i, j - 1, k));
    if (j < cy && i > 0 && k > 0 && i < cx && k < cz && v0 !== (F[i + (j + 1) * sy + k * sz] < 0))
      quads.push(C(i - 1, j, k - 1), C(i, j, k - 1), C(i, j, k), C(i - 1, j, k));
    if (k < cz && i > 0 && j > 0 && i < cx && j < cy && v0 !== (F[i + j * sy + (k + 1) * sz] < 0))
      quads.push(C(i - 1, j - 1, k), C(i, j - 1, k), C(i, j, k), C(i - 1, j, k));
  }
  return { verts, quads };
}

function gradient(sdf, x, y, z, e, out) {
  out[0] = sdf(x + e, y, z) - sdf(x - e, y, z);
  out[1] = sdf(x, y + e, z) - sdf(x, y - e, z);
  out[2] = sdf(x, y, z + e) - sdf(x, y, z - e);
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= l; out[1] /= l; out[2] /= l;
}

// ----------------------------------------------------------------------------------
// mesh builder (positions, normals, colours, skin indices/weights)
// ----------------------------------------------------------------------------------
class Builder {
  constructor() { this.p = []; this.n = []; this.c = []; this.si = []; this.sw = []; this.i = []; }
  get count() { return this.p.length / 3; }
  vert(px, py, pz, nx, ny, nz, r, g, b, W) {
    this.p.push(px, py, pz); this.n.push(nx, ny, nz); this.c.push(r, g, b);
    // W: Map-like array of [bone, weight] pairs; keep strongest 4
    W.sort((a, b2) => b2[1] - a[1]);
    let tot = 0; for (let k = 0; k < 4 && k < W.length; k++) tot += W[k][1];
    for (let k = 0; k < 4; k++) {
      if (k < W.length && tot > 0) { this.si.push(W[k][0]); this.sw.push(W[k][1] / tot); } else { this.si.push(0); this.sw.push(0); }
    }
    return this.count - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
function addW(W, bone, w) { if (w <= 1e-4) return; for (const e of W) if (e[0] === bone) { e[1] += w; return; } W.push([bone, w]); }

// chain weighting: point projected on polyline P (array of [x,y,z]), bones per segment, joint blend radii
function chainWeights(W, scale, x, y, z, P, bones, radii) {
  // closest arc-length parameter
  let best = 1e9, bestS = 0, acc = 0;
  const L = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
    const len = Math.hypot(bx, by, bz); L.push(acc);
    const t = clamp(((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / (len * len), 0, 1);
    const d = Math.hypot(x - a[0] - bx * t, y - a[1] - by * t, z - a[2] - bz * t);
    if (d < best) { best = d; bestS = acc + t * len; }
    acc += len;
  }
  L.push(acc);
  // partition of unity with smooth steps at interior joints
  let prev = 1;
  for (let i = 0; i < bones.length; i++) {
    const next = i < bones.length - 1 ? sstep(L[i + 1] - radii[i], L[i + 1] + radii[i], bestS) : 0;
    addW(W, bones[i], (prev - next) * scale);
    prev = next;
  }
}

// ----------------------------------------------------------------------------------
// geometry generation (cached)
// ----------------------------------------------------------------------------------
let SHARED = null;
const BODY_H = 0.0205, HEAD_H = 0.0088;
const COUNTS = {};

function buildShared() {
  const t0 = performance.now();
  // vertebra positions: find the back surface along the midline
  VERT = [];
  for (let y = 1.13; y < 1.96; y += 0.034) {
    let z = 0.0;
    while (z > -0.3 && sdTorsoBase(0, y, z) < 0) z -= 0.002;
    VERT.push([y, z + 0.003]);
  }

  const skin = new Builder(), bone = new Builder(), dark = new Builder();
  const g = [0, 0, 0];

  // ---------------- body ----------------
  {
    const { verts, quads } = surfaceNets(sdBody, -0.6, -0.012, -0.2, 0.6, 2.3, 0.16, BODY_H);
    const nv = verts.length / 3, map = new Int32Array(nv);
    for (let v = 0; v < nv; v++) {
      let x = verts[v * 3], y = verts[v * 3 + 1], z = verts[v * 3 + 2];
      for (let it = 0; it < 3; it++) {
        const d = sdBody(x, y, z); gradient(sdBody, x, y, z, 0.002, g);
        const st = clamp(d, -0.008, 0.008); x -= g[0] * st; y -= g[1] * st; z -= g[2] * st;
      }
      gradient(sdBody, x, y, z, 0.0025, g);
      // ambient occlusion from the field
      let occ = 0;
      for (let k = 1; k <= 5; k++) { const hh = k * 0.012; occ += (hh - sdBody(x + g[0] * hh, y + g[1] * hh, z + g[2] * hh)) / hh * Math.pow(0.7, k); }
      let ao = clamp(1 - occ * 0.55, 0.12, 1);
      // weights
      const X = Math.abs(x), s = x >= 0 ? 'L' : 'R', sg = x >= 0 ? 1 : -1;
      const dp = [sdTorso(X, y, z), sdNeck(X, y, z), sdArm(X, y, z), sdLeg(X, y, z)];
      const dm = Math.min(...dp);
      const wp = dp.map(d => Math.exp(-(d - dm) / 0.009));
      const ws = wp[0] + wp[1] + wp[2] + wp[3];
      const W = [];
      chainWeights(W, wp[0] / ws, 0, y, z, [[0, 0.9, -0.02], [0, 1.3, -0.02], [0, 1.47, -0.03], [0, 1.62, -0.03], [0, 2.1, -0.035]],
        [BI.hips, BI.spine1, BI.spine2, BI.chest], [0.07, 0.07, 0.07]);
      chainWeights(W, wp[1] / ws, 0, y, z, [[0, 1.8, -0.03], [0, 1.915, -0.035], [0, 2.06, -0.02], [0, 2.18, -0.01], [0, 2.4, 0]],
        [BI.chest, BI.neck1, BI.neck2, BI.head], [0.03, 0.035, 0.03]);
      chainWeights(W, wp[2] / ws, X, y, z, [[0.035, 1.925, -0.03], SHO, ELB, WRI, [KNU[0] + 0.05 * SA, KNU[1] - 0.05 * CA, KNU[2]]],
        [BI['clav' + s], BI['uarm' + s], BI['farm' + s], BI['hand' + s]], [0.045, 0.035, 0.025]);
      chainWeights(W, wp[3] / ws, X, y, z, [[0.09, 1.32, 0], HIP, KNE, ANK, [BALL[0], BALL[1], BALL[2] + 0.03]],
        [BI.hips, BI['thigh' + s], BI['shin' + s], BI['foot' + s]], [0.07, 0.045, 0.03]);
      // colour: AO + bruised joints
      let r = 1, gg = 1, b = 1;
      const joint = Math.max(
        Math.exp(-((X - ELB[0]) ** 2 + (y - ELB[1]) ** 2 + (z - ELB[2]) ** 2) / 0.0012),
        Math.exp(-((X - KNE[0]) ** 2 + (y - KNE[1]) ** 2 + (z - KNE[2]) ** 2) / 0.0018),
        Math.exp(-((X - KNU[0]) ** 2 + (y - KNU[1]) ** 2 + (z - KNU[2]) ** 2) / 0.0015),
        Math.exp(-((X - ANK[0]) ** 2 + (y - ANK[1]) ** 2 + (z - ANK[2]) ** 2) / 0.0012));
      r *= 1 - 0.12 * joint; gg *= 1 - 0.3 * joint; b *= 1 - 0.18 * joint;
      // livid, dead extremities (hands, feet) and a greyer, dirtier lower body
      const hand = sstep(WRI[1] + 0.02, WRI[1] - 0.06, y) * sstep(0.3, 0.42, X);
      const foot = sstep(ANK[1] + 0.12, ANK[1] - 0.05, y);
      const ext = Math.max(hand, foot);
      r *= 1 - 0.3 * ext; gg *= 1 - 0.4 * ext; b *= 1 - 0.22 * ext;
      const low = sstep(1.0, 0.3, y) * 0.12; r *= 1 - low; gg *= 1 - low; b *= 1 - low * 0.8;
      map[v] = skin.vert(x, y, z, g[0], g[1], g[2], r * ao, gg * ao, b * ao, W);
    }
    addQuads(skin, quads, map);
    COUNTS.body = skin.i.length / 3;
  }

  // ---------------- head ----------------
  {
    const { verts, quads } = surfaceNets(sdHead, -0.1, 2.1, -0.178, 0.1, 2.445, 0.13, HEAD_H);
    const nv = verts.length / 3, map = new Int32Array(nv);
    for (let v = 0; v < nv; v++) {
      let x = verts[v * 3], y = verts[v * 3 + 1], z = verts[v * 3 + 2];
      for (let it = 0; it < 3; it++) {
        const d = sdHead(x, y, z); gradient(sdHead, x, y, z, 0.0008, g);
        const st = clamp(d, -0.003, 0.003); x -= g[0] * st; y -= g[1] * st; z -= g[2] * st;
      }
      gradient(sdHead, x, y, z, 0.001, g);
      let occ = 0;
      for (let k = 1; k <= 5; k++) { const hh = k * 0.005; occ += (hh - sdHead(x + g[0] * hh, y + g[1] * hh, z + g[2] * hh)) / hh * Math.pow(0.72, k); }
      let ao = clamp(1 - occ * 0.6, 0.06, 1);
      const X = Math.abs(x);
      // jaw weight
      const inSlit = 1 - sstep(MOUTH_W - 0.008, MOUTH_W + 0.02, X);
      const width = mix(0.028, 0.0045, inSlit);
      const below = sstep(mouthY(X) + width, mouthY(X) - width, y);
      const fwd = sstep(HINGE[2] - 0.035, HINGE[2] + 0.01, z);
      const wj = clamp(below * fwd, 0, 1);
      const W = [];
      addW(W, BI.head, 1 - wj); addW(W, BI.jaw, wj);
      // mouth interior darkness
      const my = mouthY(X), ht = slitHalf(z);
      const inside = (1 - sstep(ht + 0.0005, ht + 0.0045, Math.abs(y - my))) * (1 - sstep(MOUTH_W - 0.004, MOUTH_W + 0.006, X));
      // socket darkness
      const SK = x >= 0 ? SOCK[0] : SOCK[1];
      const ed = Math.hypot(x - SK[0], (y - SK[1]) * 1.15, (z - 0.086) * 0.7);
      const sock = 1 - sstep(0.015, 0.036, ed);
      const crease = (1 - sstep(0.002, 0.008, Math.abs(y - my))) * sstep(MOUTH_W + 0.028, MOUTH_W - 0.004, X) * 0.6;
      let k = ao * (1 - 0.97 * Math.max(inside, crease)) * (1 - 0.93 * sock);
      map[v] = skin.vert(x, y, z, g[0], g[1], g[2], k * (1 + 0.06 * inside), k * (1 - 0.1 * inside), k * (1 - 0.05 * inside), W);
    }
    addQuads(skin, quads, map);
    COUNTS.head = skin.i.length / 3 - COUNTS.body;
  }

  // ---------------- fingers & toes (tubes) + claws ----------------
  for (let si = 0; si < 2; si++) {
    const s = si === 0 ? 'L' : 'R', sg = si === 0 ? 1 : -1;
    const N = new THREE.Vector3(CA * sg, SA, 0); // back-of-hand direction (dorsal)
    for (let f = 0; f < 4; f++) {
      const fg = fingerGeo[si][f];
      const bones = [BI['hand' + s], BI[`f${f}0${s}`], BI[`f${f}1${s}`], BI[`f${f}2${s}`]];
      const L = FLEN[f];
      const P = [fg.base.clone().addScaledVector(fg.dir, -0.035), ...fg.joints];
      const prof = (t) => { // t in metres from knuckle
        const j1 = L * PHAL[0], j2 = j1 + L * PHAL[1];
        let r = mix(0.0082, 0.0056, clamp(t / L, 0, 1));
        r += 0.0016 * Math.exp(-sq(t / 0.009)) + 0.0014 * Math.exp(-sq((t - j1) / 0.007)) + 0.0011 * Math.exp(-sq((t - j2) / 0.006));
        return r;
      };
      tube(skin, fg.base, fg.dir, N, -0.035, L, prof, 16, 6, (px, py, pz, t) => {
        const W = []; chainWeights(W, 1, px, py, pz, P.map(v => v.toArray()), bones, [0.012, 0.008, 0.007]);
        const tipDark = sstep(L - 0.03, L, t);
        return { W, col: [1 - 0.35 * tipDark, 1 - 0.45 * tipDark, 1 - 0.3 * tipDark] };
      });
      // claw
      const tip = fg.joints[3];
      claw(bone, tip.clone().addScaledVector(fg.dir, -0.01).addScaledVector(N, 0.0025), fg.dir, N, 0.024, 0.0042, bones[3]);
    }
    // toes
    for (let t = 0; t < 4; t++) {
      const xo = [-0.022, -0.007, 0.008, 0.023][t];
      const len = [0.07, 0.082, 0.078, 0.062][t];
      const base = new THREE.Vector3((BALL[0] + xo) * sg, BALL[1] + 0.006, BALL[2] - 0.012);
      const dir = new THREE.Vector3(xo * 0.9 * sg, -0.3, 1).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const bones = [BI['foot' + s], BI['toes' + s]];
      const P = [base.clone().addScaledVector(dir, -0.03).toArray(), base.toArray(), base.clone().addScaledVector(dir, len).toArray()];
      tube(skin, base, dir, up, -0.03, len, (u) => mix(0.0092, 0.0052, clamp(u / len, 0, 1)) + 0.0012 * Math.exp(-sq((u - len * 0.5) / 0.008)), 9, 6, (px, py, pz, u) => {
        const W = []; chainWeights(W, 1, px, py, pz, P, bones, [0.012]);
        const dk = sstep(len - 0.02, len, u);
        return { W, col: [0.8 - 0.3 * dk, 0.78 - 0.35 * dk, 0.8 - 0.3 * dk] };
      });
      const tip = base.clone().addScaledVector(dir, len);
      claw(bone, tip.clone().addScaledVector(dir, -0.008).addScaledVector(up, 0.002), dir, up, 0.014, 0.0045, bones[1]);
    }
  }

  // ---------------- teeth ----------------
  {
    const rnd = mulberry(1337);
    const faceZ = (x, y) => { let z = 0.14; while (z > -0.05 && sdHeadNoMouth(Math.abs(x), y, z) > 0) z -= 0.0005; return z; };
    for (const row of [0, 1]) {
      const n = row === 0 ? 17 : 11;
      for (const upper of [true, false]) {
        for (let i = 0; i < n; i++) {
          let x = mix(-0.044, 0.044, (i + 0.5) / n) + (rnd() - 0.5) * 0.004 * (row + 1);
          x *= row === 0 ? 1 : 0.85;
          const zf = faceZ(x, mouthY(Math.abs(x))) - 0.007 - row * 0.011 - rnd() * 0.002;
          const ht = slitHalf(zf);
          const y = mouthY(Math.abs(x)) + (upper ? ht + 0.0015 : -ht - 0.0015);
          const len = (0.009 + rnd() * 0.013) * (row === 0 ? 1 : 0.8) * (Math.abs(x) > 0.035 ? 0.75 : 1);
          const r = 0.0014 + rnd() * 0.0012;
          const dir = new THREE.Vector3((rnd() - 0.5) * 0.35, upper ? -1 : 1, 0.06 + (rnd() - 0.4) * 0.3).normalize();
          const baseP = new THREE.Vector3(x, y, zf).addScaledVector(dir, -0.004);
          const tipP = baseP.clone().addScaledVector(dir, len + 0.004);
          const bn = upper ? BI.head : BI.jaw;
          spike(bone, baseP, tipP, r, 5, bn, [0.86, 0.8, 0.62]);
        }
      }
    }
  }

  // ---------------- eyeballs (dark glossy) ----------------
  for (const e of EYEBALL) sphere(dark, e[0], e[1], e[2], e[3], 10, 8, BI.head);
  // gullet: a dark funnel behind the mouth slit going down the neck
  {
    const rings = 7, seg = 10;
    const base = dark.count;
    for (let r = 0; r < rings; r++) {
      const t = r / (rings - 1);
      const cy = mix(2.205, 1.99, t), cz = mix(0.0, -0.03, t);
      const rx = mix(0.042, 0.018, t), rz = mix(0.028, 0.016, t);
      for (let k = 0; k < seg; k++) {
        const a = k / seg * Math.PI * 2;
        const nx = Math.cos(a), nz = Math.sin(a);
        const W = []; addW(W, BI.head, 1 - t); addW(W, BI.neck2, t);
        dark.vert(nx * rx, cy, cz + nz * rz, -nx, 0, -nz, 1, 1, 1, W);
      }
    }
    for (let r = 0; r < rings - 1; r++) for (let k = 0; k < seg; k++) {
      const a = base + r * seg + k, b = base + r * seg + (k + 1) % seg, c = a + seg, d = b + seg;
      dark.tri(a, c, b); dark.tri(b, c, d);
    }
  }

  const res = {
    skin: skin.geometry(), bone: bone.geometry(), dark: dark.geometry(),
    buildMs: performance.now() - t0,
  };
  res.tris = (res.skin.index.count + res.bone.index.count + res.dark.index.count) / 3;
  return res;
}

function addQuads(B, quads, map) {
  const P = B.p, Nn = B.n;
  const tmp = (a, b, c) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nx = Nn[a * 3] + Nn[b * 3] + Nn[c * 3], ny = Nn[a * 3 + 1] + Nn[b * 3 + 1] + Nn[c * 3 + 1], nz = Nn[a * 3 + 2] + Nn[b * 3 + 2] + Nn[c * 3 + 2];
    if (fx * nx + fy * ny + fz * nz >= 0) B.tri(a, b, c); else B.tri(a, c, b);
  };
  for (let q = 0; q < quads.length; q += 4) {
    const a = map[quads[q]], b = map[quads[q + 1]], c = map[quads[q + 2]], d = map[quads[q + 3]];
    // split along the shorter diagonal
    const dac = (P[a * 3] - P[c * 3]) ** 2 + (P[a * 3 + 1] - P[c * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[c * 3 + 2]) ** 2;
    const dbd = (P[b * 3] - P[d * 3]) ** 2 + (P[b * 3 + 1] - P[d * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[d * 3 + 2]) ** 2;
    if (dac < dbd) { tmp(a, b, c); tmp(a, c, d); } else { tmp(a, b, d); tmp(b, c, d); }
  }
}

// tube along dir from t0 to t1 (metres), radius profile prof(t), weights via fn
function tube(B, base, dir, up, t0, t1, prof, rings, seg, fn) {
  const side = new THREE.Vector3().crossVectors(dir, up).normalize();
  const up2 = new THREE.Vector3().crossVectors(side, dir).normalize();
  const start = B.count;
  for (let r = 0; r <= rings; r++) {
    const t = mix(t0, t1, r / rings);
    const rad = r === rings ? 0.0012 : prof(t);
    const cx = base.x + dir.x * t, cy = base.y + dir.y * t, cz = base.z + dir.z * t;
    const { W, col } = fn(cx, cy, cz, t);
    for (let k = 0; k < seg; k++) {
      const a = k / seg * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a) * 0.85; // slightly flattened
      const nx = side.x * ca + up2.x * sa, ny = side.y * ca + up2.y * sa, nz = side.z * ca + up2.z * sa;
      const tipBend = r === rings ? 0.6 : 0;
      B.vert(cx + nx * rad, cy + ny * rad, cz + nz * rad, nx * (1 - tipBend) + dir.x * tipBend, ny * (1 - tipBend) + dir.y * tipBend, nz * (1 - tipBend) + dir.z * tipBend, col[0], col[1], col[2], W.map(e => e.slice()));
    }
  }
  for (let r = 0; r < rings; r++) for (let k = 0; k < seg; k++) {
    const a = start + r * seg + k, b = start + r * seg + (k + 1) % seg, c = a + seg, d = b + seg;
    B.tri(a, b, c); B.tri(b, d, c);
  }
  // fix winding (outward normals)
  fixWinding(B, start);
}
function fixWinding(B, startVert) {
  // flip any triangle (touching verts >= startVert) whose face normal disagrees with vertex normals
  const P = B.p, Nn = B.n, I = B.i;
  for (let q = 0; q < I.length; q += 3) {
    const a = I[q], b = I[q + 1], c = I[q + 2];
    if (a < startVert) continue;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nx = Nn[a * 3] + Nn[b * 3] + Nn[c * 3], ny = Nn[a * 3 + 1] + Nn[b * 3 + 1] + Nn[c * 3 + 1], nz = Nn[a * 3 + 2] + Nn[b * 3 + 2] + Nn[c * 3 + 2];
    if (fx * nx + fy * ny + fz * nz < 0) { I[q + 1] = c; I[q + 2] = b; }
  }
}
// hooked claw: cone from base along dir, curving toward -N (palm side)
function claw(B, base, dir, N, len, r, boneIdx) {
  const seg = 5, rings = 4, start = B.count;
  const side = new THREE.Vector3().crossVectors(dir, N).normalize();
  const W = [[boneIdx, 1]];
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const c = base.clone().addScaledVector(dir, len * t).addScaledVector(N, -0.006 * t * t);
    const rad = r * (1 - t) + 0.0003;
    for (let s = 0; s < seg; s++) {
      const a = s / seg * Math.PI * 2;
      const nx = side.x * Math.cos(a) + N.x * Math.sin(a) * 0.6, ny = side.y * Math.cos(a) + N.y * Math.sin(a) * 0.6, nz = side.z * Math.cos(a) + N.z * Math.sin(a) * 0.6;
      B.vert(c.x + nx * rad, c.y + ny * rad, c.z + nz * rad, nx, ny, nz, 0.2, 0.18, 0.15, W.map(e => e.slice()));
    }
  }
  for (let k = 0; k < rings; k++) for (let s = 0; s < seg; s++) {
    const a = start + k * seg + s, b = start + k * seg + (s + 1) % seg, c = a + seg, d = b + seg;
    B.tri(a, b, c); B.tri(b, d, c);
  }
  fixWinding(B, start);
}
function spike(B, baseP, tipP, r, seg, boneIdx, col) {
  const dir = tipP.clone().sub(baseP); const len = dir.length(); dir.normalize();
  const ref = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const s1 = new THREE.Vector3().crossVectors(dir, ref).normalize(), s2 = new THREE.Vector3().crossVectors(dir, s1);
  const start = B.count; const W = [[boneIdx, 1]];
  for (let k = 0; k < seg; k++) {
    const a = k / seg * Math.PI * 2, nx = s1.x * Math.cos(a) + s2.x * Math.sin(a), ny = s1.y * Math.cos(a) + s2.y * Math.sin(a), nz = s1.z * Math.cos(a) + s2.z * Math.sin(a);
    B.vert(baseP.x + nx * r, baseP.y + ny * r, baseP.z + nz * r, nx, ny, nz, col[0] * 0.8, col[1] * 0.75, col[2] * 0.7, W.map(e => e.slice()));
  }
  // slightly curved: mid ring
  const mid = baseP.clone().addScaledVector(dir, len * 0.55);
  for (let k = 0; k < seg; k++) {
    const a = k / seg * Math.PI * 2, nx = s1.x * Math.cos(a) + s2.x * Math.sin(a), ny = s1.y * Math.cos(a) + s2.y * Math.sin(a), nz = s1.z * Math.cos(a) + s2.z * Math.sin(a);
    B.vert(mid.x + nx * r * 0.55, mid.y + ny * r * 0.55, mid.z + nz * r * 0.55, nx, ny, nz, col[0], col[1], col[2], W.map(e => e.slice()));
  }
  const tip = B.vert(tipP.x, tipP.y, tipP.z, dir.x, dir.y, dir.z, col[0], col[1], col[2], W.map(e => e.slice()));
  for (let k = 0; k < seg; k++) {
    const a = start + k, b = start + (k + 1) % seg, c = a + seg, d = b + seg;
    B.tri(a, b, c); B.tri(b, d, c); B.tri(c, d, tip);
  }
  fixWinding(B, start);
}
function sphere(B, cx, cy, cz, r, ws, hs, boneIdx) {
  const start = B.count;
  for (let j = 0; j <= hs; j++) {
    const v = j / hs, th = v * Math.PI;
    for (let i = 0; i <= ws; i++) {
      const u = i / ws, ph = u * Math.PI * 2;
      const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
      B.vert(cx + nx * r, cy + ny * r, cz + nz * r, nx, ny, nz, 1, 1, 1, [[boneIdx, 1]]);
    }
  }
  for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) {
    const a = start + j * (ws + 1) + i, b = a + 1, c = a + ws + 1, d = c + 1;
    B.tri(a, c, b); B.tri(b, c, d);
  }
  fixWinding(B, start);
}

// ----------------------------------------------------------------------------------
// materials
// ----------------------------------------------------------------------------------
const NOISE_GLSL = /* glsl */`
varying vec3 vBindPos;
float vh13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(vh13(i), vh13(i+vec3(1,0,0)), f.x), mix(vh13(i+vec3(0,1,0)), vh13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(vh13(i+vec3(0,0,1)), vh13(i+vec3(1,0,1)), f.x), mix(vh13(i+vec3(0,1,1)), vh13(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
`;
function makeSkinMaterial() {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x9aa7a2, roughness: 0.46, metalness: 0, vertexColors: true,
    clearcoat: 0.9, clearcoatRoughness: 0.14, specularIntensity: 0.8,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBindPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBindPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 sp = vBindPos;
        float nL = fbm3(sp * 5.0);
        float nM = fbm3(sp * 24.0 + 7.3);
        float nF = vnoise(sp * 110.0);
        vec3 wq = sp * 12.0 + vec3(fbm3(sp * 3.1), fbm3(sp * 3.1 + 3.3), fbm3(sp * 3.1 + 6.7)) * 1.8;
        float vr = 1.0 - abs(vnoise(wq) * 2.0 - 1.0);
        vec3 wq2 = sp * 31.0 + vec3(fbm3(sp * 9.0 + 1.0), fbm3(sp * 9.0 + 4.0), 0.0) * 2.0;
        float vr2 = 1.0 - abs(vnoise(wq2) * 2.0 - 1.0);
        float vmask = smoothstep(0.3, 0.62, fbm3(sp * 2.3 + 11.0));
        float veins = max(smoothstep(0.86, 0.972, vr), smoothstep(0.9, 0.985, vr2) * 0.7) * vmask;
        vec3 tint = mix(vec3(0.86, 0.98, 1.0), vec3(1.06, 0.95, 0.93), smoothstep(0.3, 0.75, nL));
        float blot = smoothstep(0.52, 0.78, fbm3(sp * 7.0 + 21.0));
        diffuseColor.rgb *= tint * mix(0.62, 1.1, nM);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.58, 0.7), blot * 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.34, 0.42, 0.62), veins * 0.85);
        float wet = smoothstep(0.25, 0.7, fbm3(sp * 4.0 + 5.0));
        float skinH2 = nM * 0.8 + nL * 0.4;
        float cav = smoothstep(0.03, 0.3, max(vColor.r, max(vColor.g, vColor.b)));
        float skinRough = mix(0.7, 1.35, nM);
        float skinH = nM * 0.55 + nF * 0.3 - veins * 0.5;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * skinRough, 0.08, 1.0);')
      .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
        {
          vec3 sX = dFdx(-vViewPosition), sY = dFdy(-vViewPosition);
          vec3 R1 = cross(sY, clearcoatNormal), R2 = cross(clearcoatNormal, sX);
          float det = dot(sX, R1) * faceDirection;
          vec2 dH = vec2(dFdx(skinH2), dFdy(skinH2)) * 0.0024;
          vec3 grad = sign(det) * (dH.x * R1 + dH.y * R2);
          clearcoatNormal = normalize(abs(det) * clearcoatNormal - grad);
        }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.specularColor *= cav; material.specularF90 *= cav;
        material.clearcoat *= cav * mix(0.35, 1.0, wet);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 sX = dFdx(-vViewPosition), sY = dFdy(-vViewPosition);
          vec3 R1 = cross(sY, normal), R2 = cross(normal, sX);
          float det = dot(sX, R1) * faceDirection;
          vec2 dH = vec2(dFdx(skinH), dFdy(skinH)) * 0.0016;
          vec3 grad = sign(det) * (dH.x * R1 + dH.y * R2);
          normal = normalize(abs(det) * normal - grad);
        }`);
  };
  m.customProgramCacheKey = () => 'hush-visitor-skin-2';
  return m;
}
function makeEyeshineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uColor: { value: new THREE.Color(0.75, 1.0, 0.82) }, uSize: { value: 0.0035 }, uMinPx: { value: 3.2 }, uH: { value: 1080 } },
    vertexShader: /* glsl */`
      uniform float uSize, uMinPx, uH;
      varying float vHalo;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = uSize * uH * 0.5 * projectionMatrix[1][1] / max(0.05, -mv.z);
        vHalo = clamp((uMinPx - px) / uMinPx * 1.6, 0.0, 1.0);  // halo only once it shrinks below a few px (distance)
        gl_PointSize = max(px, uMinPx) * 4.0;   // core is the inner quarter, the rest is a faint halo
      }`,
    fragmentShader: /* glsl */`
      uniform float uI; uniform vec3 uColor;
      varying float vHalo;
      void main(){
        vec2 c = (gl_PointCoord * 2.0 - 1.0) * 4.0;   // core units
        float d2 = dot(c, c);
        float core = exp(-d2 * 2.2);
        float halo = exp(-sqrt(d2) * 1.6) * 0.07 * vHalo;
        float a = core + halo;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor * uI * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
}

function getShared() {
  if (!SHARED) {
    const geo = buildShared();
    SHARED = {
      ...geo,
      skinMat: makeSkinMaterial(),
      boneMat: new THREE.MeshStandardMaterial({ color: 0xd9cfb4, roughness: 0.32, metalness: 0, vertexColors: true }),
      darkMat: new THREE.MeshStandardMaterial({ color: 0x020101, roughness: 0.5, metalness: 0, side: THREE.DoubleSide }),
      refs: 0,
    };
  }
  SHARED.refs++;
  return SHARED;
}

// ----------------------------------------------------------------------------------
// the model
// ----------------------------------------------------------------------------------
const BIND = BONES.map(b => new THREE.Vector3(...b.pos));
const OFF = BONES.map((b, i) => b.parent < 0 ? BIND[i].clone() : BIND[i].clone().sub(BIND[b.parent]));
const A_L = new THREE.Vector3(SA, -CA, 0), A_R = new THREE.Vector3(-SA, -CA, 0);
const PALM_L = new THREE.Vector3(-CA, -SA, 0), PALM_R = new THREE.Vector3(CA, -SA, 0);
const CURL_L = new THREE.Vector3(0, 0, -1), CURL_R = new THREE.Vector3(0, 0, 1);
const THIGH_BIND = new THREE.Vector3(...KNE).sub(new THREE.Vector3(...HIP)).normalize();
const SHIN_BIND = new THREE.Vector3(...ANK).sub(new THREE.Vector3(...KNE)).normalize();
const L_THIGH = new THREE.Vector3(...KNE).distanceTo(new THREE.Vector3(...HIP));
const L_SHIN = new THREE.Vector3(...ANK).distanceTo(new THREE.Vector3(...KNE));
const X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0), Z_AXIS = new THREE.Vector3(0, 0, 1);
const FACE_OFF = new THREE.Vector3(...FACE_CENTER).sub(BIND[BI.head]);

const MODES = {
  idle: { stoop: 0.18 }, walk: { stoop: 0.22 }, stoop: { stoop: 1 }, run: { stoop: 0.35, run: 1 },
  lurk: { stoop: 0.14, lurk: 1 }, reach: { stoop: 0.3, reach: 1 }, scream: { stoop: 0.1, jaw: 1, shake: 1, tremor: 1, spread: 1 },
};
const JERK_POOL = [BI.head, BI.head, BI.neck2, BI.neck1, BI.chest, BI.uarmL, BI.uarmR, BI.farmL, BI.farmR, BI.handL, BI.handR, BI.spine2, BI.clavL, BI.clavR];
const PARAMS = ['stoop', 'run', 'reach', 'spread', 'jaw', 'shake', 'tremor', 'lurk'];

// scratch (module level; update() is synchronous so instances can share)
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _size = new THREE.Vector2();

class EntityModel {
  constructor() {
    this._shared = getShared();
    const S = this._shared;
    this.root = new THREE.Group(); this.root.name = 'Visitor';
    this.height = HEAD_TOP;
    this.bones = BONES.map((b, i) => { const bone = new THREE.Bone(); bone.name = b.name; bone.position.copy(OFF[i]); return bone; });
    BONES.forEach((b, i) => { if (b.parent >= 0) this.bones[b.parent].add(this.bones[i]); });
    this.root.add(this.bones[0]);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    const mk = (geo, mat) => {
      const m = new THREE.SkinnedMesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.2, 0.3), 2.1);
      this.root.add(m); m.bind(this.skeleton);
      return m;
    };
    this.skinMesh = mk(S.skin, S.skinMat);
    this.boneMesh = mk(S.bone, S.boneMat);
    this.darkMesh = mk(S.dark, S.darkMat); this.darkMesh.receiveShadow = false;
    // eyeshine: two points parented to the head bone
    this.eyeMat = makeEyeshineMaterial();
    const eg = new THREE.BufferGeometry();
    const hb = BIND[BI.head];
    eg.setAttribute('position', new THREE.Float32BufferAttribute(EYEBALL.flatMap(e => [e[0] - hb.x, e[1] - hb.y, e[2] + e[3] + 0.0015 - hb.z]), 3));
    this.eyes = new THREE.Points(eg, this.eyeMat);
    this.eyes.frustumCulled = false; this.eyes.renderOrder = 10;
    this.eyes.onBeforeRender = (renderer) => { renderer.getDrawingBufferSize(_size); this.eyeMat.uniforms.uH.value = _size.y; };
    this.bones[BI.head].add(this.eyes);
    this._layer = 0;

    // animation state
    this.P = {}; for (const k of PARAMS) this.P[k] = 0; this.P.stoop = 0.18;
    this.gait = 0; this.phase = Math.random(); this.time = Math.random() * 100; this.anim = 0;
    this.feet = [{ z: 0.06, y: 0, planted: true, liftZ: 0, sw: 0 }, { z: -0.05, y: 0, planted: true, liftZ: 0, sw: 0 }];
    this.arms = [{ a: 0, v: 0, e: 0.25, ev: 0, s: 0, sv: 0 }, { a: 0, v: 0, e: 0.25, ev: 0, s: 0, sv: 0 }];
    this.hy = 0; this.hp = 0; this.thy = 0; this.thp = 0; this.sacc = 0;
    this.tilt = 0.5 * (Math.random() < 0.5 ? -1 : 1); this.tiltT = this.tilt;
    this.lurkT = 0; this.hold = 0; this.shine = 0;
    this.lean = 0; this.hipsY = 0; this.lastHead = new THREE.Vector3(0, 2.3, 0);
    this.jerk = new Float32Array(NB * 3); // per-bone twitch offsets (euler)
    this.fingerN = new Float32Array(8);
    this.reachLag = 0; this.jawV = 0; this.jawX = 0;
    // root-space pose buffers
    this.wq = BONES.map(() => new THREE.Quaternion());
    this.wp = BONES.map((_, i) => BIND[i].clone());
    this.lq = BONES.map(() => new THREE.Quaternion());
    this.lp = BONES.map((_, i) => OFF[i].clone());
    this.jawScale = 1;
    this._invRoot = new THREE.Matrix4();
    this._look = new THREE.Vector3(); this._hasLook = false;
    this.update(0, { mode: 'idle', speed: 0 });
  }

  // ------------------------------------------------------------------ API
  setLayer(n) { this._layer = n; this.root.traverse(o => o.layers.set(n)); }
  clone() { const c = new EntityModel(); c.setLayer(this._layer); c.root.visible = this.root.visible; return c; }
  dispose() {
    this.root.removeFromParent();
    this.eyes.geometry.dispose(); this.eyeMat.dispose();
    const S = this._shared; if (!S) return; this._shared = null;
    if (--S.refs <= 0) { S.skin.dispose(); S.bone.dispose(); S.dark.dispose(); S.skinMat.dispose(); S.boneMat.dispose(); S.darkMat.dispose(); if (SHARED === S) SHARED = null; }
    this.skeleton.dispose();
  }
  headWorldPosition(out) {
    const hb = this.bones[BI.head];
    this.root.updateWorldMatrix(true, false);
    hb.updateWorldMatrix(true, false);
    return out.copy(FACE_OFF).applyMatrix4(hb.matrixWorld);
  }
  eyeWorldPosition(out) { return this.headWorldPosition(out); }
  static get stats() { const S = SHARED; return S ? { tris: S.tris, buildMs: S.buildMs, bones: NB, parts: COUNTS } : null; }

  // ------------------------------------------------------------------ animation
  update(dt, state) {
    dt = clamp(dt || 0, 0, 0.1);
    const st = state || {};
    const mode = MODES[st.mode] ? st.mode : 'idle';
    const speed = Math.max(0, st.speed || 0);
    const twitch = clamp(st.twitch || 0, 0, 1);
    const light = clamp(st.light || 0, 0, 1);
    const P = this.P, T = MODES[mode];
    this.time += dt;

    // --- parameter smoothing
    for (let pi = 0; pi < PARAMS.length; pi++) {
      const k = PARAMS[pi];
      let tgt = T[k] || 0;
      if (k === 'run') tgt = Math.max(tgt, sstep(2.4, 3.8, speed));
      const rate = k === 'jaw' ? (tgt > P[k] ? 0 : 6) : k === 'lurk' ? 7 : k === 'shake' || k === 'tremor' ? 10 : 3.2;
      if (k === 'jaw') continue;
      P[k] += (tgt - P[k]) * (1 - Math.exp(-dt * rate));
    }
    // jaw: underdamped spring so it tears open with an overshoot
    {
      const tgt = T.jaw || 0;
      const k = tgt > 0.5 ? 260 : 90, c = tgt > 0.5 ? 14 : 16;
      this.jawV += (k * (tgt - P.jaw) - c * this.jawV) * dt;
      P.jaw += this.jawV * dt;
    }
    const gTarget = speed > 0.05 ? 1 : 0;
    this.gait += (gTarget - this.gait) * (1 - Math.exp(-dt * (gTarget ? 5 : 3)));
    this.anim += dt * (1 - P.lurk);
    this.lurkT = mode === 'lurk' ? this.lurkT + dt : 0;

    // --- look target in root space
    this._hasLook = false;
    if (st.lookAt) {
      this.root.updateWorldMatrix(true, false);
      this._invRoot.copy(this.root.matrixWorld).invert();
      this._look.copy(st.lookAt).applyMatrix4(this._invRoot);
      this._hasLook = true;
    }

    // --- eyeshine (retro-reflection: only lit when the flashlight hits it)
    this.shine += (light - this.shine) * (1 - Math.exp(-dt * 18));
    let flick = 1;
    if (twitch > 0 && Math.random() < dt * twitch * 3) flick = 0.2;
    this.eyeMat.uniforms.uI.value = Math.pow(this.shine, 1.4) * 16 * flick;

    // --- twitch: random bone jerks + whole-pose frame skips
    const tw = twitch + P.tremor * 0.3;
    const jd = Math.exp(-dt * 16);
    for (let i = 0; i < this.jerk.length; i++) this.jerk[i] *= jd;
    if (P.lurk < 0.5 && Math.random() < dt * (0.4 + tw * 5)) {
      const pool = JERK_POOL;
      const b = pool[(Math.random() * pool.length) | 0];
      const amp = (0.06 + tw * 0.35) * (b === BI.head ? 1.3 : 1);
      this.jerk[b * 3] += (Math.random() - 0.5) * amp; this.jerk[b * 3 + 1] += (Math.random() - 0.5) * amp; this.jerk[b * 3 + 2] += (Math.random() - 0.5) * amp;
      if (b === BI.head && Math.random() < 0.3) this.tiltT = -this.tiltT; // head flips its broken angle
    }
    let skip = false;
    if (this.hold > 0) { this.hold -= dt; skip = this.hold > 0; }
    else if (twitch > 0.05 && P.lurk < 0.5 && Math.random() < dt * twitch * 1.1) { this.hold = 0.05 + Math.random() * (0.08 + 0.18 * twitch); skip = true; }

    this._simulate(dt, speed, twitch, mode);
    if (!skip) this._applyPose();
  }

  _simulate(dt, speed, twitch, mode) {
    const P = this.P, wq = this.wq, wp = this.wp, run = P.run, stoop = P.stoop;
    const t = this.anim;

    // ---------------- gait
    const freq = 0.55 + 0.21 * speed;
    const duty = mix(0.62, 0.42, run);
    const hitch = Math.exp(-sq(((this.phase % 1) - 0.04) / 0.045)) * (1 - run * 0.7);
    if (speed > 0.05) this.phase += dt * freq * (1 - 0.6 * hitch);
    const L = speed > 0.05 ? clamp(speed * duty / freq, 0.2, 1.3) : 0.3;
    const lift = mix(0.1, 0.24, run);
    for (let f = 0; f < 2; f++) {
      const ft = this.feet[f];
      const lp = (this.phase + f * 0.5) % 1;
      if (this.gait > 0.02 && speed > 0.05) {
        if (lp < duty) {
          if (!ft.planted) ft.planted = true;
          ft.z -= speed * dt; ft.y = 0; ft.sw = 0;
        } else {
          if (ft.planted) { ft.planted = false; ft.liftZ = ft.z; }
          const s = (lp - duty) / (1 - duty);
          const e = s * s * (3 - 2 * s);
          ft.z = mix(ft.liftZ, L * 0.5, e);
          ft.y = lift * Math.sin(Math.PI * s) * (0.7 + 0.3 * Math.sin(Math.PI * s));
          ft.sw = s;
        }
        ft.z = clamp(ft.z, -L * 0.75, L * 0.75);
      } else {
        // settle to a staggered stance
        const rest = f === 0 ? 0.07 : -0.06;
        ft.z += (rest - ft.z) * (1 - Math.exp(-dt * 6)); ft.y *= Math.exp(-dt * 10); ft.planted = true; ft.sw = 0;
      }
    }
    const g = this.gait;
    const ph2 = this.phase * Math.PI * 2;

    // ---------------- lean toward the look target in reach / scream
    let leanT = 0;
    if (this._hasLook && (P.reach > 0.01 || P.jaw > 0.01)) {
      const drop = clamp((2.25 - this._look.y) / 0.85, 0, 1);
      leanT = drop * Math.max(P.reach * 0.8, clamp(P.jaw, 0, 1));
    }
    this.lean += (leanT - this.lean) * (1 - Math.exp(-dt * 6));
    const lean = this.lean;

    // ---------------- hips
    const bob = g * (0.018 + 0.03 * run) * Math.cos(ph2 * 2);
    const drop = 0.03 + g * mix(0.075, 0.2, run) + stoop * 0.13 + lean * 0.12;
    const breath = Math.sin(t * 1.3) * (1 - P.lurk);
    const sway = (Math.sin(t * 0.37) * 0.012 + Math.sin(t * 0.91) * 0.006) * (1 - g) * (1 - P.lurk);
    const tremor = P.tremor;
    wp[0].set(BIND[0].x + sway + g * Math.sin(ph2) * mix(0.025, 0.06, run), BIND[0].y - drop + bob, BIND[0].z - lean * 0.12 - run * 0.1);
    if (tremor > 0.01) wp[0].x += (Math.random() - 0.5) * 0.012 * tremor;
    _e.set(0.1 * stoop + 0.38 * run + 0.25 * lean, g * Math.sin(ph2) * mix(0.12, 0.22, run), g * Math.cos(ph2) * mix(0.05, 0.12, run) + sway * 2, 'YXZ');
    wq[0].setFromEuler(_e);
    this._jerk(0, 0);

    // ---------------- spine
    const lurch = run * Math.sin(ph2 + 0.8) * 0.16;
    this._chain(BI.spine1, 0.12 * stoop + 0.1 * run + 0.18 * lean + 0.02 * breath, -g * Math.sin(ph2) * 0.09, lurch * 0.5 - g * Math.cos(ph2) * 0.03);
    this._chain(BI.spine2, 0.24 * stoop + 0.12 * run + 0.3 * lean, -g * Math.sin(ph2) * 0.08, lurch * 0.4 + 0.03);
    this._chain(BI.chest, 0.3 * stoop + 0.1 * run + 0.3 * lean - 0.015 * breath - 0.12 * P.spread, -g * Math.sin(ph2) * 0.05, lurch * 0.3 - 0.02);
    if (tremor > 0.01) for (let bi = BI.spine1; bi <= BI.chest; bi++) { const b = bi; _e.set((Math.random() - 0.5) * 0.05 * tremor, (Math.random() - 0.5) * 0.05 * tremor, (Math.random() - 0.5) * 0.05 * tremor); _q.setFromEuler(_e); wq[b].multiply(_q); }

    // ---------------- head look (snappy saccades; lurk = glacial)
    const hp = this.lastHead;
    let dy = 0, dpch = -0.12 + 0.2 * stoop;
    if (this._hasLook) {
      _v.copy(this._look).sub(hp);
      dy = Math.atan2(_v.x, _v.z);
      dpch = -Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    } else {
      dy = Math.sin(t * 0.21) * 0.3 + Math.sin(t * 0.07) * 0.4;
    }
    // unwrap yaw relative to current
    while (dy - this.hy > Math.PI) dy -= Math.PI * 2;
    while (dy - this.hy < -Math.PI) dy += Math.PI * 2;
    dy = clamp(dy, -2.8, 2.8); dpch = clamp(dpch, -1.2, 1.1);
    if (P.lurk > 0.5) {
      const k = 1 - Math.exp(-dt * 0.45);
      this.hy += (dy - this.hy) * k; this.hp += (dpch - this.hp) * k;
      this.thy = this.hy; this.thp = this.hp;
    } else {
      this.sacc -= dt;
      const err = Math.abs(dy - this.thy) + Math.abs(dpch - this.thp);
      if (this.sacc <= 0 || err > 0.5 || P.jaw > 0.3) {
        this.thy = dy + (Math.random() - 0.5) * 0.08; this.thp = dpch + (Math.random() - 0.5) * 0.06;
        this.sacc = P.jaw > 0.3 ? 0 : 0.18 + Math.random() * (0.9 - 0.6 * twitch);
      }
      const k = 1 - Math.exp(-dt * (P.jaw > 0.3 ? 30 : 24));
      this.hy += (this.thy - this.hy) * k; this.hp += (this.thp - this.hp) * k;
    }
    // broken tilt
    this.tilt += (this.tiltT - this.tilt) * (1 - Math.exp(-dt * 20));
    let roll = this.tilt;
    if (P.lurk > 0.01) roll += Math.sign(this.tilt) * P.lurk * (0.35 * (1 - Math.cos(this.lurkT * 0.22)));
    let shY = 0, shP = 0, shR = 0;
    if (P.shake > 0.01) {
      const tt = this.time;
      shY = P.shake * (Math.sin(tt * 47) * 0.12 + Math.sin(tt * 71 + 1) * 0.08 + (Math.random() - 0.5) * 0.12);
      shP = P.shake * (Math.sin(tt * 53 + 2) * 0.06 + (Math.random() - 0.5) * 0.08);
      shR = P.shake * (Math.sin(tt * 39 + 3) * 0.15 + (Math.random() - 0.5) * 0.1);
    }
    _e.set(this.hp + shP, this.hy + shY, roll + shR, 'YXZ');
    _q3.setFromEuler(_e);                    // desired head orientation (root space)
    // neck: blend chest -> head
    const stretch = 1 + 0.28 * clamp(P.jaw, 0, 1.2) + 0.08 * P.reach;
    this._slerpBone(BI.neck1, BI.chest, _q3, 0.28, 1);
    this._slerpBone(BI.neck2, BI.neck1, _q3, 0.55, stretch);
    wq[BI.head].copy(_q3); this._jerk(BI.head, BI.neck2);
    this._pos(BI.head, stretch);
    // jaw
    const J = P.jaw;
    this.jawX = -0.165 + clamp(J, -0.2, 1.3) * 1.3 + (J > 0.2 ? (Math.random() - 0.5) * 0.08 * J : 0);
    _q.setFromAxisAngle(X_AXIS, this.jawX);
    wq[BI.jaw].copy(wq[BI.head]).multiply(_q);
    this.lp[BI.jaw].set(OFF[BI.jaw].x, OFF[BI.jaw].y - 0.075 * clamp(J, 0, 1.3), OFF[BI.jaw].z + 0.01 * clamp(J, 0, 1.3));
    this.jawScale = 1 + 0.3 * clamp(J, 0, 1.3);
    _v.copy(this.lp[BI.jaw]).applyQuaternion(wq[BI.head]);
    wp[BI.jaw].copy(wp[BI.head]).add(_v);
    // remember face position for next frame's look direction
    _v.copy(FACE_OFF).applyQuaternion(wq[BI.head]); hp.copy(wp[BI.head]).add(_v);

    // ---------------- arms
    for (let si = 0; si < 2; si++) {
      const sg = si === 0 ? 1 : -1, s = si === 0 ? 'L' : 'R';
      const ar = this.arms[si];
      const cl = BI['clav' + s], ua = BI['uarm' + s], fa = BI['farm' + s], hd = BI['hand' + s];
      // clavicle: hunched forward, shrug in scream/reach
      const shrug = 0.12 * P.spread + 0.12 * P.reach - 0.04 * stoop + (si === 0 ? -0.05 : 0.03);
      _e.set(0, -sg * (0.12 * stoop + 0.1 * run + 0.15 * P.reach), sg * shrug);
      _q.setFromEuler(_e); wq[cl].copy(wq[BI.chest]).multiply(_q); this._jerk(cl, BI.chest); this._pos(cl, 1);
      this._pos(ua, 1);
      // pendulum swing (counter to the legs), lagging and underdamped
      const oppZ = this.feet[1 - si].z;
      const swingT = g * clamp(oppZ * mix(0.55, 0.9, run), -0.6, 0.6) + (1 - g) * 0.02 + run * 0.15;
      const k = 26, c = mix(3.2, 4.5, P.lurk);
      const acc = k * (swingT - ar.a) - c * ar.v;
      ar.v += acc * dt; ar.a += ar.v * dt;
      if (P.lurk > 0.9) { ar.v *= Math.exp(-dt * 10); }
      // forearm lag
      const eT = 0.18 + 0.12 * stoop + run * 0.35 + (twitch * 0.1) * Math.sin(this.time * 13 + si);
      ar.ev += (60 * (eT - ar.e) - 7 * ar.ev - acc * 0.35) * dt; ar.e += ar.ev * dt; ar.e = clamp(ar.e, -0.12, 2.2);
      // hanging direction in root space
      const ab = 0.07 + 0.05 * run;
      _v.set(sg * Math.sin(ab), -Math.cos(ab) * Math.cos(ar.a), Math.cos(ab) * Math.sin(ar.a)).normalize();
      // reach: point the arms at the target
      const reachW = si === 0 ? P.reach : this.reachLag;
      if (reachW > 0.001) {
        if (this._hasLook) _v2.copy(this._look).sub(wp[ua]); else _v2.set(sg * 0.1, 0.25, 1);
        _v2.normalize(); _v2.x += sg * 0.32; _v2.y += 0.05 * Math.sin(this.time * 0.9 + si * 2); _v2.normalize();
        _v.lerp(_v2, reachW).normalize();
      }
      if (P.spread > 0.001) {
        _v2.set(sg * 0.92, 0.22, 0.38).normalize();
        _v.lerp(_v2, clamp(P.spread, 0, 1)).normalize();
      }
      // upper arm orientation
      _q.setFromUnitVectors(si === 0 ? A_L : A_R, _v);
      // twist: palms turn down/forward in reach
      _q2.setFromAxisAngle(_v, sg * (0.9 * reachW + 0.5 * P.spread));
      wq[ua].copy(_q2).multiply(_q);
      this._jerk(ua, -1);
      // forearm: bend around the elbow toward the front
      const bend = mix(ar.e, 0.35, reachW) * (1 - 0.3 * P.spread) + 0.5 * P.spread;
      _v2.copy(Z_AXIS).applyQuaternion(wq[ua]);  // bend direction
      _v3.copy(_v).multiplyScalar(Math.cos(bend)).addScaledVector(_v2, Math.sin(bend)).normalize();
      _q.setFromUnitVectors(_v, _v3);
      wq[fa].copy(_q).multiply(wq[ua]); this._jerk(fa, -1);
      this._pos(fa, 1);
      // hand: slight droop, cocked back in reach/scream
      const wrist = 0.12 + 0.06 * Math.sin(t * 0.8 + si) - 0.7 * reachW - 0.6 * P.spread;
      _v4.copy(si === 0 ? PALM_L : PALM_R).applyQuaternion(wq[fa]);
      _v5.copy(_v3).multiplyScalar(Math.cos(wrist)).addScaledVector(_v4, Math.sin(wrist)).normalize();
      _q.setFromUnitVectors(_v3, _v5);
      wq[hd].copy(_q).multiply(wq[fa]); this._jerk(hd, -1);
      this._pos(hd, 1);
      if (tremor > 0.01) { _e.set((Math.random() - 0.5) * 0.06 * tremor, (Math.random() - 0.5) * 0.06 * tremor, (Math.random() - 0.5) * 0.06 * tremor); _q.setFromEuler(_e); wq[ua].premultiply(_q); wq[fa].premultiply(_q); wq[hd].premultiply(_q); }
    }
    this.reachLag += (this.P.reach - this.reachLag) * (1 - Math.exp(-dt * 1.6));

    // ---------------- legs (2-bone IK in root space)
    this.hipsY = wp[0].y;
    for (let si = 0; si < 2; si++) {
      const sg = si === 0 ? 1 : -1, s = si === 0 ? 'L' : 'R';
      const th = BI['thigh' + s], sh = BI['shin' + s], ft = BI['foot' + s], to = BI['toes' + s];
      const F = this.feet[si];
      this._pos(th, 1);
      const H = wp[th];
      // ankle target
      _v.set(ANK[0] * sg + sg * 0.02 * run, ANK[1] + F.y, F.z + ANK[2] - 0.02 - 0.12 * run);
      _v2.copy(_v).sub(H);
      let d = _v2.length();
      const maxL = (L_THIGH + L_SHIN) * 0.999;
      if (d > maxL) { _v2.multiplyScalar(maxL / d); d = maxL; }
      d = Math.max(d, 0.25);
      _v2.normalize();                                     // hip -> ankle dir
      const cosA = clamp((L_THIGH * L_THIGH + d * d - L_SHIN * L_SHIN) / (2 * L_THIGH * d), -1, 1);
      const A = Math.acos(cosA);
      // pole: forward (+z) slightly outward, rotated with the hips' yaw
      _v3.set(sg * 0.12, 0, 1).applyQuaternion(wq[0]);
      _v3.addScaledVector(_v2, -_v3.dot(_v2)).normalize();
      _v4.copy(_v2).multiplyScalar(Math.cos(A)).addScaledVector(_v3, Math.sin(A)).normalize(); // thigh dir
      _q.setFromUnitVectors(THIGH_BIND, _v4);
      // twist so the bind +z maps onto the pole
      _v5.copy(Z_AXIS).applyQuaternion(_q); _v5.addScaledVector(_v4, -_v5.dot(_v4)).normalize();
      const tw2 = Math.atan2(_v.copy(_v5).cross(_v3).dot(_v4), _v5.dot(_v3));
      _q2.setFromAxisAngle(_v4, tw2);
      wq[th].copy(_q2).multiply(_q);
      // knee position and shin
      _v5.copy(H).addScaledVector(_v4, L_THIGH);
      wp[sh].copy(_v5);
      _v.copy(_v2).multiplyScalar(d).add(H).sub(_v5).normalize(); // shin dir
      _v4.copy(SHIN_BIND).applyQuaternion(wq[th]);                // current shin dir after thigh
      _q.setFromUnitVectors(_v4, _v);
      wq[sh].copy(_q).multiply(wq[th]);
      this._pos(ft, 1);
      // foot: planted flat on its ball, toes down during swing
      const fp = F.sw > 0 ? Math.sin(Math.PI * F.sw) * mix(0.35, 0.6, run) + 0.1 : 0;
      _e.set(fp, 0.5 * g * Math.sin(ph2) * 0.2 + sg * 0.06, 0, 'YXZ');
      wq[ft].setFromEuler(_e);
      this._pos(to, 1);
      const toeCurl = 0.25 * P.lurk + 0.15 + (F.sw > 0 ? 0.35 * Math.sin(Math.PI * F.sw) : 0) - 0.15 * P.tremor;
      _q.setFromAxisAngle(X_AXIS, toeCurl);
      wq[to].copy(wq[ft]).multiply(_q);
    }

    // ---------------- fingers (local rotations, set directly)
    for (let si = 0; si < 2; si++) {
      const s = si === 0 ? 'L' : 'R';
      const curlAxis = si === 0 ? CURL_L : CURL_R, palm = si === 0 ? PALM_L : PALM_R;
      for (let f = 0; f < 4; f++) {
        let n = this.fingerN[si * 4 + f];
        // restless fingers: slow drift + twitchy flicks (frozen in lurk)
        const live = 1 - P.lurk;
        n += (Math.sin(t * (1.1 + f * 0.37) + si * 3 + f) * 0.5 - n) * dt * 2 * live;
        if (live > 0.5 && Math.random() < dt * (0.3 + twitch * 2.5)) n += (Math.random() - 0.3) * 1.2;
        n *= Math.exp(-dt * 3 * live);
        this.fingerN[si * 4 + f] = n;
        const base = 0.22 + 0.1 * f * 0.3 + 0.15 * stoop * 0 + n * 0.25;
        const grasp = P.reach * (0.25 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * 2.2 + f * 0.7 + si)));
        const curl = mix(base, grasp, P.reach) * (1 - clamp(P.spread, 0, 1)) - 0.28 * clamp(P.spread, 0, 1) + (P.lurk * 0.15);
        const spread = (FZ[f] / 0.027) * (0.05 + 0.3 * P.reach + 0.4 * P.spread);
        for (let k = 0; k < 3; k++) {
          const bi = BI[`f${f}${k}${s}`];
          const c = curl * (k === 0 ? 0.9 : k === 1 ? 1.2 : 0.9) + (P.tremor > 0.01 ? (Math.random() - 0.5) * 0.2 * P.tremor : 0);
          _q.setFromAxisAngle(curlAxis, c);
          if (k === 0) { _q2.setFromAxisAngle(palm, spread * (si === 0 ? 1 : -1)); _q.multiply(_q2); }
          this.lq[bi].copy(_q);
        }
      }
    }
  }

  // helpers ----------------------------------------------------------
  _pos(b, stretch) {
    const p = BONES[b].parent;
    this.wp[b].copy(OFF[b]).multiplyScalar(stretch).applyQuaternion(this.wq[p]).add(this.wp[p]);
    this.lp[b].copy(OFF[b]).multiplyScalar(stretch);
  }
  _chain(b, pitch, yaw, roll) {
    const p = BONES[b].parent;
    _e.set(pitch, yaw, roll, 'YXZ'); _q.setFromEuler(_e);
    this.wq[b].copy(this.wq[p]).multiply(_q);
    this._jerk(b, p);
    this._pos(b, 1);
  }
  _slerpBone(b, from, target, t, stretch) {
    this.wq[b].copy(this.wq[from]).slerp(target, t);
    this._jerk(b, from);
    this._pos(b, stretch);
  }
  _jerk(b) {
    const j = this.jerk, i = b * 3;
    if (Math.abs(j[i]) + Math.abs(j[i + 1]) + Math.abs(j[i + 2]) < 1e-4) return;
    _e.set(j[i], j[i + 1], j[i + 2]); _q2.setFromEuler(_e);
    this.wq[b].multiply(_q2);
  }

  _applyPose() {
    const B = this.bones, wq = this.wq;
    // hips
    B[0].position.copy(this.wp[0]); B[0].quaternion.copy(wq[0]);
    for (let i = 1; i < NB; i++) {
      const name = BONES[i].name;
      if (name[0] === 'f' && name.length === 4) { B[i].quaternion.copy(this.lq[i]); continue; }  // fingers: local
      const p = BONES[i].parent;
      B[i].quaternion.copy(wq[p]).invert().multiply(wq[i]);
      B[i].position.copy(this.lp[i]);
    }
    B[BI.jaw].scale.set(1, this.jawScale, 1 + (this.jawScale - 1) * 0.5);
  }
}

export function createEntityModel() { return new EntityModel(); }
export { EntityModel };
