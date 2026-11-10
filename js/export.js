// Export: PNG, CSV, JSON, report testuale, video analizzato (Reel 9:16 o formato originale).
import { S, drawOverlays, metricsAt, activeMetricKeys, media } from './app.js';
import * as B from './biomech.js';
import { C, CONF_COLOR, fmt, roundRect } from './draw.js';
import * as T from './tools.js';

const video = document.querySelector('#video');
const FONT = '"Inter", "SF Pro Display", system-ui, sans-serif';

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const base = () => `GASA_${S.name}`;

/** disegna il fotogramma corrente (già posizionato) con le grafiche su un canvas di larghezza data */
export function renderFrameTo(cv, f, width = S.W) {
  const k = width / S.W;
  cv.width = Math.round(width); cv.height = Math.round(S.H * k);
  const c = cv.getContext('2d');
  c.setTransform(k, 0, 0, k, 0, 0);
  c.drawImage(media(), 0, 0, S.W, S.H);
  drawOverlays(c, Math.max(0.6, width / 900) / k, f, { export: true });
  return cv;
}

export function exportPNG(f) {
  const cv = renderFrameTo(document.createElement('canvas'), f, S.W);
  brandStrip(cv.getContext('2d'), cv.width, cv.height, f);
  cv.toBlob((b) => download(b, `${base()}_F${f}.png`), 'image/png');
}

function brandStrip(c, W, H, f) {
  const s = W / 1080;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = 'rgba(8,13,20,0.8)'; c.fillRect(0, H - 44 * s, W, 44 * s);
  c.font = `800 ${18 * s}px ${FONT}`; c.fillStyle = C.blue; c.textBaseline = 'middle';
  c.fillText('GASA', 16 * s, H - 22 * s);
  c.fillStyle = C.white; c.fillText(' BIOMECHANICS', 16 * s + c.measureText('GASA').width, H - 22 * s);
  c.textAlign = 'right'; c.font = `600 ${15 * s}px ${FONT}`; c.fillStyle = '#C9D2DD';
  c.fillText(`F ${f} · ${(f / S.fps).toFixed(3)} s · ${S.fps} fps`, W - 16 * s, H - 22 * s);
  c.textAlign = 'left';
}

function allMetricKeys() {
  const keys = new Set();
  for (let f = S.rangeIn; f <= S.rangeOut; f++) {
    const mm = metricsAt(f);
    if (mm) Object.keys(mm.M).forEach((k) => { if (mm.M[k]?.unit) keys.add(k); });
  }
  return [...keys];
}

export function exportCSV() {
  const keys = allMetricKeys();
  const rows = [['frame', 'time_s', 'view', ...keys.flatMap((k) => [k, `${k}_conf`])].join(',')];
  for (let f = S.rangeIn; f <= S.rangeOut; f++) {
    const mm = metricsAt(f);
    const cells = [f, (f / S.fps).toFixed(4), mm?.view || ''];
    for (const k of keys) { const m = mm?.M[k]; cells.push(m ? m.value.toFixed(2) : '', m ? m.conf : ''); }
    rows.push(cells.join(','));
  }
  download(new Blob([rows.join('\n')], { type: 'text/csv' }), `${base()}_angoli.csv`);
}

function buildReport() {
  const st = B.stepTimes(S.events, S.fps);
  const atEvents = S.events.map((e) => {
    const mm = metricsAt(e.frame);
    const vals = {};
    if (mm) for (const k of Object.keys(mm.M)) if (mm.M[k]?.unit) vals[k] = { value: +mm.M[k].value.toFixed(1), unit: mm.M[k].unit, conf: mm.M[k].conf, label: mm.M[k].label };
    return { ...e, time_s: +(e.frame / S.fps).toFixed(4), metrics: vals };
  });
  return {
    progetto: 'GASA BIOMECHANICS — SPRINT PERFORMANCE ANALYSIS',
    generato: new Date().toISOString(),
    video: { nome: S.name, risoluzione: `${S.W}x${S.H}`, fps: S.fps, fps_stimati: S.fpsAuto, durata_s: S.isImage ? 0 : +video.duration.toFixed(3), fotogrammi: S.nFrames },
    analisi: {
      intervallo: [S.rangeIn, S.rangeOut], vista: S.seqView || S.view, lato_vicino: S.seqNear, direzione: (S.dirSetting || S.dir) > 0 ? 'destra' : 'sinistra',
      smoothing_frame: S.smooth, terreno_deg: +B.deg(S.groundRad).toFixed(2), scala_px_m: S.pxPerM,
      fotogrammi_con_atleta: S.px.slice(S.rangeIn, S.rangeOut + 1).filter(Boolean).length, scambi_sx_dx_corretti: S.swaps || 0,
      modello_pose: `MediaPipe Pose Landmarker (${S.model})`, modello_com: `de Leva 1996 (${S.sex})`,
    },
    eventi: atEvents,
    tempi: { contatti_ms: st.contacts, voli_ms: st.flights, confidenza: st.conf, risoluzione_ms: +st.resolutionMs.toFixed(2) },
    angoli_disegnati: shapesMeasure(),
    limiti: [
      'Misure 2D proiettate sul piano immagine: errori se il gesto non è parallelo al piano della camera.',
      'Landmark stimati da rete neurale, non marker anatomici: centri articolari approssimati, piede meno affidabile.',
      'Il CoM è una stima segmentale (de Leva) sui landmark 2D, non una misura.',
      'Nessuna inferenza su forze, impulsi, rigidità o rischio di infortunio dalla sola cinematica.',
      `Risoluzione temporale ±${(1000 / S.fps).toFixed(1)} ms per evento a ${S.fps} fps.`,
    ],
  };
}

