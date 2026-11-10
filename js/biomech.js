// GASA Biomechanics — cinematica 2D da landmark MediaPipe Pose.
// Tutte le misure sono PROIEZIONI 2D sul piano immagine: dipendono dall'allineamento
// della videocamera e vanno lette con il livello di confidenza associato.
// Le stesse definizioni sono replicate in python/gasa/biomech.py (tenerle allineate).

export const LM = {
  nose: 0, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lIdx: 19, rIdx: 20, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28,
  lHeel: 29, rHeel: 30, lToe: 31, rToe: 32,
};

export const LM_NAMES = {
  0: 'Naso', 7: 'Orecchio sx', 8: 'Orecchio dx', 11: 'Spalla sx', 12: 'Spalla dx',
  13: 'Gomito sx', 14: 'Gomito dx', 15: 'Polso sx', 16: 'Polso dx', 19: 'Mano sx', 20: 'Mano dx',
  23: 'Anca sx', 24: 'Anca dx', 25: 'Ginocchio sx', 26: 'Ginocchio dx', 27: 'Caviglia sx',
  28: 'Caviglia dx', 29: 'Tallone sx', 30: 'Tallone dx', 31: 'Avampiede sx', 32: 'Avampiede dx',
};

export const SIDE = {
  L: { sh: 11, el: 13, wr: 15, idx: 19, hip: 23, kn: 25, an: 27, heel: 29, toe: 31, ear: 7, label: 'SX' },
  R: { sh: 12, el: 14, wr: 16, idx: 20, hip: 24, kn: 26, an: 28, heel: 30, toe: 32, ear: 8, label: 'DX' },
};

export const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
  [7, 11], [8, 12],
];

// Modello antropometrico segmentale (de Leva, 1996, J Biomech 29:1223-1230).
// frazione di massa, posizione del CoM dal punto prossimale (frazione della lunghezza).
export const DE_LEVA = {
  M: { head: 0.0694, trunk: [0.4346, 0.4486], upperArm: [0.0271, 0.5772], forearm: [0.0162, 0.4574],
       hand: [0.0061, 0.79], thigh: [0.1416, 0.4095], shank: [0.0433, 0.4459], foot: [0.0137, 0.4415] },
  F: { head: 0.0668, trunk: [0.4257, 0.4964], upperArm: [0.0255, 0.5754], forearm: [0.0138, 0.4559],
       hand: [0.0056, 0.7474], thigh: [0.1478, 0.3612], shank: [0.0481, 0.4416], foot: [0.0129, 0.4014] },
};

// ---------- vettori ----------
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v ?? 1, b.v ?? 1) });
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const deg = (r) => (r * 180) / Math.PI;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** angolo incluso ABC in gradi (0..180) */
export function angle3(a, b, c) {
  const u = sub(a, b), w = sub(c, b);
  const d = len(u) * len(w);
  if (!d) return NaN;
  return deg(Math.acos(Math.max(-1, Math.min(1, dot(u, w) / d))));
}

/** angolo fra due rette (0..90 se acute=true, altrimenti 0..180 fra i vettori orientati) */
export function angleLines(a1, a2, b1, b2, acute = false) {
  const u = sub(a2, a1), w = sub(b2, b1);
  let t = deg(Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (len(u) * len(w) || 1)))));
  if (acute && t > 90) t = 180 - t;
  return t;
}

/** Sistema di riferimento del terreno. groundRad = inclinazione della linea del terreno nell'immagine. */
export function frame(groundRad = 0, dir = 1) {
  const g = { x: Math.cos(groundRad), y: Math.sin(groundRad) };
  const up = { x: Math.sin(groundRad), y: -Math.cos(groundRad) };
  return { g, up, f: mul(g, dir), dir };
}

/** angolo con segno di un vettore v rispetto alla verticale (verso l'alto); positivo = in avanti */
export function fromVertical(v, F) { return deg(Math.atan2(dot(v, F.f), dot(v, F.up))); }
/** rispetto alla verticale verso il basso; positivo = in avanti */
export function fromDown(v, F) { return deg(Math.atan2(dot(v, F.f), -dot(v, F.up))); }
/** angolo assoluto di una retta rispetto all'orizzontale del terreno (0..90) */
export function vsHorizontal(a, b, groundRad = 0) {
  const v = sub(b, a);
  let t = Math.abs(deg(Math.atan2(v.y, v.x) - groundRad)) % 180;
  if (t > 90) t = 180 - t;
  return t;
}
export function vsVertical(a, b, groundRad = 0) { return 90 - vsHorizontal(a, b, groundRad); }

