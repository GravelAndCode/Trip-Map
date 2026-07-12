// Geo math shared by the editor, viewer, and tour engine.
export const M2MI = 0.000621371;
export const M2FT = 3.28084;

export function haversine(a, b) {
  const R = 6371000, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const la1 = toR(a.lat), la2 = toR(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function parseGPX(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  const grab = (sel) =>
    Array.from(xml.querySelectorAll(sel))
      .map((p) => {
        const e = p.querySelector('ele'), t = p.querySelector('time');
        return {
          lat: parseFloat(p.getAttribute('lat')),
          lon: parseFloat(p.getAttribute('lon')),
          ele: e ? parseFloat(e.textContent) : NaN,
          t: t ? Date.parse(t.textContent) : NaN,
        };
      })
      .filter((p) => isFinite(p.lat) && isFinite(p.lon));
  let pts = grab('trkpt');
  if (!pts.length) pts = grab('rtept');
  if (!pts.length) pts = grab('wpt');
  const nm = xml.querySelector('trk name') || xml.querySelector('name');
  return { pts, name: nm ? nm.textContent.trim() : null };
}

export function buildCum(pts) {
  const cum = [0];
  let dist = 0;
  for (let i = 1; i < pts.length; i++) {
    dist += haversine(pts[i - 1], pts[i]);
    cum.push(dist);
  }
  return { cum, distM: dist };
}

// Lightly smooth, then count climbs past a small hysteresis threshold —
// tuned against Garmin head-unit totals (heavier filtering only ever loses gain).
export function elevationGain(pts) {
  const e = [];
  for (const p of pts) if (isFinite(p.ele)) e.push(p.ele);
  if (e.length < 3) return 0;
  const win = 2, sm = [];
  for (let i = 0; i < e.length; i++) {
    const a = Math.max(0, i - win), b = Math.min(e.length - 1, i + win);
    let s = 0, c = 0;
    for (let k = a; k <= b; k++) { s += e[k]; c++; }
    sm.push(s / c);
  }
  const TH = 2;
  let gain = 0, ref = sm[0];
  for (let i = 1; i < sm.length; i++) {
    const d = sm[i] - ref;
    if (d > TH) { gain += d; ref = sm[i]; }
    else if (d < 0) ref = sm[i];
  }
  return gain;
}

// Cap stored points per day (keeps DB rows lean without visible fidelity loss).
export function downsample(pts, max = 6000) {
  if (pts.length <= max) return pts;
  const stride = Math.ceil(pts.length / max);
  const out = [];
  for (let i = 0; i < pts.length; i += stride) out.push(pts[i]);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

// Trim ~meters off each end of a route (privacy for shared views of home starts/ends).
export function trimEnds(pts, meters) {
  if (!meters || pts.length < 10) return pts;
  const { cum, distM } = buildCum(pts);
  if (distM < meters * 3) return pts; // too short to trim meaningfully
  let a = 0, b = pts.length - 1;
  while (a < pts.length - 1 && cum[a] < meters) a++;
  while (b > 0 && distM - cum[b] < meters) b--;
  return b > a ? pts.slice(a, b + 1) : pts;
}

export function fmtWall(w) {
  if (!w) return 'No timestamp';
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const h = w.h % 12 || 12, ap = w.h < 12 ? 'AM' : 'PM';
  return `${M[w.mo - 1]} ${w.d} · ${h}:${String(w.mi).padStart(2, '0')} ${ap}`;
}

export function wallEpoch(w, offMin) {
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - offMin * 60000;
}

// rows <-> engine point formats: DB stores [[lat,lng,ele,t],...]
export const ptsToRows = (pts) => pts.map((p) => [p.lat, p.lon, isFinite(p.ele) ? +p.ele.toFixed(1) : null, isFinite(p.t) ? p.t : null]);
export const rowsToPts = (rows) => rows.map((r) => ({ lat: r[0], lon: r[1], ele: r[2] == null ? NaN : r[2], t: r[3] == null ? NaN : r[3] }));