export function exportJSON() {
  download(new Blob([JSON.stringify(buildReport(), null, 2)], { type: 'application/json' }), `${base()}_report.json`);
}

export function exportMarkdown() {
  const r = buildReport();
  const L = [];
  L.push(`# ${r.progetto}`, '', `Video: **${r.video.nome}** · ${r.video.risoluzione} · ${r.video.fps} fps${r.video.fps_stimati ? ' (stimati)' : ''} · ${r.video.durata_s} s`, '');
  L.push(`Vista: ${r.analisi.vista} · lato vicino: ${r.analisi.lato_vicino || 'n.d.'} · direzione: ${r.analisi.direzione} · terreno: ${r.analisi.terreno_deg}°`, '');
  L.push('## Eventi', '', '| Evento | Piede | Frame | Tempo (s) | Origine |', '|---|---|---|---|---|');
  for (const e of r.eventi) L.push(`| ${e.type} | ${e.foot || '-'} | ${e.frame} | ${e.time_s} | ${e.auto ? 'automatico (verificare)' : 'manuale'} |`);
  L.push('', '## Angoli agli eventi', '');
  for (const e of r.eventi) {
    L.push(`### ${e.type} ${e.foot || ''} — F ${e.frame}`, '', '| Misura | Valore | Confidenza |', '|---|---|---|');
    for (const m of Object.values(e.metrics)) L.push(`| ${m.label} | ${m.conf === 'bassa' ? 'non misurabile' : `${m.value} ${m.unit}`} | ${m.conf} |`);
    L.push('');
  }
  L.push('## Tempi', '');
  r.tempi.contatti_ms.forEach((c, i) => L.push(`- Contatto ${i + 1} (${c.foot}): ${c.ms.toFixed(0)} ms`));
  r.tempi.voli_ms.forEach((c, i) => L.push(`- Volo ${i + 1}: ${c.ms.toFixed(0)} ms`));
  L.push(`- Confidenza tempi: ${r.tempi.confidenza} (±${r.tempi.risoluzione_ms} ms)`, '', '## Limiti', '', ...r.limiti.map((l) => `- ${l}`), '');
  download(new Blob([L.join('\n')], { type: 'text/markdown' }), `${base()}_report.md`);
}

// ---------------- video ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickMime() {
  const c = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return c.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

const EV_TXT = { START: 'INIZIO MOVIMENTO', TD: 'TOUCHDOWN', TO: 'TOE-OFF' };

function drawReel(c, Wo, Ho, f, opts) {
  const s = Wo / 1080;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = C.bg; c.fillRect(0, 0, Wo, Ho);
  // video
  const k = Math.min(Wo / S.W, (Ho * 0.62) / S.H);
  const vw = S.W * k, vh = S.H * k, vx = (Wo - vw) / 2, vy = 230 * s + (Ho * 0.62 - vh) / 2;
  c.save(); c.translate(vx, vy); c.scale(k, k);
  c.drawImage(media(), 0, 0, S.W, S.H);
  drawOverlays(c, (1 / k) * s * 1.35, f, { export: true });
  c.restore();
  // header
  c.fillStyle = C.blue; c.fillRect(60 * s, 96 * s, 6 * s, 84 * s);
  c.textBaseline = 'alphabetic';
  c.font = `800 ${44 * s}px ${FONT}`; c.fillStyle = C.blue; c.fillText('GASA', 84 * s, 134 * s);
  c.fillStyle = C.white; c.fillText(' BIOMECHANICS', 84 * s + c.measureText('GASA').width, 134 * s);
  c.font = `700 ${26 * s}px ${FONT}`; c.fillStyle = '#C9D2DD'; c.fillText(opts.title || '', 84 * s, 176 * s);
  // tag evento
  const ev = S.events.find((e) => e.frame === f);
  if (ev) {
    const label = `${EV_TXT[ev.type]}${ev.foot ? ` ${ev.foot === 'L' ? 'SX' : 'DX'}` : ''}`;
    c.font = `800 ${30 * s}px ${FONT}`;
    const w = c.measureText(label).width + 40 * s;
    c.fillStyle = ev.type === 'TO' ? C.yellow : C.blue;
    roundRect(c, (Wo - w) / 2, vy + 24 * s, w, 50 * s, 10 * s); c.fill();
    c.fillStyle = C.bg; c.textAlign = 'center'; c.fillText(label, Wo / 2, vy + 60 * s); c.textAlign = 'left';
  }
  // pannello valori
  const mm = metricsAt(f);
  const keys = activeMetricKeys(mm).filter((k2) => mm.M[k2].unit === '°').slice(0, 6);
  const top = vy + vh + 40 * s;
  const colW = (Wo - 120 * s) / 3;
  keys.forEach((k2, i) => {
    const m = mm.M[k2];
    const x = 60 * s + (i % 3) * colW, y = top + Math.floor(i / 3) * 150 * s;
    c.fillStyle = 'rgba(21,33,49,0.9)'; roundRect(c, x, y, colW - 16 * s, 132 * s, 14 * s); c.fill();
    c.fillStyle = CONF_COLOR[m.conf]; c.fillRect(x, y + 18 * s, 5 * s, 96 * s);
    c.font = `600 ${21 * s}px ${FONT}`; c.fillStyle = '#C9D2DD'; c.fillText(m.label.toUpperCase().slice(0, 22), x + 22 * s, y + 42 * s);
    c.font = `800 ${56 * s}px ${FONT}`; c.fillStyle = CONF_COLOR[m.conf]; c.fillText(fmt(m, S.showLow), x + 22 * s, y + 104 * s);
    c.font = `700 ${16 * s}px ${FONT}`; c.fillStyle = C.grey; c.fillText(m.conf.toUpperCase(), x + 22 * s, y + 124 * s);
  });
  // footer
  c.font = `600 ${22 * s}px ${FONT}`; c.fillStyle = C.grey;
  c.fillText(`F ${f} · ${(f / S.fps).toFixed(3)} s · ${opts.slow > 1 ? `RALLENTATO ${opts.slow}×` : 'VELOCITÀ REALE'}${opts.frozen ? ' · FERMO IMMAGINE' : ''}`, 60 * s, Ho - 120 * s);
  c.font = `800 ${24 * s}px ${FONT}`; c.fillStyle = C.white; c.fillText('ANALYZE. UNDERSTAND. PERFORM.', 60 * s, Ho - 72 * s);
  c.font = `600 ${17 * s}px ${FONT}`; c.fillStyle = C.grey;
  c.fillText('Misure 2D da video · colori = confidenza (blu alta, giallo media)', 60 * s, Ho - 40 * s);
}

