// Reel animato 9:16 generato nel browser: analisi del fotogramma (foto o video in pausa) con
// zoom sulle articolazioni, archi animati, valori con confidenza, sottotitoli e schede finali.
import { S, poseAt, metricsAt, activeMetricKeys, media, viewAt } from './app.js';
import * as B from './biomech.js';
import * as T from './tools.js';
import { drawSkeleton, bodyBox } from './overlay.js';
import { C, CONF_COLOR, fmt, line, joint, arc, pill, roundRect, hexA } from './draw.js';

const FONT = '"Inter", "SF Pro Display", system-ui, sans-serif';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// ---------------- geometria degli angoli per l'animazione ----------------
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const len = (a) => Math.hypot(a.x, a.y);
const ext = (from, through, k) => add(through, mul(sub(through, from), k));

/** vertice, raggio di riferimento (a), segmento misurato (c) e linee extra per ogni metrica */
export function geometry(key, P, M, view) {
  const side = /[LR]$/.test(key) ? key.slice(-1) : null;
  const base = side ? key.slice(0, -1) : key;
  const s = side ? B.SIDE[side] : null;
  const dir = M.meta?.dir || 1;
  const F = B.frame(S.groundRad, view === 'frontale' ? 1 : dir);
  const sh = M.meta?.sh || B.mid(P[11], P[12]);
  const hip = M.meta?.hip || B.mid(P[23], P[24]);
  const g = (k) => P[s[k]];
  const up = F.up, down = mul(F.up, -1);
  switch (base) {
    case 'trunk': { const L = len(sub(sh, hip)); return { v: hip, a: add(hip, mul(up, L)), c: sh, ref: 'dashed' }; }
    case 'trunkH': { const L = len(sub(sh, hip)); const sg = Math.sign((sh.x - hip.x) * F.g.x + (sh.y - hip.y) * F.g.y) || 1; return { v: hip, a: add(hip, mul(F.g, L * sg)), c: sh, ref: 'dashed' }; }
    case 'head': { const ear = P[B.SIDE[M.meta?.near || 'L'].ear]; return { v: sh, a: ext(hip, sh, 0.4), c: ear, ref: 'dashed' }; }
    case 'hip': return { v: g('hip'), a: ext(sh, g('hip'), 0.5), c: g('kn'), ref: 'dashed', extra: [[sh, g('hip')]] };
    case 'thigh': { const L = len(sub(g('kn'), g('hip'))); return { v: g('hip'), a: add(g('hip'), mul(down, L)), c: g('kn'), ref: 'dashed' }; }
    case 'knee': return { v: g('kn'), a: ext(g('hip'), g('kn'), 0.5), c: g('an'), ref: 'dashed', extra: [[g('hip'), g('kn')]] };
    case 'ankle': { const fd = sub(g('toe'), g('heel')); return { v: g('an'), a: add(g('an'), fd), c: g('kn'), ref: 'dashed', extra: [[g('heel'), g('toe')]], abs: true }; }
    case 'tibia': { const L = len(sub(g('kn'), g('an'))); return { v: g('an'), a: add(g('an'), mul(up, L * 1.05)), c: g('kn'), ref: 'vertical' }; }
    case 'elbow': return { v: g('el'), a: g('sh'), c: g('wr'), ref: 'solid' };
    case 'bodyLine': {
      const fp = B.footPoint(P, s, F); const L = len(sub(sh, fp));
      const sg = Math.sign((sh.x - fp.x) * F.g.x + (sh.y - fp.y) * F.g.y) || 1;
      return { v: fp, a: add(fp, mul(F.g, L * 0.8 * sg)), c: sh, ref: 'horizontal' };
    }
    case 'pelvis': case 'shoulders': case 'headTilt': {
      const [i, j] = base === 'pelvis' ? [23, 24] : base === 'shoulders' ? [11, 12] : [7, 8];
      const a = P[i], b = P[j]; const right = a.x > b.x ? a : b; const left = a.x > b.x ? b : a;
      const L = len(sub(right, left));
      return { v: left, a: add(left, mul(F.g, L * 1.2)), c: right, ref: 'horizontal' };
    }
    case 'trunkLat': { const L = len(sub(sh, hip)); return { v: hip, a: add(hip, mul(up, L)), c: sh, ref: 'dashed' }; }
    case 'fppa': return { v: g('kn'), a: ext(g('hip'), g('kn'), 0.5), c: g('an'), ref: 'dashed', extra: [[g('hip'), g('kn')]], abs: true };
    default: return null;
  }
}

