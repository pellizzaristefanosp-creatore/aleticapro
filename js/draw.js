// Primitive grafiche GASA (coordinate in pixel video; u = 1 pixel schermo in unità video).
export const C = {
  bg: '#080D14', blue: '#00C8FF', white: '#FFFFFF', yellow: '#FFD447', red: '#FF4655',
  grey: '#8A97A8', far: 'rgba(0,200,255,0.45)',
};
export const CONF_COLOR = { alta: C.blue, media: C.yellow, bassa: C.grey };
const FONT = '"Inter", "SF Pro Display", system-ui, sans-serif';

export function fmt(m, showLow = false, digits = 0) {
  if (!m || m.value == null || Number.isNaN(m.value)) return '—';
  if (m.conf === 'bassa' && !showLow) return 'n.m.';
  const v = `${m.value >= 0 || m.unit !== '°' ? '' : '−'}${Math.abs(m.value).toFixed(digits)}`;
  return `${m.conf === 'bassa' ? '~' : ''}${v}${m.unit === '°' ? '°' : ` ${m.unit}`}`;
}

export function line(ctx, a, b, u, color = C.blue, w = 3, dash = null) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = w * u; ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash.map((d) => d * u));
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.restore();
}

export function glowLine(ctx, a, b, u, color = C.blue, w = 3) {
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 10 * u;
  line(ctx, a, b, u, color, w);
  ctx.restore();
}

export function joint(ctx, p, u, color = C.blue, r = 5, glow = true) {
  ctx.save();
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 14 * u; }
  ctx.fillStyle = C.white; ctx.beginPath(); ctx.arc(p.x, p.y, r * u, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2.5 * u; ctx.strokeStyle = color; ctx.stroke();
  ctx.restore();
}

/** arco dell'angolo in b fra i raggi b→a e b→c, con etichetta lungo la bisettrice */
export function arc(ctx, a, b, c, u, color, label, opts = {}) {
  const segMin = Math.min(Math.hypot(a.x - b.x, a.y - b.y), Math.hypot(c.x - b.x, c.y - b.y));
  const r = Math.max(8 * u, Math.min((opts.r || 38) * u, segMin * 0.55));
  const a1 = Math.atan2(a.y - b.y, a.x - b.x);
  const a2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const prog = opts.progress ?? 1;
  ctx.save();
  ctx.fillStyle = hexA(color, 0.18);
  ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, r, a1, a1 + d * prog, d < 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 2.5 * u;
  ctx.beginPath(); ctx.arc(b.x, b.y, r, a1, a1 + d * prog, d < 0); ctx.stroke();
  ctx.restore();
  if (label) {
    const bis = a1 + d / 2;
    const off = r + (opts.labelOff || 30) * u;
    const at = { x: b.x + Math.cos(bis) * off, y: b.y + Math.sin(bis) * off };
    if (Labels.list) Labels.list.push({ anchor: { x: b.x + Math.cos(bis) * r, y: b.y + Math.sin(bis) * r }, text: label, sub: opts.sub, color });
    else pill(ctx, at, label, u, color, opts.sub);
  }
}

export function pill(ctx, p, text, u, color = C.blue, sub = null) {
  ctx.save();
  const fs = 15 * u;
  ctx.font = `700 ${fs}px ${FONT}`;
  const w = ctx.measureText(text).width;
  let w2 = 0;
  if (sub) { ctx.font = `600 ${fs * 0.62}px ${FONT}`; w2 = ctx.measureText(sub).width; }
  const W = Math.max(w, w2) + 14 * u, H = (sub ? 34 : 22) * u;
  const x = p.x - W / 2, y = p.y - H / 2;
  ctx.fillStyle = 'rgba(8,13,20,0.86)';
  roundRect(ctx, x, y, W, H, 6 * u); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.5 * u; ctx.stroke();
  ctx.fillStyle = color === C.grey ? '#C9D2DD' : color;
  ctx.font = `700 ${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, p.x, sub ? y + 12 * u : p.y + 0.5 * u);
  if (sub) { ctx.font = `600 ${fs * 0.62}px ${FONT}`; ctx.fillStyle = '#C9D2DD'; ctx.fillText(sub, p.x, y + 26 * u); }
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function crosshair(ctx, p, u, color = C.yellow) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2 * u;
  ctx.beginPath(); ctx.arc(p.x, p.y, 10 * u, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - 16 * u, p.y); ctx.lineTo(p.x - 4 * u, p.y); ctx.moveTo(p.x + 4 * u, p.y); ctx.lineTo(p.x + 16 * u, p.y);
  ctx.moveTo(p.x, p.y - 16 * u); ctx.lineTo(p.x, p.y - 4 * u); ctx.moveTo(p.x, p.y + 4 * u); ctx.lineTo(p.x, p.y + 16 * u);
  ctx.stroke();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, 3 * u, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function text(ctx, p, str, u, color = C.white, size = 14, align = 'left', weight = 700) {
  ctx.save();
  ctx.font = `${weight} ${size * u}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4 * u;
  ctx.fillText(str, p.x, p.y);
  ctx.restore();
}

