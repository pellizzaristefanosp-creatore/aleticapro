// GASA Biomechanics — Sprint Lab: controller principale.
import * as B from './biomech.js';
import { getLandmarker, resetVideoLandmarker, landmarksFromResult } from './pose.js';
import { drawSkeleton, drawSagittal, drawFrontal, legsToShow, bodyBox } from './overlay.js';
import * as T from './tools.js';
import { C, CONF_COLOR, fmt, text as drawText, Labels } from './draw.js';
import { exportPNG, exportCSV, exportJSON, exportMarkdown, exportVideo, renderFrameTo } from './export.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const video = $('#video');
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
const stage = $('#stage');

const SAG_CHIPS = [
  ['trunk', 'Tronco'], ['head', 'Testa'], ['hip', 'Anca'], ['knee', 'Ginocchio'], ['ankle', 'Caviglia'],
  ['tibia', 'Tibia'], ['thigh', 'Coscia'], ['com', 'CoM / piede'], ['arms', 'Gomiti'],
];
const FRONT_CHIPS = [
  ['pelvis', 'Bacino'], ['shoulders', 'Spalle'], ['trunkLat', 'Tronco lat.'], ['headTilt', 'Testa'],
  ['fppa', 'Ginocchia (FPPA)'], ['footMid', 'Piedi / mediana'],
];

export const S = {
  loaded: false, W: 0, H: 0, fps: 30, fpsAuto: true, nFrames: 0, frame: 0, name: 'video',
  raw: [], px: [], analyzed: false, rangeIn: 0, rangeOut: 0,
  view: 'auto', groundRad: 0, groundShape: null, pxPerM: null, dirSetting: 0, dir: 1, sex: 'M', smooth: 5, model: 'full',
  legs: 'near',
  show: { trunk: true, head: false, hip: true, knee: true, ankle: true, tibia: true, thigh: false, com: false, arms: false,
          pelvis: true, shoulders: true, trunkLat: true, headTilt: false, fppa: true, footMid: false },
  skeleton: true, live: true, showLow: false,
  shapes: [], tool: 'select', magnet: true, sel: null, draft: null, history: [],
  events: [], A: null, B: null, chartKeys: ['trunk', 'kneeL', 'kneeR'],
  zoom: 1, panX: 0, panY: 0, busy: false, cancel: false, playing: false,
};

// ---------------- dati per frame ----------------
export function poseAt(f) { return S.px[f] || null; }

export function viewAt(f) {
  if (S.view !== 'auto') return S.view;
  if (S.analyzed && S.seqView) return S.seqView;
  const P = poseAt(f);
  return P ? B.detectView(P).view : 'sagittale';
}

export function metricsAt(f) {
  const P = poseAt(f);
  if (!P) return null;
  const v = viewAt(f);
  if (v === 'frontale') return { view: v, M: B.frontalMetrics(P, { groundRad: S.groundRad }) };
  const near = S.seqNear || B.nearSide(P);
  const dir = S.dirSetting || (S.analyzed ? S.dir : B.dirFromFace(P));
  const M = B.sagittalMetrics(P, { groundRad: S.groundRad, dir, near, sex: S.sex, pxPerM: S.pxPerM });
  const oblique = v === 'obliqua';
  // vista obliqua: la prospettiva distorce gli angoli sagittali → un livello di confidenza in meno ovunque
  if (oblique) for (const k of Object.keys(M)) if (M[k]?.conf) M[k].conf = B.downConf(M[k].conf);
  return { view: 'sagittale', oblique, M };
}

function setPose(f, lms) {
  S.raw[f] = lms;
  S.px[f] = lms ? B.toPx(lms, S.W, S.H) : null;
}

function rebuildSeries() {
  const px = S.raw.map((l) => (l ? B.toPx(l, S.W, S.H) : null));
  const swaps = B.fixLegSwaps(px);
  S.px = B.smoothFrames(px, S.smooth);
  S.swaps = swaps;
  const valid = S.px.filter(Boolean);
  S.dir = B.runDirection(S.px);
  const views = valid.map((P) => B.detectView(P).view);
  const count = (v) => views.filter((x) => x === v).length;
  S.seqView = count('frontale') > count('sagittale') + count('obliqua') ? 'frontale' : (count('obliqua') > count('sagittale') ? 'obliqua' : 'sagittale');
  const nearVotes = valid.map((P) => B.nearSide(P));
  S.seqNear = nearVotes.filter((v) => v === 'L').length >= nearVotes.length / 2 ? 'L' : 'R';
}

// ---------------- video ----------------
$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  S.name = file.name.replace(/\.[^.]+$/, '');
  video.src = URL.createObjectURL(file);
  e.target.value = '';
});

video.addEventListener('loadedmetadata', async () => {
  S.W = video.videoWidth; S.H = video.videoHeight;
  S.raw = []; S.px = []; S.analyzed = false; S.events = []; S.shapes = []; S.A = S.B = null; S.seqView = null; S.seqNear = null;
  S.groundRad = 0; S.groundShape = null; S.pxPerM = null;
  $('#empty').hidden = true;
  S.loaded = false;
  if (S.fpsAuto) S.fps = await detectFps();
  setupFrames();
  S.loaded = true;
  fit();
  S.follow = true; $('#btnFollow').classList.add('on');
  await gotoFrame(0);
  $('#btnAnalyze').disabled = false;
  hint(`Video ${S.W}×${S.H} · ${S.fps} fps${S.fpsAuto ? ' (stimati)' : ''} · ${video.duration.toFixed(2)} s`);
  refreshAll();
});

function setupFrames() {
  S.nFrames = Math.max(1, Math.floor(video.duration * S.fps + 1e-6));
  S.rangeIn = 0; S.rangeOut = S.nFrames - 1;
  $('#scrub').max = S.nFrames - 1;
}

