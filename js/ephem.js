// ---- Ephemeris (Meeus, Astronomical Algorithms, ch. 25, 47) ---------------
// Scene frame: X = vernal equinox, Y = ecliptic north, Z = -(ecliptic y).
// Lengths in Earth equatorial radii.
const DEG = Math.PI / 180;
const RE_KM = 6378.137;
const R_SUN = 696000 / RE_KM;
const R_MOON = 0.2725076;            // IAU lunar radius in Earth radii
const AU_RE = 149597870.7 / RE_KM;
const EARTH_SHADOW_ENLARGE = 1.02;    // atmosphere enlarges Earth's shadow ~2 %
const DELTA_T = 69 / 86400;           // TT - UT, days
const OBLIQ = 23.4393 * DEG;

const jdFromMs = ms => ms / 86400000 + 2440587.5;
const msFromJd = jd => (jd - 2440587.5) * 86400000;

// D, M, M', F, Σl (1e-6 deg), Σr (1e-3 km)
const MOON_LR = [
  [0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],
  [0,0,2,0,213618,-569925],[0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],
  [2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],[2,0,1,0,53322,-170733],
  [2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],
  [0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],
  [0,0,1,-2,10980,79661],[4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],
  [4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],[2,1,0,0,-6766,30824],
  [1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],
  [2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],
  [0,1,-2,0,-2689,-7003],[2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056],
  [1,0,1,0,-2348,6322],[2,-2,0,0,2236,-9884],[0,1,2,0,-2120,5751],
  [0,2,0,0,-2069,0],[2,-2,-1,0,2048,-4950],[2,0,1,-2,-1773,4130],
  [2,0,0,2,-1595,0],[4,-1,-1,0,1215,-3958],[0,0,2,2,-1110,0],
  [3,0,-1,0,-892,3258],[2,1,1,0,-810,2616],[4,-1,-2,0,759,-1897],
  [0,2,-1,0,-713,-2117],[2,2,-1,0,-700,2354],[2,1,-2,0,691,0],
  [2,-1,0,-2,596,0],[4,0,1,0,549,-1423],[0,0,4,0,537,-1117],
  [4,-1,0,0,520,-1571],[1,0,-2,0,-487,-1739],[2,1,0,-2,-399,0],
  [0,0,2,-2,-381,-4421],[1,1,1,0,351,0],[3,0,-2,0,-340,0],
  [4,0,-3,0,330,0],[2,-1,2,0,327,0],[0,2,1,0,-323,1165],
  [1,1,-1,0,299,0],[2,0,3,0,294,0],[2,0,-1,-2,0,8752],
];
// D, M, M', F, Σb (1e-6 deg)
const MOON_B = [
  [0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],
  [2,0,-1,1,55413],[2,0,-1,-1,46271],[2,0,0,1,32573],[0,0,2,1,17198],
  [2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],
  [2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],
  [2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794],
  [0,0,0,3,-1749],[0,1,-1,1,-1565],[1,0,0,1,-1491],[0,1,1,1,-1475],
  [0,1,1,-1,-1410],[0,1,0,-1,-1344],[1,0,0,-1,-1335],[0,0,3,1,1107],
  [4,0,0,-1,1021],[4,0,-1,1,833],[0,0,1,-3,777],[4,0,-2,1,671],
  [2,0,0,-3,607],[2,0,2,-1,596],[2,-1,1,-1,491],[2,0,-2,1,-451],
  [0,0,3,-1,439],[2,0,2,1,422],[2,0,-3,-1,421],
];

function moonEcl(jde) {
  const T = (jde - 2451545) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T ** 3 / 538841;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699;
  const F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T * T;
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.290 * T, A3 = 313.45 + 481266.484 * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of MOON_LR) {
    const a = (d * D + m * M + mp * Mp + f * F) * DEG;
    const e = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
    sl += l * e * Math.sin(a);
    sr += r * e * Math.cos(a);
  }
  for (const [d, m, mp, f, b] of MOON_B) {
    const e = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
    sb += b * e * Math.sin((d * D + m * M + mp * Mp + f * F) * DEG);
  }
  sl += 3958 * Math.sin(A1 * DEG) + 1962 * Math.sin((Lp - F) * DEG) + 318 * Math.sin(A2 * DEG);
  sb += -2235 * Math.sin(Lp * DEG) + 382 * Math.sin(A3 * DEG) + 175 * Math.sin((A1 - F) * DEG)
      + 175 * Math.sin((A1 + F) * DEG) + 127 * Math.sin((Lp - Mp) * DEG) - 115 * Math.sin((Lp + Mp) * DEG);
  return { lon: (Lp + sl / 1e6) * DEG, lat: (sb / 1e6) * DEG, distKm: 385000.56 + sr / 1000 };
}

