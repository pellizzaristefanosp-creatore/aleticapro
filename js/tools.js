// Strumenti di disegno manuale degli angoli: tocca → trascina → rilascia, con lente e magnete sui landmark.
import { angle3, angleLines, vsVertical, vsHorizontal, frame, dist, LM_NAMES } from './biomech.js';
import { C, line, joint, arc, pill, text, hexA } from './draw.js';

export const TOOLS = {
  select: { label: 'Sposta', icon: 'M5 3l14 8-6 2-2 6z', pts: 0, help: 'Trascina i punti. Tocca un\'articolazione con lo strumento Auto per l\'angolo istantaneo.' },
  auto: { label: 'Auto', icon: 'M12 2l2.4 6.9H22l-6 4.4 2.3 7L12 16l-6.3 4.3 2.3-7-6-4.4h7.6z', pts: 1, help: 'Tocca un\'articolazione (anca, ginocchio, caviglia, gomito, spalla): l\'angolo si crea e segue il tracking.' },
  angle3: { label: 'Angolo', icon: 'M4 20L20 20M4 20L16 6', pts: 3, help: 'Tocca 3 punti: estremo – vertice – estremo.' },
  vertical: { label: 'vs Vert.', icon: 'M12 3v18M12 21L19 8', pts: 2, help: 'Tocca 2 punti del segmento (es. caviglia → ginocchio): angolo rispetto alla verticale del terreno.' },
  horizontal: { label: 'vs Oriz.', icon: 'M3 18h18M3 18L17 7', pts: 2, help: 'Tocca 2 punti: angolo rispetto all\'orizzontale del terreno.' },
  lines2: { label: '2 linee', icon: 'M3 6l18 4M5 20L19 4', pts: 4, help: 'Tocca 2 punti per la prima linea e 2 per la seconda: angolo fra le linee.' },
  dist: { label: 'Distanza', icon: 'M3 12h18M3 8v8M21 8v8', pts: 2, help: 'Tocca 2 punti. In metri se hai calibrato la scala.' },
  ground: { label: 'Terreno', icon: 'M2 18h20M5 14l3-3 3 3 3-3 3 3', pts: 2, help: 'Tocca 2 punti sul terreno: tutte le verticali/orizzontali vengono corrette.' },
  scale: { label: 'Scala', icon: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2', pts: 2, help: 'Tocca gli estremi di un oggetto di lunghezza nota (es. 1 m).' },
};

// articolazione toccata → terna anatomica (prossimale, vertice, distale)
const AUTO_TRIPLETS = {
  25: [23, 25, 27], 26: [24, 26, 28], // ginocchio
  23: [11, 23, 25], 24: [12, 24, 26], // anca
  27: [25, 27, 31], 28: [26, 28, 32], // caviglia
  13: [11, 13, 15], 14: [12, 14, 16], // gomito
  11: [23, 11, 13], 12: [24, 12, 14], // spalla
};

let uid = 1;
export function bumpIds(shapes) { for (const s of shapes) uid = Math.max(uid, (s.id || 0) + 1); }
export function newShape(type, pts, frameIdx) {
  const allSnapped = pts.every((p) => p.lm != null);
  return { id: uid++, type, pts, frame: frameIdx, scope: allSnapped ? 'all' : 'frame', color: C.yellow };
}

export function autoShape(lmIdx, P, frameIdx) {
  const t = AUTO_TRIPLETS[lmIdx];
  if (!t) return null;
  const s = newShape('angle3', t.map((i) => ({ x: P[i].x, y: P[i].y, lm: i })), frameIdx);
  s.color = C.blue;
  return s;
}

/** posizione attuale dei punti (segue il landmark se agganciato) */
export function resolve(shape, P) {
  return shape.pts.map((p) => (p.lm != null && P && P[p.lm] ? { x: P[p.lm].x, y: P[p.lm].y, lm: p.lm } : p));
}

export function visible(shape, frameIdx) { return shape.scope === 'all' || shape.frame === frameIdx; }

export function measure(shape, pts, env) {
  const g = env.groundRad || 0;
  switch (shape.type) {
    case 'angle3': return pts.length === 3 ? { value: angle3(pts[0], pts[1], pts[2]), unit: '°' } : null;
    case 'vertical': return pts.length === 2 ? { value: vsVertical(pts[0], pts[1], g), unit: '°' } : null;
    case 'horizontal': return pts.length === 2 ? { value: vsHorizontal(pts[0], pts[1], g), unit: '°' } : null;
    case 'lines2': return pts.length === 4 ? { value: angleLines(pts[0], pts[1], pts[2], pts[3], true), unit: '°' } : null;
    case 'dist': {
      if (pts.length !== 2) return null;
      const d = dist(pts[0], pts[1]);
      return env.pxPerM ? { value: (d / env.pxPerM) * 100, unit: 'cm' } : { value: d, unit: 'px' };
    }
    default: return null;
  }
}

export function shapeName(shape) {
  const t = TOOLS[shape.type]?.label || shape.type;
  const lm = shape.pts.map((p) => (p.lm != null ? LM_NAMES[p.lm] : null));
  if (shape.type === 'angle3' && lm[1]) return `${t} ${lm[1]}`;
  if (lm.every(Boolean)) return `${t} ${lm.join(' – ')}`;
  return t;
}

export function fmtMeasure(m) {
  if (!m) return '—';
  return m.unit === '°' ? `${m.value.toFixed(1)}°` : `${m.value.toFixed(m.unit === 'px' ? 0 : 1)} ${m.unit}`;
}

export function drawShape(ctx, shape, pts, u, env, selected = false, cursor = null) {
  const col = shape.color || C.yellow;
  const all = cursor ? [...pts, cursor] : pts;
  const F = frame(env.groundRad || 0, 1);
  ctx.save();
  switch (shape.type) {
    case 'angle3':
      if (all.length >= 2) line(ctx, all[0], all[1], u, col, 3);
      if (all.length >= 3) { line(ctx, all[1], all[2], u, col, 3); arc(ctx, all[0], all[1], all[2], u, col, `${angle3(all[0], all[1], all[2]).toFixed(1)}°`, { r: 36 }); }
      break;
    case 'vertical':
    case 'horizontal':
      if (all.length >= 2) {
        const [a, b] = all;
        const L = dist(a, b);
        line(ctx, a, b, u, col, 3);
        let ref;
        if (shape.type === 'vertical') { const sgn = (b.x - a.x) * F.up.x + (b.y - a.y) * F.up.y >= 0 ? 1 : -1; ref = { x: a.x + F.up.x * L * sgn, y: a.y + F.up.y * L * sgn }; }
        else { const sgn = (b.x - a.x) * F.g.x + (b.y - a.y) * F.g.y >= 0 ? 1 : -1; ref = { x: a.x + F.g.x * L * sgn, y: a.y + F.g.y * L * sgn }; }
        line(ctx, a, ref, u, C.white, 1.8, [7, 6]);
        const v = shape.type === 'vertical' ? vsVertical(a, b, env.groundRad) : vsHorizontal(a, b, env.groundRad);
        arc(ctx, ref, a, b, u, col, `${v.toFixed(1)}°`, { r: Math.min(60, L * 0.4 / u), sub: shape.type === 'vertical' ? 'vs VERTICALE' : 'vs ORIZZONTALE' });
      }
      break;
    case 'lines2':
      if (all.length >= 2) line(ctx, all[0], all[1], u, col, 3);
      if (all.length >= 4) {
        line(ctx, all[2], all[3], u, C.blue, 3);
        const ang = angleLines(all[0], all[1], all[2], all[3], true);
        const m = { x: (all[0].x + all[1].x + all[2].x + all[3].x) / 4, y: (all[0].y + all[1].y + all[2].y + all[3].y) / 4 };
        pill(ctx, m, `${ang.toFixed(1)}°`, u, col, 'ANGOLO FRA LINEE');
      } else if (all.length === 3) line(ctx, all[2], all[2], u, C.blue, 3);
      break;
    case 'dist':
    case 'scale':
    case 'ground':
      if (all.length >= 2) {
        const c2 = shape.type === 'ground' ? C.white : col;
        line(ctx, all[0], all[1], u, c2, shape.type === 'ground' ? 2 : 3, shape.type === 'ground' ? [10, 6] : null);
        if (shape.type === 'dist') {
          const m = measure(shape, all, env);
          pill(ctx, { x: (all[0].x + all[1].x) / 2, y: (all[0].y + all[1].y) / 2 - 22 * u }, fmtMeasure(m), u, col);
        }
        if (shape.type === 'ground') text(ctx, { x: all[1].x + 8 * u, y: all[1].y - 12 * u }, 'TERRENO', u, C.white, 11);
      }
      break;
    default: break;
  }
  for (const p of all) {
    joint(ctx, p, u, p.lm != null ? C.blue : col, selected ? 7 : 5, selected);
    if (selected) { ctx.strokeStyle = hexA(C.white, 0.35); ctx.lineWidth = 1 * u; ctx.beginPath(); ctx.arc(p.x, p.y, 16 * u, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.restore();
}

/** landmark più vicino entro raggio (pixel video) */
export function snapLandmark(p, P, radius, onlyIds = null) {
  if (!P) return null;
  let best = null, bd = radius;
  P.forEach((q, i) => {
    if (i < 11 && i !== 0 && i !== 7 && i !== 8) return;
    if (i >= 17 && i <= 22 && i !== 19 && i !== 20) return;
    if (onlyIds && !onlyIds.includes(i)) return;
    if (q.v < 0.25) return;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

export const AUTO_IDS = Object.keys(AUTO_TRIPLETS).map(Number);
