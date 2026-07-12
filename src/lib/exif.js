// Self-contained EXIF reader (JPEG APP1/TIFF). No external library — nothing to fail loading.
export function readExif(buf) {
  try {
    const dv = new DataView(buf);
    if (dv.getUint16(0) !== 0xffd8) return null; // not a JPEG
    let off = 2, tiff = null;
    const len = dv.byteLength;
    while (off + 4 < len) {
      const marker = dv.getUint16(off);
      if ((marker & 0xff00) !== 0xff00) { off++; continue; }
      if (marker === 0xffda || marker === 0xffd9) break;
      const segLen = dv.getUint16(off + 2);
      if (marker === 0xffe1 && dv.getUint32(off + 4) === 0x45786966) { tiff = off + 10; break; }
      if (segLen < 2) break;
      off += 2 + segLen;
    }
    if (tiff == null) return null;
    const le = dv.getUint16(tiff) === 0x4949;
    const u16 = (p) => dv.getUint16(p, le);
    const u32 = (p) => dv.getUint32(p, le);
    if (u16(tiff + 2) !== 0x002a) return null;
    const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    const ents = (o) => {
      const n = u16(o), a = [];
      for (let i = 0; i < n; i++) {
        const e = o + 2 + i * 12;
        a.push({ tag: u16(e), type: u16(e + 2), count: u32(e + 4), vo: e + 8 });
      }
      return a;
    };
    const ptr = (en) => ((SZ[en.type] || 1) * en.count <= 4 ? en.vo : tiff + u32(en.vo));
    const asc = (en) => {
      const p = ptr(en); let s = '';
      for (let i = 0; i < en.count; i++) { const c = dv.getUint8(p + i); if (!c) break; s += String.fromCharCode(c); }
      return s;
    };
    const rats = (en) => {
      const p = ptr(en), o = [];
      for (let i = 0; i < en.count; i++) { const n = u32(p + i * 8), d = u32(p + i * 8 + 4); o.push(d ? n / d : 0); }
      return o;
    };
    const ifd0 = tiff + u32(tiff + 4);
    let exifP = null, gpsP = null;
    ents(ifd0).forEach((en) => {
      if (en.tag === 0x8769) exifP = tiff + u32(en.vo);
      if (en.tag === 0x8825) gpsP = tiff + u32(en.vo);
    });
    let dateRaw = null, tzRaw = null, gps = null;
    if (exifP) ents(exifP).forEach((en) => {
      if (en.tag === 0x9003) dateRaw = asc(en).trim();
      if (en.tag === 0x9011) tzRaw = asc(en).trim();
    });
    if (gpsP) {
      let latR = null, lonR = null, latV = null, lonV = null;
      ents(gpsP).forEach((en) => {
        if (en.tag === 0x0001) latR = asc(en);
        if (en.tag === 0x0002) latV = rats(en);
        if (en.tag === 0x0003) lonR = asc(en);
        if (en.tag === 0x0004) lonV = rats(en);
      });
      if (latV && lonV && latV.length >= 3 && lonV.length >= 3) {
        let lat = latV[0] + latV[1] / 60 + latV[2] / 3600;
        let lon = lonV[0] + lonV[1] / 60 + lonV[2] / 3600;
        if (latR && latR.toUpperCase().includes('S')) lat = -lat;
        if (lonR && lonR.toUpperCase().includes('W')) lon = -lon;
        if (isFinite(lat) && isFinite(lon) && (lat || lon)) gps = { lat, lon };
      }
    }
    return { gps, dateRaw, tzRaw };
  } catch {
    return null;
  }
}

export function parseExifWall(s) {
  if (!s) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6] };
}

export function parseTz(s) {
  const m = /([+-])(\d{2}):?(\d{2})/.exec(s || '');
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]);
}

// Resize + re-encode (also strips ALL metadata — shared photos carry no EXIF).
export function compressImage(file, { max = 2048, quality = 0.86 } = {}) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (Math.max(w, h) > max) {
        const s = max / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