// ---------- confidenza ----------
export const CONF = { HIGH: 'alta', MED: 'media', LOW: 'bassa' };
const RANK = { alta: 2, media: 1, bassa: 0 };
const BY_RANK = ['bassa', 'media', 'alta'];
export function confFromVis(vs) {
  const m = Math.min(...vs.map((p) => p?.v ?? 0));
  return m >= 0.8 ? CONF.HIGH : m >= 0.55 ? CONF.MED : CONF.LOW;
}
export const capConf = (c, max) => BY_RANK[Math.min(RANK[c], RANK[max])];
export const downConf = (c) => BY_RANK[Math.max(0, RANK[c] - 1)];
export const confRank = (c) => RANK[c];

/** converte landmark normalizzati in pixel */
export function toPx(lms, W, H) {
  // z MediaPipe è normalizzata come x: la riportiamo in pixel (scala W)
  return lms.map((p) => ({ x: p.x * W, y: p.y * H, z: (p.z ?? 0) * W, v: p.visibility ?? p.v ?? 0 }));
}

// ---------- vista e lato ----------
/**
 * Stima della vista: sagittale / frontale / obliqua. Combina due indizi geometrici 2D:
 *  (a) larghezza di spalle e anche rispetto alla lunghezza del tronco (≈0 di profilo);
 *  (b) posizione del naso rispetto alle orecchie (di profilo il naso è fuori dalla coppia di orecchie).
 * La profondità z di MediaPipe è troppo rumorosa per questo scopo e non viene usata.
 */
export function detectView(P) {
  const shW = Math.abs(P[11].x - P[12].x), hipW = Math.abs(P[23].x - P[24].x);
  const torso = dist(mid(P[11], P[12]), mid(P[23], P[24])) || 1;
  const r = (shW + hipW) / 2 / torso;
  const earW = Math.abs(P[7].x - P[8].x);
  const face = Math.abs(P[0].x - (P[7].x + P[8].x) / 2) / Math.max(earW, torso * 0.04);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const sWidth = clamp((0.45 - r) / 0.25);
  const faceOk = Math.min(P[0].v, P[7].v, P[8].v) > 0.5;
  const sFace = clamp((face - 0.3) / 0.7);
  const score = faceOk ? 0.6 * sWidth + 0.4 * sFace : sWidth;
  const view = score > 0.6 ? 'sagittale' : score < 0.35 ? 'frontale' : 'obliqua';
  return { view, ratio: r, face, score };
}

/** lato vicino alla camera (z MediaPipe più negativo = più vicino) */
export function nearSide(P) {
  const zl = (P[23].z + P[25].z + P[27].z + P[11].z) / 4;
  const zr = (P[24].z + P[26].z + P[28].z + P[12].z) / 4;
  const vl = P[23].v + P[25].v + P[27].v, vr = P[24].v + P[26].v + P[28].v;
  return zl + (vr - vl) * 20 < zr ? 'L' : 'R';
}

/** direzione di corsa da un singolo frame (naso rispetto alle orecchie) */
export function dirFromFace(P) {
  const e = mid(P[7], P[8]);
  return P[0].x >= e.x ? 1 : -1;
}

// ---------- centro di massa ----------
export function centerOfMass(P, sex = 'M') {
  const T = DE_LEVA[sex] || DE_LEVA.M;
  const shM = mid(P[11], P[12]), hipM = mid(P[23], P[24]);
  const parts = [];
  parts.push([mid(P[7], P[8]), T.head, [7, 8]]);
  parts.push([lerp(shM, hipM, T.trunk[1]), T.trunk[0], [11, 12, 23, 24]]);
  for (const s of [SIDE.L, SIDE.R]) {
    parts.push([lerp(P[s.sh], P[s.el], T.upperArm[1]), T.upperArm[0], [s.sh, s.el]]);
    parts.push([lerp(P[s.el], P[s.wr], T.forearm[1]), T.forearm[0], [s.el, s.wr]]);
    parts.push([lerp(P[s.wr], P[s.idx], 0.5), T.hand[0], [s.wr]]);
    parts.push([lerp(P[s.hip], P[s.kn], T.thigh[1]), T.thigh[0], [s.hip, s.kn]]);
    parts.push([lerp(P[s.kn], P[s.an], T.shank[1]), T.shank[0], [s.kn, s.an]]);
    parts.push([lerp(P[s.heel], P[s.toe], T.foot[1]), T.foot[0], [s.heel, s.toe]]);
  }
  let x = 0, y = 0, m = 0;
  const used = new Set();
  for (const [c, w, ids] of parts) { x += c.x * w; y += c.y * w; m += w; ids.forEach((i) => used.add(i)); }
  const pts = [...used].map((i) => P[i]);
  // il CoM dipende anche dagli arti controlaterali, spesso occlusi in vista sagittale: massimo "media"
  return { x: x / m, y: y / m, conf: capConf(confFromVis(pts), CONF.MED) };
}