/** Stima del frame rate dai mediaTime dei fotogrammi presentati (riproduzione rallentata). */
function detectFps() {
  return new Promise((resolve) => {
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return resolve(30);
    const times = [];
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      video.pause(); video.playbackRate = 1;
      const d = [];
      for (let i = 1; i < times.length; i++) { const x = times[i] - times[i - 1]; if (x > 0.0005) d.push(x); }
      d.sort((a, b) => a - b);
      if (d.length < 4) return resolve(30);
      const med = d[Math.floor(d.length * 0.3)];
      const raw = 1 / med;
      const common = [24, 25, 30, 48, 50, 60, 90, 100, 120, 180, 240];
      const snap = common.find((c) => Math.abs(c - raw) / c < 0.06);
      video.currentTime = 0;
      resolve(snap || Math.round(raw));
    };
    const cb = (now, meta) => { times.push(meta.mediaTime); if (times.length < 24 && !done) video.requestVideoFrameCallback(cb); else finish(); };
    video.requestVideoFrameCallback(cb);
    video.playbackRate = 0.2;
    video.muted = true;
    video.play().catch(() => finish());
    setTimeout(finish, 2500);
  });
}

function seekFrame(f) {
  return new Promise((resolve) => {
    const t = Math.min(video.duration - 0.0005, (f + 0.5) / S.fps);
    let settled = false;
    const done = () => { if (settled) return; settled = true; video.removeEventListener('seeked', onSeek); resolve(); };
    const onSeek = () => {
      if ('requestVideoFrameCallback' in video) { video.requestVideoFrameCallback(() => done()); setTimeout(done, 150); } else done();
    };
    if (Math.abs(video.currentTime - t) < 1e-6 && video.readyState >= 2) return resolve();
    video.addEventListener('seeked', onSeek);
    video.currentTime = t;
    setTimeout(done, 3000);
  });
}

let seekToken = 0;
export async function gotoFrame(f, detect = true) {
  if (!S.loaded) return;
  f = Math.max(0, Math.min(S.nFrames - 1, Math.round(f)));
  S.frame = f;
  const token = ++seekToken;
  await seekFrame(f);
  if (token !== seekToken) return;
  render();
  updateTransport();
  if (detect && S.live && !S.raw[f] && !S.busy) {
    await detectSingle(f, token);
  }
  refreshValues();
}

async function detectSingle(f, token) {
  try {
    hint('Rilevamento articolazioni…');
    const lm = await getLandmarker('IMAGE', S.model);
    if (token !== seekToken) return;
    const res = lm.detect(video);
    setPose(f, landmarksFromResult(res));
    if (!S.px[f]) hint('Atleta non rilevato in questo fotogramma.');
    else hint('');
    render(); updateTransport();
  } catch (e) { console.error(e); hint('Errore nel caricamento del modello di pose.'); }
}

// ---------------- analisi completa ----------------
$('#btnAnalyze').addEventListener('click', analyze);
$('#btnCancel').addEventListener('click', () => { S.cancel = true; });

async function analyze() {
  if (S.busy) return;
  S.busy = true; S.cancel = false;
  pause();
  const a = S.rangeIn, b = S.rangeOut;
  $('#progress').hidden = false;
  try {
    resetVideoLandmarker(S.model);
    const lm = await getLandmarker('VIDEO', S.model);
    const t0 = performance.now();
    for (let f = a; f <= b; f++) {
      if (S.cancel) break;
      await seekFrame(f);
      const res = lm.detectForVideo(video, Math.round(((f - a) * 1000) / S.fps) + 1);
      S.raw[f] = landmarksFromResult(res);
      S.frame = f;
      if ((f - a) % 3 === 0) {
        S.px[f] = S.raw[f] ? B.toPx(S.raw[f], S.W, S.H) : null;
        render();
        const p = (f - a + 1) / (b - a + 1);
        $('#progressBar').style.width = `${p * 100}%`;
        const el = (performance.now() - t0) / 1000;
        $('#progressText').textContent = `Analisi ${f - a + 1}/${b - a + 1} · ${Math.round(el / p - el)} s`;
        updateTransport();
      }
    }
    rebuildSeries();
    S.analyzed = true;
    const found = S.raw.slice(a, b + 1).filter(Boolean).length;
    if (viewAt(a) !== 'frontale') autoEvents(false);
    hint(`Analisi completata: atleta rilevato in ${found}/${b - a + 1} fotogrammi${S.swaps ? ` · ${S.swaps} scambi sx/dx corretti` : ''}.`);
  } catch (e) {
    console.error(e); hint('Analisi interrotta: ' + e.message);
  } finally {
    $('#progress').hidden = true;
    S.busy = false;
    await gotoFrame(S.frame, false);
    refreshAll();
  }
}

// ---------------- rendering ----------------
let dpr = 1, base = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = stage.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  if (S.loaded) base = Math.min(r.width / S.W, r.height / S.H);
  render();
}
new ResizeObserver(resize).observe(stage);

function fit() { S.follow = false; $('#btnFollow').classList.remove('on'); S.zoom = 1; S.panX = 0; S.panY = 0; resize(); }
/** "segui atleta": centra e ingrandisce sull'atleta (interpolazione morbida) */
function followAthlete() {
  const P = poseAt(S.frame);
  if (!P) return;
  const b = bodyBox(P);
  const r = stage.getBoundingClientRect();
  const h = (b.maxY - b.minY) * 1.25 + 40, w = (b.maxX - b.minX) * 1.25 + 300;
  const z = Math.max(1, Math.min(8, Math.min(r.height / (h * base), r.width / (w * base))));
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const k = S.playing ? 0.25 : 1;
  S.zoom += (z - S.zoom) * k;
  const s = base * S.zoom;
  const px = r.width / 2 - ((r.width - S.W * s) / 2 + cx * s);
  const py = r.height / 2 - ((r.height - S.H * s) / 2 + cy * s);
  S.panX += (px - S.panX) * k; S.panY += (py - S.panY) * k;
}
function view() {
  const r = stage.getBoundingClientRect();
  const s = base * S.zoom;
  const ox = (r.width - S.W * s) / 2 + S.panX, oy = (r.height - S.H * s) / 2 + S.panY;
  return { s, ox, oy };
}
function toVideo(ev) {
  const r = canvas.getBoundingClientRect();
  const { s, ox, oy } = view();
  return { x: (ev.clientX - r.left - ox) / s, y: (ev.clientY - r.top - oy) / s };
}

