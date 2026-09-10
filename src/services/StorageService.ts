import type { Track } from '../types/music';

const DB_NAME = 'stuxs_music_offline_db';
const DB_VERSION = 1;

export interface StoredAudioRecord {
  id: string;
  track: Track;
  blob: Blob;
  addedAt?: number;
  downloadedAt?: number;
  fileSize: number;
}

class StorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB is not supported in this environment.'));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('local_tracks')) {
          db.createObjectStore('local_tracks', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('downloaded_tracks')) {
          db.createObjectStore('downloaded_tracks', { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });

    return this.dbPromise;
  }

  // --- Local Music Store ---
  public async saveLocalTrack(record: StoredAudioRecord): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('local_tracks', 'readwrite');
      const store = tx.objectStore('local_tracks');
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async getAllLocalTracks(): Promise<StoredAudioRecord[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('local_tracks', 'readonly');
      const store = tx.objectStore('local_tracks');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  public async getLocalTrack(id: string): Promise<StoredAudioRecord | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('local_tracks', 'readonly');
      const store = tx.objectStore('local_tracks');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  public async deleteLocalTrack(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('local_tracks', 'readwrite');
      const store = tx.objectStore('local_tracks');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // --- Downloaded Tracks Store ---
  public async saveDownloadedTrack(record: StoredAudioRecord): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('downloaded_tracks', 'readwrite');
      const store = tx.objectStore('downloaded_tracks');
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async getAllDownloadedTracks(): Promise<StoredAudioRecord[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('downloaded_tracks', 'readonly');
      const store = tx.objectStore('downloaded_tracks');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  public async getDownloadedTrack(id: string): Promise<StoredAudioRecord | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('downloaded_tracks', 'readonly');
      const store = tx.objectStore('downloaded_tracks');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  public async deleteDownloadedTrack(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('downloaded_tracks', 'readwrite');
      const store = tx.objectStore('downloaded_tracks');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

export const storageService = new StorageService();