/** punto di contatto stimato del piede (il più basso fra tallone e avampiede, nel riferimento terreno) */
export function footPoint(P, s, F) {
  const h = P[s.heel], t = P[s.toe];
  const hh = -dot(h, F.up), ht = -dot(t, F.up); // valori maggiori = più in basso
  if (Math.abs(hh - ht) < 4) return { ...mid(h, t) };
  return hh > ht ? { ...h } : { ...t };
}

/** lunghezza arto inferiore (anca-ginocchio + ginocchio-caviglia), usata per normalizzare le distanze */
export function legLength(P, s) { return dist(P[s.hip], P[s.kn]) + dist(P[s.kn], P[s.an]); }

// ---------- metriche ----------
const M = (value, conf, unit = '°', extra = {}) => ({ value, conf, unit, ...extra });

/**
 * Metriche sagittali. P in pixel, opts: {groundRad, dir, near, sex, pxPerM}
 * Convenzioni:
 *  - tronco: segmento centro anche → centro spalle vs verticale (+ = inclinato in avanti)
 *  - anca: angolo coscia rispetto al prolungamento del tronco (+ flessione, − estensione)
 *  - ginocchio: flessione = 180 − angolo incluso anca-ginocchio-caviglia
 *  - caviglia: 90 − angolo fra tibia e piede (tallone→avampiede): + dorsiflessione, − plantarflessione
 *  - tibia: segmento caviglia → ginocchio vs verticale del terreno (+ = ginocchio davanti alla caviglia)
 */
export function sagittalMetrics(P, opts = {}) {
  const F = frame(opts.groundRad || 0, opts.dir || 1);
  const near = opts.near || nearSide(P);
  const out = {};
  const shM = mid(P[11], P[12]), hipM = mid(P[23], P[24]);
  const trunkConf = confFromVis([P[11], P[12], P[23], P[24]]);
  const trunk = fromVertical(sub(shM, hipM), F);
  out.trunk = M(trunk, trunkConf, '°', { label: 'Tronco vs verticale' });
  out.trunkH = M(90 - Math.abs(trunk), trunkConf, '°', { label: 'Tronco vs orizzontale' });

  const ear = P[SIDE[near].ear];
  const neckV = sub(ear, shM);
  out.head = M(fromVertical(neckV, F) - trunk, confFromVis([ear, P[11], P[12]]), '°',
    { label: 'Testa rispetto al tronco', hint: '+ = testa avanti/flessa rispetto al tronco' });

  for (const k of ['L', 'R']) {
    const s = SIDE[k];
    const isNear = k === near;
    const adj = (c) => (isNear ? c : downConf(c));
    const thigh = fromDown(sub(P[s.kn], P[s.hip]), F);
    out[`hip${k}`] = M(thigh + trunk, adj(confFromVis([P[s.hip], P[s.kn], P[11], P[12]])), '°',
      { label: `Anca ${s.label}`, hint: '+ flessione / − estensione' });
    out[`thigh${k}`] = M(thigh, adj(confFromVis([P[s.hip], P[s.kn]])), '°', { label: `Coscia ${s.label} vs verticale` });
    out[`knee${k}`] = M(180 - angle3(P[s.hip], P[s.kn], P[s.an]), adj(confFromVis([P[s.hip], P[s.kn], P[s.an]])), '°',
      { label: `Ginocchio ${s.label} (flessione)` });
    // landmark del piede MediaPipe = stime approssimate → confidenza massima "media"
    const ank = 90 - angle3(P[s.kn], P[s.an], add(P[s.an], sub(P[s.toe], P[s.heel])));
    out[`ankle${k}`] = M(ank, capConf(adj(confFromVis([P[s.kn], P[s.an], P[s.heel], P[s.toe]])), CONF.MED), '°',
      { label: `Caviglia ${s.label}`, hint: '+ dorsiflessione / − plantarflessione' });
    out[`tibia${k}`] = M(fromVertical(sub(P[s.kn], P[s.an]), F), adj(confFromVis([P[s.kn], P[s.an]])), '°',
      { label: `Tibia ${s.label} vs verticale`, hint: '+ = ginocchio davanti alla caviglia' });
    out[`elbow${k}`] = M(angle3(P[s.sh], P[s.el], P[s.wr]), adj(confFromVis([P[s.sh], P[s.el], P[s.wr]])), '°',
      { label: `Gomito ${s.label}` });
    out[`shoulder${k}`] = M(fromDown(sub(P[s.el], P[s.sh]), F) + trunk, adj(confFromVis([P[s.sh], P[s.el], P[11], P[12]])), '°',
      { label: `Braccio ${s.label} vs tronco`, hint: '+ = avanti' });
  }

  const com = centerOfMass(P, opts.sex);
  out.com = { x: com.x, y: com.y, conf: com.conf };
  for (const k of ['L', 'R']) {
    const s = SIDE[k];
    const fp = footPoint(P, s, F);
    const L = legLength(P, s) || 1;
    const dx = dot(sub(fp, com), F.f);
    const c = capConf(k === near ? com.conf : downConf(com.conf), confFromVis([P[s.heel], P[s.toe]]));
    out[`footCom${k}`] = M((dx / L) * 100, c, '% arto',
      { label: `Piede ${SIDE[k].label} – proiezione CoM`, hint: '+ = piede davanti alla proiezione del CoM', px: dx,
        m: opts.pxPerM ? dx / opts.pxPerM : null, foot: fp });
  }
  out.meta = { near, dir: F.dir };
  return out;
}