/** disegna il frame corrente con tutte le grafiche nel contesto dato (usato anche per export) */
export function drawOverlays(c, u, f, opts = {}) {
  const P = poseAt(f);
  const mm = metricsAt(f);
  if (P && mm) {
    if (S.skeleton && !opts.noSkeleton) drawSkeleton(c, P, u, mm.M.meta?.near || S.seqNear || 'L', mm.view);
    const o = { u, groundRad: S.groundRad, legs: S.legs, showLow: S.showLow };
    Labels.begin();
    if (mm.view === 'frontale') drawFrontal(c, P, mm.M, S.show, o); else drawSagittal(c, P, mm.M, S.show, o);
    Labels.flush(c, u, bodyBox(P), S.W, S.H);
  }
  const env = { groundRad: S.groundRad, pxPerM: S.pxPerM };
  if (S.groundShape) T.drawShape(c, S.groundShape, S.groundShape.pts, u, env);
  for (const sh of S.shapes) if (T.visible(sh, f)) T.drawShape(c, sh, T.resolve(sh, P), u, env, !opts.export && sh.id === S.sel);
}

function render() {
  if (S.follow && S.loaded) followAthlete();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#03060a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!S.loaded) return;
  const { s, ox, oy } = view();
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, S.W, S.H);
  const u = 1 / s;
  drawOverlays(ctx, u, S.frame);
  if (S.draft) {
    const P = poseAt(S.frame);
    T.drawShape(ctx, S.draft.shape, T.resolve(S.draft.shape, P), u, { groundRad: S.groundRad, pxPerM: S.pxPerM }, true, S.draft.cursor);
  }
  if (S.snapPreview != null && poseAt(S.frame)) {
    const p = poseAt(S.frame)[S.snapPreview];
    ctx.save(); ctx.strokeStyle = C.yellow; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.arc(p.x, p.y, 14 * u, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    drawText(ctx, { x: p.x + 18 * u, y: p.y - 16 * u }, B.LM_NAMES[S.snapPreview] || '', u, C.yellow, 12);
  }
  if (S.loupe) drawLoupe();
}

function drawLoupe() {
  const { s, ox, oy } = view();
  const p = S.loupe;
  const cx = (p.x * s + ox) * dpr, cy = (p.y * s + oy) * dpr;
  const R = 62 * dpr, Z = 3;
  const r = stage.getBoundingClientRect();
  // la lente si posiziona lontano dal dito
  const lx = cx < r.width * dpr / 2 ? canvas.width - R - 14 * dpr : R + 14 * dpr;
  const ly = R + 56 * dpr;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.closePath();
  ctx.save(); ctx.clip();
  ctx.fillStyle = '#000'; ctx.fillRect(lx - R, ly - R, 2 * R, 2 * R);
  ctx.drawImage(canvas, cx - R / Z, cy - R / Z, (2 * R) / Z, (2 * R) / Z, lx - R, ly - R, 2 * R, 2 * R);
  ctx.restore();
  ctx.strokeStyle = C.blue; ctx.lineWidth = 2 * dpr; ctx.stroke();
  ctx.strokeStyle = C.yellow; ctx.lineWidth = 1 * dpr;
  ctx.beginPath(); ctx.moveTo(lx - 12 * dpr, ly); ctx.lineTo(lx + 12 * dpr, ly); ctx.moveTo(lx, ly - 12 * dpr); ctx.lineTo(lx, ly + 12 * dpr); ctx.stroke();
  ctx.restore();
}

// ---------------- riproduzione ----------------
function play() {
  if (!S.loaded) return;
  video.playbackRate = parseFloat($('#speed').value);
  S.playing = true;
  video.play();
  $('#playIcon').innerHTML = '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';
  const loop = (now, meta) => {
    if (!S.playing) return;
    const f = Math.min(S.nFrames - 1, Math.floor((meta ? meta.mediaTime : video.currentTime) * S.fps + 1e-3));
    S.frame = f;
    if (S.live && !S.analyzed && !S.raw[f]) liveDetect(f, meta ? meta.mediaTime : video.currentTime);
    render(); updateTransport();
    if (S.frame % 3 === 0) refreshValues();
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(loop); else requestAnimationFrame(() => loop());
  };
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(loop); else requestAnimationFrame(() => loop());
}
let liveTs = 0;
async function liveDetect(f, t) {
  try {
    const lm = await getLandmarker('VIDEO', S.model);
    const ts = Math.max(liveTs + 1, Math.round(performance.now()));
    liveTs = ts;
    setPose(f, landmarksFromResult(lm.detectForVideo(video, ts)));
  } catch (e) { /* ignora */ }
}
function pause() {
  if (!S.playing) return;
  S.playing = false;
  video.pause();
  $('#playIcon').innerHTML = '<path d="M7 5l12 7-12 7z"/>';
  const f = Math.floor(video.currentTime * S.fps + 1e-3);
  gotoFrame(f);
}
video.addEventListener('ended', pause);
$('#btnPlay').onclick = () => (S.playing ? pause() : play());
$('#btnPrev').onclick = () => { pause(); gotoFrame(S.frame - 1); };
$('#btnNext').onclick = () => { pause(); gotoFrame(S.frame + 1); };
$('#speed').onchange = () => { video.playbackRate = parseFloat($('#speed').value); };
let scrubTimer = null;
$('#scrub').addEventListener('input', (e) => {
  pause();
  const f = +e.target.value;
  clearTimeout(scrubTimer);
  scrubTimer = setTimeout(() => gotoFrame(f), 30);
});

function updateTransport() {
  $('#scrub').value = S.frame;
  $('#time').textContent = `${(S.frame / S.fps).toFixed(3)} s`;
  $('#hudFrame').textContent = `F ${S.frame} · ${(S.frame / S.fps).toFixed(3)} s`;
  const v = S.loaded && poseAt(S.frame) ? viewAt(S.frame) : null;
  const el = $('#hudView');
  el.textContent = v ? `VISTA ${v.toUpperCase()}${S.view === 'auto' ? ' · AUTO' : ''}` : (S.loaded ? 'NESSUN ATLETA' : '—');
  el.className = `tag ${v === 'frontale' ? 'front' : v ? 'sag' : ''}`;
}

// ---------------- interazione disegno ----------------
const pointers = new Map();
let drag = null; // {kind:'pt', shape, idx} | {kind:'pan', x, y} | {kind:'pinch', d, z, cx, cy}

