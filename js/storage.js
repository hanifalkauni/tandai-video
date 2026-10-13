/**
 * @file storage.js
 * @description IndexedDB-backed media store for persisting video blobs locally so a
 * reload can restore the video (not just annotations) without asking the user to
 * relink the file. 100% client-side: nothing leaves the browser.
 *
 * localStorage only holds small strings (~5-10MB) and can't keep a video; IndexedDB
 * can store large Blobs. Keyed by clip id (which survives VideoClip.toJSON()).
 *
 * All methods return Promises and degrade gracefully (resolve null / no-op) when
 * IndexedDB is unavailable (e.g. hardened privacy modes), so callers can always fall
 * back to the relink flow.
 */
(function (global) {
  'use strict';

  const TV = (global.TV = global.TV || {});

  const DB_NAME = 'tandai_video_media';
  const DB_VERSION = 1;
  const STORE = 'videos';

  let _dbPromise = null;

  function _hasIDB() {
    try {
      return typeof global.indexedDB !== 'undefined' && global.indexedDB !== null;
    } catch (e) {
      return false;
    }
  }

  function _openDB() {
    if (!_hasIDB()) return Promise.resolve(null);
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise((resolve) => {
      let req;
      try {
        req = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        console.warn('MediaStore: indexedDB.open failed:', e);
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE); // out-of-line keys (we pass the clip id)
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn('MediaStore: failed to open IndexedDB:', req.error);
        resolve(null);
      };
      req.onblocked = () => {
        console.warn('MediaStore: IndexedDB open blocked.');
        resolve(null);
      };
    });
    return _dbPromise;
  }

  function _tx(db, mode) {
    const tx = db.transaction(STORE, mode);
    return { tx, store: tx.objectStore(STORE) };
  }

  const MediaStore = {
    /** True if IndexedDB is usable in this environment. */
    isAvailable() {
      return _hasIDB();
    },

    /**
     * Persist a Blob/File under a key (clip id). Resolves true on success, false if
     * storage is unavailable or the write fails (e.g. quota exceeded) — callers treat
     * false as "fall back to relink".
     */
    async put(key, blob) {
      if (!key || !blob) return false;
      const db = await _openDB();
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const { tx, store } = _tx(db, 'readwrite');
          store.put(blob, key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => {
            console.warn('MediaStore.put failed:', tx.error);
            resolve(false);
          };
          tx.onabort = () => {
            console.warn('MediaStore.put aborted (quota?):', tx.error);
            resolve(false);
          };
        } catch (e) {
          console.warn('MediaStore.put threw:', e);
          resolve(false);
        }
      });
    },

    /** Retrieve a stored Blob by key, or null if absent/unavailable. */
    async get(key) {
      if (!key) return null;
      const db = await _openDB();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const { store } = _tx(db, 'readonly');
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => {
            console.warn('MediaStore.get failed:', req.error);
            resolve(null);
          };
        } catch (e) {
          console.warn('MediaStore.get threw:', e);
          resolve(null);
        }
      });
    },

    /** Delete a stored Blob by key. Resolves true when done (or nothing to do). */
    async delete(key) {
      if (!key) return true;
      const db = await _openDB();
      if (!db) return true;
      return new Promise((resolve) => {
        try {
          const { tx, store } = _tx(db, 'readwrite');
          store.delete(key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => { console.warn('MediaStore.delete failed:', tx.error); resolve(false); };
        } catch (e) {
          console.warn('MediaStore.delete threw:', e);
          resolve(false);
        }
      });
    },

    /** Remove every stored Blob (used by the Reset action). */
    async clear() {
      const db = await _openDB();
      if (!db) return true;
      return new Promise((resolve) => {
        try {
          const { tx, store } = _tx(db, 'readwrite');
          store.clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => { console.warn('MediaStore.clear failed:', tx.error); resolve(false); };
        } catch (e) {
          console.warn('MediaStore.clear threw:', e);
          resolve(false);
        }
      });
    },

    /**
     * Delete every stored Blob whose key is NOT in keepKeys. Keeps IndexedDB from
     * accumulating orphaned videos across sessions.
     */
    async pruneExcept(keepKeys) {
      const keep = new Set(keepKeys || []);
      const db = await _openDB();
      if (!db) return true;
      return new Promise((resolve) => {
        try {
          const { tx, store } = _tx(db, 'readwrite');
          const req = store.getAllKeys();
          req.onsuccess = () => {
            const keys = req.result || [];
            keys.forEach((k) => { if (!keep.has(k)) store.delete(k); });
          };
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => { console.warn('MediaStore.pruneExcept failed:', tx.error); resolve(false); };
        } catch (e) {
          console.warn('MediaStore.pruneExcept threw:', e);
          resolve(false);
        }
      });
    }
  };

  TV.MediaStore = MediaStore;

})(window);
