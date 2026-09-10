/**
 * MetadataResolverService.ts
 *
 * Intelligent metadata & album artwork resolution engine for local & imported audio tracks.
 * Features:
 * - Pure-TS embedded audio metadata extractor (ID3v2.2-4, ID3v1, MP4/M4A atoms, FLAC/OGG Vorbis).
 * - Multi-stage title/artist clean parser for noisy file names.
 * - Confidence-scored online metadata & high-res artwork resolver (JioSaavn & iTunes).
 * - Converts remote artwork to persistent Base64 Data URLs for 100% offline availability.
 */

export interface ExtractedAudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  language?: string;
  year?: number;
  trackNumber?: number;
  isrc?: string;
  artworkDataUrl?: string;
  duration?: number;
}

export interface ResolvedOnlineMatch {
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
  genre?: string;
  language?: string;
  year?: number;
  trackNumber?: number;
  isConfidenceHigh: boolean;
  source: 'JioSaavn' | 'iTunes';
  matchScore: number;
}

export interface ResolvedTrackMetadata {
  title: string;
  artist: string;
  album: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  isrc?: string;
  artworkUrl: string;
  isConfidenceHigh: boolean;
  source: 'embedded' | 'online-itunes' | 'online-jiosaavn' | 'filename';
}

export class MetadataResolverService {
  /**
   * Cleans filename by stripping track number prefixes, rip signatures, YouTube tags, and file extensions.
   */
  public static cleanFilename(filename: string): { artist?: string; title: string } {
    let name = filename.replace(/\.[^/.]+$/, ''); // Remove extension

    // Remove track number prefixes (e.g. "01. ", "01 - ", "01_ ", "01 ", "1 - ")
    name = name.replace(/^(\d{1,3}[\s._-]+)/, '');

    // Remove common YouTube/rip tags inside parentheses or brackets
    name = name.replace(
      /[\(\[][^\)\]]*(?:official|video|audio|hq|hd|320\s*kbps|remaster(?:ed)?|lyrics?|full\s*song|1080p|4k|mp3|flac|m4a|aac)[^\)\]]*[\)\]]/gi,
      ''
    );

    // Clean up underscores and multiple spaces
    name = name.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
    name = name.replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();

    let artist: string | undefined;
    let title = name;

    if (name.includes(' - ')) {
      const parts = name.split(' - ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    } else if (name.includes(' – ')) {
      const parts = name.split(' – ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' – ').trim();
    }

    return { artist: artist || undefined, title: title || filename.replace(/\.[^/.]+$/, '') };
  }

  /**
   * Calculates similarity between two strings using bigram Dice coefficient & substring matching.
   */
  public static calculateSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.88;

    const bigrams1 = new Set<string>();
    for (let i = 0; i < s1.length - 1; i++) bigrams1.add(s1.substring(i, i + 2));
    const bigrams2 = new Set<string>();
    for (let i = 0; i < s2.length - 1; i++) bigrams2.add(s2.substring(i, i + 2));

    let intersection = 0;
    for (const b of bigrams1) {
      if (bigrams2.has(b)) intersection++;
    }

    const total = bigrams1.size + bigrams2.size;
    return total === 0 ? 0 : (2 * intersection) / total;
  }

  /**
   * Helper to convert ArrayBuffer or Blob into a persistent Base64 Data URL.
   */
  public static async blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Fetches an image URL and converts it into a persistent Base64 Data URL.
   */
  public static async fetchArtworkAsDataUrl(url: string): Promise<string | null> {
    if (!url) return null;
    if (url.startsWith('data:')) return url;

    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await this.blobToDataUrl(blob);
    } catch {
      return null;
    }
  }

  /**
   * Extracts embedded metadata (ID3v2, ID3v1, MP4 atoms, FLAC/OGG comments, APIC artwork)
   * directly from an audio file's binary stream.
   */
  public static async extractEmbeddedMetadata(
    file: File | Blob,
    _filename?: string
  ): Promise<ExtractedAudioMetadata> {
    const meta: ExtractedAudioMetadata = {};

    try {
      // Read first 512KB for headers/tags
      const headerSlice = await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer();
      const bytes = new Uint8Array(headerSlice);

      // 1. ID3v2 Tags (MP3 / WAV)
      if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
        let offset = 10;
        const tagSize =
          ((bytes[6] & 0x7f) << 21) |
          ((bytes[7] & 0x7f) << 14) |
          ((bytes[8] & 0x7f) << 7) |
          (bytes[9] & 0x7f);

        const maxOffset = Math.min(bytes.length, 10 + tagSize);

        while (offset + 10 < maxOffset) {
          const frameId = String.fromCharCode(
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3]
          );
          const frameSize =
            (bytes[offset + 4] << 24) |
            (bytes[offset + 5] << 16) |
            (bytes[offset + 6] << 8) |
            bytes[offset + 7];

          if (frameSize <= 0 || offset + 10 + frameSize > maxOffset) break;

          const frameData = bytes.subarray(offset + 10, offset + 10 + frameSize);

          // Decode text frames
          if (
            ['TIT2', 'TPE1', 'TALB', 'TPE2', 'TCON', 'TYER', 'TDRC', 'TRCK', 'TSRC', 'TLAN'].includes(
              frameId
            )
          ) {
            try {
              const encoding = frameData[0];
              const contentBytes = frameData.subarray(1);
              let text = '';
              if (encoding === 1 || encoding === 2) {
                text = new TextDecoder('utf-16').decode(contentBytes);
              } else {
                text = new TextDecoder('utf-8').decode(contentBytes);
              }
              text = text.replace(/\0/g, '').trim();

              if (frameId === 'TIT2' && text) meta.title = text;
              if (frameId === 'TPE1' && text) meta.artist = text;
              if (frameId === 'TALB' && text) meta.album = text;
              if (frameId === 'TPE2' && text) meta.albumArtist = text;
              if (frameId === 'TCON' && text) meta.genre = text;
              if (frameId === 'TLAN' && text) meta.language = text;
              if ((frameId === 'TYER' || frameId === 'TDRC') && text) {
                const yearParsed = parseInt(text.substring(0, 4), 10);
                if (!isNaN(yearParsed)) meta.year = yearParsed;
              }
              if (frameId === 'TRCK' && text) {
                const trkParsed = parseInt(text.split('/')[0], 10);
                if (!isNaN(trkParsed)) meta.trackNumber = trkParsed;
              }
              if (frameId === 'TSRC' && text) meta.isrc = text;
            } catch {}
          }

          // Embedded APIC cover artwork
          if (frameId === 'APIC') {
            try {
              let picOffset = 1;
              let mime = 'image/jpeg';
              let mimeEnd = picOffset;
              while (mimeEnd < frameData.length && frameData[mimeEnd] !== 0) {
                mimeEnd++;
              }
              if (mimeEnd > picOffset) {
                mime = new TextDecoder('utf-8').decode(frameData.subarray(picOffset, mimeEnd));
              }
              picOffset = mimeEnd + 1;
              picOffset++; // picture type byte

              while (picOffset < frameData.length && frameData[picOffset] !== 0) {
                picOffset++;
              }
              picOffset++; // null terminator

              if (picOffset < frameData.length) {
                const imgBytes = frameData.subarray(picOffset);
                const imgBlob = new Blob([imgBytes], { type: mime || 'image/jpeg' });
                meta.artworkDataUrl = await this.blobToDataUrl(imgBlob);
              }
            } catch {}
          }

          offset += 10 + frameSize;
        }
      }

      // 2. MP4 / M4A Atoms (e.g. \xa9nam, \xa9ART, \xa9alb, covr)
      const dataView = new DataView(headerSlice);
      if (headerSlice.byteLength > 12) {
        const magic = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
        if (magic === 'ftyp' || magic === 'moov') {
          const textDecoder = new TextDecoder('utf-8');
          const headerStr = textDecoder.decode(bytes);

          const findAtomText = (atomTag: string): string | undefined => {
            const idx = headerStr.indexOf(atomTag);
            if (idx !== -1 && idx + 16 < bytes.length) {
              const dataStart = idx + 8;
              const len = dataView.getUint32(idx - 4, false);
              if (len > 8 && idx + len <= bytes.length) {
                const atomSlice = bytes.subarray(dataStart + 8, idx + len);
                return textDecoder.decode(atomSlice).replace(/[\0\r\n]/g, '').trim();
              }
            }
            return undefined;
          };

          const m4aTitle = findAtomText('©nam');
          const m4aArtist = findAtomText('©ART');
          const m4aAlbum = findAtomText('©alb');
          const m4aGenre = findAtomText('©gen');

          if (m4aTitle && !meta.title) meta.title = m4aTitle;
          if (m4aArtist && !meta.artist) meta.artist = m4aArtist;
          if (m4aAlbum && !meta.album) meta.album = m4aAlbum;
          if (m4aGenre && !meta.genre) meta.genre = m4aGenre;

          // Check covr atom
          const covrIdx = headerStr.indexOf('covr');
          if (covrIdx !== -1 && covrIdx + 16 < bytes.length) {
            try {
              const dataPos = covrIdx + 8;
              const covrLen = dataView.getUint32(covrIdx - 4, false);
              if (covrLen > 16 && covrIdx + covrLen <= bytes.length) {
                const imgData = bytes.subarray(dataPos + 8, covrIdx + covrLen);
                const isPng = imgData[0] === 0x89 && imgData[1] === 0x50;
                const mime = isPng ? 'image/png' : 'image/jpeg';
                const imgBlob = new Blob([imgData], { type: mime });
                meta.artworkDataUrl = await this.blobToDataUrl(imgBlob);
              }
            } catch {}
          }
        }
      }

      // 3. FLAC / OGG Vorbis comment headers
      if (bytes.length > 4 && bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
        const textDecoder = new TextDecoder('utf-8');
        const headerStr = textDecoder.decode(bytes);

        const extractVorbisTag = (tagName: string): string | undefined => {
          const regex = new RegExp(`${tagName}=([^\\0\\r\\n]+)`, 'i');
          const m = headerStr.match(regex);
          return m ? m[1].trim() : undefined;
        };

        const flacTitle = extractVorbisTag('TITLE');
        const flacArtist = extractVorbisTag('ARTIST');
        const flacAlbum = extractVorbisTag('ALBUM');
        const flacGenre = extractVorbisTag('GENRE');
        const flacDate = extractVorbisTag('DATE');
        const flacTrack = extractVorbisTag('TRACKNUMBER');
        const flacLanguage = extractVorbisTag('LANGUAGE');
        const flacIsrc = extractVorbisTag('ISRC');

        if (flacTitle && !meta.title) meta.title = flacTitle;
        if (flacArtist && !meta.artist) meta.artist = flacArtist;
        if (flacAlbum && !meta.album) meta.album = flacAlbum;
        if (flacGenre && !meta.genre) meta.genre = flacGenre;
        if (flacLanguage && !meta.language) meta.language = flacLanguage;
        if (flacDate && !meta.year) {
          const yr = parseInt(flacDate.substring(0, 4), 10);
          if (!isNaN(yr)) meta.year = yr;
        }
        if (flacTrack && !meta.trackNumber) {
          const tn = parseInt(flacTrack, 10);
          if (!isNaN(tn)) meta.trackNumber = tn;
        }
        if (flacIsrc && !meta.isrc) meta.isrc = flacIsrc;
      }

      // 4. ID3v1 Fallback (Last 128 bytes of file)
      if (!meta.title || !meta.artist) {
        try {
          const tailSlice = await file.slice(Math.max(0, file.size - 128)).arrayBuffer();
          const tailBytes = new Uint8Array(tailSlice);
          if (tailBytes.length === 128 && tailBytes[0] === 0x54 && tailBytes[1] === 0x41 && tailBytes[2] === 0x47) {
            const dec = new TextDecoder('utf-8');
            const v1Title = dec.decode(tailBytes.subarray(3, 33)).replace(/\0/g, '').trim();
            const v1Artist = dec.decode(tailBytes.subarray(33, 63)).replace(/\0/g, '').trim();
            const v1Album = dec.decode(tailBytes.subarray(63, 93)).replace(/\0/g, '').trim();
            const v1Year = parseInt(dec.decode(tailBytes.subarray(93, 97)).replace(/\0/g, '').trim(), 10);

            if (v1Title && !meta.title) meta.title = v1Title;
            if (v1Artist && !meta.artist) meta.artist = v1Artist;
            if (v1Album && !meta.album) meta.album = v1Album;
            if (!isNaN(v1Year) && !meta.year) meta.year = v1Year;
          }
        } catch {}
      }
    } catch (err) {
      console.warn('[MetadataResolver] Error extracting embedded metadata:', err);
    }

    return meta;
  }

  /**
   * Queries JioSaavn music metadata API.
   */
  public static async queryJioSaavnCatalog(
    title: string,
    artist?: string,
    album?: string
  ): Promise<ResolvedOnlineMatch | null> {
    try {
      const q = `${title} ${artist || ''}`.trim();
      const res = await fetch(`https://saavn.dev/api/search/songs?query=${encodeURIComponent(q)}&page=1&limit=5`);
      if (!res.ok) return null;
      const json = await res.json();
      const results = json.data?.results || [];

      for (const item of results) {
        const candTitle = item.name || '';
        const primaryArtists = item.artists?.primary?.map((a: any) => a.name).join(', ') || '';
        const candAlbum = item.album?.name || '';

        const titleSim = this.calculateSimilarity(title, candTitle);
        let artistSim = 1.0;
        if (artist && artist !== 'Unknown Artist') {
          artistSim = this.calculateSimilarity(artist, primaryArtists);
        }

        let albumBonus = 0;
        if (album && candAlbum) {
          const albumSim = this.calculateSimilarity(album, candAlbum);
          if (albumSim > 0.7) albumBonus = 0.1;
        }

        const score = titleSim * 0.65 + artistSim * 0.35 + albumBonus;
        if (score >= 0.75 && titleSim >= 0.65) {
          const highResArt =
            item.image?.[item.image.length - 1]?.url ||
            item.image?.[0]?.url ||
            '';

          const detectedLang = item.language ? item.language.charAt(0).toUpperCase() + item.language.slice(1) : undefined;

          return {
            title: candTitle,
            artist: primaryArtists || artist || '',
            album: candAlbum || album || '',
            artworkUrl: highResArt,
            genre: detectedLang ? `${detectedLang} Music` : 'Music',
            language: detectedLang,
            year: item.year ? parseInt(item.year, 10) : undefined,
            trackNumber: 1,
            isConfidenceHigh: true,
            source: 'JioSaavn',
            matchScore: score,
          };
        }
      }
    } catch (err) {
      console.warn('[MetadataResolver] JioSaavn query error:', err);
    }
    return null;
  }

  /**
   * Queries iTunes music metadata API.
   */
  public static async queryITunesCatalog(
    title: string,
    artist?: string,
    album?: string,
    isrc?: string
  ): Promise<ResolvedOnlineMatch | null> {
    const cleanTitle = title.trim();
    const cleanArtist = (artist || '').trim();

    if (!cleanTitle && !isrc) return null;

    const queries: string[] = [];
    if (isrc) queries.push(isrc);
    if (cleanArtist && cleanArtist !== 'Unknown Artist') {
      queries.push(`${cleanTitle} ${cleanArtist}`);
    } else {
      queries.push(cleanTitle);
    }

    for (const query of queries) {
      try {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
          query
        )}&media=music&entity=song&limit=5`;

        const res = await fetch(url);
        if (!res.ok) continue;

        const data = await res.json();
        if (!data.results || data.results.length === 0) continue;

        for (const candidate of data.results) {
          if (candidate.wrapperType !== 'track' || candidate.kind !== 'song') continue;

          const candTitle = candidate.trackName || '';
          const candArtist = candidate.artistName || '';
          const candAlbum = candidate.collectionName || '';

          // 1. ISRC exact match
          if (isrc && candidate.isrc && candidate.isrc.toLowerCase() === isrc.toLowerCase()) {
            const highResArtwork = (candidate.artworkUrl100 || '').replace('100x100bb', '600x600bb');
            return {
              title: candTitle,
              artist: candArtist,
              album: candAlbum,
              artworkUrl: highResArtwork,
              genre: candidate.primaryGenreName,
              year: candidate.releaseDate ? new Date(candidate.releaseDate).getFullYear() : undefined,
              trackNumber: candidate.trackNumber,
              isConfidenceHigh: true,
              source: 'iTunes',
              matchScore: 1.0,
            };
          }

          // 2. Title & Artist Similarity Score
          const titleSim = this.calculateSimilarity(cleanTitle, candTitle);
          let artistSim = 1.0;
          if (cleanArtist && cleanArtist !== 'Unknown Artist') {
            artistSim = this.calculateSimilarity(cleanArtist, candArtist);
          }

          let albumBonus = 0;
          if (album && candAlbum) {
            const albumSim = this.calculateSimilarity(album, candAlbum);
            if (albumSim > 0.7) albumBonus = 0.1;
          }

          const combinedScore = titleSim * 0.65 + artistSim * 0.35 + albumBonus;

          if (combinedScore >= 0.75 && titleSim >= 0.65) {
            const highResArtwork = (candidate.artworkUrl100 || '')
              .replace('100x100bb', '600x600bb')
              .replace('60x60bb', '600x600bb');

            return {
              title: candTitle,
              artist: candArtist,
              album: candAlbum,
              artworkUrl: highResArtwork,
              genre: candidate.primaryGenreName,
              year: candidate.releaseDate ? new Date(candidate.releaseDate).getFullYear() : undefined,
              trackNumber: candidate.trackNumber,
              isConfidenceHigh: true,
              source: 'iTunes',
              matchScore: combinedScore,
            };
          }
        }
      } catch (err) {
        console.warn('[MetadataResolver] iTunes query error:', err);
      }
    }

    return null;
  }

  /**
   * Queries online catalogs (JioSaavn & iTunes) with strict confidence threshold.
   * Only returns metadata when confidence score is >= 0.75.
   */
  public static async queryOnlineCatalog(
    title: string,
    artist?: string,
    album?: string,
    isrc?: string
  ): Promise<ResolvedOnlineMatch | null> {
    // 1. Try JioSaavn first (top Indian & global catalogue accuracy)
    const saavnMatch = await this.queryJioSaavnCatalog(title, artist, album);
    if (saavnMatch && saavnMatch.isConfidenceHigh) {
      return saavnMatch;
    }

    // 2. Try iTunes
    const itunesMatch = await this.queryITunesCatalog(title, artist, album, isrc);
    if (itunesMatch && itunesMatch.isConfidenceHigh) {
      return itunesMatch;
    }

    return null;
  }

  /**
   * Main entry point: Resolves metadata for an audio file with strict priority.
   */
  public static async resolveTrack(
    file: File | Blob,
    filename: string,
    defaultArtwork: string
  ): Promise<ResolvedTrackMetadata> {
    // 1. Extract embedded metadata
    const embedded = await this.extractEmbeddedMetadata(file, filename);

    // 2. If embedded metadata has complete title, artist, and embedded cover art -> Use directly!
    if (embedded.title && embedded.artist && embedded.artist !== 'Unknown Artist' && embedded.artworkDataUrl) {
      return {
        title: embedded.title,
        artist: embedded.artist,
        album: embedded.album || 'Local Library',
        genre: embedded.genre,
        year: embedded.year,
        trackNumber: embedded.trackNumber,
        isrc: embedded.isrc,
        artworkUrl: embedded.artworkDataUrl,
        isConfidenceHigh: true,
        source: 'embedded',
      };
    }

    // 3. Clean filename fallback
    const { artist: fnArtist, title: fnTitle } = this.cleanFilename(filename);
    const candidateTitle = embedded.title || fnTitle || filename.replace(/\.[^/.]+$/, '');
    const candidateArtist = embedded.artist || fnArtist || 'Unknown Artist';
    const candidateAlbum = embedded.album || 'Local Library';

    // 4. If artwork is missing or metadata is incomplete, query online catalog
    try {
      const match = await this.queryOnlineCatalog(
        candidateTitle,
        candidateArtist !== 'Unknown Artist' ? candidateArtist : undefined,
        embedded.album,
        embedded.isrc
      );

      if (match && match.isConfidenceHigh && match.artworkUrl) {
        const localDataUrl = await this.fetchArtworkAsDataUrl(match.artworkUrl);

        return {
          title: match.title || candidateTitle,
          artist: match.artist || candidateArtist,
          album: match.album || candidateAlbum,
          genre: match.genre || embedded.genre,
          year: match.year || embedded.year,
          trackNumber: match.trackNumber || embedded.trackNumber,
          isrc: embedded.isrc,
          artworkUrl: localDataUrl || match.artworkUrl,
          isConfidenceHigh: true,
          source: match.source === 'JioSaavn' ? 'online-jiosaavn' : 'online-itunes',
        };
      }
    } catch (err) {
      console.warn('[MetadataResolver] Failed to resolve online metadata:', err);
    }

    // 5. Fallback to embedded or filename
    return {
      title: candidateTitle,
      artist: candidateArtist,
      album: candidateAlbum,
      genre: embedded.genre,
      year: embedded.year,
      trackNumber: embedded.trackNumber,
      isrc: embedded.isrc,
      artworkUrl: embedded.artworkDataUrl || defaultArtwork,
      isConfidenceHigh: Boolean(embedded.title && embedded.artist),
      source: embedded.title ? 'embedded' : 'filename',
    };
  }
}