/**
 * Metriche frontali (atleta che corre verso/da la camera).
 *  - bacino: linea anca sx–dx vs orizzontale (+ = anca dx più bassa nell'immagine)
 *  - spalle: idem
 *  - tronco laterale: centro anche → centro spalle vs verticale (+ = verso destra immagine)
 *  - FPPA ginocchio: 180 − angolo incluso; + valgo (ginocchio verso la linea mediana), − varo
 *  - piede vs linea mediana: distanza laterale della caviglia dalla linea mediana del bacino (% larghezza bacino); − = incrocia
 */
export function frontalMetrics(P, opts = {}) {
  const g = opts.groundRad || 0;
  const out = {};
  const rot = (v) => ({ x: v.x * Math.cos(-g) - v.y * Math.sin(-g), y: v.x * Math.sin(-g) + v.y * Math.cos(-g) });
  const tilt = (a, b) => { // angolo della linea a→b rispetto all'orizzontale, con segno (+ = b più basso)
    let v = rot(sub(b, a)); if (v.x < 0) v = mul(v, -1);
    return deg(Math.atan2(v.y, v.x));
  };
  const lowerName = (a, b) => (a.y > b.y ? 'sx' : 'dx');
  const pel = tilt(P[23], P[24]);
  out.pelvis = M(Math.abs(pel), confFromVis([P[23], P[24]]), '°', { label: 'Obliquità bacino', hint: `anca ${lowerName(P[23], P[24])} più bassa` });
  const sh = tilt(P[11], P[12]);
  out.shoulders = M(Math.abs(sh), confFromVis([P[11], P[12]]), '°', { label: 'Inclinazione spalle', hint: `spalla ${lowerName(P[11], P[12])} più bassa` });
  const F = frame(g, 1);
  const shM = mid(P[11], P[12]), hipM = mid(P[23], P[24]);
  const lat = fromVertical(sub(shM, hipM), F);
  out.trunkLat = M(Math.abs(lat), confFromVis([P[11], P[12], P[23], P[24]]), '°', { label: 'Tronco laterale', hint: lat >= 0 ? 'verso destra immagine' : 'verso sinistra immagine' });
  out.headTilt = M(Math.abs(tilt(P[7], P[8])), confFromVis([P[7], P[8]]), '°', { label: 'Inclinazione testa' });
  const hipW = dist(P[23], P[24]) || 1;
  for (const k of ['L', 'R']) {
    const s = SIDE[k];
    const inc = angle3(P[s.hip], P[s.kn], P[s.an]);
    const ha = sub(P[s.an], P[s.hip]);
    const hk = sub(P[s.kn], P[s.hip]);
    const cross = ha.x * hk.y - ha.y * hk.x; // lato del ginocchio rispetto alla retta anca-caviglia
    const towardMid = sub(hipM, P[s.hip]);
    const crossMid = ha.x * towardMid.y - ha.y * towardMid.x;
    const valgus = Math.sign(cross) === Math.sign(crossMid);
    // FPPA interpretabile solo in appoggio: sull'arto in volo la flessione del ginocchio la falsa
    const other = SIDE[k === 'L' ? 'R' : 'L'];
    const legL = legLength(P, s) || 1;
    const swing = P[other.an].y - P[s.an].y > 0.08 * legL;
    out[`fppa${k}`] = M((valgus ? 1 : -1) * (180 - inc), swing ? CONF.LOW : confFromVis([P[s.hip], P[s.kn], P[s.an]]), '°',
      { label: `FPPA ginocchio ${s.label}`, hint: swing ? 'arto in volo: non interpretabile' : '+ valgo / − varo (proiezione 2D, in appoggio)' });
    const side = Math.sign(P[s.hip].x - hipM.x) || 1;
    const lateral = ((P[s.an].x - hipM.x) * side) / hipW * 100;
    out[`footMid${k}`] = M(lateral, confFromVis([P[s.an], P[23], P[24]]), '% bacino',
      { label: `Caviglia ${s.label} – linea mediana`, hint: '< 0 = incrocia la linea mediana' });
  }
  return out;
}

