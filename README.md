# Trip Map

Map your trips, pin your photos, play them back as a cinematic tour, and share a view-only link with anyone. React + Vite + Supabase + Vercel — no terminal required to deploy.

---

## One-time setup (~45 minutes total)

### 1. Supabase project (~10 min)

1. Go to [supabase.com](https://supabase.com) → **New project** (any name, e.g. `tripmap`; pick a strong DB password and save it somewhere — you won't need it day-to-day).
2. When the project finishes provisioning, open **SQL Editor** (left sidebar) → **New query**.
3. Paste the entire contents of `supabase/schema.sql` from this repo → **Run**. You should see "Success". This creates the tables, security policies, and the photo storage bucket in one shot.
4. Go to **Project Settings → API** and copy two values for later:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

### 2. Google sign-in (~20 min, one time)

Magic-link email sign-in works with **zero setup** — you can skip this section entirely and add Google later. For Google:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project (e.g. `tripmap`).
2. **APIs & Services → OAuth consent screen** → External → fill in app name + your email → Save (you can leave everything else default; publish the app when prompted).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → Application type: **Web application**.
4. Under **Authorized redirect URIs**, add the callback URL shown in Supabase: go to your Supabase project → **Authentication → Providers → Google** — it displays the exact URL to paste (looks like `https://<project>.supabase.co/auth/v1/callback`).
5. Create → copy the **Client ID** and **Client Secret**.
6. Back in Supabase **Authentication → Providers → Google**: toggle it on, paste Client ID + Secret, Save.

### 3. Supabase redirect URLs (~2 min)

In Supabase **Authentication → URL Configuration**:
- **Site URL**: your production URL once you have it (e.g. `https://tripmap.vercel.app`)
- **Redirect URLs**: add the same production URL.

(Until you deploy, `http://localhost` defaults are fine to leave.)

### 4. Music (~10 min, optional but worth it)

1. Go to [pixabay.com/music](https://pixabay.com/music) — everything there is free to use in apps, no attribution required.
2. Pick 4 instrumental tracks you like (try searching "acoustic folk instrumental", "cinematic ambient", "upbeat indie").
3. Download the MP3s and rename them to **exactly**:
   - `open-road.mp3`
   - `golden-hour.mp3`
   - `switchbacks.mp3`
   - `city-lights.mp3`
4. Put them in this repo's `public/music/` folder.

Want different names or more tracks? Edit the list in `src/lib/music.js` — the picker reads it.

### 5. GitHub + Vercel deploy (~10 min)

1. Create a new GitHub repo and upload this entire folder (on github.com: **Add file → Upload files**, drag the whole folder contents in — or use github.dev if you prefer).
2. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import the repo. Vercel auto-detects Vite; don't change build settings.
3. Before deploying, open **Environment Variables** and add **four**:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Project URL from step 1 |
   | `VITE_SUPABASE_ANON_KEY` | your anon key from step 1 |
   | `SUPABASE_URL` | same Project URL again |
   | `SUPABASE_ANON_KEY` | same anon key again |

   (The `VITE_` pair is baked into the app; the bare pair is used by the keep-alive function.)
4. **Deploy.** When it finishes, copy your production URL and paste it into Supabase's URL Configuration (step 3 above).

The anon key is **safe to expose** — it's designed to be public; row-level security in the database is what protects your data.

### 6. Keep-alive (~3 min)

Supabase free-tier projects pause after 7 days of no traffic. Prevent it:

1. Go to [uptimerobot.com](https://uptimerobot.com) (free) → **Add New Monitor**.
2. Type: HTTP(s) · URL: `https://YOUR-APP.vercel.app/api/keepalive` · Interval: every 24 hours (or the minimum allowed).

Done. Your project never sleeps.

---

## Day-to-day

- **New trip** → upload one GPX per day → add photos (GPS photos pin themselves; others go to the tray for drag, tap-to-place, or place-by-time).
- Everything **saves automatically** — there is no save button.
- **Share** → toggle on → copy the link. Viewers see a view-only version: no sign-in, no editing, photos and tour and music all work. Revoke any time (old link dies instantly, new one issued).
- **Trim route ends** hides the first/last ~quarter mile of each day from viewers — start-from-home privacy.
- Photos are compressed on upload (~300–600 KB each) and **all camera metadata is stripped**, so shared photos carry no hidden GPS or device info.

## Costs & limits (free tier)

- Supabase free: 1 GB storage ≈ 2,000–4,000 compressed photos; 5 GB/month egress ≈ thousands of trip views.
- Vercel free: far more than this app will use.
- If you ever outgrow it: Supabase Pro is $25/mo. You'll know long before it matters.

## Known v1 limitations

- Link previews (the card when you text someone the link) show a generic Trip Map card, not a per-trip map image — per-trip previews need server-side rendering; parked for v2.
- Day reordering and photo dragging work on touch devices; full phone-first layout polish is a v2 item.