// ---------------- testi narrativi (solo valori misurati) ----------------
function sentence(key, m) {
  if (!m) return '';
  if (m.conf === 'bassa') return `${m.label}: non misurabile in modo affidabile in questo fotogramma.`;
  const v = Math.abs(m.value).toFixed(0);
  const base = key.replace(/[LR]$/, '');
  const conf = m.conf === 'media' ? ' Confidenza media.' : '';
  switch (base) {
    case 'trunk': return `Tronco inclinato di ${v}° rispetto alla verticale.${conf}`;
    case 'trunkH': return `Tronco a ${v}° dal suolo.${conf}`;
    case 'head': return `Testa ${m.value >= 0 ? 'flessa' : 'estesa'} di ${v}° rispetto al tronco.${conf}`;
    case 'hip': return `${m.label}: ${v}° di ${m.value >= 0 ? 'flessione' : 'estensione'} rispetto al tronco.${conf}`;
    case 'knee': return `${m.label.replace(' (flessione)', '')}: ${v}° di flessione${m.value < 10 ? ', quasi esteso' : ''}.${conf}`;
    case 'ankle': return `${m.label}: ${v}° di ${m.value >= 0 ? 'dorsiflessione' : 'plantarflessione'}. I punti del piede sono stimati.`;
    case 'tibia': return `${m.label}: ${v}°${m.value > 0 ? ', ginocchio davanti alla caviglia' : ''}.${conf}`;
    case 'bodyLine': return `Linea del corpo dal piede alle spalle: ${v}° dal suolo.${conf}`;
    case 'fppa': return `${m.label}: ${v}° di ${m.value >= 0 ? 'valgo' : 'varo'} in proiezione 2D.${conf}`;
    default: return `${m.label}: ${fmt(m)}.${conf}`;
  }
}

// ---------------- impaginazione ----------------
const OW = 1080, OH = 1920, VY = 250, VH = 1180, FPS = 30;

function wrap(c, str, maxW) {
  const words = str.split(' '); const out = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (c.measureText(t).width <= maxW) cur = t; else { if (cur) out.push(cur); cur = w; } }
  if (cur) out.push(cur);
  return out;
}
function txt(c, x, y, s, size, color, weight = 800, align = 'left', alpha = 1) {
  c.save(); c.globalAlpha = alpha; c.font = `${weight} ${size}px ${FONT}`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'alphabetic';
  c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 6; c.fillText(s, x, y); c.restore();
}

/** sfondo sfocato economico (compatibile Safari: niente ctx.filter) */
let blurCache = null;
function blurred(src) {
  if (blurCache?.src === src && blurCache.w === S.W) return blurCache.cv;
  const small = document.createElement('canvas'); small.width = 48; small.height = Math.max(1, Math.round(48 * S.H / S.W));
  small.getContext('2d').drawImage(src, 0, 0, small.width, small.height);
  blurCache = { src, w: S.W, cv: small };
  return small;
}

function camFit(P) {
  const b = bodyBox(P);
  const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
  const k = Math.min((OW * 0.86) / Math.max(bw, 1), (VH * 0.8) / Math.max(bh, 1), (OW * 2.5) / S.W * 2);
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, k: Math.max(k, Math.min(OW / S.W, VH / S.H)) };
}
const lerpCam = (a, b, t) => ({ cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t, k: a.k * Math.pow(b.k / a.k, t) });
const mapC = (cam, p) => ({ x: (p.x - cam.cx) * cam.k + OW / 2, y: (p.y - cam.cy) * cam.k + VY + VH / 2 });

function drawBase(c, cam, dim = 0) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = C.bg; c.fillRect(0, 0, OW, OH);
  const src = media();
  // sfondo sfocato a riempimento
  const bl = blurred(src);
  const kb = Math.max(OW / S.W, VH / S.H);
  c.save(); c.globalAlpha = 0.45; c.imageSmoothingQuality = 'high';
  c.drawImage(bl, (OW - S.W * kb) / 2, VY + (VH - S.H * kb) / 2, S.W * kb, S.H * kb);
  c.restore();
  c.save();
  c.beginPath(); c.rect(0, VY, OW, VH); c.clip();
  c.setTransform(cam.k, 0, 0, cam.k, OW / 2 - cam.cx * cam.k, VY + VH / 2 - cam.cy * cam.k);
  c.drawImage(src, 0, 0, S.W, S.H);
  c.restore();
  if (dim) { c.fillStyle = `rgba(8,13,20,${dim})`; c.fillRect(0, VY, OW, VH); }
  const gr1 = c.createLinearGradient(0, VY, 0, VY + 40); gr1.addColorStop(0, C.bg); gr1.addColorStop(1, 'rgba(8,13,20,0)');
  c.fillStyle = gr1; c.fillRect(0, VY, OW, 40);
  const gr2 = c.createLinearGradient(0, VY + VH - 40, 0, VY + VH); gr2.addColorStop(0, 'rgba(8,13,20,0)'); gr2.addColorStop(1, C.bg);
  c.fillStyle = gr2; c.fillRect(0, VY + VH - 40, OW, 40);
}