function sunEcl(jde) {
  const T = (jde - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * DEG;
  const e = 0.016708634 - 0.000042037 * T;
  const C = (1.914602 - 0.004817 * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M)
          + 0.000289 * Math.sin(3 * M);
  const nu = M + C * DEG;
  const R = 1.000001018 * (1 - e * e) / (1 + e * Math.cos(nu));
  return { lon: (L0 + C - 0.00569) * DEG, distAU: R };   // apparent (aberration)
}

const meanNode = jde => (125.0445479 - 1934.1362891 * (jde - 2451545) / 36525) * DEG;
const gmst = jd => {
  const T = (jd - 2451545) / 36525;
  return (280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T) * DEG;
};

const eclVec = (lon, lat, r) =>
  [r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon)];

const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};

const wrapPi = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

// Earth orientation: rotation Rx(-ε)·Ry(GMST) applied to Earth-fixed vectors
// (Earth-fixed: Y = north pole, X = Greenwich, east = rotation about +Y).
function earthToScene(p, g) {
  const c = Math.cos(g), s = Math.sin(g);
  const x1 = p[0] * c + p[2] * s, z1 = -p[0] * s + p[2] * c, y1 = p[1];
  const ce = Math.cos(-OBLIQ), se = Math.sin(-OBLIQ);
  return [x1, y1 * ce - z1 * se, y1 * se + z1 * ce];
}
function sceneToEarth(p, g) {
  const ce = Math.cos(OBLIQ), se = Math.sin(OBLIQ);
  const y1 = p[1] * ce - p[2] * se, z1 = p[1] * se + p[2] * ce, x1 = p[0];
  const c = Math.cos(-g), s = Math.sin(-g);
  return [x1 * c + z1 * s, y1, -x1 * s + z1 * c];
}
const latLonOf = p => ({ lat: Math.asin(p[1] / v3.len(p)) / DEG, lon: Math.atan2(-p[2], p[0]) / DEG });

// Full geometric state at UT Julian date
function stateAt(jd) {
  const jde = jd + DELTA_T;
  const s = sunEcl(jde), m = moonEcl(jde);
  const sunDist = s.distAU * AU_RE;
  const sunDir = eclVec(s.lon, 0, 1);
  const sun = v3.mul(sunDir, sunDist);
  const moon = eclVec(m.lon, m.lat, m.distKm / RE_KM);
  const st = { jd, sun, sunDir, sunDist, moon, moonKm: m.distKm, sunLon: s.lon, moonLon: m.lon,
    moonLat: m.lat, node: meanNode(jde), gmst: gmst(jd) };

  // Moon's shadow
  const sm = v3.sub(moon, sun), dSM = v3.len(sm), u = v3.mul(sm, 1 / dSM);
  const sinF1 = (R_SUN + R_MOON) / dSM, sinF2 = (R_SUN - R_MOON) / dSM;
  const t0 = -v3.dot(moon, u);
  const p = v3.add(moon, v3.mul(u, t0));
  const gamma = v3.len(p);
  st.ms = { u, t0, p, gamma, tanF1: Math.tan(Math.asin(sinF1)), tanF2: Math.tan(Math.asin(sinF2)),
    Lp: R_MOON / sinF1, Lu: R_MOON / sinF2 };
  st.ms.rp = t => (st.ms.Lp + t) * st.ms.tanF1;     // penumbra radius at t behind Moon
  st.ms.ru = t => (st.ms.Lu - t) * st.ms.tanF2;     // >0 umbra, <0 antumbra
  // Where the axis meets the surface (if it does)
  if (t0 > 0 && gamma < 1) {
    const ts = t0 - Math.sqrt(1 - gamma * gamma);
    st.ms.tSurf = ts;
    st.ms.surf = v3.add(moon, v3.mul(u, ts));
    st.ms.ruSurf = st.ms.ru(ts);
  }
  // Distance from Moon to the nearest point of Earth's surface along the axis
  st.ms.tToSurface = st.ms.tSurf ?? (v3.len(moon) - 1);

  // Earth's shadow
  const ue = v3.mul(sunDir, -1);
  const RE_SH = EARTH_SHADOW_ENLARGE;
  const eF1 = (R_SUN + RE_SH) / sunDist, eF2 = (R_SUN - RE_SH) / sunDist;
  const te = v3.dot(moon, ue);
  const q = v3.sub(moon, v3.mul(ue, te));
  st.es = { u: ue, t0: te, q, qLen: v3.len(q), tanF1: Math.tan(Math.asin(eF1)), tanF2: Math.tan(Math.asin(eF2)),
    Lp: RE_SH / eF1, Lu: RE_SH / eF2 };
  st.es.rp = t => (st.es.Lp + t) * st.es.tanF1;
  st.es.ru = t => (st.es.Lu - t) * st.es.tanF2;

  st.elong = wrapPi(m.lon - s.lon);
  // Apparent angular radii seen from Earth's centre
  st.sunAng = Math.asin(R_SUN / sunDist);
  st.moonAng = Math.asin(R_MOON / v3.len(moon));
  return st;
}

