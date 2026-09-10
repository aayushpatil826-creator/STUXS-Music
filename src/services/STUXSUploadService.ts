import { supabase, isSupabaseConfigured } from '../config/supabase';
import { MetadataResolverService } from './MetadataResolverService';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import type { Database } from '../types/database.types';

export type SongRow = Database['public']['Tables']['songs']['Row'];

export interface TrackDraftMetadata {
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  language?: string;
  releaseYear?: number;
  trackNumber?: number;
  discNumber?: number;
  copyright?: string;
  duration: number; // in seconds
  artworkDataUrl?: string | null;
  embeddedArtworkDataUrl?: string | null;
  providerArtworkUrl?: string | null;
  isrc?: string;
  fileName?: string;
  fileSize?: number; // bytes
  mimeType?: string;
  enrichmentSource?: 'JioSaavn' | 'iTunes' | 'Embedded' | 'Manual';
  isProviderEnriched?: boolean;
  rawEmbeddedMeta?: {
    title?: string;
    artist?: string;
    album?: string;
    genre?: string;
    language?: string;
    year?: number;
    duration?: number;
  };
}

export interface UploadProgressCallback {
  (percentage: number, status: string): void;
}

export class STUXSUploadService {
  /**
   * Checks whether a song with matching title and artist already exists in the STUXS catalog.
   * If album is provided, matches on title, artist, and album for high-fidelity identity.
   */
  public static async checkDuplicate(title: string, artist: string, album?: string): Promise<boolean> {
    if (!isSupabaseConfigured() || !title.trim() || !artist.trim()) return false;

    try {
      let query = supabase
        .from('songs')
        .select('id')
        .eq('provider', 'stuxs')
        .ilike('title', title.trim())
        .ilike('artist_name', artist.trim());

      if (album && album.trim() && album !== 'STUXS Single' && album !== 'STUXS Album') {
        query = query.ilike('album_title', album.trim());
      }

      const { data, error } = await query.limit(1);

      if (error || !data) return false;
      return data.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Automatically extracts embedded metadata from audio file and enriches it
   * using existing high-confidence music metadata providers (JioSaavn & iTunes).
   */
  public static async analyzeAudioFile(file: File): Promise<TrackDraftMetadata> {
    const cleaned = MetadataResolverService.cleanFilename(file.name);
    let embeddedMeta: any = {};

    // STEP 1: READ LOCAL AUDIO METADATA & EMBEDDED ARTWORK
    try {
      embeddedMeta = await MetadataResolverService.extractEmbeddedMetadata(file, file.name);
    } catch (err) {
      console.warn('[STUXSUploadService] Embedded metadata extraction warning:', err);
    }

    // Accurate audio duration extraction via HTML5 Audio probe
    const duration = await this.probeAudioDuration(file);

    const initialTitle = (embeddedMeta.title && embeddedMeta.title.trim()) || cleaned.title || file.name.replace(/\.[^/.]+$/, '');
    const initialArtist = (embeddedMeta.artist && embeddedMeta.artist.trim()) || cleaned.artist || 'STUXS Artist';
    const initialAlbum = (embeddedMeta.album && embeddedMeta.album.trim()) || 'STUXS Single';
    const embeddedArtwork = embeddedMeta.artworkDataUrl || null;

    // STEP 2: ENRICH USING EXISTING MUSIC METADATA PROVIDERS (JioSaavn & iTunes)
    let enrichedMatch: any = null;
    try {
      enrichedMatch = await MetadataResolverService.queryOnlineCatalog(
        initialTitle,
        initialArtist !== 'STUXS Artist' && initialArtist !== 'Unknown Artist' ? initialArtist : undefined,
        initialAlbum !== 'STUXS Single' ? initialAlbum : undefined,
        embeddedMeta.isrc
      );
    } catch (err) {
      console.warn('[STUXSUploadService] Metadata provider lookup warning:', err);
    }

    // STEP 3: SMART METADATA MERGING
    // Priority:
    // 1. High-confidence provider metadata when exact match identified
    // 2. Embedded audio metadata
    // 3. Safe cleaned filename fallback
    if (enrichedMatch && enrichedMatch.isConfidenceHigh) {
      const finalArtwork = enrichedMatch.artworkUrl || embeddedArtwork;

      return {
        title: enrichedMatch.title || initialTitle,
        artist: enrichedMatch.artist || initialArtist,
        album: enrichedMatch.album || initialAlbum,
        albumArtist: enrichedMatch.artist || embeddedMeta.albumArtist || initialArtist,
        genre: enrichedMatch.genre || embeddedMeta.genre || undefined,
        language: enrichedMatch.language || embeddedMeta.language || 'Hindi',
        releaseYear: enrichedMatch.year || embeddedMeta.year || new Date().getFullYear(),
        trackNumber: enrichedMatch.trackNumber || embeddedMeta.trackNumber || 1,
        discNumber: embeddedMeta.discNumber || 1,
        copyright: embeddedMeta.copyright || undefined,
        duration: Math.round(duration || 180),
        artworkDataUrl: finalArtwork,
        embeddedArtworkDataUrl: embeddedArtwork,
        providerArtworkUrl: enrichedMatch.artworkUrl || null,
        isrc: embeddedMeta.isrc,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'audio/mpeg',
        isProviderEnriched: true,
        enrichmentSource: enrichedMatch.source || 'iTunes',
        rawEmbeddedMeta: {
          title: embeddedMeta.title,
          artist: embeddedMeta.artist,
          album: embeddedMeta.album,
          genre: embeddedMeta.genre,
          language: embeddedMeta.language,
          year: embeddedMeta.year,
          duration: Math.round(duration || 180),
        },
      };
    }

    // Fallback to pure embedded metadata when provider match is not confidently found
    return {
      title: initialTitle,
      artist: initialArtist,
      album: initialAlbum,
      albumArtist: embeddedMeta.albumArtist || initialArtist,
      genre: embeddedMeta.genre || undefined,
      language: embeddedMeta.language || 'Hindi',
      releaseYear: embeddedMeta.year || new Date().getFullYear(),
      trackNumber: embeddedMeta.trackNumber || 1,
      discNumber: embeddedMeta.discNumber || 1,
      copyright: embeddedMeta.copyright || undefined,
      duration: Math.round(duration || 180),
      artworkDataUrl: embeddedArtwork,
      embeddedArtworkDataUrl: embeddedArtwork,
      providerArtworkUrl: null,
      isrc: embeddedMeta.isrc,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'audio/mpeg',
      isProviderEnriched: false,
      enrichmentSource: embeddedMeta.title ? 'Embedded' : 'Manual',
      rawEmbeddedMeta: {
        title: embeddedMeta.title,
        artist: embeddedMeta.artist,
        album: embeddedMeta.album,
        genre: embeddedMeta.genre,
        language: embeddedMeta.language,
        year: embeddedMeta.year,
        duration: Math.round(duration || 180),
      },
    };
  }

  /**
   * Helper to accurately probe audio duration in seconds without full decode.
   */
  private static async probeAudioDuration(file: File): Promise<number> {
    return new Promise((resolve) => {
      try {
        const audio = new Audio();
        const url = URL.createObjectURL(file);
        audio.preload = 'metadata';

        const cleanup = () => {
          audio.removeAttribute('src');
          URL.revokeObjectURL(url);
        };

        audio.onloadedmetadata = () => {
          const dur = audio.duration;
          cleanup();
          resolve(dur && !isNaN(dur) && dur > 0 ? dur : 180);
        };

        audio.onerror = () => {
          cleanup();
          resolve(180);
        };

        audio.src = url;
      } catch {
        resolve(180);
      }
    });
  }

  /**
   * Uploads the audio file, uploads artwork, and creates a draft (is_published = false) record.
   */
  public static async uploadTrack(
    file: File,
    meta: TrackDraftMetadata,
    userId: string,
    onProgress?: UploadProgressCallback
  ): Promise<{ success: boolean; trackId?: string; error?: string }> {
    if (!userId) {
      return { success: false, error: 'Authentication required to upload tracks.' };
    }

    if (!file || file.size === 0) {
      return { success: false, error: 'Audio file is empty or corrupted.' };
    }

    if (file.size > 100 * 1024 * 1024) {
      return { success: false, error: 'Audio file exceeds 100 MB limit.' };
    }

    const validExtensions = ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'wav'];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!validExtensions.includes(ext) && !file.type.startsWith('audio/')) {
      return { success: false, error: 'Unsupported audio format. Supported: MP3, M4A, AAC, FLAC, OGG, WAV.' };
    }

    if (!meta.title || !meta.title.trim()) {
      return { success: false, error: 'Track title is required.' };
    }

    if (!meta.artist || !meta.artist.trim()) {
      return { success: false, error: 'Artist name is required.' };
    }

    // Explicit preview check (do not reject short songs unless explicit preview marker exists)
    const isExplicitPreview = (
      /(?:^|\W)(?:30s\s*preview|preview\s*clip|sample\s*only)(?:\W|$)/i.test(meta.title) ||
      /\.preview\./i.test(file.name) ||
      /-preview\./i.test(file.name)
    );
    if (isExplicitPreview && meta.duration <= 35) {
      return { success: false, error: 'Preview clips cannot be uploaded as full catalog tracks.' };
    }

    // SoundCloud exclusion check
    if (/soundcloud/i.test(file.name) || /soundcloud/i.test(meta.title) || /soundcloud/i.test(meta.artist)) {
      return { success: false, error: 'SoundCloud tracks are permanently excluded from STUXS.' };
    }

    // Artwork size check (10 MB limit)
    if (meta.artworkDataUrl && meta.artworkDataUrl.startsWith('data:')) {
      const approxBytes = (meta.artworkDataUrl.length * 3) / 4;
      if (approxBytes > 10 * 1024 * 1024) {
        return { success: false, error: 'Artwork image exceeds 10 MB limit.' };
      }
    }

    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Supabase is not configured' };
    }