/** entra nel sistema di coordinate video (clip sull'area video). Restituisce u = 1 px di uscita × 2 */
function enterVideo(c, cam) {
  c.save(); c.beginPath(); c.rect(0, VY, OW, VH); c.clip();
  c.setTransform(cam.k, 0, 0, cam.k, OW / 2 - cam.cx * cam.k, VY + VH / 2 - cam.cy * cam.k);
  return 2.2 / cam.k;
}

function chrome(c, chapter, footer, title) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = C.blue; c.fillRect(60, 92, 6, 90);
  c.font = `900 46px ${FONT}`;
  txt(c, 86, 136, 'GASA', 46, C.blue, 900);
  txt(c, 86 + c.measureText('GASA ').width, 136, 'BIOMECHANICS', 46, C.white, 900);
  txt(c, 88, 176, chapter, 26, '#C9D2DD', 700);
  txt(c, 60, OH - 60, footer, 24, C.grey, 600);
  txt(c, OW - 60, OH - 60, title || 'ANALYZE. UNDERSTAND. PERFORM.', 24, C.white, 700, 'right');
}

function subtitle(c, s, a = 1) {
  if (!s) return;
  c.save(); c.font = `700 42px ${FONT}`;
  const lines = wrap(c, s, OW - 170).slice(0, 3);
  const y0 = OH - 150 - 58 * lines.length;
  c.globalAlpha = a * 0.86; c.fillStyle = C.bg; roundRect(c, 60, y0 - 50, OW - 120, 58 * lines.length + 40, 20); c.fill();
  c.restore();
  lines.forEach((l, n) => txt(c, OW / 2, y0 + n * 58, l, 42, C.white, 700, 'center', a));
}

function pillOut(c, p, value, sub, color, a = 1) {
  c.save(); c.globalAlpha = a; pill(c, p, value, 3.6, color, sub); c.restore();
}

/** animazione di un angolo: punto → segmenti → arco → valore */
function animAngle(c, cam, G, m, prog) {
  const u = enterVideo(c, cam);
  const col = CONF_COLOR[m.conf] || C.grey;
  const p1 = ease(prog / 0.25), p2 = ease((prog - 0.2) / 0.35), p3 = ease((prog - 0.5) / 0.3);
  if (G.extra) for (const [a, b] of G.extra) line(c, a, add(a, mul(sub(b, a), p2)), u, col, 2.5);
  if (G.ref === 'dashed') line(c, G.v, add(G.v, mul(sub(G.a, G.v), p2)), u, C.white, 1.6, [6, 5]);
  if (G.ref === 'vertical' || G.ref === 'horizontal') line(c, G.v, add(G.v, mul(sub(G.a, G.v), p2)), u, C.yellow, 1.8, [7, 6]);
  if (G.ref === 'solid') line(c, G.v, add(G.v, mul(sub(G.a, G.v), p2)), u, col, 3);
  if (p2 > 0) { c.save(); c.shadowColor = col; c.shadowBlur = 14 * u; line(c, G.v, add(G.v, mul(sub(G.c, G.v), p2)), u, col, 4.5); c.restore(); }
  joint(c, G.v, u, col, 5 + 3 * p1, true);
  const measurable = m.conf !== 'bassa' || S.showLow;
  if (p3 > 0 && measurable) arc(c, G.a, G.v, G.c, u, col, null, { r: 40, progress: p3 });
  c.restore();
  if (p3 > 0.6) {
    const v = mapC(cam, G.v);
    const lx = Math.min(Math.max(v.x > OW / 2 ? v.x - 280 : v.x + 280, 260), OW - 260);
    const ly = Math.min(Math.max(v.y - 170, VY + 110), VY + VH - 110);
    c.save(); c.globalAlpha = ease((p3 - 0.6) / 0.4) * 0.8; line(c, v, { x: lx, y: ly }, 1, col, 2); c.restore();
    const val = measurable ? `${m.conf === 'bassa' ? '~' : ''}${(G.abs ? Math.abs(m.value) : m.value).toFixed(0)}°` : 'n.m.';
    pillOut(c, { x: lx, y: ly }, val, `${m.label.toUpperCase()} · ${m.conf}`, col, ease((p3 - 0.6) / 0.4));
  }
}

