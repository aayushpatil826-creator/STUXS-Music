import React from 'react';
import { X, ShieldAlert, CheckCircle2, Radio, ExternalLink } from 'lucide-react';
import type { ProviderType } from '../../types/music';

interface ConnectProviderModalProps {
  providerId: ProviderType | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectProviderModal: React.FC<ConnectProviderModalProps> = ({
  providerId,
  isOpen,
  onClose,
}) => {
  if (!isOpen || !providerId) return null;

  const providerDetails: Record<
    ProviderType,
    { name: string; description: string; requiresKey: boolean; envKey: string; docUrl: string; authMethod: string }
  > = {
    stuxs: {
      name: 'STUXS Core',
      description: 'Default integrated lossless music catalog & audio engine.',
      requiresKey: false,
      envKey: '',
      docUrl: '',
      authMethod: 'Built-in',
    },
    spotify: {
      name: 'Spotify Web API',
      description: 'Requires official Spotify Developer App Client ID & OAuth scopes for user playback.',
      requiresKey: true,
      envKey: 'SPOTIFY_CLIENT_ID & SPOTIFY_CLIENT_SECRET (Edge Secret)',
      docUrl: 'https://developer.spotify.com/documentation/web-api',
      authMethod: 'OAuth 2.0 PKCE / Authorization Code',
    },
    jiosaavn: {
      name: 'JioSaavn',
      description: 'Indian & Regional music provider with direct 320kbps streams.',
      requiresKey: false,
      envKey: 'VITE_JIOSAAVN_API_URL (Optional Self-Hosted)',
      docUrl: '',
      authMethod: 'Direct / Self-Hosted API Proxy',
    },
    gaana: {
      name: 'Gaana',
      description: 'Indian & Regional music provider (Tamil, Punjabi, Bengali, Hindi, Telugu, Marathi) with HLS streams.',
      requiresKey: false,
      envKey: 'VITE_GAANA_API_URL (Self-Hosted Mumbai Region)',
      docUrl: '',
      authMethod: 'Self-Hosted Unofficial API Proxy (Mumbai)',
    },
    itunes: {
      name: 'iTunes Store & Apple Catalog',
      description: 'Public search & 30-second high-fidelity preview stream integration active by default.',
      requiresKey: false,
      envKey: 'VITE_ITUNES_API_URL',
      docUrl: 'https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/',
      authMethod: 'Public REST API',
    },
    amazon: {
      name: 'Amazon Music Developer API',
      description: 'Requires Amazon Music Developer Portal client registration.',
      requiresKey: true,
      envKey: 'AMAZON_MUSIC_CLIENT_ID (Edge Secret)',
      docUrl: 'https://developer.amazon.com/music',
      authMethod: 'LWA OAuth 2.0',
    },
    local: {
      name: 'Local Device Music',
      description: 'Local audio files stored directly in device IndexedDB.',
      requiresKey: false,
      envKey: '',
      docUrl: '',
      authMethod: 'Device Storage',
    },
  };

  const details = providerDetails[providerId];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div
        className="w-full max-w-sm bg-stuxs-surface-secondary border border-stuxs-border rounded-3xl p-6 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-stuxs-border">
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-stuxs-accent" />
            <h3 className="text-base font-bold text-stuxs-text">{details.name}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-stuxs-text-muted hover:text-stuxs-text"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="pt-4 space-y-4 text-xs">
          <p className="text-stuxs-text-secondary leading-relaxed">
            {details.description}
          </p>

          <div className="p-3 rounded-xl bg-stuxs-surface border border-stuxs-border space-y-1">
            <span className="text-[10px] font-bold uppercase text-stuxs-text-muted">Auth Flow:</span>
            <p className="text-[11px] font-semibold text-stuxs-text">{details.authMethod}</p>
          </div>

          {details.requiresKey ? (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-300 space-y-1.5">
              <div className="flex items-center space-x-2 font-semibold">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                <span>Server-Side Secret Required</span>
              </div>
              <p className="text-[11px] text-amber-200/80 leading-normal">
                To activate, set <code className="px-1 py-0.5 rounded bg-black/40 font-mono text-[10px]">{details.envKey}</code> in your Supabase project secrets. Client secrets are never exposed to the client application.
              </p>
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 space-y-1.5">
              <div className="flex items-center space-x-2 font-semibold">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>Adapter Ready & Functional</span>
              </div>
              <p className="text-[11px] text-emerald-200/80 leading-normal">
                Live catalog querying and preview audio is enabled for this provider.
              </p>
            </div>
          )}

          {details.docUrl && (
            <a
              href={details.docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 rounded-xl bg-stuxs-surface hover:bg-stuxs-surface-hover transition-colors text-stuxs-text font-medium"
            >
              <span>Official Developer Documentation</span>
              <ExternalLink className="w-4 h-4 text-stuxs-text-secondary" />
            </a>
          )}

          <div className="pt-2">
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-stuxs-surface-tertiary hover:bg-stuxs-surface-hover text-stuxs-text font-semibold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
