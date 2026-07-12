import { useEffect, useState } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { supabase } from './lib/supabase.js';
import Home from './pages/Home.jsx';
import TripEditor from './pages/TripEditor.jsx';
import TripViewer from './pages/TripViewer.jsx';

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div id="app-shell">
      <div id="topbar">
        <Link to="/" className="logo">Trip Map</Link>
        <div className="spacer" />
        {session && (
          <>
            <span className="who">{session.user.email}</span>
            <button className="btn sm ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </>
        )}
      </div>
      <Routes>
        <Route path="/" element={<Home session={session} />} />
        <Route path="/trip/:id" element={<TripEditor session={session} />} />
        <Route path="/t/:slug" element={<TripViewer />} />
      </Routes>
    </div>
  );
}