function snapRadius() { return 26 / view().s; }
function placePoint(p) {
  if (!S.magnet) return { x: p.x, y: p.y };
  const P = poseAt(S.frame);
  const i = T.snapLandmark(p, P, snapRadius());
  return i != null ? { x: P[i].x, y: P[i].y, lm: i } : { x: p.x, y: p.y };
}

canvas.addEventListener('pointerdown', (ev) => {
  if (!S.loaded) return;
  canvas.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    S.follow = false; $('#btnFollow').classList.remove('on');
    drag = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), z: S.zoom, px: S.panX, py: S.panY, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    S.draft = null; S.loupe = null; render();
    return;
  }
  pause();
  const p = toVideo(ev);
  const tool = S.tool;
  if (tool === 'select') {
    const hit = hitTest(p);
    if (hit) { S.sel = hit.shape.id; pushHistory(); drag = { kind: 'pt', ...hit }; S.loupe = p; }
    else { S.follow = false; $('#btnFollow').classList.remove('on'); drag = { kind: 'pan', x: ev.clientX, y: ev.clientY, px: S.panX, py: S.panY }; S.sel = null; }
    refreshShapes(); render();
    return;
  }
  if (tool === 'auto') {
    const P = poseAt(S.frame);
    const i = T.snapLandmark(p, P, snapRadius() * 1.6, T.AUTO_IDS);
    if (i == null) { hint('Tocca vicino a un\'articolazione rilevata (anca, ginocchio, caviglia, gomito, spalla).'); return; }
    pushHistory();
    const sh = T.autoShape(i, P, S.frame);
    S.shapes.push(sh); S.sel = sh.id;
    refreshShapes(); render();
    return;
  }
  // strumenti a punti: premi → trascina (con lente) → rilascia
  if (!S.draft) S.draft = { shape: T.newShape(tool, [], S.frame), cursor: null };
  S.draft.cursor = placePoint(p);
  S.loupe = p;
  drag = { kind: 'place' };
  render();
});

canvas.addEventListener('pointermove', (ev) => {
  if (!S.loaded) return;
  if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  const p = toVideo(ev);
  if (drag?.kind === 'pinch' && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt(drag.z * (d / drag.d), drag.cx, drag.cy, drag);
    S.panX += (a.x + b.x) / 2 - drag.cx; S.panY += (a.y + b.y) / 2 - drag.cy;
    drag.cx = (a.x + b.x) / 2; drag.cy = (a.y + b.y) / 2;
    render(); return;
  }
  if (drag?.kind === 'pan') { S.panX = drag.px + ev.clientX - drag.x; S.panY = drag.py + ev.clientY - drag.y; render(); return; }
  if (drag?.kind === 'pt') {
    const np = placePoint(p);
    drag.shape.pts[drag.idx] = np;
    if (np.lm == null) drag.shape.scope = 'frame', drag.shape.frame = S.frame;
    S.snapPreview = np.lm ?? null;
    S.loupe = p; render(); refreshShapes(); return;
  }
  if (S.draft) {
    S.draft.cursor = placePoint(p);
    S.snapPreview = S.draft.cursor.lm ?? null;
    if (drag?.kind === 'place') S.loupe = p;
    render(); return;
  }
  if (S.tool === 'auto' || S.tool === 'select') {
    const P = poseAt(S.frame);
    const i = S.tool === 'auto' ? T.snapLandmark(p, P, snapRadius() * 1.6, T.AUTO_IDS) : null;
    if (i !== S.snapPreview) { S.snapPreview = i; render(); }
  }
});

function endPointer(ev) {
  pointers.delete(ev.pointerId);
  if (drag?.kind === 'pinch') { if (pointers.size < 2) drag = null; return; }
  if (drag?.kind === 'place' && S.draft) {
    const sh = S.draft.shape;
    sh.pts.push(S.draft.cursor);
    S.draft.cursor = ev.pointerType === 'mouse' ? S.draft.cursor : null;
    const need = T.TOOLS[sh.type].pts;
    if (sh.pts.length >= need) finishDraft();
  }
  drag = null; S.loupe = null; S.snapPreview = null;
  render(); refreshValues();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (S.draft && !drag) { S.draft.cursor = null; render(); } });

function finishDraft() {
  const sh = S.draft.shape;
  S.draft = null;
  if (sh.type === 'ground') {
    const [a, b] = sh.pts;
    let ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
    S.groundRad = ang; S.groundShape = { ...sh, pts: sh.pts.map((p) => ({ x: p.x, y: p.y })) };
    hint(`Terreno calibrato: ${B.deg(ang).toFixed(1)}° rispetto all'orizzontale dell'immagine.`);
    setTool('select');
  } else if (sh.type === 'scale') {
    const px = B.dist(sh.pts[0], sh.pts[1]);
    const v = prompt('Lunghezza reale del segmento in metri:', '1.00');
    const m = parseFloat((v || '').replace(',', '.'));
    if (m > 0) { S.pxPerM = px / m; hint(`Scala: ${S.pxPerM.toFixed(1)} px/m (valida solo sul piano dell'atleta).`); }
    setTool('select');
  } else {
    pushHistory();
    sh.scope = sh.pts.every((p) => p.lm != null) ? 'all' : 'frame';
    S.shapes.push(sh); S.sel = sh.id;
  }
  refreshAll();
}

function hitTest(p) {
  const r = 18 / view().s;
  const P = poseAt(S.frame);
  for (let k = S.shapes.length - 1; k >= 0; k--) {
    const sh = S.shapes[k];
    if (!T.visible(sh, S.frame)) continue;
    const pts = T.resolve(sh, P);
    for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - p.x, pts[i].y - p.y) < r) return { shape: sh, idx: i };
  }
  return null;
}

