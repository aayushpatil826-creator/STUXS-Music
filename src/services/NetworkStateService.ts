/**
 * NetworkStateService — Lightweight, non-blocking network connectivity & quality tracker.
 *
 * Responsibilities:
 * - Detect ONLINE, OFFLINE, and ONLINE_BUT_SLOW states.
 * - Listen to window online/offline events.
 * - Record request latencies to identify degraded/slow network without making redundant network pings.
 * - Provide event subscriber mechanism for UI components (e.g. OfflineBanner).
 */

export type NetworkStatus = 'ONLINE' | 'OFFLINE' | 'ONLINE_BUT_SLOW';
export type NetworkState = NetworkStatus;

export type NetworkStateListener = (status: NetworkStatus) => void;

class NetworkStateService {
  private static instance: NetworkStateService;
  private status: NetworkStatus = 'ONLINE';
  private listeners: Set<NetworkStateListener> = new Set();
  private consecutiveTimeouts = 0;
  private recentLatencies: number[] = [];
  private maxLatencyHistory = 5;

  public static getInstance(): NetworkStateService {
    if (!NetworkStateService.instance) {
      NetworkStateService.instance = new NetworkStateService();
    }
    return NetworkStateService.instance;
  }

  private constructor() {
    if (typeof window !== 'undefined') {
      const initialOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
      this.status = initialOnline ? 'ONLINE' : 'OFFLINE';

      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  private handleOnline = () => {
    this.consecutiveTimeouts = 0;
    this.updateStatus('ONLINE');
  };

  private handleOffline = () => {
    this.updateStatus('OFFLINE');
  };

  private updateStatus(newStatus: NetworkStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.notifyListeners();
    }
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener(this.status);
      } catch (err) {
        console.warn('[NetworkStateService] Listener threw error:', err);
      }
    }
  }

  /**
   * Subscribe to network status changes.
   * Immediately calls listener with current status.
   */
  public subscribe(listener: NetworkStateListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private manualOverride = false;

  public getStatus(): NetworkStatus {
    // Dynamic check in browser environment if navigator.onLine explicitly reports offline
    if (
      !this.manualOverride &&
      typeof window !== 'undefined' &&
      typeof window.navigator !== 'undefined' &&
      window.navigator.onLine === false &&
      this.status !== 'OFFLINE'
    ) {
      this.status = 'OFFLINE';
    }
    return this.status;
  }

  public getState(): NetworkStatus {
    return this.getStatus();
  }

  public setOffline(): void {
    this.manualOverride = true;
    this.updateStatus('OFFLINE');
  }

  public setOnline(): void {
    this.manualOverride = true;
    this.consecutiveTimeouts = 0;
    this.recentLatencies = [];
    this.updateStatus('ONLINE');
  }

  public isOffline(): boolean {
    return this.getStatus() === 'OFFLINE';
  }

  public isOnline(): boolean {
    return this.getStatus() === 'ONLINE';
  }

  public isSlow(): boolean {
    return this.getStatus() === 'ONLINE_BUT_SLOW';
  }

  /**
   * Record a network request outcome to dynamically detect sluggish / degraded connections
   * without running dedicated ping probes.
   */
  public recordRequestLatency(latencyMs: number, timedOut = false): void {
    if (this.status === 'OFFLINE') return;

    if (timedOut) {
      this.consecutiveTimeouts++;
      if (this.consecutiveTimeouts >= 2) {
        this.updateStatus('ONLINE_BUT_SLOW');
      }
      return;
    }

    this.consecutiveTimeouts = 0;
    this.recentLatencies.push(latencyMs);
    if (this.recentLatencies.length > this.maxLatencyHistory) {
      this.recentLatencies.shift();
    }

    const avgLatency = this.recentLatencies.reduce((a, b) => a + b, 0) / this.recentLatencies.length;
    if (avgLatency > 3000) {
      this.updateStatus('ONLINE_BUT_SLOW');
    } else if (this.status === 'ONLINE_BUT_SLOW' && avgLatency < 2000) {
      this.updateStatus('ONLINE');
    }
  }

  /**
   * Reset state (useful for tests)
   */
  public resetForTesting(initialStatus: NetworkStatus = 'ONLINE'): void {
    this.status = initialStatus;
    this.consecutiveTimeouts = 0;
    this.recentLatencies = [];
    this.notifyListeners();
  }
}

export const networkStateService = NetworkStateService.getInstance();