    const generateUUID = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        try {
          return crypto.randomUUID();
        } catch {}
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    };

    const trackId = generateUUID();
    const audioStoragePath = `${trackId}/original.${ext || 'mp3'}`;
    const artworkStoragePath = `${trackId}/cover.jpg`;

    try {
      // 1. Upload Audio File with status notifications
      onProgress?.(25, 'Uploading audio file...');

      const { error: audioUploadError } = await supabase.storage
        .from('stuxs-audio')
        .upload(audioStoragePath, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type || 'audio/mpeg',
        });

      if (audioUploadError) {
        throw new Error(`Audio upload failed: ${audioUploadError.message}`);
      }

      onProgress?.(65, 'Processing metadata...');
      const { data: audioUrlData } = supabase.storage
        .from('stuxs-audio')
        .getPublicUrl(audioStoragePath);

      const publicAudioUrl = audioUrlData?.publicUrl || '';

      // 2. Upload Artwork (if available as Data URL or Blob)
      let publicArtworkUrl: string | null = null;
      if (meta.artworkDataUrl && meta.artworkDataUrl.startsWith('data:')) {
        onProgress?.(80, 'Processing artwork...');
        try {
          const res = await fetch(meta.artworkDataUrl);
          const blob = await res.blob();
          const { error: artError } = await supabase.storage
            .from('stuxs-artwork')
            .upload(artworkStoragePath, blob, {
              cacheControl: '86400',
              upsert: true,
              contentType: blob.type || 'image/jpeg',
            });

          if (!artError) {
            const { data: artUrlData } = supabase.storage
              .from('stuxs-artwork')
              .getPublicUrl(artworkStoragePath);
            publicArtworkUrl = artUrlData?.publicUrl || null;
          }
        } catch (artErr) {
          console.warn('[STUXSUploadService] Artwork upload warning:', artErr);
        }
      } else if (meta.artworkDataUrl && meta.artworkDataUrl.startsWith('http')) {
        publicArtworkUrl = meta.artworkDataUrl;
      }

      // 3. Insert Draft Track into public.songs (is_published: false)
      onProgress?.(92, 'Creating catalog entry...');

      const { data: songData, error: songError } = await supabase
        .from('songs')
        .insert({
          id: trackId,
          title: meta.title.trim(),
          artist_name: meta.artist.trim(),
          album_title: meta.album.trim(),
          genre: meta.genre?.trim() || null,
          language: meta.language?.trim() || null,
          release_year: meta.releaseYear || new Date().getFullYear(),
          duration: meta.duration,
          provider: 'stuxs',
          provider_id: trackId,
          artwork_url: publicArtworkUrl,
          audio_storage_path: audioStoragePath,
          audio_url: publicAudioUrl,
          is_published: false, // Starts as draft
          is_explicit: false,
          uploaded_by: userId,
        } as any)
        .select('*')
        .single();

      if (songError) {
        // Rollback uploaded storage object on DB failure
        await supabase.storage.from('stuxs-audio').remove([audioStoragePath]);
        throw new Error(`Database record creation failed: ${songError.message}`);
      }

      onProgress?.(100, 'Upload complete');
      return { success: true, trackId: (songData as any)?.id || trackId };
    } catch (err: any) {
      console.error('[STUXSUploadService] Upload error:', err);
      return { success: false, error: err.message || 'Upload failed. Please try again.' };
    }
  }

  /**
   * Publishes a draft track, verifying playability before making it discoverable in search and catalog.
   */
  public static async publishTrack(trackId: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase not configured' };

    try {
      // Step 1: Pre-validate track existence and playability
      const { data: song, error: fetchError } = await supabase
        .from('songs')
        .select('*')
        .eq('id', trackId)
        .maybeSingle();

      if (fetchError || !song) {
        return { success: false, error: 'Track not found in catalog.' };
      }

      const songRow = song as any;
      if (!songRow.title?.trim() || !songRow.artist_name?.trim()) {
        return { success: false, error: 'Cannot publish track with missing title or artist name.' };
      }

      if (!songRow.audio_storage_path && !songRow.audio_url) {
        return { success: false, error: 'Cannot publish track without an audio file.' };
      }

      const audioUrl = String(songRow.audio_url || '');
      if (audioUrl.includes('itunes.apple.com') || audioUrl.includes('mzstatic.com') || audioUrl.includes('soundcloud')) {
        return { success: false, error: 'Cannot publish preview clips or unauthorized audio streams.' };
      }

      // Step 2: Set published status
      const { error } = await (supabase.from('songs') as any)
        .update({
          is_published: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', trackId);

      if (error) throw error;

      // Step 3: Invalidate catalog and search caches so track appears immediately
      try {
        ProviderRegistry.getInstance().clearSearchCache();
        ProviderRegistry.getInstance().invalidateStreamCache(trackId);
      } catch {}

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to publish track' };
    }
  }

  /**
   * Unpublishes a track, removing it from public search and discovery without deleting files.
   */
  public static async unpublishTrack(trackId: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase not configured' };

    try {
      const { error } = await (supabase.from('songs') as any)
        .update({
          is_published: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', trackId);

      if (error) throw error;

      // Invalidate caches so track immediately disappears from discovery and search
      try {
        ProviderRegistry.getInstance().clearSearchCache();
        ProviderRegistry.getInstance().invalidateStreamCache(trackId);
      } catch {}

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to unpublish track' };
    }
  }

  /**
   * Updates metadata for an existing STUXS catalog track.
   */
  public static async updateTrack(
    trackId: string,
    updates: Partial<TrackDraftMetadata>
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase not configured' };

    try {
      const payload: any = { updated_at: new Date().toISOString() };
      if (updates.title !== undefined) payload.title = updates.title.trim();
      if (updates.artist !== undefined) payload.artist_name = updates.artist.trim();
      if (updates.album !== undefined) payload.album_title = updates.album.trim();
      if (updates.genre !== undefined) payload.genre = updates.genre?.trim() || null;
      if (updates.language !== undefined) payload.language = updates.language?.trim() || null;
      if (updates.releaseYear !== undefined) payload.release_year = updates.releaseYear;
      if (updates.artworkDataUrl !== undefined) {
        if (updates.artworkDataUrl === null) {
          payload.artwork_url = null;
        } else if (updates.artworkDataUrl.startsWith('http')) {
          payload.artwork_url = updates.artworkDataUrl;
        }
      }

      const { error } = await (supabase.from('songs') as any)
        .update(payload)
        .eq('id', trackId);

      if (error) throw error;

      try {
        ProviderRegistry.getInstance().clearSearchCache();
        ProviderRegistry.getInstance().invalidateStreamCache(trackId);
      } catch {}

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to update track' };
    }
  }

  /**
   * Deletes a STUXS track and purges its storage files safely.
   */
  public static async deleteTrack(
    trackId: string,
    audioStoragePath?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase not configured' };

    try {
      const audioPath = audioStoragePath || `${trackId}/original.mp3`;
      await supabase.storage.from('stuxs-audio').remove([audioPath, `${trackId}/original.m4a`, `${trackId}/original.flac`, `${trackId}/original.wav`, `${trackId}/original.aac`, `${trackId}/original.ogg`]);
      await supabase.storage.from('stuxs-artwork').remove([`${trackId}/cover.jpg`]);

      const { error } = await supabase.from('songs').delete().eq('id', trackId);
      if (error) throw error;

      // Invalidate caches so deleted track immediately ceases to resolve or search
      try {
        ProviderRegistry.getInstance().clearSearchCache();
        ProviderRegistry.getInstance().invalidateStreamCache(trackId);
      } catch {}

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to delete track' };
    }
  }

  /**
   * Retrieves all developer tracks (both published and drafts) for catalog management.
   */
  public static async getDeveloperCatalog(): Promise<SongRow[]> {
    if (!isSupabaseConfigured()) return [];

    try {
      const { data, error } = await supabase
        .from('songs')
        .select('*')
        .eq('provider', 'stuxs')
        .order('created_at', { ascending: false });

      if (error || !data) return [];
      return data as SongRow[];
    } catch (err) {
      console.warn('[STUXSUploadService] getDeveloperCatalog error:', err);
      return [];
    }
  }
}
