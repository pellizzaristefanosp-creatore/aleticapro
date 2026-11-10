// Disegno automatico degli angoli sui landmark (sagittale e frontale).
import { SIDE, BONES, mid, frame, footPoint } from './biomech.js';
import { C, CONF_COLOR, fmt, line, glowLine, joint, arc, pill, crosshair, text, Labels } from './draw.js';

const ext = (from, through, k = 0.6) => ({ x: through.x + (through.x - from.x) * k, y: through.y + (through.y - from.y) * k });
const along = (p, v, L) => ({ x: p.x + v.x * L, y: p.y + v.y * L });
const colorOf = (m) => CONF_COLOR[m?.conf] || C.grey;

export function legsToShow(mode, near) {
  if (mode === 'both') return ['L', 'R'];
  if (mode === 'L' || mode === 'R') return [mode];
  return [near || 'L'];
}

export function drawSkeleton(ctx, P, u, near, view) {
  const farIds = new Set(view === 'sagittale' ? Object.values(SIDE[near === 'L' ? 'R' : 'L']).filter((v) => typeof v === 'number') : []);
  for (const [a, b] of BONES) {
    const far = farIds.has(a) || farIds.has(b);
    const vis = Math.min(P[a].v, P[b].v);
    if (vis < 0.3) continue;
    line(ctx, P[a], P[b], u, far ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.75)', far ? 2 : 2.5);
  }
  for (let i = 11; i <= 32; i++) {
    if (i >= 17 && i <= 22) continue;
    if (P[i].v < 0.3) continue;
    const far = farIds.has(i);
    joint(ctx, P[i], u, far ? C.far : C.blue, far ? 3 : 4, !far);
  }
}