function zoomAt(z, cx, cy) {
  const r = stage.getBoundingClientRect();
  const before = view();
  const vx = (cx - r.left - before.ox) / before.s, vy = (cy - r.top - before.oy) / before.s;
  S.zoom = Math.max(1, Math.min(10, z));
  const after = view();
  S.panX += (cx - r.left) - (vx * after.s + after.ox);
  S.panY += (cy - r.top) - (vy * after.s + after.oy);
  if (S.zoom === 1) { S.panX = 0; S.panY = 0; }
}
canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); S.follow = false; $('#btnFollow').classList.remove('on'); zoomAt(S.zoom * Math.exp(-ev.deltaY * 0.0015), ev.clientX, ev.clientY); render(); }, { passive: false });
$('#btnZoomIn').onclick = () => { const r = stage.getBoundingClientRect(); zoomAt(S.zoom * 1.4, r.left + r.width / 2, r.top + r.height / 2); render(); };
$('#btnZoomOut').onclick = () => { const r = stage.getBoundingClientRect(); zoomAt(S.zoom / 1.4, r.left + r.width / 2, r.top + r.height / 2); render(); };
$('#btnFit').onclick = fit;
$('#btnFollow').onclick = () => { S.follow = !S.follow; $('#btnFollow').classList.toggle('on', S.follow); if (!S.follow) fit(); else render(); };

function pushHistory() { S.history.push(JSON.stringify(S.shapes)); if (S.history.length > 50) S.history.shift(); }
function undo() {
  if (S.draft) { S.draft.shape.pts.pop(); if (!S.draft.shape.pts.length) S.draft = null; render(); return; }
  const h = S.history.pop(); if (h != null) { S.shapes = JSON.parse(h); refreshAll(); }
}
function delSel() { if (S.sel == null) return; pushHistory(); S.shapes = S.shapes.filter((s) => s.id !== S.sel); S.sel = null; refreshAll(); }