// ---------- serie temporali ----------
/** Corregge gli scambi sx/dx delle gambe (frequenti in vista sagittale) per continuità temporale. */
export function fixLegSwaps(frames) {
  const legL = [23, 25, 27, 29, 31], legR = [24, 26, 28, 30, 32];
  let prev = null;
  let swaps = 0;
  for (const fr of frames) {
    if (!fr) { continue; }
    if (prev) {
      let keep = 0, swap = 0;
      for (let i = 1; i < legL.length; i++) {
        keep += dist(fr[legL[i]], prev[legL[i]]) + dist(fr[legR[i]], prev[legR[i]]);
        swap += dist(fr[legL[i]], prev[legR[i]]) + dist(fr[legR[i]], prev[legL[i]]);
      }
      if (swap < keep * 0.6) {
        for (let i = 0; i < legL.length; i++) { const t = fr[legL[i]]; fr[legL[i]] = fr[legR[i]]; fr[legR[i]] = t; }
        swaps++;
      }
    }
    prev = fr;
  }
  return swaps;
}

/** Media mobile centrata pesata per visibilità (window dispari). Non riempie i frame mancanti. */
export function smoothFrames(frames, win = 5) {
  if (win <= 1) return frames.map((f) => f && f.map((p) => ({ ...p })));
  const h = Math.floor(win / 2);
  return frames.map((fr, t) => {
    if (!fr) return null;
    return fr.map((p, j) => {
      let x = 0, y = 0, z = 0, w = 0;
      for (let k = -h; k <= h; k++) {
        const q = frames[t + k]?.[j];
        if (!q) continue;
        const ww = Math.max(0.05, q.v) * (1 - Math.abs(k) / (h + 1));
        x += q.x * ww; y += q.y * ww; z += q.z * ww; w += ww;
      }
      return { x: x / w, y: y / w, z: z / w, v: p.v };
    });
  });
}

/** Direzione di corsa dall'andamento del centro anche nel tempo (fallback: volto). */
export function runDirection(frames) {
  const xs = frames.map((f) => f && (f[23].x + f[24].x) / 2).filter((v) => v != null);
  if (xs.length > 4 && Math.abs(xs[xs.length - 1] - xs[0]) > 20) return xs[xs.length - 1] > xs[0] ? 1 : -1;
  const f = frames.find(Boolean);
  return f ? dirFromFace(f) : 1;
}

/**
 * Rilevamento automatico di touchdown/toe-off (vista sagittale, camera fissa).
 * Contatto = piede vicino al livello del terreno E quasi fermo orizzontalmente.
 * Restituisce eventi a confidenza "media": vanno sempre verificati sui fotogrammi.
 */
