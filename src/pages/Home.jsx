import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';

function Auth() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const google = () =>
    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  const magic = async () => {
    if (!email.includes('@')) return;
    await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    setSent(true);
  };
  return (
    <div className="auth">
      <div className="eyebrow">Trip Map</div>
      <h1>Relive the ride.</h1>
      <p>Map your routes, pin your photos, and play the whole trip back as a cinematic tour.</p>
      <button className="btn amber" onClick={google}>Continue with Google</button>
      <div className="or">— OR —</div>
      {sent ? (
        <p>Check your email — we sent you a sign-in link.</p>
      ) : (
        <>
          <input
            type="email" placeholder="you@example.com" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && magic()}
          />
          <button className="btn" onClick={magic}>Email me a sign-in link</button>
        </>
      )}
      <div className="note">No passwords. Viewing a shared trip never requires signing in.</div>
    </div>
  );
}

export default function Home({ session }) {
  const nav = useNavigate();
  const [trips, setTrips] = useState(null);

  useEffect(() => {
    if (!session) return;
    supabase
      .from('trips')
      .select('id,title,is_shared,created_at')
      .eq('owner', session.user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setTrips(data || []));
  }, [session]);

  if (session === undefined) return null;
  if (!session) return <Auth />;

  const createTrip = async () => {
    const { data, error } = await supabase
      .from('trips')
      .insert({ owner: session.user.id, title: '' })
      .select()
      .single();
    if (!error) nav(`/trip/${data.id}`);
  };

  const deleteTrip = async (e, trip) => {
    e.stopPropagation();
    if (!confirm(`Delete "${trip.title || 'Untitled trip'}" and all its photos? This can't be undone.`)) return;
    // best-effort storage cleanup so orphaned photos don't eat the free tier
    const { data: objs } = await supabase.storage.from('photos').list(trip.id, { limit: 1000 });
    if (objs?.length) await supabase.storage.from('photos').remove(objs.map((o) => `${trip.id}/${o.name}`));
    await supabase.from('trips').delete().eq('id', trip.id);
    setTrips(trips.filter((t) => t.id !== trip.id));
  };

  return (
    <div className="home">
      <h1>Your trips</h1>
      <div className="sub">Every route, photo, and caption saves automatically as you work.</div>
      <button className="btn amber" onClick={createTrip} style={{ marginBottom: 22 }}>+ New trip</button>
      {trips === null ? null : trips.length === 0 ? (
        <div className="empty-trips">No trips yet. Start one, drop in your GPX files, and add your photos.</div>
      ) : (
        trips.map((t) => (
          <div key={t.id} className="trip-card" onClick={() => nav(`/trip/${t.id}`)}>
            <span className="t">{t.title || 'Untitled trip'}</span>
            {t.is_shared && <span className="shared-pill">Shared</span>}
            <span className="meta">{new Date(t.created_at).toLocaleDateString()}</span>
            <button className="del" title="Delete trip" onClick={(e) => deleteTrip(e, t)}>×</button>
          </div>
        ))
      )}
    </div>
  );
}
