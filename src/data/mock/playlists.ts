import type { Playlist } from '../../types/music';
import { MOCK_TRACKS } from './tracks';

export const MOCK_PLAYLISTS: Playlist[] = [
  {
    id: 'playlist-1',
    name: 'STUXS Select: Obsidian Flow',
    description: 'Deep modular synthscapes, cinematic retrowave, and nocturnal sound design curated by STUXS Sound Labs.',
    artworkUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=800&auto=format&fit=crop&q=80',
    isPublic: true,
    songCount: 6,
    duration: 1320,
    songs: [MOCK_TRACKS[0], MOCK_TRACKS[1], MOCK_TRACKS[5], MOCK_TRACKS[6]],
    createdAt: '2026-08-01T00:00:00Z',
  },
  {
    id: 'playlist-2',
    name: 'Pure Focus: 40Hz Waves',
    description: 'Binaural ambient textures engineered for deep cognitive focus, programming flow, and creative clarity.',
    artworkUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&auto=format&fit=crop&q=80',
    isPublic: true,
    songCount: 4,
    duration: 980,
    songs: [MOCK_TRACKS[2], MOCK_TRACKS[3], MOCK_TRACKS[6]],
    createdAt: '2026-08-10T00:00:00Z',
  },
  {
    id: 'playlist-3',
    name: 'Late Night Tokyo Sessions',
    description: 'Rain drenched analog keys, tape flutter, and dusty lo-fi drum machines for midnight reflections.',
    artworkUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&auto=format&fit=crop&q=80',
    isPublic: true,
    songCount: 5,
    duration: 1100,
    songs: [MOCK_TRACKS[6], MOCK_TRACKS[4], MOCK_TRACKS[2]],
    createdAt: '2026-08-15T00:00:00Z',
  },
  {
    id: 'playlist-4',
    name: 'Kinetic Drive: Electronic Horizon',
    description: 'High energy melodic house, forward-leaning beats, and driving synth basslines for movement.',
    artworkUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&auto=format&fit=crop&q=80',
    isPublic: true,
    songCount: 6,
    duration: 1450,
    songs: [MOCK_TRACKS[0], MOCK_TRACKS[5], MOCK_TRACKS[1]],
    createdAt: '2026-08-18T00:00:00Z',
  },
];