export async function exportVideo(opts) {
  if (!window.MediaRecorder) throw new Error('MediaRecorder non supportato da questo browser');
  const mime = pickMime();
  const reel = opts.format !== 'orig';
  const Wo = opts.format === 'reel720' ? 720 : reel ? 1080 : S.W;
  const Ho = opts.format === 'reel720' ? 1280 : reel ? 1920 : S.H;
  const cv = document.createElement('canvas'); cv.width = Wo; cv.height = Ho;
  const c = cv.getContext('2d');
  const stream = cv.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: reel ? 10e6 : 8e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const OUT = 30, tick = 1000 / OUT;
  // timeline: frame sorgente per ogni tick di uscita
  const plan = [];
  const dur = (S.rangeOut - S.rangeIn + 1) / S.fps;
  const nTicks = Math.ceil(dur * opts.slow * OUT);
  let lastF = -1;
  for (let k = 0; k < nTicks; k++) {
    const f = Math.min(S.rangeOut, S.rangeIn + Math.floor((k / OUT / opts.slow) * S.fps));
    plan.push({ f, frozen: false });
    if (f !== lastF && opts.freeze) {
      // freeze sugli eventi attraversati
      for (let g = lastF + 1; g <= f; g++) if (S.events.some((e) => e.frame === g) && g >= S.rangeIn) {
        for (let q = 0; q < opts.freeze * OUT; q++) plan.push({ f: g, frozen: true });
      }
    }
    lastF = f;
  }
  const draw = (p) => {
    if (reel) drawReel(c, Wo, Ho, p.f, { ...opts, frozen: p.frozen });
    else { c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(media(), 0, 0, S.W, S.H); drawOverlays(c, Math.max(1, S.W / 900), p.f, { export: true }); brandStrip(c, Wo, Ho, p.f); }
  };
  rec.start();
  rec.pause();
  let cur = -1;
  for (let i = 0; i < plan.length; i++) {
    if (opts.cancelled()) break;
    const p = plan[i];
    if (p.f !== cur) { await opts.seek(p.f); cur = p.f; }
    draw(p);
    rec.resume();
    track.requestFrame();
    await sleep(tick);
    rec.pause();
    if (i % 5 === 0) opts.onProgress(i / plan.length, `Export video ${Math.round((i / plan.length) * 100)}%`);
  }
  rec.resume();
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  const type = rec.mimeType || mime || 'video/webm';
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  download(new Blob(chunks, { type }), `${base()}_${opts.format}.${ext}`);
  if (ext === 'webm') console.info('Per Instagram/iPhone converti in MP4 H.264: python/tools/to_instagram.sh');
}

function shapesMeasure() {
  return S.shapes.map((sh) => {
    const P = S.px[sh.frame] || null;
    const m = T.measure(sh, T.resolve(sh, P), { groundRad: S.groundRad, pxPerM: S.pxPerM });
    return { nome: T.shapeName(sh), tipo: sh.type, frame: sh.frame, ambito: sh.scope, valore: m ? +m.value.toFixed(2) : null, unita: m?.unit };
  });
}
