import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export const photoUrl = (path) =>
  supabase.storage.from('photos').getPublicUrl(path).data.publicUrl;

export const newSlug = () => {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  const a = crypto.getRandomValues(new Uint8Array(12));
  for (const b of a) s += chars[b % chars.length];
  return s;
};
