// Bundled royalty-free tracks. Download MP3s from pixabay.com/music (free for app
// use, no attribution) and drop them into public/music/ with these exact filenames.
// Add or rename entries freely — the picker reads this list.
export const TRACKS = [
  { id: 'open-road',    name: 'Open Road',    file: '/music/open-road.mp3' },
  { id: 'golden-hour',  name: 'Golden Hour',  file: '/music/golden-hour.mp3' },
  { id: 'switchbacks',  name: 'Switchbacks',  file: '/music/switchbacks.mp3' },
  { id: 'city-lights',  name: 'City Lights',  file: '/music/city-lights.mp3' },
];
export const trackById = (id) => TRACKS.find((t) => t.id === id) || null;
