import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Upload,
  X,
  Music,
  Sparkles,
  Layers,
  Trash2,
  Globe,
  Loader2,
  ArrowLeft,
  Image as ImageIcon,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  Check,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { STUXSUploadService, type TrackDraftMetadata, type SongRow } from '../../services/STUXSUploadService';
import { backButtonManager } from '../../services/backButtonManager';
import { BRANDING_CONFIG } from '../../config/branding';

interface DeveloperUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTrackPublished?: () => void;
}

type ModalView = 'select' | 'analyzing' | 'confirm' | 'draft_success' | 'manage';

const LANGUAGE_OPTIONS = [
  'Hindi',
  'Tamil',
  'Telugu',
  'Punjabi',
  'Bengali',
  'Malayalam',
  'Kannada',
  'Marathi',
  'English',
  'Other',
];

export const DeveloperUploadModal: React.FC<DeveloperUploadModalProps> = ({
  isOpen,
  onClose,
  onTrackPublished,
}) => {
  const { user, isDeveloper } = useAuth();
  const { showToast } = useToast();

  const [currentView, setCurrentView] = useState<ModalView>('select');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [draftMeta, setDraftMeta] = useState<TrackDraftMetadata | null>(null);
  const [uploadedTrackId, setUploadedTrackId] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusText, setUploadStatusText] = useState('');
  const [active, setActive] = useState(false);

  // Duplicate Warning Modal state
  const [duplicateWarning, setDuplicateWarning] = useState<boolean>(false);
  const [pendingUploadMeta, setPendingUploadMeta] = useState<TrackDraftMetadata | null>(null);

  // Publish & Delete Confirmation Dialogs
  const [confirmPublishId, setConfirmPublishId] = useState<string | null>(null);
  const [confirmDeleteTrack, setConfirmDeleteTrack] = useState<SongRow | null>(null);

  // Manage catalog state
  const [catalogTab, setCatalogTab] = useState<'drafts' | 'published'>('drafts');
  const [catalogList, setCatalogList] = useState<SongRow[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortController = useRef<boolean>(false);

  const handleAnimatedClose = useCallback(() => {
    setActive(false);
    setTimeout(() => {
      setSelectedFile(null);
      setDraftMeta(null);
      setUploadedTrackId(null);
      setDuplicateWarning(false);
      setConfirmPublishId(null);
      setConfirmDeleteTrack(null);
      setIsUploading(false);
      setCurrentView('select');
      onClose();
    }, 240);
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setActive(true);
      }, 20);
      return () => clearTimeout(timer);
    } else {
      setActive(false);
    }
  }, [isOpen]);

  // Back button integration
  useEffect(() => {
    if (!isOpen) return;
    return backButtonManager.register(
      'developer-upload-modal',
      () => {
        if (duplicateWarning) {
          setDuplicateWarning(false);
        } else if (confirmPublishId) {
          setConfirmPublishId(null);
        } else if (confirmDeleteTrack) {
          setConfirmDeleteTrack(null);
        } else if (currentView !== 'select') {
          setCurrentView('select');
        } else {
          handleAnimatedClose();
        }
      },
      35
    );
  }, [isOpen, duplicateWarning, confirmPublishId, confirmDeleteTrack, currentView, handleAnimatedClose]);

  // Load developer catalog
  const loadCatalog = useCallback(async () => {
    setIsLoadingCatalog(true);
    try {
      const tracks = await STUXSUploadService.getDeveloperCatalog();
      setCatalogList(tracks);
    } catch {
      showToast('Failed to load catalog', 'error');
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (isOpen && currentView === 'manage') {
      loadCatalog();
    }
  }, [isOpen, currentView, loadCatalog]);

  if (!isOpen || !isDeveloper) return null;

  // Format file size
  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown size';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  // Format seconds to mm:ss
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 1. Handle File Selection -> Read Local Metadata -> Enrich with Providers -> Show Review First
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size === 0) {
      showToast('Selected audio file is empty or corrupted', 'error');
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      showToast(`Audio file exceeds 100 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB)`, 'error');
      return;
    }

    const validExtensions = ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'wav'];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!validExtensions.includes(ext) && !file.type.startsWith('audio/')) {
      showToast('Please select a supported audio format (MP3, M4A, AAC, FLAC, OGG, WAV)', 'error');
      return;
    }

    if (/\.preview\./i.test(file.name) || /-preview\./i.test(file.name)) {
      showToast('Preview clips cannot be uploaded as full tracks', 'error');
      return;
    }

    setSelectedFile(file);
    uploadAbortController.current = false;
    setCurrentView('analyzing');
    setUploadProgress(35);
    setUploadStatusText('Reading local audio metadata & embedded artwork...');

    try {
      // Step 1: Local ID3 extraction + Step 2: Provider enrichment lookup + Step 3: Smart merge
      setUploadProgress(60);
      setUploadStatusText('Enriching metadata with music providers...');
      const meta = await STUXSUploadService.analyzeAudioFile(file);
      setDraftMeta(meta);

      // Check for duplicate with album context
      const isDuplicate = await STUXSUploadService.checkDuplicate(meta.title, meta.artist, meta.album);
      if (isDuplicate) {
        setPendingUploadMeta(meta);
        setDuplicateWarning(true);
        return;
      }

      // Show the pre-filled metadata preview screen FIRST
      setCurrentView('confirm');
      if (meta.isProviderEnriched) {
        showToast(`Metadata enriched via ${meta.enrichmentSource}`, 'success');
      } else {
        showToast('Local embedded metadata extracted', 'success');
      }
    } catch (err: any) {
      console.error('[DeveloperUploadModal] Processing error:', err);
      showToast(err.message || 'Failed to process audio file', 'error');
      setCurrentView('select');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 2. Perform Final Audio & Artwork Upload to Storage & Database
  const handleStartUpload = async () => {
    if (!user || !selectedFile || !draftMeta) return;

    setIsUploading(true);
    uploadAbortController.current = false;
    setCurrentView('analyzing');
    setUploadProgress(15);
    setUploadStatusText('Uploading audio file to STUXS Storage...');

    try {
      const result = await STUXSUploadService.uploadTrack(
        selectedFile,
        draftMeta,
        user.id,
        (pct, status) => {
          if (!uploadAbortController.current) {
            setUploadProgress(pct);
            setUploadStatusText(status);
          }
        }
      );

      if (uploadAbortController.current) {
        showToast('Upload cancelled', 'info');
        setCurrentView('confirm');
        setIsUploading(false);
        return;
      }

      if (result.success && result.trackId) {
        setUploadedTrackId(result.trackId);
        setCurrentView('draft_success');
        showToast('Song uploaded successfully (Status: DRAFT)', 'success');
      } else {
        showToast(result.error || 'Upload failed. Please try again.', 'error');
        setCurrentView('confirm');
      }
    } catch (err: any) {
      showToast(err.message || 'Upload failed. Please try again.', 'error');
      setCurrentView('confirm');
    } finally {
      setIsUploading(false);
    }
  };

  // Cancel in-flight upload
  const handleCancelUpload = () => {
    uploadAbortController.current = true;
    setIsUploading(false);
    setCurrentView('confirm');
    showToast('Upload cancelled', 'info');
  };

  // Handle Cover Art Replace
  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !draftMeta) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select a valid image file', 'error');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast('Artwork image must be under 10 MB', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setDraftMeta({ ...draftMeta, artworkDataUrl: reader.result as string });
      showToast('Custom artwork selected', 'success');
    };
    reader.readAsDataURL(file);
  };

  // Handle Cover Art Remove
  const handleRemoveCover = () => {
    if (!draftMeta) return;
    setDraftMeta({ ...draftMeta, artworkDataUrl: null });
    showToast('Artwork removed', 'info');
  };

  // Confirm and Publish Track to Live Catalog
  const handleConfirmPublish = async () => {
    const trackIdToPublish = confirmPublishId || uploadedTrackId;
    if (!trackIdToPublish) return;

    setIsPublishing(true);
    try {
      if (draftMeta && uploadedTrackId === trackIdToPublish) {
        await STUXSUploadService.updateTrack(trackIdToPublish, draftMeta);
      }

      const { success, error } = await STUXSUploadService.publishTrack(trackIdToPublish);
      if (!success) throw new Error(error);

      showToast('Published to STUXS Catalog! Available to all users.', 'success');
      setConfirmPublishId(null);
      onTrackPublished?.();
      handleAnimatedClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to publish track', 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  // Delete Track Confirmation Action
  const handleConfirmDelete = async () => {
    if (!confirmDeleteTrack) return;
    try {
      await STUXSUploadService.deleteTrack(
        confirmDeleteTrack.id,
        confirmDeleteTrack.audio_storage_path || undefined
      );
      showToast(`Deleted "${confirmDeleteTrack.title}"`, 'success');
      setConfirmDeleteTrack(null);
      loadCatalog();
    } catch {
      showToast('Failed to delete track', 'error');
    }
  };

  // Toggle Publish / Unpublish from Catalog
  const handleTogglePublish = async (track: SongRow) => {
    try {
      if (track.is_published) {
        await STUXSUploadService.unpublishTrack(track.id);
        showToast(`Unpublished "${track.title}"`, 'info');
      } else {
        await STUXSUploadService.publishTrack(track.id);
        showToast(`Published "${track.title}"`, 'success');
      }
      loadCatalog();
    } catch {
      showToast('Action failed', 'error');
    }
  };

  const draftsList = catalogList.filter((t) => !t.is_published);
  const publishedList = catalogList.filter((t) => t.is_published);
  const activeCatalogList = catalogTab === 'drafts' ? draftsList : publishedList;

  return createPortal(
    <>
      {/* Dim Scrim Backdrop */}
      <div
        onClick={handleAnimatedClose}
        className={`fixed inset-0 z-[999] bg-black/50 transition-opacity duration-240 ${
          active ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Bottom Sheet Container: slides upward from bottom */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`fixed inset-x-0 bottom-0 z-[1000] w-full max-w-lg mx-auto bg-stuxs-surface border-t sm:border border-stuxs-border rounded-t-[32px] sm:rounded-3xl p-6 shadow-2xl transition-all select-none will-change-transform flex flex-col max-h-[90vh] text-left ${
          active ? 'duration-300' : 'duration-240'
        }`}
        style={{
          transform: active ? 'translate3d(0, 0, 0)' : 'translate3d(0, 100%, 0)',
          opacity: active ? 1 : 0,
          transitionTimingFunction: active ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.3, 0, 0.8, 0.15)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 16px), var(--safe-area-inset-bottom, 16px), 16px)',
        }}
      >
        {/* Mobile drag pill */}
        <div className="sm:hidden flex justify-center -mt-2 pb-3">
          <div className="w-9 h-1 rounded-full bg-stuxs-text-muted/30" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-stuxs-border/60">
          <div className="flex items-center space-x-2">
            {currentView !== 'select' && (
              <button
                onClick={() => setCurrentView('select')}
                className="p-1 -ml-1 text-stuxs-text-muted hover:text-stuxs-text transition-colors cursor-pointer"
                aria-label="Back"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="w-7 h-7 rounded-lg bg-stuxs-accent/15 flex items-center justify-center text-stuxs-accent">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-stuxs-text">
                {currentView === 'manage' ? 'Developer Catalog' : 'Upload Song to STUXS'}
              </h3>
              <p className="text-[10px] text-stuxs-accent font-bold uppercase tracking-wider">
                Authorized STUXS Developer
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {currentView === 'select' && (
              <button
                onClick={() => setCurrentView('manage')}
                className="px-2.5 py-1 rounded-xl bg-stuxs-surface-secondary hover:bg-stuxs-surface-hover text-xs font-semibold text-stuxs-text flex items-center space-x-1.5 transition-colors cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>My Uploads</span>
              </button>
            )}
            <button
              onClick={handleAnimatedClose}
              className="p-1 rounded-full text-stuxs-text-muted hover:text-stuxs-text cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Hidden inputs */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="audio/mp3,audio/mpeg,audio/x-m4a,audio/aac,audio/flac,audio/ogg,audio/wav"
          className="hidden"
        />
        <input
          type="file"
          ref={coverInputRef}
          onChange={handleCoverChange}
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
        />

        {/* VIEW 1: SELECT AUDIO FILE */}
        {currentView === 'select' && (
          <div className="py-6 space-y-5 text-center">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-stuxs-border hover:border-stuxs-accent/60 rounded-3xl p-8 flex flex-col items-center justify-center space-y-3 bg-stuxs-surface-secondary/40 hover:bg-stuxs-surface-secondary transition-all cursor-pointer group"
            >
              <div className="w-16 h-16 rounded-2xl bg-stuxs-accent/10 border border-stuxs-accent/25 flex items-center justify-center text-stuxs-accent group-hover:scale-110 transition-transform">
                <Upload className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-stuxs-text">Choose Audio File to Upload</h4>
                <p className="text-xs text-stuxs-text-muted mt-1">
                  Supports MP3, M4A, AAC, WAV, FLAC, and OGG
                </p>
              </div>
              <span className="px-4 py-1.5 rounded-full bg-stuxs-accent text-white text-xs font-bold shadow-stuxs-glow">
                Select Audio File
              </span>
            </div>

            <div className="text-[11px] text-stuxs-text-muted flex items-center justify-center space-x-2">
              <Sparkles className="w-3.5 h-3.5 text-stuxs-accent" />
              <span>Automatic ID3 extraction & multi-provider metadata enrichment</span>
            </div>
          </div>
        )}

        {/* VIEW 2: ANALYZING & UPLOADING PROGRESS */}
        {currentView === 'analyzing' && (
          <div className="py-10 space-y-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-stuxs-accent/15 border border-stuxs-accent/30 flex items-center justify-center text-stuxs-accent mx-auto animate-pulse">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-stuxs-text truncate max-w-xs mx-auto">
                {selectedFile?.name || 'Processing Audio File...'}
              </h4>
              <p className="text-xs text-stuxs-text-muted">
                {formatFileSize(selectedFile?.size)} • {selectedFile?.name.split('.').pop()?.toUpperCase()}
              </p>
              <p className="text-xs text-stuxs-accent font-semibold pt-1">{uploadStatusText}</p>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-stuxs-surface-secondary rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-stuxs-accent h-full transition-all duration-300 rounded-full"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-stuxs-text-muted font-mono px-1">
              <span>{uploadStatusText}</span>
              <span>{uploadProgress}%</span>
            </div>

            {isUploading && (
              <button
                onClick={handleCancelUpload}
                className="px-4 py-1.5 rounded-xl bg-stuxs-surface-secondary hover:bg-stuxs-surface-hover text-xs font-semibold text-stuxs-text-muted hover:text-stuxs-text transition-colors"
              >
                Cancel Upload
              </button>
            )}
          </div>
        )}

        {/* VIEW 3: DRAFT CREATED SUCCESS SCREEN */}
        {currentView === 'draft_success' && draftMeta && (
          <div className="py-6 space-y-5 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-base font-bold text-stuxs-text">Song Uploaded Successfully!</h4>
              <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[11px] font-bold mt-2">
                <span>Status: DRAFT (Unpublished)</span>
              </div>
              <p className="text-xs text-stuxs-text-muted mt-2">
                This song is saved as a draft and is invisible to normal users until published.
              </p>
            </div>

            {/* Preview Card */}
            <div className="flex items-center space-x-3.5 p-3 rounded-2xl bg-stuxs-surface-secondary/80 border border-stuxs-border text-left">
              <img
                src={draftMeta.artworkDataUrl || BRANDING_CONFIG.appLogo}
                alt={draftMeta.title}
                className="w-14 h-14 rounded-xl object-cover border border-stuxs-border flex-shrink-0"
              />
              <div className="min-w-0 flex-1">
                <h5 className="text-sm font-bold text-stuxs-text truncate">{draftMeta.title}</h5>
                <p className="text-xs text-stuxs-text-secondary truncate">{draftMeta.artist}</p>
                <div className="flex items-center space-x-2 text-[10px] text-stuxs-text-muted mt-0.5">
                  <span>{draftMeta.album}</span>
                  <span>•</span>
                  <span>{formatDuration(draftMeta.duration)}</span>
                  <span>•</span>
                  <span>{draftMeta.language}</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center space-x-2.5 pt-2">
              <button
                onClick={() => setCurrentView('confirm')}
                className="flex-1 py-2.5 rounded-xl bg-stuxs-surface-secondary hover:bg-stuxs-surface-hover text-stuxs-text text-xs font-bold transition-colors flex items-center justify-center space-x-1.5"
              >
                <Edit3 className="w-4 h-4" />
                <span>Edit Metadata</span>
              </button>
              <button
                onClick={() => setConfirmPublishId(uploadedTrackId)}
                className="flex-1 py-2.5 rounded-xl bg-stuxs-accent hover:opacity-90 text-white text-xs font-bold shadow-stuxs-glow transition-all flex items-center justify-center space-x-1.5"
              >
                <Globe className="w-4 h-4" />
                <span>Publish Song</span>
              </button>
            </div>
          </div>
        )}

        {/* VIEW 4: AUTOMATIC METADATA & PROVIDER ENRICHMENT REVIEW BEFORE UPLOAD */}
        {currentView === 'confirm' && draftMeta && (
          <div className="flex-1 overflow-y-auto py-4 space-y-4 text-xs pr-1">
            {/* Top Preview Card */}
            <div className="p-3.5 rounded-2xl bg-stuxs-surface-secondary/70 border border-stuxs-border space-y-3">
              <div className="flex items-center space-x-4">
                <div className="relative group flex-shrink-0">
                  {draftMeta.artworkDataUrl ? (
                    <img
                      src={draftMeta.artworkDataUrl}
                      alt={draftMeta.title}
                      className="w-16 h-16 rounded-xl object-cover shadow-md border border-stuxs-border"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-stuxs-surface border border-dashed border-stuxs-border flex flex-col items-center justify-center text-stuxs-text-muted p-1 text-center">
                      <ImageIcon className="w-5 h-5 text-stuxs-text-muted/60" />
                      <span className="text-[9px] mt-0.5 leading-tight">No artwork found</span>
                    </div>
                  )}
                  <div
                    onClick={() => coverInputRef.current?.click()}
                    className="absolute inset-0 bg-black/50 rounded-xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white cursor-pointer"
                  >
                    <ImageIcon className="w-5 h-5" />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    {draftMeta.isProviderEnriched ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
                        <Sparkles className="w-3 h-3 text-emerald-400" />
                        <span>Enriched via {draftMeta.enrichmentSource}</span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/25">
                        Embedded ID3 Tag
                      </span>
                    )}
                    <span className="text-[11px] text-stuxs-text-muted font-mono">
                      {formatDuration(draftMeta.duration)}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-stuxs-text truncate mt-1">{draftMeta.title || 'Untitled'}</h4>
                  <p className="text-xs text-stuxs-text-secondary truncate">{draftMeta.artist || 'Unknown Artist'}</p>
                </div>
              </div>

              {/* Artwork action pills */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-stuxs-border/40">
                {draftMeta.providerArtworkUrl && (
                  <button
                    type="button"
                    onClick={() => setDraftMeta({ ...draftMeta, artworkDataUrl: draftMeta.providerArtworkUrl })}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer flex items-center space-x-1 ${
                      draftMeta.artworkDataUrl === draftMeta.providerArtworkUrl
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : 'bg-stuxs-surface hover:bg-stuxs-surface-hover text-stuxs-text border-stuxs-border'
                    }`}
                  >
                    <Sparkles className="w-3 h-3 text-emerald-400" />
                    <span>Provider High-Res</span>
                  </button>
                )}
                {draftMeta.embeddedArtworkDataUrl && (
                  <button
                    type="button"
                    onClick={() => setDraftMeta({ ...draftMeta, artworkDataUrl: draftMeta.embeddedArtworkDataUrl })}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer flex items-center space-x-1 ${
                      draftMeta.artworkDataUrl === draftMeta.embeddedArtworkDataUrl
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                        : 'bg-stuxs-surface hover:bg-stuxs-surface-hover text-stuxs-text border-stuxs-border'
                    }`}
                  >
                    <Music className="w-3 h-3 text-purple-400" />
                    <span>Embedded Art</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  className="px-2.5 py-1 rounded-lg bg-stuxs-surface hover:bg-stuxs-surface-hover text-[11px] font-semibold text-stuxs-text border border-stuxs-border cursor-pointer flex items-center space-x-1"
                >
                  <ImageIcon className="w-3 h-3 text-stuxs-accent" />
                  <span>Custom Art</span>
                </button>
                {draftMeta.artworkDataUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveCover}
                    className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-[11px] font-semibold text-rose-300 border border-rose-500/20 cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {/* Editable Fields Form (Pre-filled from enriched / embedded metadata) */}
            <div className="space-y-3 text-left">
              <div>
                <label className="text-[11px] font-semibold text-stuxs-text-secondary block mb-1">
                  Track Title *
                </label>
                <input
                  type="text"
                  value={draftMeta.title}
                  onChange={(e) => setDraftMeta({ ...draftMeta, title: e.target.value })}
                  placeholder="e.g. Jikade Tikade"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border text-stuxs-text text-xs focus:outline-none focus:border-stuxs-accent"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-stuxs-text-secondary block mb-1">
                    Artist Name *
                  </label>
                  <input
                    type="text"
                    value={draftMeta.artist}
                    onChange={(e) => setDraftMeta({ ...draftMeta, artist: e.target.value })}
                    placeholder="e.g. Anirudh Ravichander"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border text-stuxs-text text-xs focus:outline-none focus:border-stuxs-accent"
                    required
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-stuxs-text-secondary block mb-1">
                    Album Name
                  </label>
                  <input
                    type="text"
                    value={draftMeta.album}
                    onChange={(e) => setDraftMeta({ ...draftMeta, album: e.target.value })}
                    placeholder="e.g. Coolie"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border text-stuxs-text text-xs focus:outline-none focus:border-stuxs-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-stuxs-text-secondary block mb-1">
                    Album Artist
                  </label>
                  <input
                    type="text"
                    value={draftMeta.albumArtist || ''}
                    onChange={(e) => setDraftMeta({ ...draftMeta, albumArtist: e.target.value })}
                    placeholder="e.g. Anirudh Ravichander"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border text-stuxs-text text-xs focus:outline-none focus:border-stuxs-accent"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-stuxs-text-secondary block mb-1">
                    Language
                  </label>
                  <select
                    value={draftMeta.language || 'Hindi'}
                    onChange={(e) => setDraftMeta({ ...draftMeta, language: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border text-stuxs-text text-xs focus:outline-none focus:border-stuxs-accent"
                  >
                    {LANGUAGE_OPTIONS.map((lang) => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-stuxs-text-secondary block mb-1">
                    Genre
                  </label>
                  <input
                    type="text"
                    value={draftMeta.genre || ''}
                    onChange={(e) => setDraftMeta({ ...draftMeta, genre: e.target.value })}
                    placeholder="e.g. Soundtrack"
                    className="w-full px-2.5 py-2 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border text-stuxs-text text-xs focus:outline-none focus:border-stuxs-accent"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-stuxs-text-secondary block mb-1">
                    Release Year
                  </label>
                  <input
                    type="number"
                    value={draftMeta.releaseYear || new Date().getFullYear()}
                    onChange={(e) => setDraftMeta({ ...draftMeta, releaseYear: parseInt(e.target.value, 10) || 2025 })}
                    className="w-full px-2.5 py-2 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border text-stuxs-text text-xs focus:outline-none focus:border-stuxs-accent"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-stuxs-text-secondary block mb-1">
                    Track #
                  </label>
                  <input
                    type="number"
                    value={draftMeta.trackNumber || 1}
                    onChange={(e) => setDraftMeta({ ...draftMeta, trackNumber: parseInt(e.target.value, 10) || 1 })}
                    className="w-full px-2.5 py-2 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border text-stuxs-text text-xs focus:outline-none focus:border-stuxs-accent"
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-3 pt-3 border-t border-stuxs-border/60">
              <button
                type="button"
                onClick={() => setCurrentView('select')}
                className="flex-1 py-2.5 rounded-xl bg-stuxs-surface-secondary hover:bg-stuxs-surface-hover text-stuxs-text font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUploading || !draftMeta.title.trim() || !draftMeta.artist.trim()}
                onClick={handleStartUpload}
                className="flex-1 py-2.5 rounded-xl bg-stuxs-accent hover:opacity-90 disabled:opacity-50 text-white font-bold shadow-stuxs-glow transition-all active:scale-95 flex items-center justify-center space-x-1.5 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Upload Song</span>
              </button>
            </div>
          </div>
        )}

        {/* VIEW 5: MANAGE CATALOG / MY UPLOADS */}
        {currentView === 'manage' && (
          <div className="flex-1 flex flex-col min-h-0 pt-2 text-xs">
            {/* Status Tabs */}
            <div className="flex items-center space-x-2 pb-3 border-b border-stuxs-border/60">
              <button
                onClick={() => setCatalogTab('drafts')}
                className={`flex-1 py-1.5 rounded-xl font-bold transition-all text-xs flex items-center justify-center space-x-1.5 ${
                  catalogTab === 'drafts'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-stuxs-surface-secondary text-stuxs-text-muted hover:text-stuxs-text'
                }`}
              >
                <span>Drafts</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/30 font-mono">
                  {draftsList.length}
                </span>
              </button>
              <button
                onClick={() => setCatalogTab('published')}
                className={`flex-1 py-1.5 rounded-xl font-bold transition-all text-xs flex items-center justify-center space-x-1.5 ${
                  catalogTab === 'published'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-stuxs-surface-secondary text-stuxs-text-muted hover:text-stuxs-text'
                }`}
              >
                <span>Published</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/30 font-mono">
                  {publishedList.length}
                </span>
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto py-3 space-y-2.5 pr-1">
              {isLoadingCatalog ? (
                <div className="py-12 text-center text-stuxs-text-muted flex flex-col items-center justify-center space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin text-stuxs-accent" />
                  <span>Loading Catalog...</span>
                </div>
              ) : activeCatalogList.length === 0 ? (
                <div className="py-12 text-center text-stuxs-text-muted space-y-2">
                  <Music className="w-8 h-8 mx-auto text-stuxs-text-muted/40" />
                  <p>No {catalogTab} tracks found.</p>
                  {catalogTab === 'drafts' && (
                    <button
                      onClick={() => setCurrentView('select')}
                      className="px-3 py-1.5 rounded-xl bg-stuxs-accent text-white font-bold text-xs shadow-stuxs-glow mt-1"
                    >
                      Upload A Song
                    </button>
                  )}
                </div>
              ) : (
                activeCatalogList.map((track) => (
                  <div
                    key={track.id}
                    className="p-3 rounded-2xl bg-stuxs-surface-secondary/70 border border-stuxs-border space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3 min-w-0 flex-1 mr-2">
                        <img
                          src={track.artwork_url || BRANDING_CONFIG.appLogo}
                          alt={track.title}
                          className="w-11 h-11 rounded-xl object-cover flex-shrink-0 border border-stuxs-border"
                        />
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex items-center space-x-1.5">
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                                track.is_published
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              }`}
                            >
                              {track.is_published ? 'Published' : 'Draft'}
                            </span>
                            <span className="text-[10px] text-stuxs-text-muted">
                              {formatDuration(track.duration)}
                            </span>
                            {track.language && (
                              <span className="text-[10px] text-stuxs-text-muted">
                                • {track.language}
                              </span>
                            )}
                          </div>
                          <h4 className="text-xs font-bold text-stuxs-text truncate mt-0.5">{track.title}</h4>
                          <p className="text-[11px] text-stuxs-text-secondary truncate">{track.artist_name || 'STUXS Artist'}</p>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center space-x-1.5 flex-shrink-0">
                        <button
                          onClick={() => {
                            if (track.is_published) {
                              handleTogglePublish(track);
                            } else {
                              setConfirmPublishId(track.id);
                            }
                          }}
                          className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all ${
                            track.is_published
                              ? 'bg-stuxs-surface hover:bg-stuxs-surface-hover text-stuxs-text border border-stuxs-border'
                              : 'bg-stuxs-accent hover:opacity-90 text-white shadow-stuxs-glow'
                          }`}
                        >
                          {track.is_published ? 'Unpublish' : 'Publish'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteTrack(track)}
                          className="p-1.5 rounded-xl text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
                          aria-label="Delete track"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* DIALOG 1: DUPLICATE DETECTION WARNING */}
        {duplicateWarning && pendingUploadMeta && (
          <div className="fixed inset-0 z-[1001] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="w-full max-w-sm bg-stuxs-surface border border-stuxs-border rounded-3xl p-5 space-y-4 shadow-2xl text-center">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-stuxs-text">Duplicate Song Detected</h4>
                <p className="text-xs text-stuxs-text-muted mt-1">
                  A track titled <span className="text-stuxs-text font-bold">"{pendingUploadMeta.title}"</span> by <span className="text-stuxs-text font-bold">{pendingUploadMeta.artist}</span> has already been uploaded to STUXS Music.
                </p>
              </div>
              <div className="flex items-center space-x-2 pt-1">
                <button
                  onClick={() => {
                    setDuplicateWarning(false);
                    setCurrentView('select');
                  }}
                  className="flex-1 py-2 rounded-xl bg-stuxs-surface-secondary text-stuxs-text text-xs font-bold hover:bg-stuxs-surface-hover"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setDuplicateWarning(false);
                    setCurrentView('confirm');
                  }}
                  className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-black text-xs font-bold"
                >
                  Continue Anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DIALOG 2: CONFIRM PUBLISH DIALOG */}
        {confirmPublishId && (
          <div className="fixed inset-0 z-[1001] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="w-full max-w-sm bg-stuxs-surface border border-stuxs-border rounded-3xl p-5 space-y-4 shadow-2xl text-center">
              <div className="w-12 h-12 rounded-2xl bg-stuxs-accent/15 border border-stuxs-accent/30 flex items-center justify-center text-stuxs-accent mx-auto">
                <Globe className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-stuxs-text">Publish to STUXS Catalog?</h4>
                <p className="text-xs text-stuxs-text-muted mt-1">
                  This will make the song available to all STUXS Music users in search, discovery, and albums.
                </p>
              </div>
              <div className="flex items-center space-x-2 pt-1">
                <button
                  disabled={isPublishing}
                  onClick={() => setConfirmPublishId(null)}
                  className="flex-1 py-2 rounded-xl bg-stuxs-surface-secondary text-stuxs-text text-xs font-bold hover:bg-stuxs-surface-hover disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  disabled={isPublishing}
                  onClick={handleConfirmPublish}
                  className="flex-1 py-2 rounded-xl bg-stuxs-accent hover:opacity-90 text-white text-xs font-bold shadow-stuxs-glow flex items-center justify-center space-x-1 disabled:opacity-50"
                >
                  {isPublishing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Publish</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DIALOG 3: CONFIRM DELETE DIALOG */}
        {confirmDeleteTrack && (
          <div className="fixed inset-0 z-[1001] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="w-full max-w-sm bg-stuxs-surface border border-stuxs-border rounded-3xl p-5 space-y-4 shadow-2xl text-center">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mx-auto">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-stuxs-text">Delete this song?</h4>
                <p className="text-xs text-stuxs-text-muted mt-1">
                  This will permanently remove the audio, artwork, and catalog record for <span className="text-stuxs-text font-bold">"${confirmDeleteTrack.title}"</span>.
                </p>
              </div>
              <div className="flex items-center space-x-2 pt-1">
                <button
                  onClick={() => setConfirmDeleteTrack(null)}
                  className="flex-1 py-2 rounded-xl bg-stuxs-surface-secondary text-stuxs-text text-xs font-bold hover:bg-stuxs-surface-hover"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="flex-1 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body
  );
};

export default DeveloperUploadModal;