/** Overlay sagittale. M = sagittalMetrics(P), show = toggle, opts = {groundRad, legs, showLow, u} */
export function drawSagittal(ctx, P, M, show, opts) {
  const u = opts.u;
  const F = frame(opts.groundRad || 0, M.meta.dir);
  const shM = mid(P[11], P[12]), hipM = mid(P[23], P[24]);
  const up = F.up, down = { x: -up.x, y: -up.y };
  const legs = legsToShow(opts.legs, M.meta.near);
  const lab = (m) => fmt(m, opts.showLow);

  if (show.trunk) {
    const L = Math.hypot(shM.x - hipM.x, shM.y - hipM.y);
    line(ctx, hipM, along(hipM, up, L * 1.1), u, C.white, 1.5, [6, 6]);
    glowLine(ctx, hipM, shM, u, colorOf(M.trunk), 4);
    arc(ctx, along(hipM, up, L), hipM, shM, u, colorOf(M.trunk), `${lab(M.trunk)}`, { r: L * 0.35 / u, sub: 'TRONCO' });
  }
  if (show.head) {
    const ear = P[SIDE[M.meta.near].ear];
    line(ctx, shM, ear, u, colorOf(M.head), 2.5);
    arc(ctx, ext(hipM, shM, 0.35), shM, ear, u, colorOf(M.head), lab(M.head), { r: 26, sub: 'TESTA/TRONCO' });
  }
  for (const k of legs) {
    const s = SIDE[k];
    const hip = P[s.hip], kn = P[s.kn], an = P[s.an], heel = P[s.heel], toe = P[s.toe];
    if (show.hip) {
      const tExt = ext(shM, hip, 0.45);
      line(ctx, hip, tExt, u, C.white, 1.5, [5, 5]);
      glowLine(ctx, hip, kn, u, colorOf(M[`hip${k}`]), 3.5);
      arc(ctx, tExt, hip, kn, u, colorOf(M[`hip${k}`]), lab(M[`hip${k}`]), { r: 34, sub: `ANCA ${s.label}` });
    }
    if (show.thigh) {
      const TL = Math.hypot(kn.x - hip.x, kn.y - hip.y);
      line(ctx, hip, along(hip, down, TL), u, C.white, 1.5, [5, 5]);
      arc(ctx, along(hip, down, TL), hip, kn, u, colorOf(M[`thigh${k}`]), lab(M[`thigh${k}`]), { r: 48, sub: `COSCIA/VERT ${s.label}` });
    }
    if (show.knee) {
      const tExt = ext(hip, kn, 0.45);
      line(ctx, kn, tExt, u, C.white, 1.5, [5, 5]);
      glowLine(ctx, kn, an, u, colorOf(M[`knee${k}`]), 3.5);
      arc(ctx, tExt, kn, an, u, colorOf(M[`knee${k}`]), lab(M[`knee${k}`]), { r: 30, sub: `GINOCCHIO ${s.label}` });
    }
    if (show.tibia) {
      const L = Math.hypot(kn.x - an.x, kn.y - an.y);
      line(ctx, an, along(an, up, L * 1.05), u, C.yellow, 2, [7, 6]);
      glowLine(ctx, an, kn, u, C.blue, 4);
      arc(ctx, along(an, up, L), an, kn, u, colorOf(M[`tibia${k}`]), lab(M[`tibia${k}`]), { r: L * 0.42 / u, sub: `TIBIA ${s.label}/VERT` });
    }
    if (show.ankle) {
      const footDir = { x: toe.x - heel.x, y: toe.y - heel.y };
      const fEnd = { x: an.x + footDir.x, y: an.y + footDir.y };
      line(ctx, heel, toe, u, colorOf(M[`ankle${k}`]), 3);
      line(ctx, an, fEnd, u, C.white, 1.5, [4, 4]);
      const m = M[`ankle${k}`];
      const tag = m.value >= 0 ? 'DORSIFL.' : 'PLANTARFL.';
      arc(ctx, kn, an, fEnd, u, colorOf(m), m.conf === 'bassa' && !opts.showLow ? 'n.m.' : `${fmt({ ...m, value: Math.abs(m.value) }, opts.showLow)}`, { r: 22, sub: `CAVIGLIA ${s.label} ${tag}` });
    }
    if (show.arms) {
      const m = M[`elbow${k}`];
      arc(ctx, P[s.sh], P[s.el], P[s.wr], u, colorOf(m), lab(m), { r: 22, sub: `GOMITO ${s.label}` });
    }
  }
  if (show.com && M.com) {
    const com = M.com;
    // livello del terreno: punto piede più basso del frame
    const fps = ['L', 'R'].map((k) => footPoint(P, SIDE[k], F));
    const lowest = fps.reduce((a, b) => (-(a.x * up.x + a.y * up.y) > -(b.x * up.x + b.y * up.y) ? a : b));
    const hCom = (lowest.x - com.x) * up.x + (lowest.y - com.y) * up.y; // negativo
    const proj = along(com, up, hCom);
    const col = CONF_COLOR[com.conf];
    line(ctx, com, proj, u, col, 2, [3, 5]);
    crosshair(ctx, com, u, col);
    text(ctx, { x: com.x + 14 * u, y: com.y - 12 * u }, 'CoM', u, col, 11);
    const gL = { x: proj.x - F.g.x * 200, y: proj.y - F.g.y * 200 }, gR = { x: proj.x + F.g.x * 200, y: proj.y + F.g.y * 200 };
    line(ctx, gL, gR, u, 'rgba(255,255,255,0.35)', 1.5);
    for (const k of legs) {
      const m = M[`footCom${k}`];
      if (!m) continue;
      const f = m.foot;
      if (Math.abs(((f.x - lowest.x) * up.x + (f.y - lowest.y) * up.y)) > 25) continue; // solo piede a terra
      const fOnGround = along(proj, F.g, (f.x - proj.x) * F.g.x + (f.y - proj.y) * F.g.y);
      joint(ctx, f, u, C.yellow, 5);
      line(ctx, proj, fOnGround, u, CONF_COLOR[m.conf], 3);
      const txt = m.conf === 'bassa' && !opts.showLow ? 'davanti/dietro: n.m.'
        : `${m.value >= 0 ? 'davanti' : 'dietro'} ${Math.abs(m.value).toFixed(0)}% arto${m.m != null ? ` · ${Math.abs(m.m * 100).toFixed(0)} cm` : ''}`;
      const at = { x: (proj.x + fOnGround.x) / 2, y: proj.y };
      if (Labels.list) Labels.add(at, txt, CONF_COLOR[m.conf], `PIEDE ${SIDE[k].label} vs CoM`); else pill(ctx, { x: at.x, y: at.y + 26 * u }, txt, u, CONF_COLOR[m.conf], `PIEDE ${SIDE[k].label} vs CoM`);
    }
  }
}