function solarStatus(st) {
  const ms = st.ms;
  if (ms.t0 <= 0) return 'none';
  if (ms.gamma < 1) return ms.ruSurf > 0 ? 'total' : 'annular';
  // Non-central: shadow edge touches Earth?
  const r = ms.ru(ms.t0);
  if (ms.gamma < 1 + Math.abs(r)) return r > 0 ? 'total-nc' : 'annular-nc';
  if (ms.gamma < 1 + ms.rp(ms.t0)) return 'partial';
  return 'none';
}

function lunarStatus(st) {
  const es = st.es;
  if (es.t0 <= 0) return 'none';
  const ru = es.ru(es.t0), rp = es.rp(es.t0), q = es.qLen;
  if (q < ru - R_MOON) return 'total';
  if (q < ru + R_MOON) return 'partial';
  if (q < rp + R_MOON) return 'penumbral';
  return 'none';
}

// New moon (phase 0) or full moon (phase π) nearest to jd in direction dir (+1/-1, 0 = nearest)
function findPhase(jd, phase, dir) {
  const rate = 12.190749 * DEG;   // rad/day, mean synodic rate
  const st = stateAt(jd);
  let d = wrapPi(st.elong - phase);
  let dt;
  if (dir > 0) dt = (d >= -1e-6 ? 2 * Math.PI - d : -d) / rate;
  else if (dir < 0) dt = (d <= 1e-6 ? -2 * Math.PI - d : -d) / rate;
  else dt = -d / rate;
  if (dir > 0 && dt < 0.02) dt += 29.53;
  if (dir < 0 && dt > -0.02) dt -= 29.53;
  let j = jd + dt;
  for (let i = 0; i < 6; i++) j -= wrapPi(stateAt(j).elong - phase) / rate;
  return j;
}

// Minimise f on [a, b] (golden section)
function goldenMin(f, a, b, n = 40) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < n; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}

// Solar eclipse at a given new moon, or null
function solarEclipseAt(jdNM) {
  const jd = goldenMin(j => { const s = stateAt(j); return s.ms.t0 > 0 ? s.ms.gamma : 99; }, jdNM - 0.3, jdNM + 0.3);
  const st = stateAt(jd);
  let type = solarStatus(st);
  if (type === 'none') return null;
  if (type === 'total' && st.ms.ru(st.ms.t0) < 0) type = 'hybrid';
  const ms = st.ms;
  return { jd, type, gamma: Math.sign(v3.dot(ms.p, [0, 1, 0]) || 1) * ms.gamma, st,
    where: ms.surf ? latLonOf(sceneToEarth(ms.surf, st.gmst)) : null };
}

function lunarEclipseAt(jdFM) {
  const jd = goldenMin(j => stateAt(j).es.qLen, jdFM - 0.3, jdFM + 0.3);
  const st = stateAt(jd);
  const type = lunarStatus(st);
  return type === 'none' ? null : { jd, type, st };
}

function findSolarEclipse(jd, dir) {
  let nm = jd;
  for (let i = 0; i < 40; i++) {
    nm = findPhase(nm, 0, dir);
    const e = solarEclipseAt(nm);
    if (e && (dir > 0 ? e.jd > jd + 0.01 : e.jd < jd - 0.01)) return e;
  }
  return null;
}

function findLunarEclipse(jd, dir) {
  let fm = jd;
  for (let i = 0; i < 40; i++) {
    fm = findPhase(fm, Math.PI, dir);
    const e = lunarEclipseAt(fm);
    if (e && (dir > 0 ? e.jd > jd + 0.01 : e.jd < jd - 0.01)) return e;
  }
  return null;
}

export {
  DEG, RE_KM, R_SUN, R_MOON, AU_RE, EARTH_SHADOW_ENLARGE, DELTA_T, OBLIQ, jdFromMs, msFromJd, moonEcl, sunEcl, meanNode, gmst, eclVec, v3, wrapPi, earthToScene, sceneToEarth, latLonOf, stateAt, solarStatus, lunarStatus, findPhase, goldenMin, solarEclipseAt, lunarEclipseAt, findSolarEclipse, findLunarEclipse,
};
