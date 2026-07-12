import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, photoUrl, newSlug } from '../lib/supabase.js';
import { createTripMap } from '../lib/engine.js';
import { ptsToRows, rowsToPts } from '../lib/geo.js';
import { TRACKS, trackById } from '../lib/music.js';

export default function TripEditor({ session }) {
  const { id } = useParams();
  const nav = useNavigate();
  const panelRef = useRef(null), mainRef = useRef(null), engineRef = useRef(null);
  const [trip, setTrip] = useState(null);
  const [sharePanel, setSharePanel] = useState(false);
  const [copied, setCopied] = useState(false);
  const musicRef = useRef('');

  useEffect(() => {
    if (session === undefined) return;
    if (session === null) { nav('/'); return; }
    let dead = false;

    (async () => {
      const [{ data: t }, { data: dayRows }, { data: photoRows }] = await Promise.all([
        supabase.from('trips').select('*').eq('id', id).single(),
        supabase.from('days').select('*').eq('trip_id', id).order('position'),
        supabase.from('photos').select('*').eq('trip_id', id).order('created_at'),
      ]);
      if (dead || !t) return;
      setTrip(t);
      musicRef.current = t.music || '';

      const engine = createTripMap({
        panelEl: panelRef.current,
        mainEl: mainRef.current,
        editable: true,
        musicUrl: () => trackById(musicRef.current)?.file || null,
        on: {
          title: (title) => supabase.from('trips').update({ title }).eq('id', id).then(() => {}),
          dayAdded: (d) =>
            supabase.from('days').insert({
              id: d.id, trip_id: id, name: d.name, color: d.color,
              position: d.position, pts: ptsToRows(d.pts),
              dist_m: d.distM, gain_m: d.gainM,
              has_time: d.pts.some((p) => isFinite(p.t)),
            }).then(() => {}),
          dayRenamed: (dayId, name) =>
            supabase.from('days').update({ name }).eq('id', dayId).then(() => {}),
          daysReordered: (order) =>
            Promise.all(order.map((o) =>
              supabase.from('days').update({ position: o.position }).eq('id', o.id)
            )).then(() => {}),
          dayDeleted: async (dayId) => {
            await supabase.from('days').delete().eq('id', dayId);
          },
          photoAdded: async (ph, blob) => {
            const path = `${id}/${ph.id}.jpg`;
            await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
            await supabase.from('photos').insert({
              id: ph.id, trip_id: id, path,
              lat: ph.gps ? ph.gps.lat : null, lng: ph.gps ? ph.gps.lon : null,
              taken_wall: ph.timeWall, tz_offset_min: ph.tzOffsetMin,
            });
          },
          photoPlaced: (ph) =>
            supabase.from('photos').update({ lat: ph.gps.lat, lng: ph.gps.lon }).eq('id', ph.id).then(() => {}),
          photoCaption: (ph) =>
            supabase.from('photos').update({ caption: ph.caption }).eq('id', ph.id).then(() => {}),
          photoDayAssigned: (ph) =>
            supabase.from('photos').update({ day_id: ph.dayId }).eq('id', ph.id).then(() => {}),
          photoDeleted: async (photoId) => {
            await supabase.storage.from('photos').remove([`${id}/${photoId}.jpg`]);
            await supabase.from('photos').delete().eq('id', photoId);
          },
        },
      });
      engineRef.current = engine;
      engine.load({
        title: t.title,
        days: (dayRows || []).map((r) => ({
          id: r.id, name: r.name, color: r.color,
          pts: rowsToPts(r.pts), distM: r.dist_m, gainM: r.gain_m,
        })),
        photos: (photoRows || []).map((r) => ({ ...r, url: photoUrl(r.path) })),
      });
    })();

    return () => { dead = true; engineRef.current?.destroy(); engineRef.current = null; };
  }, [id, session]);

  const shareUrl = trip?.share_slug ? `${window.location.origin}/t/${trip.share_slug}` : '';

  const toggleShared = async (checked) => {
    const patch = { is_shared: checked };
    if (checked && !trip.share_slug) patch.share_slug = newSlug();
    const { data } = await supabase.from('trips').update(patch).eq('id', id).select().single();
    setTrip(data);
  };
  const regenLink = async () => {
    const { data } = await supabase.from('trips').update({ share_slug: newSlug() }).eq('id', id).select().single();
    setTrip(data); setCopied(false);
  };
  const setTrim = async (checked) => {
    const { data } = await supabase.from('trips').update({ trim_ends: checked }).eq('id', id).select().single();
    setTrip(data);
  };
  const setMusic = async (music) => {
    musicRef.current = music;
    const { data } = await supabase.from('trips').update({ music }).eq('id', id).select().single();
    setTrip(data);
  };
  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); });
  };

  return (
    <div id="tm-wrap">
      <div ref={panelRef} id="panel" />
      <div ref={mainRef} id="main" />
      <div style={{ position: 'absolute', top: 10, right: 16, zIndex: 850, display: 'flex', gap: 8 }}>
        <button className="btn sm" onClick={() => nav('/')}>‹ Trips</button>
        <button className="btn sm amber" onClick={() => setSharePanel(!sharePanel)}>Share</button>
      </div>
      {sharePanel && trip && (
        <div className="share-pop" style={{ top: 48 }}>
          <h3>Share this trip</h3>
          <div className="share-row">
            <div>
              <div>Anyone with the link can view</div>
              <div className="hint">View-only: they can explore the map, open photos, and play the trip — never edit.</div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={trip.is_shared} onChange={(e) => toggleShared(e.target.checked)} />
              <span className="knob" />
            </label>
          </div>
          {trip.is_shared && (
            <>
              <div className="share-link">
                <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
                <button className="btn sm" onClick={copyLink}>{copied ? '✓' : 'Copy'}</button>
              </div>
              <div className="hint" style={{ margin: '6px 0 12px' }}>
                <button className="btn sm ghost danger" onClick={regenLink}>Revoke &amp; make a new link</button>
              </div>
            </>
          )}
          <div className="share-row">
            <div>
              <div>Trim route ends for viewers</div>
              <div className="hint">Hides the first and last ~quarter mile of each day — keeps your start point (like home) private.</div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={trip.trim_ends} onChange={(e) => setTrim(e.target.checked)} />
              <span className="knob" />
            </label>
          </div>
          <div className="share-row" style={{ display: 'block' }}>
            <div style={{ marginBottom: 6 }}>Tour music</div>
            <select value={trip.music} onChange={(e) => setMusic(e.target.value)}>
              <option value="">No music</option>
              {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <div className="hint" style={{ marginTop: 5 }}>Plays during the tour for you and anyone you share with.</div>
          </div>
        </div>
      )}
    </div>
  );
}