/**
 * Impaginazione delle etichette in colonne laterali con linee di richiamo:
 * leggibili anche quando l'atleta occupa una piccola parte dell'inquadratura.
 */
export const Labels = {
  list: null,
  begin() { this.list = []; },
  add(anchor, text, color, sub) { if (this.list) this.list.push({ anchor, text, sub, color }); },
  flush(ctx, u, box, W, H, bounds = null) {
    // area visibile (schermo zoomato) ∩ immagine: le etichette restano sempre leggibili
    const X0 = Math.max(0, bounds?.x0 ?? 0), X1 = Math.min(W, bounds?.x1 ?? W);
    const Y0 = Math.max(0, bounds?.y0 ?? 0), Y1 = Math.min(H, bounds?.y1 ?? H);
    const L = this.list || [];
    this.list = null;
    if (!L.length) return;
    const cx = (box.minX + box.maxX) / 2;
    const ph = 38 * u, gap = 6 * u;
    const widthOf = (l) => {
      ctx.save();
      ctx.font = `700 ${15 * u}px ${FONT}`; let w = ctx.measureText(l.text).width;
      if (l.sub) { ctx.font = `600 ${15 * u * 0.62}px ${FONT}`; w = Math.max(w, ctx.measureText(l.sub).width); }
      ctx.restore();
      return w + 14 * u;
    };
    for (const side of [-1, 1]) {
      const items = L.filter((l) => (side < 0 ? l.anchor.x < cx : l.anchor.x >= cx)).sort((a, b) => a.anchor.y - b.anchor.y);
      if (!items.length) continue;
      const pw = Math.max(...items.map(widthOf));
      let x = side < 0 ? box.minX - 34 * u - pw / 2 : box.maxX + 34 * u + pw / 2;
      x = Math.max(X0 + pw / 2 + 4 * u, Math.min(X1 - pw / 2 - 4 * u, x));
      // centra il blocco sull'altezza media delle ancore, poi risolve le sovrapposizioni
      let ys = items.map((l) => l.anchor.y);
      for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + ph + gap);
      const over = ys[ys.length - 1] + ph / 2 - (Y1 - 4 * u);
      if (over > 0) ys = ys.map((y) => y - over);
      for (let i = 0; i < ys.length; i++) ys[i] = Math.max(ys[i], Y0 + ph / 2 + 4 * u + i * (ph + gap));
      items.forEach((l, i) => {
        const p = { x, y: ys[i] };
        const edge = { x: x - side * pw / 2, y: p.y };
        ctx.save();
        ctx.strokeStyle = hexA(l.color === C.grey ? '#8A97A8' : l.color, 0.7); ctx.lineWidth = 1.4 * u;
        ctx.beginPath(); ctx.moveTo(l.anchor.x, l.anchor.y);
        ctx.lineTo(edge.x - side * 10 * u, edge.y); ctx.lineTo(edge.x, edge.y); ctx.stroke();
        ctx.fillStyle = l.color; ctx.beginPath(); ctx.arc(l.anchor.x, l.anchor.y, 2.5 * u, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        pill(ctx, p, l.text, u, l.color, l.sub);
      });
    }
  },
};
