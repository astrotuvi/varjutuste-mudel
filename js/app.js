import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import {
  DEG, RE_KM, R_SUN, R_MOON, EARTH_SHADOW_ENLARGE, DELTA_T, OBLIQ, jdFromMs, msFromJd, moonEcl, moonOrbit, eclVec, v3, wrapPi, sceneToEarth, stateAt, solarStatus, lunarStatus, findPhase, solarEclipseAt, lunarEclipseAt, findSolarEclipse, findLunarEclipse,
} from './ephem.js';

const EARTH_TEX = 'textures/earth.jpg';
const MEAN_MOON_RE = 384400 / RE_KM;

// ---------------------------------------------------------------- state
const S = {
  jd: 0, playing: false, speed: 10 / 1440, frame: 'sun', Dd: MEAN_MOON_RE,
  view: 'overview', tracking: true, zoom: 1, zoomGoal: 1,
  anchor: null,   // Sun direction kept by the overview views in the star-fixed frame (null: take the current one)
  show: { cones: true, orbit: true, plane: true, nodes: true, hi: true, labels: true, earthSh: true },
};

// ---------------------------------------------------------------- renderer
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03050a);
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 30000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.02;
controls.maxDistance = 2000;
controls.addEventListener('start', () => { S.tracking = false; markView(null); });

const root = new THREE.Group();   // ecliptic frame; rotated for the Sun-fixed view
scene.add(root);

const vec = a => new THREE.Vector3(a[0], a[1], a[2]);

// ---------------------------------------------------------------- colour schemes
// [hex, opacity] for lines and surfaces; plain RGB for vertex and shader colours (shown as given).
// Dark hex values go through the usual sRGB conversion; light ones are shown exactly as written.
const THEMES = {
  dark: {
    bg: 0x03050a, linearHex: false, stars: true, tartu: 0xffe08a,
    eclDisc: [0x8aa0c8, 0.045], grid: [0x5a6a8c, 0.35], spokes: [0x5a6a8c, 0.18], ring: [0xf3c56b, 0.55],
    seasonOuter: [0xf3c56b, 0.16], seasonInner: [0xf3c56b, 0.3], node: [0xc3a3ff, 0.9], sunLine: [0xf3c56b, 0.55],
    orbitN: [0.56, 0.85, 0.94], orbitS: [0.24, 0.42, 0.51], planeAlpha: 0.12, planeRim: [0x8ed8ef, 0.45], drop: [0x8ed8ef, 0.6],
    cones: { ePen: [0x8fb3ff, 0.025], eUmb: [0xc4554a, 0.08], mPen: [0x8fb3ff, 0.05], mAnt: [0xffb347, 0.14], mUmb: [0xff6a4a, 0.3] },
    sun: { additive: true, stops: [[0, 'rgba(255,250,235,1)'], [0.12, 'rgba(255,240,200,1)'], [0.2, 'rgba(255,205,120,0.55)'], [0.5, 'rgba(255,170,80,0.12)'], [1, 'rgba(255,150,60,0)']] },
  },
  light: {
    bg: 0xeef1f6, linearHex: true, stars: false, tartu: 0xc0392b,
    eclDisc: [0x5a6f9a, 0.07], grid: [0x8592ad, 0.5], spokes: [0x8592ad, 0.3], ring: [0xc98a12, 0.8],
    seasonOuter: [0xe0a020, 0.2], seasonInner: [0xe0a020, 0.36], node: [0x7a4fd6, 1], sunLine: [0xc98a12, 0.7],
    orbitN: [0.0, 0.42, 0.58], orbitS: [0.52, 0.69, 0.77], planeAlpha: 0.1, planeRim: [0x1f6f8b, 0.55], drop: [0x006b94, 0.6],
    cones: { ePen: [0x3b67c4, 0.04], eUmb: [0x9c2f25, 0.1], mPen: [0x3b67c4, 0.07], mAnt: [0xd98a10, 0.2], mUmb: [0xd2401f, 0.35] },
    sun: { additive: false, stops: [[0, 'rgba(255,236,170,1)'], [0.12, 'rgba(250,190,70,1)'], [0.22, 'rgba(245,160,40,0.5)'], [0.5, 'rgba(240,150,40,0.12)'], [1, 'rgba(240,150,40,0)']] },
  },
};
let TH = THEMES.dark;
const bgRGB = new THREE.Color();
const transp = { transparent: true, depthWrite: false };
const MAT = {
  eclDisc: new THREE.MeshBasicMaterial({ ...transp, side: THREE.DoubleSide }),
  grid: new THREE.LineBasicMaterial(transp), spokes: new THREE.LineBasicMaterial(transp), ring: new THREE.LineBasicMaterial(transp),
  seasonOuter: new THREE.MeshBasicMaterial({ ...transp, side: THREE.DoubleSide }),
  seasonInner: new THREE.MeshBasicMaterial({ ...transp, side: THREE.DoubleSide }),
  node: new THREE.LineBasicMaterial(transp), nodeMarker: new THREE.MeshBasicMaterial(),
  sunLine: new THREE.LineDashedMaterial({ ...transp, dashSize: 0.02, gapSize: 0.015 }),
  planeRim: new THREE.LineBasicMaterial(transp), drop: new THREE.LineBasicMaterial(transp),
  tartu: new THREE.MeshBasicMaterial(),
};

// ---------------------------------------------------------------- shaders
const OVERLAP_GLSL = `
float overlap(float r1, float r2, float d) {   // fraction of disc r1 covered by disc r2
  if (d >= r1 + r2) return 0.0;
  if (d <= abs(r1 - r2)) return r2 >= r1 ? 1.0 : (r2 * r2) / (r1 * r1);
  float a = clamp((d * d + r1 * r1 - r2 * r2) / (2.0 * d * r1), -1.0, 1.0);
  float b = clamp((d * d + r2 * r2 - r1 * r1) / (2.0 * d * r2), -1.0, 1.0);
  float k = max(0.0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return (r1 * r1 * acos(a) + r2 * r2 * acos(b) - 0.5 * sqrt(k)) / (3.14159265 * r1 * r1);
}`;

