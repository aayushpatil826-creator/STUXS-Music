export interface BrandAccent {
  id: string;
  name: string;
  color: string;
  glow: string;
}

export const BRAND_ACCENTS: BrandAccent[] = [
  {
    id: 'default',
    name: 'Default',
    color: '#8B5CF6',
    glow: 'rgba(139, 92, 246, 0.35)',
  },
  {
    id: 'purple',
    name: 'Purple',
    color: '#A855F7',
    glow: 'rgba(168, 85, 247, 0.35)',
  },
  {
    id: 'blue',
    name: 'Blue',
    color: '#3B82F6',
    glow: 'rgba(59, 130, 246, 0.35)',
  },
  {
    id: 'green',
    name: 'Green',
    color: '#10B981',
    glow: 'rgba(16, 185, 129, 0.35)',
  },
  {
    id: 'pink',
    name: 'Pink',
    color: '#EC4899',
    glow: 'rgba(236, 72, 153, 0.35)',
  },
  {
    id: 'orange',
    name: 'Orange',
    color: '#F97316',
    glow: 'rgba(249, 115, 22, 0.35)',
  },
  {
    id: 'red',
    name: 'Red',
    color: '#EF4444',
    glow: 'rgba(239, 68, 68, 0.35)',
  },
];

export const BRANDING_CONFIG = {
  appName: 'STUXS Music',
  brandName: 'STUXS',
  tagline: 'Your music. Your way.',
  appLogo: '/stuxs-music-logo.jpg',
  version: '2.0',
  audioEngineName: 'STUXS Hi-Res Audio Core',
  defaultAccent: BRAND_ACCENTS[0],
  supportEmail: 'support@stuxsmusic.app',
  defaultArtwork: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&auto=format&fit=crop&q=80',
};

export const BUILD_INFO = {
  version: '2.0',
  buildId: '2026.09.01.003',
  builtAt: '2026-09-01T22:35:00Z',
  marker: 'STUXS UNIVERSAL ANDROID MEDIA NOTIFICATION & LIVE STATUS UPDATE 003',
};