// ---------------- storyboard ----------------
export function buildStoryboard(opts = {}) {
  const f = S.frame;
  const P = poseAt(f);
  if (!P) throw new Error('Nessun atleta rilevato nel fotogramma corrente');
  const mm = metricsAt(f);
  const view = mm.view;
  // nel Reel si mostrano entrambi gli arti (l'arto di spinta è spesso quello lontano dalla camera)
  const legsSaved = S.legs;
  if (S.legs === 'near') S.legs = 'both';
  let keys = activeMetricKeys(mm).filter((k) => mm.M[k]?.unit === '°' && geometry(k, P, mm.M, view));
  S.legs = legsSaved;
  if (keys.includes('trunkH')) keys = keys.filter((k) => k !== 'trunk'); // un solo angolo del tronco (rispetto al suolo)
  if (view !== 'frontale' && keys.some((k) => k.startsWith('bodyLine'))) {
    // linea del corpo solo per l'arto più esteso (arto di spinta stimato)
    const push = (mm.M.kneeL?.value ?? 999) <= (mm.M.kneeR?.value ?? 999) ? 'L' : 'R';
    keys = keys.filter((k) => !k.startsWith('bodyLine') || k === `bodyLine${push}`);
  }
  // ordine: tronco/testa, poi arto di spinta (più esteso), poi l'altro
  const pushLeg = (mm.M.kneeL?.value ?? 999) <= (mm.M.kneeR?.value ?? 999) ? 'L' : 'R';
  const rank = (k) => (/[LR]$/.test(k) ? (k.endsWith(pushLeg) ? 1 : 2) : 0);
  keys.sort((a, b) => rank(a) - rank(b));
  const measured = keys.filter((k) => mm.M[k].conf !== 'bassa');
  const lowKeys = keys.filter((k) => mm.M[k].conf === 'bassa');
  const shapes = S.shapes.filter((sh) => T.visible(sh, f));
  const scenes = [{ k: 'hook', d: 3, sub: opts.subHook || 'Analisi biomeccanica di questo fotogramma.' }];
  if (opts.preroll && !S.isImage && S.analyzed && f > S.rangeIn) {
    const from = Math.max(S.rangeIn, f - Math.round(S.fps * 0.6));
    scenes.push({ k: 'play', from, to: f, slow: 4, d: ((f - from + 1) / S.fps) * 4 + 0.4, sub: 'Rallentiamo fino al fotogramma analizzato.' });
  }
  if (shapes.length) scenes.push({ k: 'shapes', shapes, d: 1.4 * shapes.length + 2.2, sub: 'Gli angoli che hai disegnato.' });
  scenes.push({ k: 'skel', d: 2.4, sub: 'Riconoscimento automatico delle articolazioni.' });
  for (const k of measured.slice(0, 9)) scenes.push({ k: 'metric', key: k, d: 3.8, sub: sentence(k, mm.M[k]) });
  scenes.push({ k: 'concl', d: 6.5, measured, lowKeys, sub: null });
  scenes.push({ k: 'end', d: 2.5, sub: null });
  let t = 0;
  for (const s of scenes) { s.t0 = t; t += s.d; }
  return { scenes, total: t, f, P, mm, view };
}