const earthTex = new THREE.TextureLoader().load(EARTH_TEX, () => { needsRender = true; });
earthTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

const earthMat = new THREE.ShaderMaterial({
  uniforms: {
    uMap: { value: earthTex }, uLocal: { value: new THREE.Matrix4() },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunDist: { value: 23455 },
    uMoon: { value: new THREE.Vector3(60, 0, 0) }, uRs: { value: R_SUN }, uRm: { value: R_MOON },
    uHi: { value: 1 },
  },
  vertexShader: `
    uniform mat4 uLocal; varying vec3 vRoot; varying vec2 vUv;
    void main() { vUv = uv; vRoot = (uLocal * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D uMap; uniform vec3 uSunDir; uniform float uSunDist; uniform vec3 uMoon;
    uniform float uRs, uRm, uHi; varying vec3 vRoot; varying vec2 vUv;
    ${OVERLAP_GLSL}
    void main() {
      vec3 N = normalize(vRoot);
      vec3 tex = texture2D(uMap, vUv).rgb;
      float mu = dot(N, uSunDir);
      float day = smoothstep(-0.04, 0.06, mu);
      vec3 Sv = uSunDir * uSunDist - N, Mv = uMoon - N;
      float rs = asin(uRs / length(Sv)), rm = asin(uRm / length(Mv));
      float sep = atan(length(cross(Sv, Mv)), dot(Sv, Mv));
      float cov = overlap(rs, rm, sep);
      float light = day * (0.5 + 0.5 * max(mu, 0.0));
      vec3 col = tex * (0.07 + light * (1.0 - cov)) + vec3(0.004, 0.007, 0.016);
      if (uHi > 0.5 && cov > 0.0 && mu > -0.04) {
        float mag = (rs + rm - sep) / (2.0 * rs);
        col = mix(col, col * vec3(0.78, 0.74, 1.2), 0.7 * day);
        float m5 = mag * 5.0;
        float dl = abs(fract(m5 + 0.5) - 0.5);
        float ln = 1.0 - smoothstep(0.0, 1.3 * fwidth(m5), dl);
        col = mix(col, vec3(0.72, 0.78, 1.0), 0.75 * ln * day);
        if (sep < abs(rm - rs)) col = rm > rs ? vec3(1.0, 0.25, 0.14) : mix(col, vec3(1.0, 0.62, 0.18), 0.85);
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
});

const moonMat = new THREE.ShaderMaterial({
  uniforms: {
    uLocal: { value: new THREE.Matrix4() }, uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uSunDist: { value: 23455 }, uMoonReal: { value: new THREE.Vector3() }, uMoonDisp: { value: new THREE.Vector3() },
    uRs: { value: R_SUN }, uRe: { value: EARTH_SHADOW_ENLARGE },
  },
  vertexShader: `
    uniform mat4 uLocal; varying vec3 vRoot; varying vec3 vObj;
    void main() { vObj = normalize(position); vRoot = (uLocal * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform vec3 uSunDir, uMoonReal, uMoonDisp; uniform float uSunDist, uRs, uRe;
    varying vec3 vRoot; varying vec3 vObj;
    ${OVERLAP_GLSL}
    float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float noise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
    float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
    void main() {
      vec3 N = normalize(vRoot - uMoonDisp);
      vec3 P = uMoonReal + (vRoot - uMoonDisp);
      float mu = max(dot(N, uSunDir), 0.0);
      vec3 Sv = uSunDir * uSunDist - P, Ev = -P;
      float rs = asin(uRs / length(Sv)), re = asin(uRe / length(Ev));
      float cov = overlap(rs, re, atan(length(cross(Sv, Ev)), dot(Sv, Ev)));
      float maria = smoothstep(0.5, 0.62, fbm(vObj * 1.7 + vec3(3.1, 0.7, 1.9)) * (0.6 + 0.6 * max(vObj.z, 0.0)));
      vec3 alb = vec3(0.66, 0.65, 0.62) * (0.8 + 0.35 * fbm(vObj * 9.0)) * mix(1.0, 0.58, maria);
      vec3 col = alb * (0.025 + 1.05 * mu * (1.0 - cov));
      col += alb * vec3(0.30, 0.085, 0.03) * smoothstep(0.9, 1.0, cov) * (0.35 + 0.65 * mu);
      gl_FragColor = vec4(col, 1.0);
    }`,
});

const atmoMat = new THREE.ShaderMaterial({
  uniforms: { uSunW: { value: new THREE.Vector3(1, 0, 0) } },
  vertexShader: `varying vec3 vN; varying vec3 vW;
    void main() { vN = normalize(mat3(modelMatrix) * normal); vW = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
  fragmentShader: `uniform vec3 uSunW; varying vec3 vN; varying vec3 vW;
    void main() { vec3 V = normalize(cameraPosition - vW); float f = pow(1.0 - max(dot(vN, V), 0.0), 3.0);
      float lit = smoothstep(-0.25, 0.35, dot(vN, uSunW)); gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * f * lit * 0.9, 1.0); }`,
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
});

// ---------------------------------------------------------------- bodies
const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), earthMat);
earth.matrixAutoUpdate = false;
root.add(earth);
const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 48), atmoMat);
root.add(atmo);

const moon = new THREE.Mesh(new THREE.SphereGeometry(R_MOON, 96, 48), moonMat);
moon.matrixAutoUpdate = false;
root.add(moon);

// Tartu marker (Earth-fixed)
const TARTU = { lat: 58.378 * DEG, lon: 26.729 * DEG };
const tartuLocal = new THREE.Vector3(Math.cos(TARTU.lat) * Math.cos(TARTU.lon), Math.sin(TARTU.lat), -Math.cos(TARTU.lat) * Math.sin(TARTU.lon));
const tartuDot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), MAT.tartu);
tartuDot.position.copy(tartuLocal);
earth.add(tartuDot);

