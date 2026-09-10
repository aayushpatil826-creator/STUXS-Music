import React from 'react';

export const TrackRowSkeleton: React.FC = () => {
  return (
    <div className="flex items-center justify-between px-5 py-3 animate-pulse">
      <div className="flex items-center space-x-3.5 min-w-0 flex-1">
        <div className="w-12 h-12 rounded-lg bg-stuxs-surface-tertiary" />
        <div className="space-y-2 flex-1">
          <div className="h-3.5 bg-stuxs-surface-tertiary rounded w-2/3" />
          <div className="h-2.5 bg-stuxs-surface-secondary rounded w-1/3" />
        </div>
      </div>
      <div className="w-8 h-3 bg-stuxs-surface-secondary rounded" />
    </div>
  );
};

export const CardSkeleton: React.FC<{ shape?: 'square' | 'circle' }> = ({ shape = 'square' }) => {
  return (
    <div className="w-44 flex-shrink-0 animate-pulse space-y-2.5">
      <div
        className={`aspect-square bg-stuxs-surface-secondary ${
          shape === 'circle' ? 'rounded-full w-28 h-28 mx-auto' : 'rounded-2xl w-full'
        }`}
      />
      <div className="h-3.5 bg-stuxs-surface-tertiary rounded w-3/4 mx-auto" />
      <div className="h-2.5 bg-stuxs-surface-secondary rounded w-1/2 mx-auto" />
    </div>
  );
};

export const ScreenSkeleton: React.FC = () => {
  return (
    <div className="p-5 space-y-6 animate-pulse">
      <div className="h-8 bg-stuxs-surface-secondary rounded-xl w-1/2" />
      <div className="flex space-x-4 overflow-hidden">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <div className="h-6 bg-stuxs-surface-secondary rounded-lg w-1/3 pt-4" />
      <div className="space-y-2">
        <TrackRowSkeleton />
        <TrackRowSkeleton />
        <TrackRowSkeleton />
        <TrackRowSkeleton />
      </div>
    </div>
  );
};

export const ArtistScreenSkeleton: React.FC = () => {
  return (
    <div className="min-h-screen animate-pulse bg-stuxs-bg">
      {/* Hero Header Banner Skeleton */}
      <div className="relative h-72 sm:h-80 w-full bg-stuxs-surface-secondary">
        <div className="absolute safe-top-floating left-5 right-5 z-20 flex items-center justify-between">
          <div className="w-9 h-9 rounded-full bg-stuxs-surface-tertiary" />
          <div className="w-9 h-9 rounded-full bg-stuxs-surface-tertiary" />
        </div>
        <div className="absolute bottom-8 left-5 right-5 z-20 space-y-2">
          <div className="w-24 h-4 rounded-full bg-stuxs-surface-tertiary" />
          <div className="w-3/5 h-8 rounded-xl bg-stuxs-surface-tertiary" />
          <div className="w-32 h-3.5 rounded bg-stuxs-surface-tertiary" />
        </div>
      </div>

      {/* Sheet Content Skeleton */}
      <div className="rounded-t-[36px] -mt-6 relative z-10 bg-stuxs-bg px-4 sm:px-5 pt-6 pb-28 space-y-6">
        {/* Action bar */}
        <div className="flex items-center space-x-3 pb-3 border-b border-stuxs-border/30">
          <div className="w-12 h-12 rounded-full bg-stuxs-surface-secondary" />
          <div className="w-10 h-10 rounded-full bg-stuxs-surface-secondary" />
          <div className="w-24 h-9 rounded-full bg-stuxs-surface-secondary" />
        </div>

        {/* Popular tracks skeleton */}
        <div className="space-y-3">
          <div className="w-36 h-5 rounded-lg bg-stuxs-surface-secondary" />
          <div className="space-y-2">
            <TrackRowSkeleton />
            <TrackRowSkeleton />
            <TrackRowSkeleton />
            <TrackRowSkeleton />
            <TrackRowSkeleton />
          </div>
        </div>

        {/* Albums skeleton */}
        <div className="space-y-3 pt-2">
          <div className="w-28 h-5 rounded-lg bg-stuxs-surface-secondary" />
          <div className="flex space-x-4 overflow-hidden">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
};

export const AlbumScreenSkeleton: React.FC = () => {
  return (
    <div className="min-h-screen animate-pulse bg-stuxs-bg">
      {/* Top Header Placeholder */}
      <div className="sticky top-0 z-30 px-5 safe-top-header pb-3 flex items-center justify-between">
        <div className="w-9 h-9 rounded-full bg-stuxs-surface-secondary" />
        <div className="w-16 h-4 rounded bg-stuxs-surface-secondary" />
        <div className="w-9" />
      </div>

      {/* Album Hero Info Skeleton */}
      <div className="flex flex-col items-center text-center px-6 pt-2 pb-6 space-y-3">
        {/* Large Album Artwork Placeholder */}
        <div className="w-48 h-48 sm:w-56 sm:h-56 rounded-[28px] bg-stuxs-surface-secondary shadow-md" />

        <div className="w-48 h-7 rounded-xl bg-stuxs-surface-secondary mt-2" />
        <div className="w-32 h-4 rounded bg-stuxs-surface-secondary" />
        <div className="w-40 h-3 rounded bg-stuxs-surface-tertiary" />

        {/* Action Controls Skeleton */}
        <div className="flex items-center space-x-3.5 pt-2">
          <div className="w-24 h-10 rounded-full bg-stuxs-surface-secondary" />
          <div className="w-10 h-10 rounded-full bg-stuxs-surface-secondary" />
          <div className="w-10 h-10 rounded-full bg-stuxs-surface-secondary" />
        </div>
      </div>

      {/* Track List Sheet Skeleton */}
      <div className="rounded-t-[32px] sm:rounded-t-[36px] bg-stuxs-surface-secondary/20 min-h-[50vh] px-4 sm:px-5 pt-5 pb-28 space-y-2">
        <TrackRowSkeleton />
        <TrackRowSkeleton />
        <TrackRowSkeleton />
        <TrackRowSkeleton />
        <TrackRowSkeleton />
        <TrackRowSkeleton />
      </div>
    </div>
  );
};


