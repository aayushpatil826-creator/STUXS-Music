import type { Track } from '../types/music';
import { providerRegistry } from '../providers/ProviderRegistry';
import { MetadataResolverService } from './MetadataResolverService';
import { BRANDING_CONFIG } from '../config/branding';

export interface M3UEntry {
  raw: string;
  duration?: number;
  title: string;
  artist?: string;
  uri: string;
}

export interface M3UImportResult {
  playlistName: string;
  totalEntries: number;
  matchedTracks: Track[];
  unresolvedEntries: M3UEntry[];
  matchedCount: number;
  unresolvedCount: number;
}

export class M3UParserService {
  /**
   * Parses .m3u / .m3u8 file content into structured entries.
   */
  public static parse(content: string, defaultName: string = 'Imported Playlist'): { playlistName: string; entries: M3UEntry[] } {
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const entries: M3UEntry[] = [];
    let playlistName = defaultName;

    let currentDuration: number | undefined;
    let currentTitle: string | undefined;
    let currentArtist: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#PLAYLIST:')) {
        playlistName = line.replace('#PLAYLIST:', '').trim() || playlistName;
        continue;
      }

      if (line.startsWith('#EXTINF:')) {
        // Format: #EXTINF:123,Artist - Song Title  OR  #EXTINF:123,Song Title
        const match = line.match(/^#EXTINF:\s*(-?\d+)\s*,\s*(.*)$/);
        if (match) {
          currentDuration = parseInt(match[1], 10);
          if (currentDuration < 0) currentDuration = undefined;

          const info = match[2];
          if (info.includes(' - ')) {
            const parts = info.split(' - ');
            currentArtist = parts[0].trim();
            currentTitle = parts.slice(1).join(' - ').trim();
          } else {
            currentTitle = info.trim();
            currentArtist = undefined;
          }
        }
        continue;
      }

      if (line.startsWith('#')) {
        // Other directive comments
        continue;
      }

      // Audio file path or URL
      const uri = line;
      const rawFallback = uri.replace(/^.*[\\/]/, '').replace(/\.[^/.]+$/, '');
      const cleaned = MetadataResolverService.cleanFilename(rawFallback);

      const title = currentTitle || cleaned.title || rawFallback;
      const artist = currentArtist || cleaned.artist || 'Unknown Artist';

      entries.push({
        raw: line,
        duration: currentDuration,
        title,
        artist,
        uri,
      });

      // Reset entry state
      currentDuration = undefined;
      currentTitle = undefined;
      currentArtist = undefined;
    }

    return { playlistName, entries };
  }

  /**
   * Matches parsed M3U entries against local tracks and catalog providers.
   */
  public static async matchEntries(
    entries: M3UEntry[],
    localTracks: Track[],
    onProgress?: (processed: number, total: number, currentName?: string) => void
  ): Promise<{ matchedTracks: Track[]; unresolvedEntries: M3UEntry[] }> {
    const matchedTracks: Track[] = [];
    const unresolvedEntries: M3UEntry[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (onProgress) {
        onProgress(i + 1, entries.length, entry.title);
      }

      // 1. Check if matches any local track by path or title/artist
      const localMatch = localTracks.find((lt) => {
        const titleMatch = lt.title.toLowerCase() === entry.title.toLowerCase();
        const artistMatch =
          !entry.artist ||
          entry.artist === 'Unknown Artist' ||
          lt.artistName.toLowerCase().includes(entry.artist.toLowerCase());
        const pathMatch = lt.localPath && entry.uri.includes(lt.localPath);
        return pathMatch || (titleMatch && artistMatch);
      });

      if (localMatch) {
        matchedTracks.push(localMatch);
        continue;
      }

      // 2. Resolve metadata & high-res artwork via MetadataResolverService
      const onlineMatch = await MetadataResolverService.queryOnlineCatalog(
        entry.title,
        entry.artist !== 'Unknown Artist' ? entry.artist : undefined
      );

      const isRemoteStream = Boolean(entry.uri && entry.uri.startsWith('http'));
      const hasDirectUri = Boolean(entry.uri && (isRemoteStream || entry.uri.startsWith('file:') || entry.uri.startsWith('/')));

      if (onlineMatch && onlineMatch.isConfidenceHigh) {
        const resolvedArtwork = onlineMatch.artworkUrl || BRANDING_CONFIG.defaultArtwork;
        const track: Track = {
          id: `m3u-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          title: onlineMatch.title || entry.title,
          artistId: `artist_${encodeURIComponent(
            (onlineMatch.artist || entry.artist || 'Artist').toLowerCase().replace(/\s+/g, '_')
          )}`,
          artistName: onlineMatch.artist || entry.artist || 'Unknown Artist',
          albumTitle: onlineMatch.album || 'Imported Playlist',
          artworkUrl: resolvedArtwork,
          audioUrl: isRemoteStream ? entry.uri : undefined,
          localPath: !isRemoteStream ? entry.uri : undefined,
          duration: entry.duration || 180,
          provider: 'local',
          isPlayable: true,
          accessStatus: 'playable',
          playbackType: 'full',
          sourceType: isRemoteStream ? 'remote' : 'local',
          isDownloaded: false,
          trackNumber: onlineMatch.trackNumber,
        };
        matchedTracks.push(track);
        continue;
      }

      // 3. Search catalog for metadata enrichment or fallback stream if URI is missing
      let catalogArtwork: string | undefined;
      let catalogAlbum: string | undefined;
      if (entry.title && entry.title.trim().length > 0) {
        try {
          const query =
            entry.artist && entry.artist !== 'Unknown Artist'
              ? `${entry.title} ${entry.artist}`
              : entry.title;
          const searchResult = await providerRegistry.search(query);
          const topSong = searchResult.tracks[0];

          if (topSong) {
            const sim = MetadataResolverService.calculateSimilarity(entry.title, topSong.title);
            if (sim >= 0.65) {
              catalogArtwork = topSong.artworkUrl;
              catalogAlbum = topSong.albumTitle;
              // Only adopt topSong completely if the M3U entry lacked a direct playable URI
              if (!hasDirectUri && topSong.audioUrl && topSong.isPlayable !== false) {
                matchedTracks.push(topSong);
                continue;
              }
            }
          }
        } catch {}
      }

      // 4. Fallback direct track using the user's authentic M3U audio URI
      if (entry.title && entry.title.trim().length > 0) {
        const fallbackTrack: Track = {
          id: `m3u-entry-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          title: entry.title.trim(),
          artistId: 'm3u-artist',
          artistName: entry.artist || 'Unknown Artist',
          albumTitle: catalogAlbum || 'Imported Playlist Track',
          artworkUrl: catalogArtwork || BRANDING_CONFIG.defaultArtwork,
          audioUrl: isRemoteStream ? entry.uri : undefined,
          localPath: !isRemoteStream ? entry.uri : undefined,
          duration: entry.duration || 180,
          provider: 'local',
          isPlayable: true,
          accessStatus: 'playable',
          playbackType: 'full',
          sourceType: isRemoteStream ? 'remote' : 'local',
          isDownloaded: false,
        };
        matchedTracks.push(fallbackTrack);
      } else {
        unresolvedEntries.push(entry);
      }
    }

    return { matchedTracks, unresolvedEntries };
  }
}