// Central line of the current eclipse (Earth-fixed, child of the Earth mesh)
const trackMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
let track = null, trackKey = null;
function setTrack(e) {
  const key = e ? e.jd.toFixed(4) : null;
  if (key === trackKey) return;
  trackKey = key;
  if (track) { earth.remove(track); track.geometry.dispose(); track = null; }
  if (!e) return;
  const pos = [], col = [];
  let prev = null;
  for (let j = e.jd - 0.18; j <= e.jd + 0.18; j += 1 / 1440) {
    const s = stateAt(j);
    if (!s.ms.surf) { prev = null; continue; }
    const p = v3.mul(sceneToEarth(s.ms.surf, s.gmst), 1.002);
    const c = s.ms.ruSurf > 0 ? [1, 0.36, 0.22] : [1, 0.72, 0.3];
    if (prev) { pos.push(...prev.p, ...p); col.push(...prev.c, ...c); }
    prev = { p, c };
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  track = new THREE.LineSegments(g, trackMat);
  earth.add(track);
}

// Sun
function glowTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
const sunTex = { dark: glowTexture(THEMES.dark.sun.stops), light: glowTexture(THEMES.light.sun.stops) };
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex.dark, depthWrite: false, transparent: true }));
root.add(sunSprite);

// Stars
let stars;
{
  const n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pos.set([r * Math.cos(a) * 9000, z * 9000, r * Math.sin(a) * 9000], i * 3);
    const b = 0.25 + Math.pow(Math.random(), 4) * 0.75, t = Math.random();
    col.set([b * (0.85 + 0.15 * t), b * 0.9, b * (1.05 - 0.2 * t)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true }));
  root.add(stars);
}

// ---------------------------------------------------------------- ecliptic, nodes, seasons
const ecl = new THREE.Group();     // unit radius, scaled to the Sun-ring radius
root.add(ecl);
const flat = g => { g.rotateX(-Math.PI / 2); return g; };
ecl.add(new THREE.Mesh(flat(new THREE.CircleGeometry(1, 160)),
  MAT.eclDisc));
function circlePts(r, n = 256) { const p = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; p.push(new THREE.Vector3(r * Math.cos(a), 0, -r * Math.sin(a))); } return p; }
{
  for (const r of [0.25, 0.5, 0.75]) ecl.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts(r)), MAT.grid));
  const spokes = [];
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; spokes.push(new THREE.Vector3(0.12 * Math.cos(a), 0, -0.12 * Math.sin(a)), new THREE.Vector3(Math.cos(a), 0, -Math.sin(a))); }
  ecl.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(spokes), MAT.spokes));
  ecl.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts(1)), MAT.ring));
}
const nodes = new THREE.Group();   // rotated to the ascending node
ecl.add(nodes);
{
  const arc = (half, inner, mat) => {
    for (const c of [0, Math.PI]) nodes.add(new THREE.Mesh(flat(new THREE.RingGeometry(inner, 1.0, 48, 1, c - half, 2 * half)), mat));
  };
  arc(18.5 * DEG, 0.9, MAT.seasonOuter);
  arc(10.5 * DEG, 0.9, MAT.seasonInner);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.04, 0, 0), new THREE.Vector3(1.04, 0, 0)]),
    MAT.node);
  nodes.add(line);
}
const nodeMarkers = [0, 1].map(i => {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), MAT.nodeMarker);
  root.add(m); return m;
});

// Sun line
const sunLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
  MAT.sunLine);
sunLine.computeLineDistances();
root.add(sunLine);