// ---------------- toolbar ----------------
function buildTools() {
  const box = $('#tools');
  const mk = (id, label, icon, cls = 'tool') => {
    const b = document.createElement('button');
    b.className = cls; b.dataset.tool = id;
    b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${icon}"/></svg><span>${label}</span>`;
    box.appendChild(b); return b;
  };
  for (const [id, t] of Object.entries(T.TOOLS)) mk(id, t.label, t.icon).onclick = () => setTool(id);
  box.appendChild(Object.assign(document.createElement('span'), { className: 'tool-sep' }));
  const mag = mk('magnet', 'Magnete', 'M6 3v8a6 6 0 0012 0V3h-4v8a2 2 0 01-4 0V3zM6 7h4M14 7h4', 'tool toggle on');
  mag.onclick = () => { S.magnet = !S.magnet; mag.classList.toggle('on', S.magnet); hint(S.magnet ? 'Magnete attivo: i punti si agganciano alle articolazioni e le seguono.' : 'Magnete disattivato: punti liberi su questo fotogramma.'); };
  mk('undo', 'Annulla', 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3').onclick = undo;
  mk('del', 'Elimina', 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13').onclick = () => (S.sel != null ? delSel() : (pushHistory(), S.shapes = [], refreshAll()));
  setTool('select');
}
function setTool(id) {
  S.tool = id; S.draft = null;
  $$('#tools .tool[data-tool]').forEach((b) => { if (T.TOOLS[b.dataset.tool]) b.classList.toggle('on', b.dataset.tool === id); });
  $('#toolHelp').textContent = T.TOOLS[id]?.help || '';
  canvas.style.cursor = id === 'select' ? 'grab' : 'crosshair';
  render();
}

// ---------------- pannello angoli ----------------
function buildChips() {
  const mk = (box, list) => {
    box.innerHTML = '';
    for (const [k, l] of list) {
      const b = document.createElement('button');
      b.className = `chip${S.show[k] ? ' on' : ''}`; b.textContent = l;
      b.onclick = () => { S.show[k] = !S.show[k]; b.classList.toggle('on', S.show[k]); render(); refreshValues(); };
      box.appendChild(b);
    }
  };
  mk($('#chipsSag'), SAG_CHIPS); mk($('#chipsFront'), FRONT_CHIPS);
}

const KEYMAP = {
  trunk: ['trunk', 'trunkH'], head: ['head'], hip: ['hip'], knee: ['knee'], ankle: ['ankle'], tibia: ['tibia'], thigh: ['thigh'],
  com: ['footCom'], arms: ['elbow', 'shoulder'],
  pelvis: ['pelvis'], shoulders: ['shoulders'], trunkLat: ['trunkLat'], headTilt: ['headTilt'], fppa: ['fppa'], footMid: ['footMid'],
};
export function activeMetricKeys(mm) {
  if (!mm) return [];
  const keys = [];
  const legs = mm.view === 'frontale' ? ['L', 'R'] : legsToShow(S.legs, mm.M.meta?.near);
  for (const [chip, ks] of Object.entries(KEYMAP)) {
    if (!S.show[chip]) continue;
    for (const k of ks) {
      if (mm.M[k]) keys.push(k);
      for (const s of legs) if (mm.M[k + s]) keys.push(k + s);
    }
  }
  return keys;
}

function refreshValues() {
  const mm = S.loaded ? metricsAt(S.frame) : null;
  const isFront = mm?.view === 'frontale';
  $('#chipsSag').hidden = isFront; $('#chipsFront').hidden = !isFront; $('#legRow').hidden = isFront;
  const tb = $('#values');
  if (!mm) { tb.innerHTML = `<tr><td class="muted">${S.loaded ? 'Nessun atleta rilevato in questo fotogramma.' : 'Carica un video.'}</td></tr>`; refreshShapes(); return; }
  let html = '';
  if (mm.oblique) html += '<tr><td colspan="2" class="fine">⚠ Vista obliqua: gli angoli sagittali sono distorti dalla prospettiva. Confidenza ridotta.</td></tr>';
  for (const k of activeMetricKeys(mm)) {
    const m = mm.M[k];
    const conf = m.conf;
    html += `<tr><td>${m.label}<span class="conf ${conf}">${conf}</span>${m.hint ? `<small>${m.hint}</small>` : ''}</td><td style="color:${CONF_COLOR[conf]}">${fmt({ ...m, conf }, S.showLow, m.unit === '°' ? 1 : 0)}${m.m != null && conf !== 'bassa' ? `<small>${(m.m * 100).toFixed(0)} cm</small>` : ''}</td></tr>`;
  }
  if (mm.M.com && S.show.com) html += `<tr><td colspan="2" class="fine">CoM: modello segmentale de Leva (1996) sui landmark 2D; massimo “media” confidenza. Distanza piede–CoM in % della lunghezza dell'arto${S.pxPerM ? ' e in cm (scala calibrata)' : ''}.</td></tr>`;
  tb.innerHTML = html || '<tr><td class="muted">Attiva almeno un angolo con i chip.</td></tr>';
  refreshShapes();
}

function refreshShapes() {
  const ul = $('#shapes');
  const P = poseAt(S.frame);
  const env = { groundRad: S.groundRad, pxPerM: S.pxPerM };
  if (!S.shapes.length) { ul.innerHTML = '<li class="muted">Nessuno: scegli uno strumento sotto al video.</li>'; return; }
  ul.innerHTML = '';
  for (const sh of S.shapes) {
    const li = document.createElement('li');
    li.className = sh.id === S.sel ? 'sel' : '';
    const vis = T.visible(sh, S.frame);
    const m = vis ? T.measure(sh, T.resolve(sh, P), env) : null;
    li.innerHTML = `<span>${T.shapeName(sh)}<br><small class="muted">${sh.scope === 'all' ? 'segue il tracking · tutti i frame' : `solo F ${sh.frame}`}</small></span><span class="v">${vis ? T.fmtMeasure(m) : '—'}</span>`;
    const sc = document.createElement('button'); sc.textContent = sh.scope === 'all' ? '1 frame' : 'tutti';
    sc.title = 'Mostra solo in questo fotogramma / in tutti';
    sc.onclick = () => { sh.scope = sh.scope === 'all' ? 'frame' : 'all'; sh.frame = S.frame; refreshShapes(); render(); };
    const go = document.createElement('button'); go.textContent = '↦'; go.title = 'Vai al fotogramma';
    go.onclick = () => gotoFrame(sh.frame);
    const del = document.createElement('button'); del.textContent = '✕';
    del.onclick = () => { pushHistory(); S.shapes = S.shapes.filter((x) => x !== sh); refreshAll(); };
    li.onclick = (e) => { if (e.target.tagName !== 'BUTTON') { S.sel = sh.id; refreshShapes(); render(); } };
    li.append(sc, go, del);
    ul.appendChild(li);
  }
}

$('#viewSeg').addEventListener('click', (e) => {
  const v = e.target.dataset.v; if (!v) return;
  S.view = v; $$('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  render(); refreshAll();
});
$('#legSeg').addEventListener('click', (e) => {
  const l = e.target.dataset.l; if (!l) return;
  S.legs = l; $$('#legSeg button').forEach((b) => b.classList.toggle('on', b.dataset.l === l));
  render(); refreshValues();
});
$('#optSkeleton').onchange = (e) => { S.skeleton = e.target.checked; render(); };
$('#optLive').onchange = (e) => { S.live = e.target.checked; if (S.live) gotoFrame(S.frame); };
$('#optLow').onchange = (e) => { S.showLow = e.target.checked; render(); refreshValues(); };
$('#fps').onchange = (e) => {
  const v = +e.target.value;
  S.fpsAuto = v === 0;
  if (v) { S.fps = v; if (S.loaded) { S.raw = []; S.px = []; S.analyzed = false; setupFrames(); gotoFrame(0); hint(`Frame rate impostato a ${v} fps: rianalizza il video.`); } }
};
$('#model').onchange = (e) => { S.model = e.target.value; };
$('#smooth').onchange = (e) => { S.smooth = +e.target.value; if (S.analyzed) { rebuildSeries(); render(); refreshAll(); } };
$('#sex').onchange = (e) => { S.sex = e.target.value; render(); refreshValues(); };
$('#dir').onchange = (e) => { S.dirSetting = +e.target.value; render(); refreshValues(); };
$('#btnIn').onclick = () => { S.rangeIn = S.frame; if (S.rangeOut < S.rangeIn) S.rangeOut = S.nFrames - 1; refreshMarkers(); hint(`IN = F ${S.frame}`); };
$('#btnOut').onclick = () => { S.rangeOut = S.frame; if (S.rangeIn > S.rangeOut) S.rangeIn = 0; refreshMarkers(); hint(`OUT = F ${S.frame}`); };
$('#btnInOutReset').onclick = () => { S.rangeIn = 0; S.rangeOut = S.nFrames - 1; refreshMarkers(); };

// ---------------- eventi ----------------
const EV_LABEL = { START: 'Inizio movimento', TD: 'Touchdown', TO: 'Toe-off' };
$$('.evbtns [data-ev]').forEach((b) => b.addEventListener('click', () => {
  const type = b.dataset.ev, foot = b.dataset.foot || null;
  S.events = S.events.filter((e) => !(e.frame === S.frame && e.type === type && e.foot === foot));
  S.events.push({ frame: S.frame, type, foot, auto: false, conf: 'alta' });
  S.events.sort((a, c) => a.frame - c.frame);
  refreshEvents();
}));
$('#btnAutoEvents').onclick = () => autoEvents(true);
function autoEvents(notify) {
  if (!S.analyzed) { hint('Prima esegui “Analizza” sull\'intervallo di interesse.'); return; }
  const frames = S.px.map((P, i) => (i >= S.rangeIn && i <= S.rangeOut ? P : null));
  const ev = B.detectEvents(frames, { groundRad: S.groundRad, dir: S.dirSetting || S.dir });
  S.events = S.events.filter((e) => !e.auto).concat(ev).sort((a, b) => a.frame - b.frame);
  refreshEvents();
  if (notify) hint(`${ev.length} eventi rilevati automaticamente (confidenza media): verificali fotogramma per fotogramma.`);
}
function refreshEvents() {
  const ul = $('#events');
  ul.innerHTML = S.events.length ? '' : '<li class="muted">Nessun evento.</li>';
  for (const e of S.events) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${EV_LABEL[e.type]}${e.foot ? ` ${e.foot === 'L' ? 'SX' : 'DX'}` : ''} <span class="conf ${e.conf}">${e.auto ? 'auto' : 'manuale'}</span></span><span class="v mono">F ${e.frame} · ${(e.frame / S.fps).toFixed(3)} s</span>`;
    const go = document.createElement('button'); go.textContent = '↦'; go.onclick = () => gotoFrame(e.frame);
    const del = document.createElement('button'); del.textContent = '✕'; del.onclick = () => { S.events = S.events.filter((x) => x !== e); refreshEvents(); };
    li.append(go, del); ul.appendChild(li);
  }
  const st = B.stepTimes(S.events, S.fps);
  const rows = [];
  st.contacts.forEach((c, i) => rows.push(`Contatto ${i + 1} (${c.foot === 'L' ? 'SX' : 'DX'}): <b>${c.ms.toFixed(0)} ms</b> <span class="muted">(F ${c.td}→${c.to})</span>`));
  st.flights.forEach((c, i) => rows.push(`Volo ${i + 1}: <b>${c.ms.toFixed(0)} ms</b> <span class="muted">(F ${c.toFrame}→${c.tdFrame})</span>`));
  $('#times').innerHTML = rows.length
    ? `${rows.join('<br>')}<br><span class="conf ${st.conf}">${st.conf}</span> risoluzione ±${st.resolutionMs.toFixed(1)} ms per evento a ${S.fps} fps${S.fps < 100 ? ' — tempi indicativi, non usare come valori esatti' : ''}.`
    : 'Segna touchdown e toe-off per calcolare tempi di contatto e di volo.';
  refreshMarkers(); drawChart();
}
$('#btnNS').onclick = () => {
  const start = S.events.find((e) => e.type === 'START');
  if (!start) { $('#nsOut').textContent = 'Segna prima l\'evento “Inizio movimento”.'; return; }
  if (!S.analyzed) { $('#nsOut').textContent = 'Esegui prima “Analizza”.'; return; }
  const r = B.negativeStep(S.px, start.frame, $('#nsFoot').value, { groundRad: S.groundRad, dir: S.dirSetting || S.dir });
  $('#nsOut').innerHTML = `Esito: <b>${r.status}</b>${r.backPct != null ? ` · arretramento ${r.backPct.toFixed(1)}% arto` : ''}${r.frame != null ? ` (F ${r.frame})` : ''} <span class="conf ${r.conf}">${r.conf}</span><br>Valutazione descrittiva: non implica di per sé un errore tecnico. Verificare la prospettiva (piede lontano/vicino) sui fotogrammi.`;
};

function refreshMarkers() {
  const box = $('#markers');
  if (!S.loaded) { box.innerHTML = ''; return; }
  const n = Math.max(1, S.nFrames - 1);
  let h = '';
  if (S.rangeIn > 0 || S.rangeOut < S.nFrames - 1) h += `<i class="range" style="left:${(S.rangeIn / n) * 100}%;width:${((S.rangeOut - S.rangeIn) / n) * 100}%"></i>`;
  for (const e of S.events) h += `<i class="${e.type}" style="left:${(e.frame / n) * 100}%" title="${EV_LABEL[e.type]}"></i>`;
  box.innerHTML = h;
}

// ---------------- grafico ----------------
const chart = $('#chart');
const CHART_COLORS = ['#00C8FF', '#FFD447', '#FFFFFF', '#FF4655', '#7CF29A'];
function buildChartChips() {
  const mm = metricsAt(S.frame) || metricsAt(S.px.findIndex(Boolean));
  const box = $('#chartChips');
  box.innerHTML = '';
  if (!mm) return;
  const keys = Object.keys(mm.M).filter((k) => mm.M[k]?.unit && mm.M[k].value != null);
  for (const k of keys) {
    const b = document.createElement('button');
    b.className = `chip${S.chartKeys.includes(k) ? ' on' : ''}`; b.textContent = mm.M[k].label;
    b.onclick = () => {
      S.chartKeys = S.chartKeys.includes(k) ? S.chartKeys.filter((x) => x !== k) : [...S.chartKeys, k].slice(-5);
      buildChartChips(); drawChart();
    };
    box.appendChild(b);
  }
}
export function series(key) {
  const out = [];
  for (let f = S.rangeIn; f <= S.rangeOut; f++) {
    const mm = metricsAt(f);
    const m = mm?.M[key];
    out.push(m ? { f, v: m.value, c: m.conf } : { f, v: null });
  }
  return out;
}
function drawChart() {
  const w = chart.clientWidth || 340;
  const r = Math.min(window.devicePixelRatio || 1, 2);
  chart.width = w * r; chart.height = 240 * r;
  const c = chart.getContext('2d');
  c.setTransform(r, 0, 0, r, 0, 0);
  c.clearRect(0, 0, w, 240);
  if (!S.analyzed) { c.fillStyle = C.grey; c.font = '12px system-ui'; c.fillText('Esegui “Analizza” per i grafici temporali.', 12, 24); return; }
  const data = S.chartKeys.map((k) => ({ k, s: series(k) }));
  const vals = data.flatMap((d) => d.s.filter((p) => p.v != null).map((p) => p.v));
  if (!vals.length) return;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.1 + 2; lo -= pad; hi += pad;
  const L = 34, R = 8, Tp = 10, Bt = 22, Wp = w - L - R, Hp = 240 - Tp - Bt;
  const X = (f) => L + ((f - S.rangeIn) / Math.max(1, S.rangeOut - S.rangeIn)) * Wp;
  const Y = (v) => Tp + (1 - (v - lo) / (hi - lo)) * Hp;
  c.strokeStyle = '#223146'; c.fillStyle = C.grey; c.font = '10px system-ui'; c.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4; const y = Y(v);
    c.beginPath(); c.moveTo(L, y); c.lineTo(w - R, y); c.stroke(); c.fillText(`${v.toFixed(0)}°`, 2, y + 3);
  }
  for (const e of S.events) {
    if (e.frame < S.rangeIn || e.frame > S.rangeOut) continue;
    c.strokeStyle = e.type === 'TD' ? 'rgba(0,200,255,.5)' : e.type === 'TO' ? 'rgba(255,212,71,.5)' : 'rgba(255,255,255,.4)';
    c.setLineDash([3, 3]); c.beginPath(); c.moveTo(X(e.frame), Tp); c.lineTo(X(e.frame), Tp + Hp); c.stroke(); c.setLineDash([]);
    c.fillStyle = C.grey; c.fillText(`${e.type}${e.foot ? (e.foot === 'L' ? 'sx' : 'dx') : ''}`, X(e.frame) + 2, 240 - 6);
  }
  data.forEach((d, i) => {
    c.strokeStyle = CHART_COLORS[i % 5]; c.lineWidth = 2;
    let pen = false; c.beginPath();
    for (const p of d.s) {
      if (p.v == null) { pen = false; continue; }
      c.globalAlpha = 1;
      if (!pen) { c.moveTo(X(p.f), Y(p.v)); pen = true; } else c.lineTo(X(p.f), Y(p.v));
    }
    c.stroke();
    for (const p of d.s) if (p.v != null && p.c === 'bassa') { c.fillStyle = 'rgba(8,13,20,.7)'; c.fillRect(X(p.f) - 1.5, Y(p.v) - 1.5, 3, 3); }
  });
  c.strokeStyle = '#fff'; c.lineWidth = 1; c.beginPath(); c.moveTo(X(S.frame), Tp); c.lineTo(X(S.frame), Tp + Hp); c.stroke();
}
chart.addEventListener('pointerdown', (ev) => {
  if (!S.analyzed) return;
  const r = chart.getBoundingClientRect();
  const t = (ev.clientX - r.left - 34) / (r.width - 42);
  gotoFrame(S.rangeIn + t * (S.rangeOut - S.rangeIn));
});

// ---------------- confronto ----------------
$('#btnSetA').onclick = () => { S.A = S.frame; refreshCompare(); };
$('#btnSetB').onclick = () => { S.B = S.frame; refreshCompare(); };
$('#btnAutoAB').onclick = () => {
  const td = S.events.filter((e) => e.type === 'TD');
  if (td.length < 2) { hint('Servono almeno due touchdown (manuali o automatici).'); return; }
  S.A = td[0].frame; S.B = td[1].frame; refreshCompare();
};
async function refreshCompare() {
  const box = $('#compare');
  if (S.A == null && S.B == null) { box.innerHTML = '<p class="fine">Imposta A e B.</p>'; return; }
  const cur = S.frame;
  const fig = async (f, name) => {
    if (f == null) return `<figure><figcaption>${name}</figcaption><p class="fine">—</p></figure>`;
    await seekFrame(f);
    if (!S.px[f] && S.live) await detectSingle(f, seekToken);
    const cv = document.createElement('canvas');
    renderFrameTo(cv, f, 360);
    return `<figure><figcaption>${name} · F ${f}</figcaption><img src="${cv.toDataURL('image/jpeg', 0.85)}" alt="${name}"></figure>`;
  };
  const a = await fig(S.A, 'A — FIRST STEP');
  const b = await fig(S.B, 'B — SECOND STEP');
  await gotoFrame(cur, false);
  const ma = S.A != null ? metricsAt(S.A) : null, mb = S.B != null ? metricsAt(S.B) : null;
  const keys = [...new Set([...activeMetricKeys(ma), ...activeMetricKeys(mb)])];
  let t = '<table><tr><th>Misura</th><th>A</th><th>B</th><th>Δ</th></tr>';
  for (const k of keys) {
    const x = ma?.M[k], y = mb?.M[k];
    const ok = x && y && x.conf !== 'bassa' && y.conf !== 'bassa';
    t += `<tr><td>${(x || y).label}</td><td>${fmt(x, S.showLow)}</td><td>${fmt(y, S.showLow)}</td><td>${ok ? (y.value - x.value).toFixed(1) : '—'}</td></tr>`;
  }
  box.innerHTML = a + b + t + '</table>';
}

// ---------------- export ----------------
$('#btnPng').onclick = () => exportPNG(S.frame);
$('#btnCsv').onclick = () => exportCSV();
$('#btnJson').onclick = () => exportJSON();
$('#btnMd').onclick = () => exportMarkdown();
$('#btnVideo').onclick = async () => {
  if (S.busy) return;
  S.busy = true; S.cancel = false; pause();
  $('#progress').hidden = false;
  try {
    await exportVideo({
      format: $('#expFormat').value, slow: +$('#expSlow').value, freeze: +$('#expFreeze').value, title: $('#expTitle').value,
      seek: async (f) => {
        await seekFrame(f);
        // export senza analisi completa: rileva la posa del fotogramma se manca
        if (S.live && S.raw[f] === undefined) {
          const lm = await getLandmarker('IMAGE', S.model);
          setPose(f, landmarksFromResult(lm.detect(video)));
        }
      },
      onProgress: (p, msg) => { $('#progressBar').style.width = `${p * 100}%`; $('#progressText').textContent = msg; },
      cancelled: () => S.cancel,
    });
  } catch (e) { console.error(e); hint('Export non riuscito: ' + e.message); }
  $('#progress').hidden = true; S.busy = false;
  gotoFrame(S.frame, false);
};

// ---------------- generale ----------------
export function hint(msg) { $('#hudHint').textContent = msg; }
function refreshAll() {
  refreshValues(); refreshEvents(); buildChartChips(); drawChart(); refreshMarkers(); updateTransport();
  $('#calibInfo').textContent = `Terreno: ${S.groundShape ? `${B.deg(S.groundRad).toFixed(1)}° (calibrato)` : 'orizzontale immagine'} · Scala: ${S.pxPerM ? `${S.pxPerM.toFixed(1)} px/m` : 'non calibrata'} · Direzione: ${(S.dirSetting || S.dir) > 0 ? '→' : '←'}`;
}
$('#tabs').addEventListener('click', (e) => {
  const t = e.target.dataset.tab; if (!t) return;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $$('.tab').forEach((p) => p.classList.toggle('on', p.dataset.tab === t));
  if (t === 'chart') { buildChartChips(); drawChart(); }
  if (t === 'compare') refreshCompare();
});
$('#btnHelp').onclick = () => $('#help').showModal();
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); pause(); gotoFrame(S.frame - (e.shiftKey ? 10 : 1)); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); pause(); gotoFrame(S.frame + (e.shiftKey ? 10 : 1)); }
  else if (e.key === ' ') { e.preventDefault(); S.playing ? pause() : play(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') delSel();
  else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'Escape') { S.draft = null; setTool('select'); }
});

buildTools();
buildChips();
refreshAll();
// pre-carica il modello in background
getLandmarker('IMAGE', S.model).catch(() => {});
window.GASA = { S, gotoFrame, metricsAt }; // per debug/test