function renderAt(c, sb, tt, opts) {
  const s = sb.scenes.find((x) => tt >= x.t0 && tt < x.t0 + x.d) || sb.scenes[sb.scenes.length - 1];
  const lt = tt - s.t0;
  const { P, mm, view } = sb;
  const wide = camFit(P);
  const near = mm.M.meta?.near || 'L';
  const chap = { hook: 'ANALISI', play: 'AVVICINAMENTO', shapes: 'ANGOLI DISEGNATI', skel: 'TRACKING ARTICOLARE', metric: 'MISURA', concl: 'CONCLUSIONI', end: '' }[s.k];
  let footer = `${S.isImage ? 'FOTO' : `F ${sb.f} · ${(sb.f / S.fps).toFixed(3)} s`} · VISTA ${view.toUpperCase()} · MISURE 2D`;
  if (s.k === 'hook') {
    const cam = lerpCam(wide, { ...wide, k: wide.k * 1.12 }, ease(lt / s.d));
    drawBase(c, cam, 0.25);
    const u = enterVideo(c, cam);
    const legs = view === 'frontale' ? [] : [near === 'L' ? 'R' : 'L', near];
    for (const k of legs) for (const n of ['hip', 'kn', 'an']) joint(c, P[B.SIDE[k][n]], u, C.blue, 7 * ease((lt - 0.5) / 0.6), true);
    c.restore();
    const a = ease(lt / 0.6);
    c.save(); c.font = `900 80px ${FONT}`;
    wrap(c, (opts.title || 'TRIPLA ESTENSIONE: C\'È DAVVERO?').toUpperCase(), OW - 140).slice(0, 3).forEach((l, n) => txt(c, 70, VY + 110 + n * 92, l, 80, n ? C.white : C.blue, 900, 'left', a));
    c.restore();
  } else if (s.k === 'play') {
    const i = Math.min(s.to, s.from + Math.floor((lt / s.slow) * S.fps));
    const Pi = poseAt(i) || P;
    const cam = camFit(Pi);
    drawBase(c, cam, 0.1);
    const u = enterVideo(c, cam); drawSkeleton(c, Pi, u / 1.4, near, view); c.restore();
    footer = `F ${i} · RALLENTATO ${s.slow}×`;
  } else if (s.k === 'shapes') {
    drawBase(c, wide, 0.12);
    const u = enterVideo(c, wide);
    s.shapes.forEach((sh, n) => {
      const a = ease((lt - 0.4 - n * 1.4) / 0.6);
      if (a <= 0) return;
      c.save(); c.globalAlpha = a;
      T.drawShape(c, sh, T.resolve(sh, P), u / 1.2, { groundRad: S.groundRad, pxPerM: S.pxPerM });
      c.restore();
    });
    c.restore();
  } else if (s.k === 'skel') {
    drawBase(c, wide, 0.18);
    const u = enterVideo(c, wide);
    c.save(); c.globalAlpha = ease(lt / 0.9); drawSkeleton(c, P, u / 1.4, near, view); c.restore();
    c.restore();
  } else if (s.k === 'metric') {
    const m = mm.M[s.key];
    const G = geometry(s.key, P, mm.M, view);
    const segL = Math.max(len(sub(G.c, G.v)), len(sub(G.a, G.v)), 1);
    const kz = Math.min(wide.k * 2.1, (VH * 0.42) / segL);
    const focus = add(G.v, mul(sub(add(G.a, G.c), mul(G.v, 2)), 0.25));
    const z = ease(lt / 0.8) * (1 - ease((lt - (s.d - 0.5)) / 0.5));
    const cam = lerpCam(wide, { cx: focus.x, cy: focus.y, k: Math.max(wide.k, kz) }, z);
    drawBase(c, cam, 0.18);
    const u = enterVideo(c, cam); c.save(); c.globalAlpha = 0.45; drawSkeleton(c, P, u / 1.4, near, view); c.restore(); c.restore();
    animAngle(c, cam, G, m, Math.min(1, Math.max(0, lt - 0.45) / 1.6));
    c.setTransform(1, 0, 0, 1, 0, 0);
    const name = m.label.toUpperCase();
    c.save(); c.font = `900 54px ${FONT}`; txt(c, 70, VY + 80, wrap(c, name, OW - 140)[0], 54, C.blue, 900, 'left', ease(lt / 0.4)); c.restore();
  } else if (s.k === 'concl') {
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = C.bg; c.fillRect(0, 0, OW, OH);
    txt(c, 70, VY + 70, 'SINTESI', 66, C.white, 900);
    const rows = s.measured.slice(0, 9);
    rows.forEach((k, n) => {
      const m = mm.M[k]; const a = ease((lt - 0.3 - n * 0.18) / 0.4); const y = VY + 170 + n * 92;
      c.save(); c.globalAlpha = a * 0.95; c.fillStyle = 'rgba(21,33,49,0.95)'; roundRect(c, 60, y, OW - 120, 78, 14); c.fill();
      c.fillStyle = CONF_COLOR[m.conf]; c.fillRect(60, y + 14, 6, 50); c.restore();
      c.save(); c.font = `700 30px ${FONT}`; const lab = wrap(c, m.label, 640)[0]; c.restore();
      txt(c, 90, y + 50, lab, 30, C.white, 700, 'left', a);
      txt(c, OW - 90, y + 52, fmt(m), 40, CONF_COLOR[m.conf], 900, 'right', a);
    });
    const yN = VY + 190 + rows.length * 92;
    const notes = [];
    if (s.lowKeys.length) notes.push(`Non misurabili qui: ${s.lowKeys.map((k) => mm.M[k].label).join(', ')}.`);
    notes.push(S.isImage || !S.analyzed ? 'Un solo fotogramma: non mostra toe-off, tempi né sequenza delle estensioni.' : 'Misure su un fotogramma della sequenza analizzata.');
    notes.push('Proiezioni 2D: dipendono dall\'allineamento della camera. Blu = confidenza alta, giallo = media.');
    c.save(); c.font = `600 28px ${FONT}`; let y = yN;
    for (const nt of notes) for (const l of wrap(c, nt, OW - 140)) { txt(c, 70, y, l, 28, '#C9D2DD', 600, 'left', ease((lt - 1.5) / 0.6)); y += 40; }
    c.restore();
  } else {
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = C.bg; c.fillRect(0, 0, OW, OH);
    const a = ease(lt / 0.8);
    txt(c, OW / 2, OH / 2 - 70, 'GASA', 150, C.blue, 900, 'center', a);
    txt(c, OW / 2, OH / 2 + 40, 'BIOMECHANICS', 74, C.white, 900, 'center', a);
    txt(c, OW / 2, OH / 2 + 130, 'ANALYZE. UNDERSTAND. PERFORM.', 38, '#C9D2DD', 700, 'center', ease((lt - 0.5) / 0.8));
    return s;
  }
  chrome(c, chap, footer, null);
  subtitle(c, s.sub, Math.min(1, lt / 0.3));
  // dissolvenze tra scene
  const fade = Math.min(1, lt / 0.25, (s.d - lt) / 0.25);
  if (fade < 1) { c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = `rgba(8,13,20,${1 - Math.max(0, fade)})`; c.fillRect(0, 0, OW, OH); }
  return s;
}

