import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase, photoUrl } from '../lib/supabase.js';
import { createTripMap } from '../lib/engine.js';
import { rowsToPts } from '../lib/geo.js';
import { trackById } from '../lib/music.js';

export default function TripViewer() {
  const { slug } = useParams();
  const panelRef = useRef(null), mainRef = useRef(null), engineRef = useRef(null);
  const [state, setState] = useState('loading'); // loading | ok | missing

  useEffect(() => {
    let dead = false;
    (async () => {
      const { data: t } = await supabase
        .from('trips').select('*').eq('share_slug', slug).eq('is_shared', true).maybeSingle();
      if (dead) return;
      if (!t) { setState('missing'); return; }
      setState('ok');
      const [{ data: dayRows }, { data: photoRows }] = await Promise.all([
        supabase.from('days').select('*').eq('trip_id', t.id).order('position'),
        supabase.from('photos').select('*').eq('trip_id', t.id).order('created_at'),
      ]);
      if (dead) return;
      const engine = createTripMap({
        panelEl: panelRef.current,
        mainEl: mainRef.current,
        editable: false,
        trimMeters: t.trim_ends ? 400 : 0,
        musicUrl: trackById(t.music)?.file || null,
      });
      engineRef.current = engine;
      engine.load({
        title: t.title,
        days: (dayRows || []).map((r) => ({
          id: r.id, name: r.name, color: r.color,
          pts: rowsToPts(r.pts), distM: null, gainM: null, // recompute from trimmed view
        })),
        photos: (photoRows || [])
          .filter((r) => r.lat != null) // tray photos stay private to the owner
          .map((r) => ({ ...r, url: photoUrl(r.path) })),
      });
    })();
    return () => { dead = true; engineRef.current?.destroy(); engineRef.current = null; };
  }, [slug]);

  if (state === 'missing')
    return (
      <div className="auth">
        <div className="eyebrow">Trip Map</div>
        <h1>Trip not found</h1>
        <p>This link may have been revoked, or the trip is no longer shared.</p>
      </div>
    );

  return (
    <div id="tm-wrap" style={{ display: state === 'ok' ? 'flex' : 'none' }}>
      <div ref={panelRef} id="panel" />
      <div ref={mainRef} id="main" />
    </div>
  );
}