export function detectEvents(frames, opts = {}) {
  const F = frame(opts.groundRad || 0, opts.dir || 1);
  const events = [];
  const valid = frames.filter(Boolean);
  if (valid.length < 6) return events;
  const L = valid.reduce((a, P) => a + legLength(P, SIDE.L) + legLength(P, SIDE.R), 0) / (valid.length * 2) || 100;
  for (const k of ['L', 'R']) {
    const s = SIDE[k];
    const h = frames.map((P) => (P ? -dot(footPoint(P, s, F), F.up) : null));
    const xf = frames.map((P) => (P ? dot(footPoint(P, s, F), F.f) : null));
    const hv = h.filter((v) => v != null).sort((a, b) => a - b);
    const ground = hv[Math.floor(hv.length * 0.95)];
    const contact = frames.map((P, t) => {
      if (!P || h[t] == null) return false;
      const low = ground - h[t] < 0.06 * L;
      const a = xf[t - 1] ?? xf[t], b = xf[t + 1] ?? xf[t];
      const still = Math.abs((b - a) / 2) < 0.035 * L;
      return low && still;
    });
    // chiusura di buchi di 1 frame, eliminazione di contatti di 1 frame
    for (let t = 1; t < contact.length - 1; t++) if (!contact[t] && contact[t - 1] && contact[t + 1]) contact[t] = true;
    for (let t = 1; t < contact.length - 1; t++) if (contact[t] && !contact[t - 1] && !contact[t + 1]) contact[t] = false;
    for (let t = 1; t < contact.length; t++) {
      if (contact[t] && !contact[t - 1]) events.push({ frame: t, type: 'TD', foot: k, auto: true, conf: CONF.MED });
      if (!contact[t] && contact[t - 1]) events.push({ frame: t, type: 'TO', foot: k, auto: true, conf: CONF.MED });
    }
  }
  return events.sort((a, b) => a.frame - b.frame);
}

/** Tempi di contatto e di volo dagli eventi (marcati o automatici). */
export function stepTimes(events, fps) {
  const ev = [...events].filter((e) => e.type === 'TD' || e.type === 'TO').sort((a, b) => a.frame - b.frame);
  const res = { contacts: [], flights: [], resolutionMs: 1000 / fps };
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.type === 'TD') {
      const to = ev.slice(i + 1).find((x) => x.type === 'TO' && x.foot === e.foot);
      if (to) res.contacts.push({ foot: e.foot, td: e.frame, to: to.frame, ms: ((to.frame - e.frame) * 1000) / fps });
    }
    if (e.type === 'TO') {
      const td = ev.slice(i + 1).find((x) => x.type === 'TD' && x.foot !== e.foot);
      if (td) res.flights.push({ from: e.foot, to: td.foot, toFrame: e.frame, tdFrame: td.frame, ms: ((td.frame - e.frame) * 1000) / fps });
    }
  }
  // a < 100 fps l'errore di ±1 frame è rilevante rispetto a contatti di 100-200 ms
  res.conf = fps >= 200 ? CONF.HIGH : fps >= 100 ? CONF.MED : CONF.LOW;
  return res;
}

/** Negative step: spostamento all'indietro del piede prima della prima spinta in avanti. */
export function negativeStep(frames, startFrame, foot, opts = {}) {
  const F = frame(opts.groundRad || 0, opts.dir || 1);
  const s = SIDE[foot];
  const seq = [];
  for (let t = startFrame; t < Math.min(frames.length, startFrame + 30); t++) {
    const P = frames[t];
    if (P) seq.push({ t, x: dot(footPoint(P, s, F), F.f), L: legLength(P, s) });
  }
  if (seq.length < 4) return { status: 'non valutabile', conf: CONF.LOW };
  const x0 = seq[0].x, L = seq[0].L || 100;
  let minX = x0, minT = seq[0].t;
  for (const p of seq) { if (p.x < minX) { minX = p.x; minT = p.t; } if (p.x > x0 + 0.1 * L) break; }
  const back = ((x0 - minX) / L) * 100;
  if (back > 5) return { status: 'presente', backPct: back, frame: minT, conf: CONF.MED };
  if (back > 2) return { status: 'movimento preparatorio / incerto', backPct: back, frame: minT, conf: CONF.LOW };
  return { status: 'assente', backPct: back, conf: CONF.MED };
}