/** anteprima di un istante (usata nei test) */
export function previewAt(cv, tt, opts = {}) {
  cv.width = OW; cv.height = OH;
  const sb = buildStoryboard(opts);
  renderAt(cv.getContext('2d'), sb, tt, opts);
  return sb;
}

function pickMime() {
  const c = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return c.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

/** registra il Reel in tempo reale con MediaRecorder (MP4 su Safari/Chrome recenti, altrimenti WebM) */
export async function recordReel(opts) {
  if (!window.MediaRecorder) throw new Error('Questo browser non supporta la registrazione video');
  const sb = buildStoryboard(opts);
  const cv = document.createElement('canvas'); cv.width = OW; cv.height = OH;
  const c = cv.getContext('2d');
  renderAt(c, sb, 0, opts);
  const canReq = typeof CanvasCaptureMediaStreamTrack !== 'undefined' && 'requestFrame' in CanvasCaptureMediaStreamTrack.prototype;
  const stream = cv.captureStream(canReq ? 0 : FPS);
  const track = stream.getVideoTracks()[0];
  const mime = pickMime();
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 10e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(250);
  const n = Math.ceil(sb.total * FPS);
  let lastPlayFrame = -1;
  const t0 = performance.now();
  let pausedMs = 0;
  for (let i = 0; i < n; i++) {
    if (opts.cancelled?.()) break;
    const tt = i / FPS;
    const s = sb.scenes.find((x) => tt >= x.t0 && tt < x.t0 + x.d);
    if (s?.k === 'play') {
      const fi = Math.min(s.to, s.from + Math.floor(((tt - s.t0) / s.slow) * S.fps));
      if (fi !== lastPlayFrame) {
        const tp = performance.now(); rec.pause(); await opts.seek(fi); rec.resume(); pausedMs += performance.now() - tp; lastPlayFrame = fi;
      }
    } else if (lastPlayFrame !== -1 && lastPlayFrame !== sb.f) {
      const tp = performance.now(); rec.pause(); await opts.seek(sb.f); rec.resume(); pausedMs += performance.now() - tp; lastPlayFrame = sb.f;
    }
    renderAt(c, sb, tt, opts);
    if (canReq) track.requestFrame();
    const target = t0 + pausedMs + ((i + 1) * 1000) / FPS;
    const wait = target - performance.now();
    if (wait > 0) await sleep(wait);
    if (i % 10 === 0) opts.onProgress?.(i / n, `Reel animato ${Math.round((i / n) * 100)}%`);
  }
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  const type = rec.mimeType || mime || 'video/webm';
  return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm', duration: sb.total };
}