// Moon orbit trail (true computed path ± half a sidereal month)
const TRAIL_N = 241;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
trail.frustumCulled = false;
root.add(trail);
// Moon's orbital plane, coloured north/south of the ecliptic like the trail
const planeMat = new THREE.ShaderMaterial({
  uniforms: { uN: { value: new THREE.Vector4() }, uS: { value: new THREE.Vector4() } },
  vertexShader: `varying float vY;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform vec4 uN, uS; varying float vY;
    void main() { gl_FragColor = vY >= 0.0 ? uN : uS; }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
});
const orbitPlane = new THREE.Mesh(flat(new THREE.CircleGeometry(1, 160)), planeMat);
orbitPlane.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts(1)), MAT.planeRim));
root.add(orbitPlane);
const dropGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const dropLine = new THREE.Line(dropGeo, MAT.drop);
dropLine.frustumCulled = false;
root.add(dropLine);

// ---------------------------------------------------------------- shadow cones
const SEG = 160;
function makeCone(color, alpha, rim, order) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((SEG + 1) * 2 * 3), nor = new Float32Array((SEG + 1) * 2 * 3), idx = [];
  for (let i = 0; i < SEG; i++) { const a = i, b = i + 1, c = SEG + 1 + i, d = c + 1; idx.push(a, c, b, b, c, d); }
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha }, uRim: { value: rim } },
    vertexShader: `varying vec3 vN; varying vec3 vW;
      void main() { vN = mat3(modelMatrix) * normal; vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha, uRim; varying vec3 vN; varying vec3 vW;
      void main() { vec3 V = normalize(cameraPosition - vW); float f = 1.0 - abs(dot(normalize(vN), V));
        gl_FragColor = vec4(uColor, clamp(uAlpha * (1.0 + uRim * f * f * f), 0.0, 0.9)); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  root.add(mesh);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), ax = new THREE.Vector3(), tmp = new THREE.Vector3();
  return {
    mesh,
    // centres c0, c1 (arrays, root frame) and radii r0, r1
    set(c0, c1, r0, r1) {
      ax.set(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]);
      const L = ax.length(); if (L < 1e-9) { mesh.visible = false; return; }
      ax.multiplyScalar(1 / L);
      tmp.set(0, 1, 0); if (Math.abs(ax.y) > 0.9) tmp.set(1, 0, 0);
      e1.crossVectors(ax, tmp).normalize(); e2.crossVectors(ax, e1);
      const dr = r1 - r0;
      for (let ring = 0; ring < 2; ring++) {
        const c = ring ? c1 : c0, r = ring ? r1 : r0;
        for (let i = 0; i <= SEG; i++) {
          const a = i / SEG * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
          const dx = e1.x * ca + e2.x * sa, dy = e1.y * ca + e2.y * sa, dz = e1.z * ca + e2.z * sa;
          const k = (ring * (SEG + 1) + i) * 3;
          pos[k] = c[0] + dx * r; pos[k + 1] = c[1] + dy * r; pos[k + 2] = c[2] + dz * r;
          nor[k] = dx * L - ax.x * dr; nor[k + 1] = dy * L - ax.y * dr; nor[k + 2] = dz * L - ax.z * dr;
        }
      }
      g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
    },
  };
}
const cones = {
  ePen: makeCone(0x8fb3ff, 0.025, 4, 1),
  eUmb: makeCone(0xc4554a, 0.08, 3, 2),
  mPen: makeCone(0x8fb3ff, 0.05, 4, 3),
  mAnt: makeCone(0xffb347, 0.14, 3, 4),
  mUmb: makeCone(0xff6a4a, 0.3, 2.5, 5),
};

// Shadow cones point straight along the sunlight from the displayed body, with real radii at
// real distance t drawn at k·t. With compressed distance the cone therefore meets Earth (or the
// Moon) at k times the true offset; the shading on the bodies is always computed from real geometry.

// ---------------------------------------------------------------- applying a colour scheme
const SCHEME_KEY = 'varjutuste-mudel-scheme';
function applyScheme(name) {
  if (!THEMES[name]) name = 'dark';
  TH = THEMES[name];
  const space = TH.linearHex ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
  const paint = (m, [hex, op]) => { m.color.setHex(hex, space); m.opacity = op; };
  scene.background.setHex(TH.bg, space);
  bgRGB.setHex(TH.bg, space);
  stars.visible = TH.stars;
  for (const k of ['eclDisc', 'grid', 'spokes', 'ring', 'seasonOuter', 'seasonInner', 'node', 'sunLine', 'planeRim', 'drop']) paint(MAT[k], TH[k]);
  MAT.nodeMarker.color.setHex(TH.node[0], space);
  MAT.tartu.color.setHex(TH.tartu, space);
  planeMat.uniforms.uN.value.set(...TH.orbitN, TH.planeAlpha);
  planeMat.uniforms.uS.value.set(...TH.orbitS, TH.planeAlpha);
  for (const [k, [hex, alpha]] of Object.entries(TH.cones)) {
    const u = cones[k].mesh.material.uniforms;
    u.uColor.value.setHex(hex, space); u.uAlpha.value = alpha;
  }
  sunSprite.material.map = sunTex[name];
  sunSprite.material.blending = TH.sun.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  sunSprite.material.needsUpdate = true;
  document.documentElement.dataset.scheme = name;
  document.querySelectorAll('#schemeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scheme === name)));
  try { localStorage.setItem(SCHEME_KEY, name); } catch (e) { /* storage unavailable */ }
}

// ---------------------------------------------------------------- labels
const labelsEl = document.getElementById('labels');
function mkLabel(text, cls = '') { const d = document.createElement('div'); d.className = 'lbl ' + cls; d.textContent = text; labelsEl.appendChild(d); return d; }
const L = {
  earth: mkLabel('Maa'), moon: mkLabel('Kuu'), sun: mkLabel('Päike', 'sun'),
  asc: mkLabel('☊ tõusev sõlm', 'node'), desc: mkLabel('☋ laskuv sõlm', 'node'), tartu: mkLabel('Tartu', 'small'),
};
const _p = new THREE.Vector3();
function placeLabel(el, worldPos, ok = true) {
  if (!ok || !S.show.labels) { el.style.display = 'none'; return; }
  _p.copy(worldPos).project(camera);
  if (_p.z > 1 || Math.abs(_p.x) > 1.2 || Math.abs(_p.y) > 1.2) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.style.left = ((_p.x + 1) / 2 * innerWidth) + 'px';
  el.style.top = ((1 - _p.y) / 2 * innerHeight) + 'px';
}

// ---------------------------------------------------------------- camera views
let trans = null;
const W = a => root.localToWorld(vec(a));
const Wd = a => vec(a).applyQuaternion(root.quaternion);
// With the stars fixed, these views stay fixed too, so the Sun is seen moving around in a year
const STAR_FIXED_VIEWS = new Set(['overview', 'top', 'edge']);
function viewPose(name, st) {
  const k = S.Dd / MEAN_MOON_RE;
  let sunDir = st.sunDir;
  if (S.frame === 'stars' && STAR_FIXED_VIEWS.has(name)) sunDir = S.anchor ??= st.sunDir.slice();
  const s = Wd(sunDir), up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, s).normalize();
  const O = new THREE.Vector3();
  const D = S.Dd;
  switch (name) {
    case 'overview': return { pos: side.clone().multiplyScalar(1.0).addScaledVector(s, -0.35).addScaledVector(up, 0.55).normalize().multiplyScalar(3.3 * D), tgt: s.clone().multiplyScalar(0.55 * D) };
    case 'sun': return { pos: s.clone().multiplyScalar(7), tgt: O };
    case 'top': return { pos: up.clone().multiplyScalar(4.6 * D).addScaledVector(s, -0.02 * D), tgt: O };
    case 'edge': return { pos: side.clone().multiplyScalar(3.4 * D).addScaledVector(s, 0.6 * D).addScaledVector(up, 0.01 * D), tgt: s.clone().multiplyScalar(0.6 * D) };
    case 'shadow': { const m = W(v3.mul(st.moon, k)); return { pos: m.clone().addScaledVector(s, 5).addScaledVector(up, 0.8), tgt: O }; }
    case 'earth': return { pos: s.clone().addScaledVector(side, 0.9).addScaledVector(up, 0.35).normalize().multiplyScalar(8), tgt: O };
    case 'moon': { const m = W(v3.mul(st.moon, k)); return { pos: m.clone().addScaledVector(s, 2.1).addScaledVector(side, 2.1).addScaledVector(up, 0.95), tgt: m }; }
    case 'spot': {
      let P = st.ms.surf;
      if (!P) { const p = st.ms.p, l = v3.len(p); P = (st.ms.t0 > 0 && l > 1e-6) ? v3.mul(p, 1 / l) : st.sunDir; }
      const pw = W(P), n = pw.clone().normalize();
      return { pos: pw.clone().addScaledVector(n, 0.32).addScaledVector(s, 0.2).addScaledVector(up, 0.08), tgt: pw };
    }
  }
}
function setView(name) {
  S.view = name; S.tracking = true; S.zoom = S.zoomGoal = 1; S.anchor = null;
  trans = { t: 0, pos: camera.position.clone(), tgt: controls.target.clone() };
  markView(name);
}
function markView(name) { document.querySelectorAll('#views button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name))); }

function layout() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  const wide = w > 820;
  document.documentElement.style.setProperty('--tb-h', document.getElementById('timebar').offsetHeight + 'px');
  // Shift the projection centre so the scene sits in the free area beside the panels
  const pw = wide ? 356 : 0, tb = document.getElementById('timebar').offsetHeight + 14;
  camera.aspect = (w + pw) / (h + tb);
  camera.setViewOffset(w + pw, h + tb, pw, tb, w, h);
  camera.updateProjectionMatrix();
  needsRender = true;
}
addEventListener('resize', layout);

// ---------------------------------------------------------------- eclipse bookkeeping
let near = { key: null, solar: null };           // solar eclipse at the nearest new moon
let next = { from: Infinity, solar: null, lunar: null };
function refreshEclipses(jd) {
  const nm = findPhase(jd, 0, 0);
  const key = nm.toFixed(2);
  if (key !== near.key) near = { key, solar: solarEclipseAt(nm) };
  if (!(jd >= next.from && next.solar && jd < next.solar.jd && next.lunar && jd < next.lunar.jd)) {
    next = { from: jd, solar: findSolarEclipse(jd, 1), lunar: findLunarEclipse(jd, 1) };
  }
}

// ---------------------------------------------------------------- formatting
const pad = n => String(n).padStart(2, '0');
const fnum = (x, d = 1) => x.toLocaleString('et-EE', { minimumFractionDigits: d, maximumFractionDigits: d });
const fint = x => Math.round(x).toLocaleString('et-EE');
const dOf = jd => new Date(msFromJd(jd));
const fmtDate = jd => { const d = dOf(jd); return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`; };
const fmtTime = jd => { const d = dOf(jd); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const SOLAR_ET = { total: 'täielik', annular: 'rõngakujuline', hybrid: 'hübriidne', partial: 'osaline',
  'total-nc': 'täielik (mittetsentraalne)', 'annular-nc': 'rõngakujuline (mittetsentraalne)' };
const LUNAR_ET = { total: 'täielik', partial: 'osaline', penumbral: 'poolvarjuline' };

// ---------------------------------------------------------------- panel
const $ = id => document.getElementById(id);
function setCheck(id, state, html) { $(id).dataset.state = state; $(id + 'v').innerHTML = html; }
function updatePanel(st) {
  $('clockDate').textContent = fmtDate(st.jd);
  $('clockTime').textContent = fmtTime(st.jd);
  const dtEl = $('dtInput');
  if (document.activeElement !== dtEl) { const d = dOf(st.jd); dtEl.value = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }

  const sol = solarStatus(st), lun = lunarStatus(st);
  const main = $('statusMain');
  if (sol !== 'none') {
    const nearHybrid = near.solar && near.solar.type === 'hybrid' && (sol === 'total' || sol === 'annular');
    main.textContent = `Päikesevarjutus: ${SOLAR_ET[sol]}${nearHybrid ? ' (hübriidvarjutuse osa)' : ''}`;
    main.dataset.kind = sol.startsWith('total') ? 'total' : sol.startsWith('annular') ? 'annular' : 'partial';
  } else if (lun !== 'none') {
    main.textContent = `Kuuvarjutus: ${LUNAR_ET[lun]}`; main.dataset.kind = 'lunar';
  } else { main.textContent = 'Varjutust praegu ei ole'; main.dataset.kind = 'none'; }
  const ns = next.solar, nl = next.lunar;
  $('nextInfo').innerHTML =
    (ns ? `Järgmine päikesevarjutus: <b>${fmtDate(ns.jd)}</b>, ${SOLAR_ET[ns.type]}` : '') +
    (nl ? `<br>Järgmine kuuvarjutus: <b>${fmtDate(nl.jd)}</b>, ${LUNAR_ET[nl.type]}` : '');

  // 1. New moon
  const el = st.elong / DEG, ael = Math.abs(el);
  const phase = ael < 10 ? 'noorkuu' : ael > 170 ? 'täiskuu' : (el > 0 ? (el < 90 ? 'kasvav sirp' : 'kasvav kuu') : (el > -90 ? 'kahanev sirp' : 'kahanev kuu'));
  const daysToNM = ((360 - ((el + 360) % 360)) % 360) / 12.19;
  setCheck('c1', ael < 1.5 ? 'ok' : ael < 25 ? 'near' : 'off',
    `Kuu ja Päike ${fnum(ael, 1)}° kaugusel (${phase})<br>noorkuuni ${fnum(daysToNM, 1)} päeva`);

  // 2. Sun near node
  const dn = Math.abs(wrapPi(2 * (st.sunLon - st.node)) / 2) / DEG;    // distance to the nearer node
  const beta = st.moonLat / DEG;
  setCheck('c2', dn < 18.5 ? 'ok' : dn < 30 ? 'near' : 'off',
    `Päike sõlmest ${fnum(dn, 1)}°${dn < 18.5 ? ' · <span style="color:var(--ok)">hooaeg</span>' : ''}<br>Kuu ekliptikast ${fnum(Math.abs(beta), 2)}° ${beta >= 0 ? 'põhjas' : 'lõunas'} · orbiidi kalle ${fnum(st.incl / DEG, 2)}°`);

  // 3. Axis hits Earth
  const ms = st.ms;
  if (ms.t0 > 0 && ael < 30) {
    const partialLim = 1 + ms.rp(ms.t0);
    setCheck('c3', ms.gamma < 1 ? 'ok' : ms.gamma < partialLim ? 'near' : 'off',
      `γ = ${fnum(ms.gamma, 3)} ${ms.gamma < 1 ? '(telg tabab Maad)' : ms.gamma < partialLim ? '(ainult poolvari)' : '(vari möödub Maast)'}<br>poolvarju raadius Maa juures ${fnum(ms.rp(ms.t0), 2)} R⊕`);
  } else setCheck('c3', 'off', 'Kuu ei ole Päikese ees');

  // 4. Umbra long enough
  const reach = ms.Lu - ms.tToSurface;
  const ratio = st.moonAng / st.sunAng;
  let txt = `täisvari ${fint(ms.Lu * RE_KM)} km, Maa pinnani ${fint(ms.tToSurface * RE_KM)} km`;
  txt += `<br>Kuu/Päike näiv läbimõõt ${fnum(ratio, 3)} · Kuu kaugus ${fint(st.moonKm)} km`;
  if (ms.surf) txt += `<br>${ms.ruSurf > 0 ? 'täisvarju' : 'antumbra'} läbimõõt risti teljega ${fint(Math.abs(2 * ms.ruSurf) * RE_KM)} km`;
  setCheck('c4', reach > 0 ? 'ok' : reach > -0.3 ? 'near' : 'off', txt);

  const distOut = $('distOut');
  distOut.textContent = S.Dd >= 60.2 ? 'tegelik (60 R⊕)' : `${fnum(S.Dd, 0)} R⊕ (päriselt 60)`;
}

// ---------------------------------------------------------------- per-frame update
let needsRender = true, lastPanel = 0, lastEcl = 0;
const ident = new THREE.Matrix4();
function update(now) {
  const st = stateAt(S.jd);
  const k = S.Dd / MEAN_MOON_RE;
  const ringR = 1.9 * S.Dd;
  const orb = moonOrbit(S.jd + DELTA_T);
  st.node = orb.node;           // true node, so the node line lies in both drawn planes
  st.incl = orb.incl;

  root.rotation.y = S.frame === 'sun' ? -st.sunLon : 0;
  root.updateMatrixWorld(true);

  // Earth
  earth.quaternion.setFromEuler(new THREE.Euler(-OBLIQ, st.gmst, 0, 'XYZ'));
  earth.updateMatrix();
  earth.updateMatrixWorld(true);
  earthMat.uniforms.uLocal.value.copy(earth.matrix);
  earthMat.uniforms.uSunDir.value.set(...st.sunDir);
  earthMat.uniforms.uSunDist.value = st.sunDist;
  earthMat.uniforms.uMoon.value.set(...st.moon);
  earthMat.uniforms.uHi.value = S.show.hi ? 1 : 0;
  atmoMat.uniforms.uSunW.value.copy(Wd(st.sunDir));

  // Moon
  const md = v3.mul(st.moon, k);
  moon.position.set(...md);
  moon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vec(v3.norm(v3.mul(md, -1))));
  moon.updateMatrix();
  moonMat.uniforms.uLocal.value.copy(moon.matrix);
  moonMat.uniforms.uSunDir.value.set(...st.sunDir);
  moonMat.uniforms.uSunDist.value = st.sunDist;
  moonMat.uniforms.uMoonReal.value.set(...st.moon);
  moonMat.uniforms.uMoonDisp.value.set(...md);

  // Sun, sun line, ecliptic ring
  sunSprite.position.set(...v3.mul(st.sunDir, ringR));
  sunSprite.scale.setScalar(0.28 * S.Dd);
  sunLine.scale.setScalar(ringR); sunLine.rotation.y = st.sunLon;
  ecl.scale.setScalar(ringR);
  nodes.rotation.y = st.node;
  ecl.visible = true;
  nodes.visible = S.show.nodes;
  const ascDir = eclVec(st.node, 0, 1);
  nodeMarkers[0].position.set(...v3.mul(ascDir, S.Dd)); nodeMarkers[1].position.set(...v3.mul(ascDir, -S.Dd));
  nodeMarkers.forEach(m => { m.visible = S.show.nodes; m.scale.setScalar(S.Dd / 30); });

  // Moon's orbital plane
  orbitPlane.visible = S.show.plane;
  orbitPlane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vec(orb.pole));
  orbitPlane.scale.setScalar(1.1 * S.Dd);

  // Moon trail
  trail.visible = dropLine.visible = S.show.orbit;
  if (S.show.orbit) {
    const P = trailGeo.attributes.position.array, C = trailGeo.attributes.color.array;
    for (let i = 0; i < TRAIL_N; i++) {
      const j = S.jd + DELTA_T + (i - (TRAIL_N - 1) / 2) * (27.3217 / (TRAIL_N - 1));
      const m = moonEcl(j);
      const p = eclVec(m.lon, m.lat, m.distKm / RE_KM * k);
      P.set(p, i * 3);
      const fade = 0.35 + 0.65 * (1 - Math.abs(i - (TRAIL_N - 1) / 2) / ((TRAIL_N - 1) / 2));
      const oc = m.lat >= 0 ? TH.orbitN : TH.orbitS;
      C.set([bgRGB.r + (oc[0] - bgRGB.r) * fade, bgRGB.g + (oc[1] - bgRGB.g) * fade, bgRGB.b + (oc[2] - bgRGB.b) * fade], i * 3);
    }
    trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;
    const dp = dropGeo.attributes.position.array;
    dp.set(md, 0); dp.set([md[0], 0, md[2]], 3);
    dropGeo.attributes.position.needsUpdate = true;
  }

  // Moon's shadow
  const showC = S.show.cones;
  {
    const ms = st.ms, TEND = 66;
    const v = v3.mul(ms.u, k);
    const at = t => v3.add(md, v3.mul(v, t));
    cones.mPen.set(at(0), at(TEND), ms.rp(0), ms.rp(TEND));
    const tu = Math.min(ms.Lu, TEND);
    cones.mUmb.set(at(0), at(tu), ms.ru(0), Math.max(0, ms.ru(tu)));
    cones.mAnt.mesh.visible = showC && ms.Lu < TEND;
    if (ms.Lu < TEND) cones.mAnt.set(at(ms.Lu), at(TEND), 0, -ms.ru(TEND));
    cones.mPen.mesh.visible = cones.mUmb.mesh.visible = showC;
  }
  // Earth's shadow
  {
    const es = st.es, TEND = 80;
    const v = v3.mul(es.u, k);
    const at = t => v3.mul(v, t);
    cones.ePen.set(at(0), at(TEND), es.rp(0), es.rp(TEND));
    cones.eUmb.set(at(0), at(TEND), es.ru(0), es.ru(TEND));
    cones.ePen.mesh.visible = cones.eUmb.mesh.visible = showC && S.show.earthSh;
  }

  // Eclipse bookkeeping and central line
  if (now - lastEcl > 200) { refreshEclipses(S.jd); lastEcl = now; }
  const e = near.solar;
  setTrack(e && Math.abs(S.jd - e.jd) < 0.3 && ['total', 'annular', 'hybrid'].includes(e.type) ? e : null);
  if (track) track.visible = S.show.hi;

  // Camera (zoom eases toward its goal; it scales the distance to the target)
  let zNew = S.zoom + (S.zoomGoal - S.zoom) * 0.2;
  if (Math.abs(S.zoomGoal - zNew) < 1e-4 * S.zoomGoal) zNew = S.zoomGoal;
  const zRatio = zNew / S.zoom;
  S.zoom = zNew;
  if (S.tracking && S.view) {
    const pose = viewPose(S.view, st);
    pose.pos.sub(pose.tgt).multiplyScalar(S.zoom).add(pose.tgt);
    if (trans) {
      trans.t = Math.min(1, trans.t + 1 / 50);
      const a = trans.t < 0.5 ? 4 * trans.t ** 3 : 1 - (-2 * trans.t + 2) ** 3 / 2;
      camera.position.lerpVectors(trans.pos, pose.pos, a);
      controls.target.lerpVectors(trans.tgt, pose.tgt, a);
      if (trans.t >= 1) trans = null;
    } else { camera.position.copy(pose.pos); controls.target.copy(pose.tgt); }
    camera.lookAt(controls.target);
  } else {
    if (zRatio !== 1) camera.position.sub(controls.target).multiplyScalar(zRatio).add(controls.target);
    controls.update();
  }
  const cd = camera.position.length();
  camera.near = Math.min(1, Math.max(0.0005, (cd - 1.02) * 0.25));
  camera.far = 30000;
  camera.updateProjectionMatrix();

  // Labels
  const lab = S.show.labels;
  placeLabel(L.earth, W([0, 1.25, 0]));
  placeLabel(L.moon, W(v3.add(md, [0, R_MOON * 1.4, 0])));
  placeLabel(L.sun, W(v3.add(v3.mul(st.sunDir, ringR), [0, 0.12 * S.Dd, 0])));
  placeLabel(L.asc, W(v3.mul(ascDir, S.Dd * 1.0)), S.show.nodes);
  placeLabel(L.desc, W(v3.mul(ascDir, -S.Dd * 1.0)), S.show.nodes);
  const tw = tartuLocal.clone().applyMatrix4(earth.matrixWorld);
  const facing = tw.clone().sub(camera.position).dot(tw.clone().sub(root.position)) < 0 && camera.position.distanceTo(tw) < 12;
  placeLabel(L.tartu, tw, facing);

  if (now - lastPanel > 100) { updatePanel(st); lastPanel = now; }
}

// ---------------------------------------------------------------- loop
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (S.playing) S.jd = Math.min(2524593.5, Math.max(2378496.5, S.jd + dt * S.speed));
  update(now);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- controls wiring
function setPlaying(p) { S.playing = p; $('play').textContent = p ? '❚❚' : '▶'; $('play').setAttribute('aria-label', p ? 'Peata' : 'Käivita'); }
// reanchor: turn the star-fixed overview views to the Sun again (for jumps far away in time)
function jumpTo(jd, reanchor = false) { S.jd = jd; setPlaying(false); lastEcl = 0; lastPanel = 0; if (reanchor) S.anchor = null; }
$('play').onclick = () => setPlaying(!S.playing);
$('stepBack').onclick = () => { S.jd -= S.speed; lastPanel = 0; };
$('stepFwd').onclick = () => { S.jd += S.speed; lastPanel = 0; };
$('nextNM').onclick = () => jumpTo(findPhase(S.jd, 0, 1));
$('prevNM').onclick = () => jumpTo(findPhase(S.jd, 0, -1));
$('nextEcl').onclick = () => { const e = findSolarEclipse(S.jd, 1); if (e) jumpTo(e.jd, true); };
$('prevEcl').onclick = () => { const e = findSolarEclipse(S.jd, -1); if (e) jumpTo(e.jd, true); };
function setSpeedIndex(i) {
  const sel = $('speed');
  sel.selectedIndex = Math.min(sel.options.length - 1, Math.max(0, i));
  S.speed = parseFloat(sel.value);
  $('slower').disabled = sel.selectedIndex === 0;
  $('faster').disabled = sel.selectedIndex === sel.options.length - 1;
}
$('speed').onchange = () => setSpeedIndex($('speed').selectedIndex);
$('slower').onclick = () => setSpeedIndex($('speed').selectedIndex - 1);
$('faster').onclick = () => setSpeedIndex($('speed').selectedIndex + 1);
$('dtInput').onchange = ev => { const t = Date.parse(ev.target.value + ':00Z'); if (!isNaN(t)) jumpTo(jdFromMs(t), true); };
document.querySelectorAll('#views button').forEach(b => b.onclick = () => setView(b.dataset.view));
document.querySelectorAll('#frameSeg button').forEach(b => b.onclick = () => {
  S.frame = b.dataset.frame; S.anchor = null;
  document.querySelectorAll('#frameSeg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
});
document.querySelectorAll('#schemeSeg button').forEach(b => b.onclick = () => applyScheme(b.dataset.scheme));
$('dist').oninput = ev => { S.Dd = parseFloat(ev.target.value); lastPanel = 0; if (S.view) S.tracking = true; };
const tog = (id, key) => { $(id).onchange = ev => { S.show[key] = ev.target.checked; }; };
tog('tCones', 'cones'); tog('tOrbit', 'orbit'); tog('tPlane', 'plane'); tog('tNodes', 'nodes'); tog('tHi', 'hi'); tog('tLabels', 'labels'); tog('tEarthSh', 'earthSh');
function zoomBy(f) {
  const d = camera.position.distanceTo(controls.target) * (S.zoomGoal / S.zoom);
  const nd = Math.min(controls.maxDistance, Math.max(controls.minDistance, d * f));
  S.zoomGoal *= nd / d;
}
for (const [id, f] of [['zoomIn', 0.75], ['zoomOut', 1 / 0.75]]) {
  const b = $(id);
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; };
  b.onpointerdown = ev => { ev.preventDefault(); zoomBy(f); stop(); timer = setInterval(() => zoomBy(f), 160); };
  b.onpointerup = b.onpointerleave = b.onpointercancel = stop;
  b.onclick = ev => { if (ev.detail === 0) zoomBy(f); };   // keyboard activation
}
$('panelToggle').onclick = () => {
  const p = $('panel'); const c = p.classList.toggle('collapsed');
  $('panelToggle').setAttribute('aria-expanded', String(!c));
};
addEventListener('keydown', ev => {
  if (ev.target.matches('input, select, textarea')) return;
  if (ev.code === 'Space') { ev.preventDefault(); setPlaying(!S.playing); }
  else if (ev.key === 'ArrowRight') { S.jd += S.speed; lastPanel = 0; }
  else if (ev.key === 'ArrowLeft') { S.jd -= S.speed; lastPanel = 0; }
  else if (ev.key === '[') setSpeedIndex($('speed').selectedIndex - 1);
  else if (ev.key === ']') setSpeedIndex($('speed').selectedIndex + 1);
  else if (ev.key === '+' || ev.key === '=') zoomBy(0.75);
  else if (ev.key === '-' || ev.key === '−') zoomBy(1 / 0.75);
});

// Presets
const PRESETS = [
  ['solar', [2026, 8, 12, 18], '12.08.2026', 'Täielik · Gröönimaa, Island, Hispaania'],
  ['solar', [2027, 8, 2, 10], '02.08.2027', 'Täielik · Hispaania, Põhja-Aafrika, Egiptus'],
  ['solar', [2026, 2, 17, 12], '17.02.2026', 'Rõngakujuline · Antarktika'],
  ['solar', [2024, 4, 8, 18], '08.04.2024', 'Täielik · Mehhiko, USA, Kanada'],
  ['solar', [2023, 4, 20, 4], '20.04.2023', 'Hübriidne · Indoneesia, Austraalia'],
  ['solar', [1999, 8, 11, 11], '11.08.1999', 'Täielik · Kesk-Euroopa'],
  ['solar', [2061, 4, 30, 15], '30.04.2061', 'Täielik · ka Eestis'],
  ['lunar', [2025, 9, 7, 18], '07.09.2025', 'Täielik kuuvarjutus'],
  ['lunar', [2026, 8, 28, 4], '28.08.2026', 'Osaline kuuvarjutus'],
];
for (const [kind, [y, m, d, h], ds, text] of PRESETS) {
  const b = document.createElement('button');
  if (kind === 'lunar') b.className = 'lunar';
  b.innerHTML = `<span class="d">${ds}</span><span>${text}</span>`;
  b.onclick = () => {
    const jd0 = jdFromMs(Date.UTC(y, m - 1, d, h));
    const e = kind === 'solar' ? solarEclipseAt(findPhase(jd0, 0, 0)) : lunarEclipseAt(findPhase(jd0, Math.PI, 0));
    if (e) jumpTo(e.jd, true);
    if (kind === 'lunar' && (S.view === 'sun' || S.view === 'spot')) setView('overview');
  };
  $('presets').appendChild(b);
}

// ---------------------------------------------------------------- start
const startE = solarEclipseAt(findPhase(jdFromMs(Date.UTC(2026, 7, 12, 18)), 0, 0));
S.jd = startE.jd;
$('dist').value = S.Dd;
setSpeedIndex($('speed').selectedIndex);
{ let saved = null; try { saved = localStorage.getItem(SCHEME_KEY); } catch (e) { /* storage unavailable */ } applyScheme(saved || 'dark'); }
layout();
{ const pose = viewPose('overview', stateAt(S.jd)); camera.position.copy(pose.pos); controls.target.copy(pose.tgt); }
markView('overview');
$('loading').remove();
if (innerWidth <= 820) { $('panel').classList.add('collapsed'); $('panelToggle').setAttribute('aria-expanded', 'false'); }
requestAnimationFrame(loop);
