# STUXS Music — Premium Personal Music App (Android & Web)

> **"Your music. Your way."**

STUXS Music is a premium, high-performance personal music application engineered with **React, TypeScript, Vite, Supabase PostgreSQL, and Capacitor for Android**. Inspired by the refinement, simplicity, spacing, and typography of Apple-style consumer applications while featuring an original **STUXS dark aesthetic** (`#0B0B0F` obsidian palette, 8px grid, customizable dynamic accents).

---

## 🏗 Architecture Overview

```text
STUXS Music
│
├── UI Layer (React + Tailwind CSS)
│     ├── Screens (Home, Search, Library, Artist, Album, Playlist, Settings)
│     ├── Player (MiniPlayer, NowPlayingModal, QueueDrawer, DevicePickerModal)
│     └── Design System (STUXS Tokens, Theme Accents, Custom Scrollbars)
│
├── Music Service Layer (Provider Architecture)
│     ├── MusicProvider & PlaybackProvider Contracts
│     ├── STUXS Core Provider (Instant catalog & streaming)
│     ├── JioSaavn & Gaana Providers (Official studio master streams)
│     ├── iTunes Store Provider (Catalog metadata & audio previews)
│     └── Isolated Adapters (Spotify, Amazon Music)
│
├── State & Context Management
│     ├── PlayerContext (Playback, Queue, Shuffle, Repeat, Audio Engine)
│     ├── LibraryContext (Playlists, Liked Songs, Recently Played)
│     ├── SettingsContext (Audio Quality, Crossfade, Accents)
│     └── AuthContext (Supabase Auth & Session Sync)
│
├── Backend (Supabase PostgreSQL)
│     ├── Profiles, Artists, Albums, Songs, Playlists, Playlist_Songs, Favorites, Recently_Played
│     ├── Row Level Security (RLS) policies
│     └── Edge Functions (provider-auth, catalog-sync)
│
└── Android Mobile Native
      └── Capacitor (Safe-area insets, dark status bar, hardware audio support)
```

---

## 📱 Feature Highlights

1. **Immersive Now Playing Screen**:
   - Dynamic real-time artwork ambient glow
   - Precision touch/mouse scrubber with elapsed and remaining time
   - Shuffle, repeat (one/all/off), previous, play/pause, next controls
   - Lossless 24-bit/96kHz bit-perfect badge
   - Synchronized lyrics viewer with card transitions
   - Audio output destination picker (Speakers, Bluetooth DAC, Cast)
2. **Persistent Mini-Player**:
   - Positioned above bottom navigation bar
   - Play/pause, next, like toggle, and progress track line
   - Tap to expand into full-screen Now Playing modal
3. **Comprehensive Catalog & Search**:
   - Debounced multi-category search across tracks, artists, albums, and playlists
   - Browse categories (Electronic, Ambient, Lo-Fi, Neo-Soul, Techno, Post-Rock)
   - Detailed Artist page with verified badge, monthly listeners, top songs, and discography
   - Detailed Album page with lossless quality tag, full tracklist, and add-to-library toggle
   - Playlist page with track reordering and custom playlist creation
4. **Settings & Customization**:
   - Audio quality selector (Lossless, High, Normal, Data Saver)
   - Adjustable crossfade duration slider (0s - 12s)
   - Gapless playback & volume normalization switches
   - STUXS Accent Color customizer (Iris, Cyan, Amber, Emerald, Rose)
   - Music provider connection management

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Development Server
```bash
npm run dev
```

### 3. Build Web Bundle
```bash
npm run build
```

### 4. Sync with Android Project
```bash
npx cap sync android
npx cap open android
```

---

## 🗄 Supabase Database & Security

Database migrations are located in `supabase/migrations/20260825000000_init_stuxs_schema.sql`.
Row Level Security (RLS) is enabled across all tables ensuring user data isolation.
Server-side Edge Functions for OAuth and token handling are in `supabase/functions/`.

---

## 🎵 Provider Integrations

- **STUXS Core**: Default lossless audio engine with sample stream previews.
- **iTunes Store**: Integrated search and 30-second audio stream previews.
- **Spotify / Amazon Music**: Isolated adapter interfaces prepared with configuration placeholders (`.env.example`) ready for developer credentials without scraping or DRM violations.
