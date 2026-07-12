// Trip Map engine — framework-agnostic port of the proven prototype.
// Owns the sidebar content, the map, photo markers/clusters, and the cinematic tour.
// Pages provide container elements + persistence callbacks; view mode disables editing.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import {
  M2MI, M2FT, haversine, parseGPX, buildCum, elevationGain, downsample,
  trimEnds, fmtWall, wallEpoch,
} from './geo.js';
import { readExif, parseExifWall, parseTz, compressImage } from './exif.js';

const DAY_COLORS = ['#E8A44C', '#4CC2E8', '#7DD38B', '#E86B9A', '#B58CE8', '#F2D65C', '#8CC6FF'];
const AMBER = '#E8A44C', BLAZE = '#FF6B4A', TEAL = '#4CC2E8';

export function createTripMap(opts) {
  const {
    panelEl, mainEl,
    editable = true,
    trimMeters = 0,          // viewer privacy trim per day end
    musicUrl = null,         // string URL, or a function returning one (lets the editor change tracks live)
    on = {},                 // persistence callbacks (see bottom)
  } = opts;

  let days = [];    // {id,name,color,pts(view),cum,stats,layer,visible,hasTime,position}
  let photos = [];  // {id,url,gps:{lat,lon}|null,timeWall,tzOffsetMin,caption,dayId,marker,placed}
  let focusId = null, armedPhoto = null, moveTarget = null, dayCounter = 0;
  let title = '';

  // ---------- static UI ----------
  panelEl.innerHTML = `
    <div id="brand">
      <div class="eyebrow">Trip Map</div>
      <div id="title-row">
        <input id="trip-title" placeholder="Name your trip…" ${editable ? '' : 'readonly'} />
        ${editable ? '<svg id="title-pen" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>' : ''}
      </div>
      <div id="overview">
        <div class="ov"><span class="n" id="ov-dist">0</span><span class="l">Miles</span></div>
        <div class="ov"><span class="n" id="ov-gain">0</span><span class="l">Ft climbed</span></div>
        <div class="ov"><span class="n" id="ov-days">0</span><span class="l">Days</span></div>
      </div>
      <button class="btn amber" id="play-trip"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Play the trip</button>
    </div>
    <div id="scroll">
      <div class="sec-label">Days</div>
      ${editable ? `<label class="upload"><input type="file" id="gpx-input" accept=".gpx" multiple />
        <span class="btn amber"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>Add GPX day</span></label>` : ''}
      <div id="days"></div>
      <div id="days-empty" class="empty">${editable
        ? 'Drop a .gpx file for each day — each becomes its own colored route. Drag the ⋮⋮ grip to reorder.'
        : 'This trip has no routes yet.'}</div>
      ${editable ? `
      <div class="sec-label" style="margin-top:20px">Photos</div>
      <label class="upload"><input type="file" id="photo-input" accept="image/*" multiple />
        <span class="btn"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>Add photos</span></label>
      <div class="tray-hint" id="tray-hint">Photos with GPS drop onto the map automatically. Ones without land here — drag a thumbnail onto the map, place them by time below, or tap one then tap the map.</div>
      <div id="tray"></div>
      <div id="time-place">
        <div class="tp-row"><span class="tp-label">Photo timezone</span>
          <select id="tz-offset">
            <option value="-360" selected>Mountain · summer (UTC−6)</option>
            <option value="-420">Mountain · winter (UTC−7)</option>
            <option value="-300">Central · summer (UTC−5)</option>
            <option value="-240">Eastern · summer (UTC−4)</option>
            <option value="-300">Eastern · winter (UTC−5)</option>
            <option value="-420">Pacific · summer (UTC−7)</option>
            <option value="-480">Pacific · winter (UTC−8)</option>
          </select></div>
        <button class="btn" id="place-time-btn">Place photos by time</button>
        <div class="tp-note">Matches each photo's capture time to where you were on the route. Drag any pin to nudge it.</div>
        <div id="tp-result" class="tray-hint" style="display:none"></div>
      </div>` : ''}
    </div>`;

  mainEl.innerHTML = `
    <div id="map"></div>
    <div id="tiles">
      <button class="tile-btn" data-tile="trail">Trail</button>
      <button class="tile-btn on" data-tile="sat">Satellite</button>
    </div>
    <div id="arm-banner"></div>
    <div id="dock">
      <div id="dock-title">Elevation · <span id="dock-day">Day</span></div>
      <button id="dock-close">×</button>
      <div id="profile-wrap"><svg id="profile" preserveAspectRatio="none"></svg></div>
      <div id="readout">
        <div class="rd"><div class="k">Distance</div><div class="v" id="rd-dist">0.0 mi</div></div>
        <div class="rd"><div class="k">Elevation</div><div class="v" id="rd-ele">— ft</div></div>
        <div class="rd"><div class="k">Grade</div><div class="v blaze" id="rd-grade">0%</div></div>
        <div class="rd"><div class="k">Position</div><div class="v" id="rd-pos">—</div></div>
        <div id="transport">
          <button id="follow-btn" class="on">Follow</button>
          <button id="speed">1×</button>
          <button id="playbtn"><svg id="play-ico" width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
        </div>
      </div>
    </div>
    <div id="tour">
      <div id="tour-vignette"></div>
      <div class="letterbox top"></div>
      <div id="daycard"><div class="dc-k">Day</div><div class="dc-n"></div></div>
      <div id="photo-card"><div class="frame"><div class="pc-cap"><span class="pc-text"></span></div></div></div>
      <div id="tour-ctrl">
        <button class="tc-btn" id="tc-prev" title="Previous photo">‹</button>
        <button class="tc-btn" id="tc-next" title="Next photo">›</button>
        ${musicUrl ? '<button class="tc-btn" id="tc-mute" title="Mute music" style="display:none">♪</button>' : ''}
        <button class="tc-btn" id="tc-speed">2×</button>
        <button class="tc-btn play" id="tc-play">Pause</button>
        <button class="tc-btn" id="tc-exit">Exit</button>
      </div>
      <div id="tour-bar">
        <svg id="tour-profile" preserveAspectRatio="none"></svg>
        <div id="tour-stats">
          <span class="ts-day" id="ts-day">—</span>
          <span class="ts mono" id="ts-dist">0.0 mi</span>
          <span class="ts mono" id="ts-ele">— ft</span>
          <span class="ts mono dim" id="ts-pct">0%</span>
        </div>
      </div>
      <div id="tour-end">
        <div class="te-k">Trip complete</div>
        <div class="te-t" id="te-title"></div>
        <div class="te-stats">
          <div class="te-stat"><div class="n" id="te-mi">0</div><div class="l">Miles</div></div>
          <div class="te-stat"><div class="n" id="te-ft">0</div><div class="l">Ft climbed</div></div>
          <div class="te-stat"><div class="n" id="te-ph">0</div><div class="l">Photos</div></div>
        </div>
        <div class="te-btns"><button class="btn" id="te-replay">Replay</button><button class="btn amber" id="te-done">Done</button></div>
      </div>
    </div>`;

  const $ = (sel) => mainEl.querySelector(sel) || panelEl.querySelector(sel);

  // ---------- map ----------
  const map = L.map($('#map'), { zoomControl: true, attributionControl: false }).setView([39.55, -107.32], 6);
  L.control.attribution({ prefix: false, position: 'bottomright' }).addAttribution('© OpenStreetMap · Esri · CARTO').addTo(map);
  const tileTrail = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19 });
  const satImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
  const satRoads = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
  const satLabels = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', { maxZoom: 19 });
  const tileSat = L.layerGroup([satImagery, satRoads, satLabels]);
  tileSat.addTo(map);
  mainEl.querySelectorAll('.tile-btn').forEach((b) => {
    b.onclick = () => {
      mainEl.querySelectorAll('.tile-btn').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      if (b.dataset.tile === 'sat') { map.removeLayer(tileTrail); tileSat.addTo(map); }
      else { map.removeLayer(tileSat); tileTrail.addTo(map); }
    };
  });

  const photoLayer = L.markerClusterGroup({
    maxClusterRadius: 46, showCoverageOnHover: false, zoomToBoundsOnClick: false,
    spiderfyOnMaxZoom: true, spiderfyDistanceMultiplier: 1.7,
    iconCreateFunction(cluster) {
      const kids = cluster.getAllChildMarkers();
      const url = (kids[0] && kids[0].photoUrl) || '';
      return L.divIcon({
        className: '', iconSize: [54, 54], iconAnchor: [27, 27],
        html: `<div class="cluster-stack"><span class="cs-b2"></span><span class="cs-b1"></span>
               <span class="cs-face" style="background-image:url(${url})"></span>
               <span class="cs-count">${cluster.getChildCount()}</span></div>`,
      });
    },
  });
  photoLayer.on('clusterclick', (a) => a.layer.spiderfy());
  photoLayer.addTo(map);

  // ---------- title ----------
  const titleInput = $('#trip-title');
  titleInput.oninput = () => { title = titleInput.value; };
  titleInput.onchange = () => on.title && on.title(titleInput.value);

  // ---------- days ----------
  function viewPts(rawPts) { return trimMeters ? trimEnds(rawPts, trimMeters) : rawPts; }

  function makeDay(rec) {
    const pts = viewPts(rec.pts);
    const c = buildCum(pts);
    const layer = L.polyline(pts.map((p) => [p.lat, p.lon]), { color: rec.color, weight: 4, opacity: 0.92, lineJoin: 'round' }).addTo(map);
    return {
      id: rec.id, name: rec.name, color: rec.color, pts, cum: c.cum,
      hasTime: pts.filter((p) => isFinite(p.t)).length > 1,
      stats: { distM: rec.distM != null ? rec.distM : c.distM, gainM: rec.gainM != null ? rec.gainM : elevationGain(pts) },
      layer, visible: true,
    };
  }

  async function addDayFromGPX(file) {
    const text = await file.text();
    const g = parseGPX(text);
    if (g.pts.length < 2) { alert(`Could not read track points from ${file.name}`); return; }
    const pts = downsample(g.pts);
    dayCounter = days.length + 1;
    const rec = {
      id: crypto.randomUUID(),
      name: g.name || file.name.replace(/\.gpx$/i, '') || `Day ${dayCounter}`,
      color: DAY_COLORS[days.length % DAY_COLORS.length],
      pts, distM: buildCum(pts).distM, gainM: elevationGain(pts),
    };
    days.push(makeDay(rec));
    renderDays(); updateOverview(); updateTimePlaceUI();
    focusDay(rec.id); fitAll();
    on.dayAdded && on.dayAdded({ ...rec, position: days.length - 1 });
  }

  function fitAll() {
    const vis = days.filter((d) => d.visible);
    if (!vis.length) return;
    try { map.fitBounds(L.featureGroup(vis.map((d) => d.layer)).getBounds().pad(0.15)); } catch {}
  }
  function focusedDay() { return days.find((d) => d.id === focusId); }
  function focusDay(id) {
    if (id !== focusId) { stopPlay(); pDist = 0; pIdx = 0; }
    focusId = id; renderDays(); drawProfile(); openDock();
  }
  function toggleDay(id) {
    const d = days.find((x) => x.id === id);
    d.visible = !d.visible;
    if (d.visible) d.layer.addTo(map); else map.removeLayer(d.layer);
    renderDays(); updateOverview(); fitAll();
  }
  function deleteDay(d) {
    if (!confirm(`Remove "${d.name}" and its route? Photos assigned to it go back to Auto.`)) return;
    map.removeLayer(d.layer);
    days = days.filter((x) => x.id !== d.id);
    photos.forEach((p) => { if (p.dayId === d.id) p.dayId = null; });
    if (focusId === d.id) { focusId = null; $('#dock').classList.remove('show'); }
    renderDays(); updateOverview(); updateTimePlaceUI(); fitAll();
    on.dayDeleted && on.dayDeleted(d.id);
    emitOrder();
  }
  function emitOrder() {
    on.daysReordered && on.daysReordered(days.map((d, i) => ({ id: d.id, position: i })));
  }

  let dragDay = null; // {idx, ghost}
  function renderDays() {
    const wrap = $('#days');
    $('#days-empty').style.display = days.length ? 'none' : 'block';
    wrap.innerHTML = '';
    days.forEach((d, di) => {
      const mi = d.stats.distM * M2MI, ft = d.stats.gainM * M2FT;
      const el = document.createElement('div');
      el.className = 'day' + (d.id === focusId ? ' focused' : '') + (d.visible ? '' : ' hidden-day');
      el.dataset.idx = di;
      el.innerHTML = `
        <div class="day-top">
          ${editable ? '<span class="grip" title="Drag to reorder">⋮⋮</span>' : ''}
          <span class="swatch" style="background:${d.color}"></span>
          <input class="day-name" value="${d.name.replace(/"/g, '&quot;')}" ${editable ? '' : 'readonly'}/>
          <span class="eye" title="Show / hide">${d.visible
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.9 17.9A10.8 10.8 0 0 1 12 19C5.5 19 2 12 2 12a19 19 0 0 1 5.1-5.9M9.9 4.2A11 11 0 0 1 12 4c6.5 0 10 7 10 7a19 19 0 0 1-2.3 3.3M1 1l22 22"/></svg>'}</span>
          ${editable ? '<span class="day-x" title="Remove this day">×</span>' : ''}
        </div>
        <div class="day-stats"><span><b>${mi.toFixed(1)}</b> mi</span><span><b>${Math.round(ft).toLocaleString()}</b> ft</span></div>
        <div class="day-actions">
          <button class="btn sm play-day"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Fly it</button>
          <button class="btn sm ghost prof-day">Profile</button>
        </div>`;
      el.querySelector('.eye').onclick = (e) => { e.stopPropagation(); toggleDay(d.id); };
      if (editable) {
        el.querySelector('.day-x').onclick = (e) => { e.stopPropagation(); deleteDay(d); };
        const nameInput = el.querySelector('.day-name');
        nameInput.onclick = (e) => e.stopPropagation();
        nameInput.onchange = () => { d.name = nameInput.value || d.name; on.dayRenamed && on.dayRenamed(d.id, d.name); };
        // pointer-based drag (mouse AND touch) from the grip only
        const grip = el.querySelector('.grip');
        grip.addEventListener('pointerdown', (e) => {
          e.preventDefault(); e.stopPropagation();
          grip.setPointerCapture(e.pointerId);
          dragDay = { idx: di };
          el.classList.add('dragging');
          const move = (ev) => {
            const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.day');
            wrap.querySelectorAll('.day').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
            if (!target || target === el) return;
            const r = target.getBoundingClientRect();
            target.classList.add(ev.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
          };
          const up = (ev) => {
            grip.removeEventListener('pointermove', move);
            grip.removeEventListener('pointerup', up);
            grip.removeEventListener('pointercancel', up);
            el.classList.remove('dragging');
            const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.day');
            wrap.querySelectorAll('.day').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
            if (target && target !== el && dragDay) {
              const ti = +target.dataset.idx;
              const r = target.getBoundingClientRect();
              let to = ti + (ev.clientY < r.top + r.height / 2 ? 0 : 1);
              const from = dragDay.idx;
              if (to > from) to--;
              if (to !== from) {
                const mv = days.splice(from, 1)[0];
                days.splice(to, 0, mv);
                emitOrder();
              }
            }
            dragDay = null;
            renderDays();
          };
          grip.addEventListener('pointermove', move);
          grip.addEventListener('pointerup', up);
          grip.addEventListener('pointercancel', up);
        });
      }
      el.querySelector('.play-day').onclick = (e) => { e.stopPropagation(); focusDay(d.id); startPlay(); };
      el.querySelector('.prof-day').onclick = (e) => { e.stopPropagation(); focusDay(d.id); };
      el.onclick = () => focusDay(d.id);
      wrap.appendChild(el);
    });
  }

  function updateOverview() {
    const vis = days.filter((d) => d.visible);
    const dist = vis.reduce((s, d) => s + d.stats.distM, 0);
    const gain = vis.reduce((s, d) => s + d.stats.gainM, 0);
    $('#ov-dist').textContent = (dist * M2MI).toFixed(0);
    $('#ov-gain').textContent = Math.round(gain * M2FT).toLocaleString();
    $('#ov-days').textContent = days.length;
  }

  // ---------- photos ----------
  async function importPhotoFile(file) {
    const buf = await file.arrayBuffer();
    const meta = readExif(buf);
    const gps = meta?.gps || null;
    const timeWall = meta ? parseExifWall(meta.dateRaw) : null;
    const tzOff = meta?.tzRaw ? parseTz(meta.tzRaw) : null;
    const blob = await compressImage(file);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const ph = {
      id: crypto.randomUUID(), url, gps, timeWall, tzOffsetMin: tzOff,
      caption: '', dayId: null, marker: null, placed: false,
    };
    photos.push(ph);
    if (gps) placePhotoLocal(ph, gps.lat, gps.lon);
    renderTray();
    on.photoAdded && on.photoAdded(ph, blob);
  }

  function placePhotoLocal(ph, lat, lon) {
    ph.placed = true; ph.gps = { lat, lon };
    const icon = L.divIcon({
      className: '', iconSize: [46, 46], iconAnchor: [23, 23],
      html: `<div class="photo-pin" style="width:46px;height:46px;background-image:url(${ph.url})"></div>`,
    });
    ph.marker = L.marker([lat, lon], { icon, draggable: editable });
    ph.marker.photoUrl = ph.url;
    ph.marker.bindPopup(() => buildPhotoPopup(ph), { closeButton: false, autoPan: true, autoPanPadding: [40, 40], minWidth: 300, maxWidth: 520 });
    if (editable) ph.marker.on('dragend', () => {
      const ll = ph.marker.getLatLng();
      ph.gps = { lat: ll.lat, lon: ll.lng };
      on.photoPlaced && on.photoPlaced(ph);
    });
    photoLayer.addLayer(ph.marker);
    renderTray();
  }
  function placePhoto(ph, lat, lon) {
    placePhotoLocal(ph, lat, lon);
    on.photoPlaced && on.photoPlaced(ph);
  }

  function resolveAutoDay(ph) {
    if (ph.timeWall) {
      const tzSel = $('#tz-offset');
      const off = ph.tzOffsetMin != null ? ph.tzOffsetMin : (tzSel ? parseInt(tzSel.value, 10) : -360);
      const T = wallEpoch(ph.timeWall, off), tol = 20 * 60000;
      let best = null;
      days.forEach((d) => {
        const tp = d.pts.filter((p) => isFinite(p.t));
        if (tp.length < 2) return;
        const t0 = tp[0].t, t1 = tp[tp.length - 1].t;
        if (T >= t0 - tol && T <= t1 + tol) {
          const s = T < t0 ? t0 - T : T > t1 ? T - t1 : 0;
          if (!best || s < best.s) best = { d, s };
        }
      });
      if (best) return best.d;
    }
    if (ph.gps) {
      let bd = Infinity, bday = null;
      days.forEach((d) => {
        for (let i = 0; i < d.pts.length; i += 3) {
          const q = haversine(ph.gps, d.pts[i]);
          if (q < bd) { bd = q; bday = d; }
        }
      });
      return bday;
    }
    return null;
  }
  const resolveDay = (ph) => (ph.dayId && days.find((x) => x.id === ph.dayId)) || resolveAutoDay(ph);

  function buildPhotoPopup(ph) {
    const html = document.createElement('div');
    const when = fmtWall(ph.timeWall);
    if (editable) {
      const autoDay = resolveAutoDay(ph);
      let opts = `<option value="">Auto${autoDay ? ' — ' + autoDay.name.replace(/</g, '&lt;') : ''}</option>`;
      days.forEach((d) => {
        opts += `<option value="${d.id}"${ph.dayId === d.id ? ' selected' : ''}>${d.name.replace(/</g, '&lt;')}</option>`;
      });
      html.innerHTML = `
        <img class="pop-img" src="${ph.url}"/>
        <textarea class="pop-cap" placeholder="Add a caption…">${ph.caption.replace(/</g, '&lt;')}</textarea>
        <div class="pop-day"><span>Plays during</span><select class="pop-day-sel">${opts}</select></div>
        <div class="pop-row"><span class="pop-meta">${when}</span><span>
        <button class="pop-move">Move</button><button class="pop-del">Remove</button></span></div>`;
      const ta = html.querySelector('.pop-cap');
      ta.oninput = () => { ph.caption = ta.value; };
      ta.onchange = () => on.photoCaption && on.photoCaption(ph);
      const sel = html.querySelector('.pop-day-sel');
      sel.onchange = () => { ph.dayId = sel.value || null; on.photoDayAssigned && on.photoDayAssigned(ph); };
      html.querySelector('.pop-move').onclick = () => {
        moveTarget = ph; armedPhoto = null; map.closePopup(); updateArm(); renderTray();
      };
      html.querySelector('.pop-del').onclick = () => {
        if (ph.marker) photoLayer.removeLayer(ph.marker);
        photos = photos.filter((x) => x !== ph);
        map.closePopup(); renderTray();
        on.photoDeleted && on.photoDeleted(ph.id);
      };
    } else {
      html.innerHTML = `
        <img class="pop-img" src="${ph.url}"/>
        ${ph.caption ? `<div class="pop-view-cap">${ph.caption.replace(/</g, '&lt;')}</div>` : ''}`;
    }
    html.querySelector('.pop-img').title = 'Click to enlarge';
    html.querySelector('.pop-img').onclick = () => openLightbox(ph);
    return html;
  }

  // lightbox lives on document.body so it truly fills the screen
  let lb = document.getElementById('tm-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'tm-lightbox';
    lb.innerHTML = '<button id="lb-x">×</button><img alt=""/><div id="lb-cap"></div>';
    document.body.appendChild(lb);
    lb.onclick = () => lb.classList.remove('show');
    lb.querySelector('img').onclick = (e) => e.stopPropagation();
    lb.querySelector('#lb-x').onclick = () => lb.classList.remove('show');
  }
  function openLightbox(ph) {
    lb.querySelector('img').src = ph.url;
    const cap = lb.querySelector('#lb-cap');
    cap.textContent = ph.caption || '';
    cap.style.display = ph.caption ? 'block' : 'none';
    lb.classList.add('show');
  }

  // tray (editor only)
  let dragThumb = null; // {ph, ghost}
  function renderTray() {
    const tray = $('#tray');
    if (!tray) return;
    const unplaced = photos.filter((p) => !p.placed);
    $('#tray-hint').style.display = photos.length ? 'block' : 'none';
    tray.innerHTML = '';
    unplaced.forEach((p) => {
      const t = document.createElement('div');
      t.className = 'tray-thumb' + (armedPhoto === p ? ' armed' : '');
      t.style.backgroundImage = `url(${p.url})`;
      t.title = 'Drag onto the map to place';
      // pointer drag with ghost (mouse + touch); a tap without movement arms tap-to-place
      t.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('thumb-x')) return;
        e.preventDefault();
        t.setPointerCapture(e.pointerId);
        const start = { x: e.clientX, y: e.clientY };
        let moved = false, ghost = null;
        const move = (ev) => {
          if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 8) {
            moved = true;
            ghost = document.createElement('div');
            ghost.className = 'drag-ghost';
            ghost.style.backgroundImage = `url(${p.url})`;
            document.body.appendChild(ghost);
          }
          if (ghost) { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; }
        };
        const up = (ev) => {
          t.removeEventListener('pointermove', move);
          t.removeEventListener('pointerup', up);
          t.removeEventListener('pointercancel', up);
          if (ghost) ghost.remove();
          if (moved) {
            const mc = map.getContainer(), r = mc.getBoundingClientRect();
            if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
              const ll = map.containerPointToLatLng([ev.clientX - r.left, ev.clientY - r.top]);
              placePhoto(p, ll.lat, ll.lng);
              armedPhoto = null; updateArm();
            }
          } else {
            armedPhoto = armedPhoto === p ? null : p;
            updateArm(); renderTray();
          }
        };
        t.addEventListener('pointermove', move);
        t.addEventListener('pointerup', up);
        t.addEventListener('pointercancel', up);
      });
      const x = document.createElement('div');
      x.className = 'thumb-x'; x.textContent = '×'; x.title = 'Discard this photo';
      x.onclick = (ev) => {
        ev.stopPropagation();
        if (armedPhoto === p) { armedPhoto = null; updateArm(); }
        photos = photos.filter((q) => q !== p);
        renderTray();
        on.photoDeleted && on.photoDeleted(p.id);
      };
      t.appendChild(x);
      tray.appendChild(t);
    });
    updateTimePlaceUI();
  }

  function updateArm() {
    const b = $('#arm-banner');
    if (moveTarget) { b.textContent = 'Tap the map to move this photo · Esc to cancel'; b.style.display = 'block'; }
    else if (armedPhoto) { b.textContent = 'Tap the map to place this photo · Esc to cancel'; b.style.display = 'block'; }
    else b.style.display = 'none';
  }
  map.on('click', (e) => {
    if (!editable) return;
    if (moveTarget) {
      const ph = moveTarget; moveTarget = null;
      if (ph.marker) photoLayer.removeLayer(ph.marker);
      placePhoto(ph, e.latlng.lat, e.latlng.lng);
      updateArm(); return;
    }
    if (armedPhoto) { placePhoto(armedPhoto, e.latlng.lat, e.latlng.lng); armedPhoto = null; updateArm(); }
  });
  const escHandler = (e) => {
    if (e.key !== 'Escape') return;
    armedPhoto = null; moveTarget = null; updateArm(); renderTray();
    lb.classList.remove('show');
    if (tour.on) exitTour();
  };
  document.addEventListener('keydown', escHandler);

  // time placement
  function interpDay(d, T) {
    const tp = d.pts.filter((p) => isFinite(p.t));
    if (T <= tp[0].t) return tp[0];
    if (T >= tp[tp.length - 1].t) return tp[tp.length - 1];
    for (let i = 1; i < tp.length; i++) {
      if (tp[i].t >= T) {
        const a = tp[i - 1], b = tp[i], f = (T - a.t) / (b.t - a.t || 1);
        return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
      }
    }
    return tp[0];
  }
  function placeByTimeAll(defaultOff) {
    let placed = 0;
    photos.filter((p) => !p.placed && p.timeWall).forEach((ph) => {
      const off = ph.tzOffsetMin != null ? ph.tzOffsetMin : defaultOff;
      const T = wallEpoch(ph.timeWall, off);
      let best = null;
      days.forEach((day) => {
        if (!day.hasTime) return;
        const tp = day.pts.filter((p) => isFinite(p.t));
        const t0 = tp[0].t, t1 = tp[tp.length - 1].t, tol = 20 * 60000;
        if (T < t0 - tol || T > t1 + tol) return;
        const score = T < t0 ? t0 - T : T > t1 ? T - t1 : 0;
        if (!best || score < best.score) best = { day, score };
      });
      if (best) { const pos = interpDay(best.day, T); placePhoto(ph, pos.lat, pos.lon); placed++; }
    });
    renderTray();
    return { placed, remaining: photos.filter((p) => !p.placed).length };
  }
  function updateTimePlaceUI() {
    const box = $('#time-place');
    if (!box) return;
    const anyDayTime = days.some((d) => d.hasTime);
    const stamped = photos.filter((p) => !p.placed && p.timeWall).length;
    box.style.display = anyDayTime && stamped > 0 ? 'block' : 'none';
    const btn = $('#place-time-btn');
    if (btn) btn.textContent = `Place ${stamped} photo${stamped === 1 ? '' : 's'} by time`;
  }

  // ---------- per-day playback ----------
  const PAD = { l: 6, r: 6, t: 14, b: 6 };
  let profileMeta = null, playing = false, raf = null, pIdx = 0, pDist = 0, follow = true, speed = 1;
  const posDot = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="pos-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 1000 });

  function openDock() { $('#dock').classList.add('show'); map.invalidateSize(); }
  $('#dock-close').onclick = () => { stopPlay(); $('#dock').classList.remove('show'); map.invalidateSize(); };
  $('#follow-btn').onclick = function () { follow = !follow; this.classList.toggle('on', follow); };
  $('#speed').onclick = function () { const o = [1, 2, 4, 8]; speed = o[(o.indexOf(speed) + 1) % o.length]; this.textContent = speed + '×'; };
  $('#playbtn').onclick = () => (playing ? stopPlay() : startPlay());

  function drawProfile() {
    const d = focusedDay(), svg = $('#profile');
    $('#dock-day').textContent = d ? d.name : '—';
    if (!d) { svg.innerHTML = ''; return; }
    const W = svg.clientWidth || 900, H = svg.clientHeight || 90;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const eles = d.pts.map((p) => (isFinite(p.ele) ? p.ele : 0));
    let minE = Math.min(...eles), maxE = Math.max(...eles);
    if (maxE - minE < 1) maxE = minE + 1;
    const total = d.cum[d.cum.length - 1] || 1;
    const X = (i) => PAD.l + (d.cum[i] / total) * (W - PAD.l - PAD.r);
    const Y = (e) => PAD.t + (1 - (e - minE) / (maxE - minE)) * (H - PAD.t - PAD.b);
    let line = '', area = `M ${X(0)} ${H - PAD.b}`;
    for (let i = 0; i < d.pts.length; i++) {
      const x = X(i), y = Y(eles[i]);
      line += (i ? 'L' : 'M') + ` ${x.toFixed(1)} ${y.toFixed(1)} `;
      area += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    area += ` L ${X(d.pts.length - 1)} ${H - PAD.b} Z`;
    svg.innerHTML = `
      <defs><linearGradient id="pg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${d.color}" stop-opacity=".38"/>
      <stop offset="1" stop-color="${d.color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#pg)"/>
      <path d="${line}" fill="none" stroke="${d.color}" stroke-width="1.8"/>
      <circle id="prof-dot" r="4.5" fill="${BLAZE}" stroke="#fff" stroke-width="2" style="display:none"/>
      <text x="${PAD.l}" y="11" fill="#8B97A0" font-family="JetBrains Mono" font-size="9.5">${Math.round(maxE * M2FT).toLocaleString()} ft</text>`;
    profileMeta = { X, Y, minE };
  }

  function idxAtDist(d, dist) {
    const c = d.cum;
    let lo = 0, hi = c.length - 1;
    if (dist <= 0) return 0;
    if (dist >= c[hi]) return hi;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= dist) lo = mid; else hi = mid; }
    return lo;
  }
  function setPlayIco(p) { $('#play-ico').innerHTML = p ? '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>' : '<path d="M8 5v14l11-7z"/>'; }
  function startPlay() {
    const d = focusedDay();
    if (!d || d.pts.length < 2) return;
    const total = d.stats.distM;
    if (total < 10) return;
    if (pDist >= total - 1) pDist = 0;
    playing = true; setPlayIco(true);
    posDot.addTo(map);
    const dot = $('#prof-dot'); if (dot) dot.style.display = '';
    const DAY_SEC = 34;
    let last = performance.now();
    const step = (now) => {
      if (!playing) return;
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      pDist += dt * (total / (DAY_SEC / speed));
      if (pDist >= total) { pDist = total; pIdx = d.pts.length - 1; updateFrame(d); stopPlay(); return; }
      pIdx = idxAtDist(d, pDist);
      updateFrame(d);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function stopPlay() { playing = false; setPlayIco(false); if (raf) cancelAnimationFrame(raf); }
  function updateFrame(d) {
    const p = d.pts[pIdx];
    posDot.setLatLng([p.lat, p.lon]);
    if (follow) map.panTo([p.lat, p.lon], { animate: false });
    $('#rd-dist').textContent = (d.cum[pIdx] * M2MI).toFixed(1) + ' mi';
    $('#rd-ele').textContent = isFinite(p.ele) ? Math.round(p.ele * M2FT).toLocaleString() + ' ft' : '— ft';
    const pj = Math.max(1, pIdx), a = d.pts[pj - 1], b = d.pts[pj];
    const h = haversine(a, b), de = b.ele - a.ele;
    const grade = h > 0.5 && isFinite(de) ? (de / h) * 100 : 0;
    const ge = $('#rd-grade');
    ge.textContent = (grade >= 0 ? '+' : '') + grade.toFixed(1) + '%';
    ge.style.color = grade >= 0 ? BLAZE : TEAL;
    $('#rd-pos').textContent = p.lat.toFixed(4) + ', ' + p.lon.toFixed(4);
    if (profileMeta) {
      const dot = $('#prof-dot');
      if (dot) { dot.setAttribute('cx', profileMeta.X(pIdx)); dot.setAttribute('cy', profileMeta.Y(isFinite(p.ele) ? p.ele : profileMeta.minE)); }
    }
  }

  // ---------- cinematic tour ----------
  const BASE_SEC = 58, SLOW = 0.14, EASE_BACK_MS = 950;
  const tour = {
    on: false, paused: false, ended: false, speed: 2, dist: 0, drawnTo: 0,
    tp: [], tcum: [], shots: [], shotN: 0, raf: null, dayIdx: -1,
    miTotal: 0, ftTotal: 0, last: 0, trailArr: [], totalDist: 0, prof: null,
    photoActive: false, photoSwitchAt: 0, photoEndedAt: 0, queue: null, qIdx: 0,
    photoCount: 0, _scrub: false,
  };
  let audio = null, muted = false;
  function musicStart() {
    const url = typeof musicUrl === 'function' ? musicUrl() : musicUrl;
    const mb = $('#tc-mute');
    if (mb) mb.style.display = url ? '' : 'none';
    if (!url) return;
    if (!audio || audio._src !== url) {
      if (audio) audio.pause();
      audio = new Audio(url); audio.loop = true; audio._src = url;
    }
    audio.volume = 0; audio.muted = muted;
    audio.play().catch(() => {});
    let v = 0;
    const fade = setInterval(() => { v = Math.min(0.85, v + 0.06); audio.volume = v; if (v >= 0.85) clearInterval(fade); }, 90);
  }
  function musicStop() {
    if (!audio) return;
    const a = audio;
    const fade = setInterval(() => { a.volume = Math.max(0, a.volume - 0.08); if (a.volume <= 0) { a.pause(); clearInterval(fade); } }, 70);
  }

  function buildTour() {
    const vis = days.filter((d) => d.visible);
    if (!vis.length) return false;
    const full = [];
    vis.forEach((d, di) => d.pts.forEach((p) => full.push({ lat: p.lat, lon: p.lon, ele: p.ele, dayIdx: di, dayName: d.name })));
    // dedupe stationary points so stops take zero playback time
    const dd = [full[0]];
    for (let i = 1; i < full.length; i++) {
      const p = full[i], lastKept = dd[dd.length - 1];
      if (p.dayIdx !== lastKept.dayIdx || haversine(lastKept, p) > 3 || i === full.length - 1) dd.push(p);
    }
    let tp = dd;
    if (dd.length > 2600) {
      const stride = Math.ceil(dd.length / 2600);
      tp = [];
      for (let j = 0; j < dd.length; j += stride) tp.push(dd[j]);
      if (tp[tp.length - 1] !== dd[dd.length - 1]) tp.push(dd[dd.length - 1]);
    }
    const tcum = [0];
    let dist = 0;
    for (let k = 1; k < tp.length; k++) { dist += haversine(tp[k - 1], tp[k]); tcum.push(dist); }
    if (dist < 10) return false;
    // photos → shots, matched only within their assigned day's segment
    const ranges = {};
    for (let ri = 0; ri < tp.length; ri++) {
      const dxi = tp[ri].dayIdx;
      if (!(dxi in ranges)) ranges[dxi] = [ri, ri]; else ranges[dxi][1] = ri;
    }
    const raw = [];
    photos.filter((p) => p.placed && p.gps).forEach((ph) => {
      const rd = resolveDay(ph);
      if (!rd || !rd.visible) return;
      const di = vis.indexOf(rd);
      const rg = ranges[di]; if (!rg) return;
      let best = -1, bd = Infinity;
      for (let m = rg[0]; m <= rg[1]; m++) {
        const q = haversine({ lat: ph.gps.lat, lon: ph.gps.lon }, tp[m]);
        if (q < bd) { bd = q; best = m; }
      }
      if (best >= 0) raw.push({ ph, dist: tcum[best] });
    });
    raw.sort((a, b) => a.dist - b.dist);
    const GROUP_R = Math.max(150, dist / 200);
    const shots = [];
    raw.forEach((s) => {
      const last = shots[shots.length - 1];
      if (last && s.dist - last.dist < GROUP_R) last.phs.push(s.ph);
      else shots.push({ dist: s.dist, phs: [s.ph] });
    });
    tour.tp = tp; tour.tcum = tcum; tour.shots = shots; tour.totalDist = dist; tour.photoCount = raw.length;
    tour.miTotal = vis.reduce((s, d) => s + d.stats.distM, 0) * M2MI;
    tour.ftTotal = vis.reduce((s, d) => s + d.stats.gainM, 0) * M2FT;
    return true;
  }
  function posAt(dist) {
    const c = tour.tcum;
    let lo = 0, hi = c.length - 1;
    if (dist <= 0) lo = hi = 0;
    else if (dist >= c[hi]) lo = hi;
    else while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= dist) lo = mid; else hi = mid; }
    const a = tour.tp[lo], b = tour.tp[Math.min(lo + 1, tour.tp.length - 1)];
    const seg = c[Math.min(lo + 1, c.length - 1)] - c[lo], f = seg > 0 ? (dist - c[lo]) / seg : 0;
    return {
      lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f,
      ele: isFinite(a.ele) && isFinite(b.ele) ? a.ele + (b.ele - a.ele) * f : a.ele,
      i: lo, dayIdx: a.dayIdx, dayName: a.dayName,
    };
  }
  function drawTourProfile() {
    const svg = $('#tour-profile');
    const W = svg.clientWidth || 900, H = svg.clientHeight || 74, P = { l: 4, r: 4, t: 10, b: 4 };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const eles = tour.tp.map((p) => (isFinite(p.ele) ? p.ele : 0));
    let minE = Math.min(...eles), maxE = Math.max(...eles);
    if (maxE - minE < 1) maxE = minE + 1;
    const X = (i) => P.l + (tour.tcum[i] / tour.totalDist) * (W - P.l - P.r);
    const Y = (e) => P.t + (1 - (e - minE) / (maxE - minE)) * (H - P.t - P.b);
    const vis = days.filter((d) => d.visible);
    let html = '', cur = -1, seg = '';
    const flush = (di) => { if (seg) html += `<path d="${seg}" fill="none" stroke="${vis[di] ? vis[di].color : '#888'}" stroke-width="1.8" opacity=".9"/>`; seg = ''; };
    for (let i = 0; i < tour.tp.length; i++) {
      const p = tour.tp[i], x = X(i), y = Y(eles[i]);
      if (p.dayIdx !== cur) { flush(cur); cur = p.dayIdx; seg = `M ${x.toFixed(1)} ${y.toFixed(1)} `; }
      else seg += `L ${x.toFixed(1)} ${y.toFixed(1)} `;
    }
    flush(cur);
    html += `<circle id="tprof-dot" r="4.5" fill="${BLAZE}" stroke="#fff" stroke-width="2"/>`;
    svg.innerHTML = html;
    tour.prof = { X, Y, minE };
  }
  function fitTour() {
    map.fitBounds(L.latLngBounds(tour.tp.map((p) => [p.lat, p.lon])), { animate: false, padding: [46, 46] });
  }
  function lockMap(off) {
    ['dragging', 'scrollWheelZoom', 'doubleClickZoom', 'touchZoom', 'keyboard', 'boxZoom'].forEach((h) => {
      if (map[h]) { off ? map[h].disable() : map[h].enable(); }
    });
  }
  function startTour() {
    stopPlay(); map.stop(); map.closePopup(); map.removeLayer(posDot);
    if (!buildTour()) { alert('Add at least one day (a GPX file) to play the trip.'); return; }
    Object.assign(tour, { on: true, paused: false, ended: false, dist: 0, shotN: 0, dayIdx: -1, drawnTo: 0, trailArr: [] });
    clearCard();
    $('#dock').classList.remove('show');
    document.body.classList.add('touring');
    if (map.hasLayer(photoLayer)) map.removeLayer(photoLayer);
    lockMap(true);
    tour.glow = L.polyline([], { color: AMBER, weight: 13, opacity: 0.16, lineJoin: 'round', lineCap: 'round' }).addTo(map);
    tour.trail = L.polyline([], { color: AMBER, weight: 5, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }).addTo(map);
    tour.dot = L.marker([tour.tp[0].lat, tour.tp[0].lon], { icon: L.divIcon({ className: '', html: '<div class="pos-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 2000 }).addTo(map);
    const el = $('#tour');
    el.classList.add('on');
    $('#tour-end').classList.remove('show');
    $('#tc-play').textContent = 'Pause';
    $('#tc-speed').textContent = tour.speed + '×';
    fitTour();
    requestAnimationFrame(() => { el.classList.add('rolling'); drawTourProfile(); });
    musicStart();
    tour.last = 0; tour.raf = requestAnimationFrame(tourStep);
  }
  function restartTour() {
    Object.assign(tour, { dist: 0, shotN: 0, paused: false, dayIdx: -1, ended: false, drawnTo: 0, trailArr: [] });
    clearCard();
    if (tour.trail) tour.trail.setLatLngs([]);
    if (tour.glow) tour.glow.setLatLngs([]);
    $('#tour-end').classList.remove('show');
    $('#tc-play').textContent = 'Pause';
    map.stop(); fitTour();
    musicStart();
    tour.last = 0; tour.raf = requestAnimationFrame(tourStep);
  }
  function tourStep(now) {
    if (!tour.on) return;
    if (!tour.last) { tour.last = now; tour.raf = requestAnimationFrame(tourStep); return; }
    if (tour.paused) {
      const gap = now - tour.last; tour.last = now;
      if (tour.photoSwitchAt) tour.photoSwitchAt += gap;
      if (tour.photoEndedAt) tour.photoEndedAt += gap;
      tour.raf = requestAnimationFrame(tourStep); return;
    }
    const dt = Math.min((now - tour.last) / 1000, 0.05); tour.last = now;
    if (tour._scrub) { tour.raf = requestAnimationFrame(tourStep); return; }

    if (tour.photoActive && now >= tour.photoSwitchAt) {
      tour.qIdx++;
      if (tour.qIdx < tour.queue.length) {
        const nph = tour.queue[tour.qIdx];
        setCardPhoto(nph, $('#photo-card'));
        tour.photoSwitchAt = now + holdFor(nph, false);
      } else {
        $('#photo-card').classList.remove('show');
        tour.photoActive = false; tour.photoEndedAt = now; tour.shotN++;
      }
    }
    if (!tour.photoActive && tour.shotN < tour.shots.length && tour.dist >= tour.shots[tour.shotN].dist) {
      const shot = tour.shots[tour.shotN];
      tour.photoActive = true; tour.queue = shot.phs; tour.qIdx = 0; tour.photoEndedAt = 0;
      const card = $('#photo-card');
      setCardPhoto(shot.phs[0], card);
      card.classList.add('show');
      tour.photoSwitchAt = now + holdFor(shot.phs[0], true);
    }

    const R = Math.max(60, tour.totalDist / 60);
    const envF = (d) => {
      if (!isFinite(d)) return 1;
      const x = Math.max(0, Math.min(1, d / R)), s = x * x * (3 - 2 * x);
      return SLOW + (1 - SLOW) * s;
    };
    let fac;
    if (tour.photoActive) fac = SLOW;
    else {
      const dNext = tour.shotN < tour.shots.length ? tour.shots[tour.shotN].dist - tour.dist : Infinity;
      let fB = 1;
      if (tour.photoEndedAt) {
        const t = (now - tour.photoEndedAt) / EASE_BACK_MS;
        if (t < 1) { const s2 = t * t * (3 - 2 * t); fB = SLOW + (1 - SLOW) * s2; }
        else tour.photoEndedAt = 0;
      }
      fac = Math.min(envF(dNext), fB);
    }
    tour.dist += dt * (tour.totalDist / (BASE_SEC / tour.speed)) * fac;
    if (tour.dist >= tour.totalDist) tour.dist = tour.totalDist;
    renderTourFrame();
    if (tour.dist >= tour.totalDist && !tour.photoActive && tour.shotN >= tour.shots.length) { endTour(); return; }
    tour.raf = requestAnimationFrame(tourStep);
  }
  function holdFor(ph, first) {
    const hasCap = !!(ph.caption && ph.caption.trim());
    return first ? (hasCap ? 2900 : 2200) : (hasCap ? 2400 : 1700);
  }
  function setCardPhoto(ph, card) {
    const frame = card.querySelector('.frame');
    const showing = card.classList.contains('show');
    let olds = Array.from(frame.querySelectorAll('img'));
    if (!showing) { olds.forEach((o) => o.remove()); olds = []; }
    const img = document.createElement('img');
    img.alt = ''; img.src = ph.url;
    img.style.opacity = showing ? '0' : '1';
    frame.insertBefore(img, frame.querySelector('.pc-cap'));
    if (showing) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        img.style.opacity = '1';
        olds.forEach((o) => { o.style.opacity = '0'; setTimeout(() => o.remove(), 560); });
      }));
    }
    const hasCap = !!(ph.caption && ph.caption.trim());
    card.querySelector('.pc-text').textContent = hasCap ? ph.caption : '';
    card.querySelector('.pc-cap').style.display = hasCap ? 'block' : 'none';
  }
  function clearCard() {
    const card = $('#photo-card');
    card.classList.remove('show');
    card.querySelectorAll('.frame img').forEach((i) => i.remove());
    Object.assign(tour, { photoActive: false, photoSwitchAt: 0, photoEndedAt: 0, queue: null, qIdx: 0 });
  }
  function seekTo(dist) {
    if (!tour.on) return;
    dist = Math.max(0, Math.min(tour.totalDist, dist));
    const wasEnded = tour.ended;
    clearCard();
    tour.dist = dist;
    const p = posAt(dist);
    tour.drawnTo = p.i;
    tour.trailArr = [];
    for (let i = 0; i <= p.i; i++) tour.trailArr.push([tour.tp[i].lat, tour.tp[i].lon]);
    tour.shotN = 0;
    while (tour.shotN < tour.shots.length && tour.shots[tour.shotN].dist <= dist) tour.shotN++;
    tour.dayIdx = p.dayIdx;
    tour.ended = false;
    $('#tour-end').classList.remove('show');
    renderTourFrame();
    if (wasEnded) {
      $('#tc-play').textContent = 'Pause';
      musicStart();
      tour.last = 0; tour.raf = requestAnimationFrame(tourStep);
    }
  }
  function renderTourFrame() {
    const p = posAt(tour.dist);
    tour.dot.setLatLng([p.lat, p.lon]);
    while (tour.drawnTo < p.i) { tour.drawnTo++; const q = tour.tp[tour.drawnTo]; tour.trailArr.push([q.lat, q.lon]); }
    tour.trail.setLatLngs(tour.trailArr.concat([[p.lat, p.lon]]));
    tour.glow.setLatLngs(tour.trailArr.concat([[p.lat, p.lon]]));
    $('#ts-day').textContent = p.dayName;
    $('#ts-dist').textContent = (tour.dist * M2MI).toFixed(1) + ' mi';
    $('#ts-ele').textContent = isFinite(p.ele) ? Math.round(p.ele * M2FT).toLocaleString() + ' ft' : '— ft';
    $('#ts-pct').textContent = Math.round((tour.dist / tour.totalDist) * 100) + '%';
    if (tour.prof) {
      const dot = $('#tprof-dot');
      if (dot) { dot.setAttribute('cx', tour.prof.X(p.i)); dot.setAttribute('cy', tour.prof.Y(isFinite(p.ele) ? p.ele : tour.prof.minE)); }
    }
    if (p.dayIdx !== tour.dayIdx) { tour.dayIdx = p.dayIdx; showDayCard(p); }
  }
  function showDayCard(p) {
    const dc = $('#daycard');
    dc.querySelector('.dc-k').textContent = 'Day ' + (p.dayIdx + 1);
    dc.querySelector('.dc-n').textContent = p.dayName;
    dc.classList.add('show');
    clearTimeout(tour._dcT);
    tour._dcT = setTimeout(() => dc.classList.remove('show'), 2200);
  }
  function endTour() {
    cancelAnimationFrame(tour.raf);
    tour.ended = true;
    clearCard();
    musicStop();
    $('#te-title').textContent = title || 'The trip';
    $('#te-mi').textContent = Math.round(tour.miTotal).toLocaleString();
    $('#te-ft').textContent = Math.round(tour.ftTotal).toLocaleString();
    $('#te-ph').textContent = tour.photoCount || 0;
    $('#tour-end').classList.add('show');
    $('#tc-play').textContent = 'Replay';
  }
  function exitTour() {
    tour.on = false;
    cancelAnimationFrame(tour.raf);
    clearTimeout(tour._dcT);
    clearCard();
    musicStop();
    const el = $('#tour');
    el.classList.remove('rolling');
    $('#daycard').classList.remove('show');
    $('#tour-end').classList.remove('show');
    document.body.classList.remove('touring');
    setTimeout(() => el.classList.remove('on'), 320);
    if (tour.trail) map.removeLayer(tour.trail);
    if (tour.glow) map.removeLayer(tour.glow);
    if (tour.dot) map.removeLayer(tour.dot);
    if (!map.hasLayer(photoLayer)) photoLayer.addTo(map);
    lockMap(false);
    fitAll();
  }
  $('#play-trip').onclick = startTour;
  $('#tc-exit').onclick = exitTour;
  $('#te-done').onclick = exitTour;
  $('#te-replay').onclick = restartTour;
  $('#tc-play').onclick = function () {
    if (tour.ended) { restartTour(); return; }
    tour.paused = !tour.paused;
    if (audio) { tour.paused ? audio.pause() : audio.play().catch(() => {}); }
    this.textContent = tour.paused ? 'Play' : 'Pause';
  };
  $('#tc-speed').onclick = function () {
    const o = [1, 2, 4];
    tour.speed = o[(o.indexOf(tour.speed) + 1) % o.length];
    this.textContent = tour.speed + '×';
  };
  const muteBtn = $('#tc-mute');
  if (muteBtn) muteBtn.onclick = function () {
    muted = !muted;
    if (audio) audio.muted = muted;
    this.textContent = muted ? '♪̶' : '♪';
    this.classList.toggle('off', muted);
  };
  $('#tc-prev').onclick = () => {
    const s = tour.shots;
    if (!s.length) { seekTo(0); return; }
    let target;
    if (tour.photoActive) target = tour.shotN - 1;
    else {
      const lastIdx = tour.shotN - 1;
      if (lastIdx < 0) { seekTo(0); return; }
      const justAfter = tour.dist - s[lastIdx].dist < Math.max(60, tour.totalDist / 60) * 1.5;
      target = justAfter ? lastIdx - 1 : lastIdx;
    }
    if (target >= 0) seekTo(s[target].dist - 2);
    else seekTo(0);
  };
  $('#tc-next').onclick = () => {
    let nx = null;
    for (const s of tour.shots) if (s.dist > tour.dist + 1) { nx = s; break; }
    seekTo(nx ? nx.dist - 2 : tour.totalDist);
  };
  (() => {
    const bar = $('#tour-profile');
    const distFromEvent = (e) => {
      const r = bar.getBoundingClientRect();
      const f = (e.clientX - r.left - 4) / (r.width - 8);
      return Math.max(0, Math.min(1, f)) * tour.totalDist;
    };
    bar.addEventListener('pointerdown', (e) => {
      if (!tour.on) return;
      tour._scrub = true;
      bar.setPointerCapture(e.pointerId);
      seekTo(distFromEvent(e));
    });
    bar.addEventListener('pointermove', (e) => { if (tour._scrub) seekTo(distFromEvent(e)); });
    bar.addEventListener('pointerup', () => { tour._scrub = false; });
    bar.addEventListener('pointercancel', () => { tour._scrub = false; });
  })();

  // ---------- inputs ----------
  if (editable) {
    $('#gpx-input').onchange = (e) => {
      Array.from(e.target.files).forEach((f) => addDayFromGPX(f));
      e.target.value = '';
    };
    $('#photo-input').onchange = (e) => {
      Array.from(e.target.files).forEach((f) => importPhotoFile(f));
      e.target.value = '';
    };
    $('#place-time-btn').onclick = () => {
      const off = parseInt($('#tz-offset').value, 10);
      const r = placeByTimeAll(off);
      const res = $('#tp-result');
      res.style.display = 'block';
      res.textContent = r.placed === 0
        ? 'No matches — check the timezone, or these photos may have no timestamp or fall outside your days.'
        : `${r.placed} placed by time.` + (r.remaining ? ` ${r.remaining} still in the tray — place those by hand.` : ' All photos placed.');
    };
  }
  const resizeHandler = () => { if (focusedDay()) drawProfile(); if (tour.on) drawTourProfile(); };
  window.addEventListener('resize', resizeHandler);

  // ---------- load & destroy ----------
  function load(data) {
    title = data.title || '';
    titleInput.value = title;
    days = (data.days || []).map(makeDay);
    dayCounter = days.length;
    (data.photos || []).forEach((rec) => {
      const ph = {
        id: rec.id, url: rec.url, gps: rec.lat != null ? { lat: rec.lat, lon: rec.lng } : null,
        timeWall: rec.taken_wall || null, tzOffsetMin: rec.tz_offset_min,
        caption: rec.caption || '', dayId: rec.day_id || null, marker: null, placed: false,
      };
      photos.push(ph);
      if (ph.gps) placePhotoLocal(ph, ph.gps.lat, ph.gps.lon);
    });
    renderDays(); renderTray(); updateOverview(); updateTimePlaceUI(); fitAll();
  }
  function destroy() {
    exitTourSafe();
    document.removeEventListener('keydown', escHandler);
    window.removeEventListener('resize', resizeHandler);
    map.remove();
  }
  function exitTourSafe() { try { if (tour.on) exitTour(); } catch {} if (audio) { audio.pause(); audio = null; } }

  return { load, destroy, map };
}

/* Persistence callbacks (all optional):
   on.title(title)
   on.dayAdded({id,name,color,pts,distM,gainM,position})
   on.dayRenamed(id, name)
   on.daysReordered([{id, position}])
   on.dayDeleted(id)
   on.photoAdded(photo, blob)      — upload blob, insert row
   on.photoPlaced(photo)           — lat/lng changed
   on.photoCaption(photo)
   on.photoDayAssigned(photo)
   on.photoDeleted(id)
*/