export function drawFrontal(ctx, P, M, show, opts) {
  const u = opts.u;
  const F = frame(opts.groundRad || 0, 1);
  const lab = (m) => fmt(m, opts.showLow);
  const hipM = mid(P[23], P[24]), shM = mid(P[11], P[12]);
  const hz = (a, b, m, name) => {
    const c = mid(a, b);
    const L = Math.hypot(b.x - a.x, b.y - a.y) * 0.75;
    line(ctx, { x: c.x - F.g.x * L, y: c.y - F.g.y * L }, { x: c.x + F.g.x * L, y: c.y + F.g.y * L }, u, C.yellow, 1.5, [6, 6]);
    glowLine(ctx, ext(b, a, 0.25), ext(a, b, 0.25), u, colorOf(m), 3.5);
    const at = ext(a, b, 0.25);
    if (Labels.list) Labels.add(at, lab(m), colorOf(m), `${name} · ${m.hint}`); else pill(ctx, { x: at.x + 40 * u, y: at.y }, lab(m), u, colorOf(m), `${name} · ${m.hint}`);
  };
  if (show.pelvis) hz(P[23], P[24], M.pelvis, 'BACINO');
  if (show.shoulders) hz(P[11], P[12], M.shoulders, 'SPALLE');
  if (show.headTilt) hz(P[7], P[8], M.headTilt, 'TESTA');
  if (show.trunkLat) {
    const L = Math.hypot(shM.x - hipM.x, shM.y - hipM.y);
    line(ctx, hipM, { x: hipM.x + F.up.x * L * 1.1, y: hipM.y + F.up.y * L * 1.1 }, u, C.white, 1.5, [6, 6]);
    glowLine(ctx, hipM, shM, u, colorOf(M.trunkLat), 4);
    arc(ctx, { x: hipM.x + F.up.x * L, y: hipM.y + F.up.y * L }, hipM, shM, u, colorOf(M.trunkLat), lab(M.trunkLat), { r: L * 0.3 / u, sub: 'TRONCO LATERALE' });
  }
  for (const k of ['L', 'R']) {
    const s = SIDE[k];
    if (show.fppa) {
      const m = M[`fppa${k}`];
      const tExt = ext(P[s.hip], P[s.kn], 0.4);
      line(ctx, P[s.hip], P[s.an], u, 'rgba(255,255,255,0.35)', 1.5, [4, 5]);
      line(ctx, P[s.kn], tExt, u, C.white, 1.5, [5, 5]);
      glowLine(ctx, P[s.hip], P[s.kn], u, colorOf(m), 3);
      glowLine(ctx, P[s.kn], P[s.an], u, colorOf(m), 3);
      const tag = m.value >= 0 ? 'VALGO' : 'VARO';
      arc(ctx, tExt, P[s.kn], P[s.an], u, colorOf(m), m.conf === 'bassa' && !opts.showLow ? 'n.m.' : `${Math.abs(m.value).toFixed(0)}°`, { r: 26, sub: `FPPA ${s.label} ${tag}` });
    }
    if (show.footMid) {
      const m = M[`footMid${k}`];
      joint(ctx, P[s.an], u, colorOf(m), 5);
      if (Labels.list) Labels.add(P[s.an], lab(m), colorOf(m), `CAVIGLIA ${s.label}/MEDIANA`); else pill(ctx, { x: P[s.an].x, y: P[s.an].y + 34 * u }, lab(m), u, colorOf(m), `CAVIGLIA ${s.label}/MEDIANA`);
    }
  }
  if (show.footMid) {
    const L = 2000;
    line(ctx, { x: hipM.x - F.up.x * L, y: hipM.y - F.up.y * L }, { x: hipM.x + F.up.x * L, y: hipM.y + F.up.y * L }, u, C.yellow, 1.5, [8, 6]);
  }
}

/** riquadro dell'atleta (pixel video) */
export function bodyBox(P) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < P.length; i++) {
    if (i > 0 && i < 7) continue;
    if (P[i].v < 0.2) continue;
    minX = Math.min(minX, P[i].x); maxX = Math.max(maxX, P[i].x); minY = Math.min(minY, P[i].y); maxY = Math.max(maxY, P[i].y);
  }
  return { minX, maxX, minY, maxY };
}
