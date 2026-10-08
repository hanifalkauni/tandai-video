/**
 * @file video-engine.js
 * @description Frame-accurate video playback engine, screen recorder API, and time synchronizer
 * Adheres to Single Responsibility Principle
 */

(function (global) {
  'use strict';

  const TV = (global.TV = global.TV || {});

  class VideoEngine {
    constructor(videoElement) {
      this.video = videoElement || document.createElement('video');
      this.video.crossOrigin = 'anonymous';
      this.video.playsInline = true;
      this.video.preload = 'auto';

      this.fps = 30;
      this.isPlaying = false;
      this.activeClip = null;
      this.playbackBounds = { trimIn: 0, trimOut: null };
      this.listeners = {
        timeupdate: [],
        loadedmetadata: [],
        playstate: [],
        ratechange: [],
        ended: []
      };

      this._rvfcId = null;
      this._rafId = null;
      this._pendingJumpTarget = null;
      this._bindInternalEvents();
    }

    setActiveClip(clip) {
      this.activeClip = clip;
      this._pendingJumpTarget = null;
      if (clip) {
        this.setPlaybackBounds(clip.trimIn || 0, clip.trimOut || clip.duration);
      }
    }

    setPlaybackBounds(trimIn = 0, trimOut = null) {
      this.playbackBounds = {
        trimIn: typeof trimIn === 'number' ? trimIn : 0,
        trimOut: typeof trimOut === 'number' && trimOut > 0 ? trimOut : null
      };
    }

    _checkPlaybackBoundary() {
      if (!this.playbackBounds) return false;
      const trimIn = this.playbackBounds.trimIn || 0;
      const trimOut = this.playbackBounds.trimOut;

      if (typeof trimOut === 'number' && trimOut > 0 && this.currentTime >= trimOut - 0.03) {
        this.pause();
        this.currentTime = trimIn;
        this._emit('boundaryReached', { trimIn, trimOut });
        return true;
      }
      return false;
    }

    _bindInternalEvents() {
      this.video.addEventListener('loadedmetadata', () => {
        this._detectFps();
        this._emit('loadedmetadata', {
          duration: this.video.duration,
          width: this.video.videoWidth,
          height: this.video.videoHeight,
          fps: this.fps
        });
      });

      this.video.addEventListener('play', () => {
        this.isPlaying = true;
        this._startSyncLoop();
        this._emit('playstate', { isPlaying: true });
      });

      this.video.addEventListener('pause', () => {
        this.isPlaying = false;
        this._pendingJumpTarget = null;
        this._stopSyncLoop();
        this._emit('playstate', { isPlaying: false });
      });

      this.video.addEventListener('seeked', () => {
        if (this._pendingJumpTarget !== null && this.video.currentTime >= this._pendingJumpTarget - 0.08) {
          this._pendingJumpTarget = null;
        }
      });

      this.video.addEventListener('ended', () => {
        this.isPlaying = false;
        this._pendingJumpTarget = null;
        this._stopSyncLoop();
        this._emit('ended');
      });

      this.video.addEventListener('ratechange', () => {
        this._emit('ratechange', { playbackRate: this.video.playbackRate });
      });

      this.video.addEventListener('timeupdate', () => {
        if (this.isPlaying) {
          if (this.activeClip && typeof this.activeClip.getNextPlaybackJump === 'function') {
            const jumpTo = this.activeClip.getNextPlaybackJump(this.video.currentTime);
            if (typeof jumpTo === 'number') {
              if (!this.video.seeking && this._pendingJumpTarget !== jumpTo) {
                this._pendingJumpTarget = jumpTo;
                this.video.currentTime = jumpTo;
                return;
              }
              if (this.video.currentTime >= jumpTo - 0.05) {
                this._pendingJumpTarget = null;
              }
            } else {
              this._pendingJumpTarget = null;
            }
          }
          if (this._checkPlaybackBoundary()) {
            return;
          }
        }
        this._emit('timeupdate', { currentTime: this.currentTime, duration: this.duration });
      });
    }

    _detectFps() {
      // Standard video FPS estimation; defaults to 30fps unless detected
      this.fps = 30;
    }

    _startSyncLoop() {
      this._stopSyncLoop();
      const onFrame = (now, metadata) => {
        if (!this.isPlaying) return;

        // Jump over cut gaps seamlessly
        if (this.activeClip && typeof this.activeClip.getNextPlaybackJump === 'function') {
          const jumpTo = this.activeClip.getNextPlaybackJump(this.video.currentTime);
          if (typeof jumpTo === 'number') {
            if (!this.video.seeking && this._pendingJumpTarget !== jumpTo) {
              this._pendingJumpTarget = jumpTo;
              this.video.currentTime = jumpTo;
              return;
            }
            if (this.video.currentTime >= jumpTo - 0.05) {
              this._pendingJumpTarget = null;
            }
          } else {
            this._pendingJumpTarget = null;
          }
        }

        if (this._checkPlaybackBoundary()) {
          return;
        }

        this._emit('timeupdate', {
          currentTime: this.currentTime,
          duration: this.duration,
          frame: metadata?.presentedFrames || Math.floor(this.currentTime * this.fps)
        });
        if ('requestVideoFrameCallback' in this.video) {
          this._rvfcId = this.video.requestVideoFrameCallback(onFrame);
        } else {
          this._rafId = requestAnimationFrame(() => onFrame(performance.now()));
        }
      };

      if ('requestVideoFrameCallback' in this.video) {
        this._rvfcId = this.video.requestVideoFrameCallback(onFrame);
      } else {
        this._rafId = requestAnimationFrame(() => onFrame(performance.now()));
      }
    }

    _stopSyncLoop() {
      if (this._rvfcId && 'cancelVideoFrameCallback' in this.video) {
        this.video.cancelVideoFrameCallback(this._rvfcId);
        this._rvfcId = null;
      }
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
    }

    /* --------------------------------------------------------------------------
       Public Playback Controls
       -------------------------------------------------------------------------- */
    get currentTime() {
      if (this.activeClip && typeof this.activeClip.sourceToTimelineTime === 'function') {
        return this.activeClip.sourceToTimelineTime(this.video.currentTime || 0);
      }
      return this.video.currentTime || 0;
    }

    set currentTime(t) {
      if (typeof t !== 'number' || isNaN(t)) return;
      const clamped = Math.max(0, Math.min(t, this.duration));
      let sourceT = clamped;
      if (this.activeClip && typeof this.activeClip.timelineToSourceTime === 'function') {
        sourceT = this.activeClip.timelineToSourceTime(clamped);
      }
      this._pendingJumpTarget = null;
      if (this.video.readyState >= 1) {
        this.video.currentTime = sourceT;
      }
      this._emit('timeupdate', { currentTime: clamped, duration: this.duration });
    }

    get duration() {
      if (this.activeClip && typeof this.activeClip.duration === 'number' && this.activeClip.duration > 0) {
        return this.activeClip.duration;
      }
      return isFinite(this.video.duration) ? this.video.duration : 0;
    }

    get videoWidth() {
      return this.video.videoWidth || 1920;
    }

    get videoHeight() {
      return this.video.videoHeight || 1080;
    }

    async play() {
      if (this.playbackBounds) {
        const startT = typeof this.playbackBounds.trimIn === 'number' ? this.playbackBounds.trimIn : 0;
        const endT = typeof this.playbackBounds.trimOut === 'number' ? this.playbackBounds.trimOut : this.duration;
        if (this.currentTime < startT - 0.05 || this.currentTime >= endT - 0.05) {
          this.currentTime = startT;
        }
      }
      if (this.activeClip && typeof this.activeClip.getNextPlaybackJump === 'function') {
        const jumpTo = this.activeClip.getNextPlaybackJump(this.video.currentTime);
        if (typeof jumpTo === 'number' && !this.video.seeking) {
          this._pendingJumpTarget = jumpTo;
          this.video.currentTime = jumpTo;
        }
      }
      try {
        await this.video.play();
      } catch (err) {
        console.warn('Autoplay or play blocked:', err);
        this.isPlaying = false;
        this._stopSyncLoop();
        this._emit('playstate', { isPlaying: false });
      }
    }

    pause() {
      this.video.pause();
    }

    togglePlay() {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    }

    stepFrame(delta = 1) {
      this.pause();
      const frameDuration = 1 / this.fps;
      this.currentTime = this.currentTime + delta * frameDuration;
    }

    jumpSeconds(delta = 1) {
      this.currentTime = this.currentTime + delta;
    }

    setPlaybackRate(rate = 1.0) {
      this.video.playbackRate = rate;
      if ('preservesPitch' in this.video) {
        this.video.preservesPitch = true;
      }
    }

    setVolume(vol = 1.0) {
      this.video.volume = Math.max(0, Math.min(vol, 1));
    }

    toggleMute() {
      this.video.muted = !this.video.muted;
      return this.video.muted;
    }

    loadSource(src) {
      this.pause();
      this._stopSyncLoop();
      this.isPlaying = false;
      this._pendingJumpTarget = null;
      this._emit('playstate', { isPlaying: false });

      return new Promise((resolve, reject) => {
        const cleanup = () => {
          this.video.removeEventListener('loadedmetadata', onLoaded);
          this.video.removeEventListener('error', onError);
        };

        const onLoaded = () => {
          // If duration is Infinity or NaN (common in MediaRecorder WebM on Chromium), fix it via seeking trick
          if (!isFinite(this.video.duration) || this.video.duration === Infinity) {
            const onSeekFix = () => {
              this.video.removeEventListener('seeked', onSeekFix);
              this.video.currentTime = 0;
              cleanup();
              this._detectFps();
              resolve({
                duration: isFinite(this.video.duration) ? this.video.duration : 1,
                width: this.video.videoWidth,
                height: this.video.videoHeight
              });
            };
            this.video.addEventListener('seeked', onSeekFix);
            this.video.currentTime = 1e101;
            return;
          }

          cleanup();
          this._detectFps();
          resolve({
            duration: this.video.duration,
            width: this.video.videoWidth,
            height: this.video.videoHeight
          });
        };

        const onError = (e) => {
          cleanup();
          reject(e || new Error('Gagal memuat video'));
        };

        this.video.addEventListener('loadedmetadata', onLoaded);
        this.video.addEventListener('error', onError);

        if (src instanceof Blob || src instanceof File) {
          this.video.src = URL.createObjectURL(src);
        } else {
          this.video.src = src;
        }
        this.video.load();
      });
    }

    /* --------------------------------------------------------------------------
       Screen Recorder API
       -------------------------------------------------------------------------- */
    static async recordScreen(options = {}) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error('Screen Capture API tidak didukung pada browser ini.');
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor'
        },
        audio: options.audio ?? true
      });

      let mimeType = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
      if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';

      const recordedChunks = [];
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      const recordingPromise = new Promise((resolve, reject) => {
        recorder.onstop = () => {
          // Stop all stream tracks to release the active capture indicator in browser
          stream.getTracks().forEach((track) => track.stop());

          const blob = new Blob(recordedChunks, { type: mimeType });
          const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
          const file = new File(
            [blob],
            `Screen_Recording_${TV.fileStamp(new Date())}.${ext}`,
            { type: mimeType }
          );
          resolve({ blob, file });
        };

        recorder.onerror = (err) => {
          stream.getTracks().forEach((track) => track.stop());
          reject(err);
        };
      });

      // Handle user clicking native browser "Stop sharing" bar
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (recorder.state === 'recording' || recorder.state === 'paused') {
            recorder.stop();
          }
        });
      });

      recorder.start(250); // chunk every 250ms

      return {
        recorder,
        stream,
        stop: () => {
          if (recorder.state === 'recording' || recorder.state === 'paused') {
            recorder.stop();
          }
        },
        complete: recordingPromise
      };
    }

    /* --------------------------------------------------------------------------
       Event Observer Pattern
       -------------------------------------------------------------------------- */
    on(event, callback) {
      if (this.listeners[event]) {
        this.listeners[event].push(callback);
      }
      return () => this.off(event, callback);
    }

    off(event, callback) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
      }
    }

    _emit(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(cb => {
          try {
            cb(data);
          } catch (err) {
            console.error(`Error in video engine event listener [${event}]:`, err);
          }
        });
      }
    }

    /* --------------------------------------------------------------------------
       Formatting Helpers
       -------------------------------------------------------------------------- */
    static formatTimecode(seconds = 0, fps = 30) {
      if (isNaN(seconds) || seconds < 0) seconds = 0;
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const f = Math.floor((seconds % 1) * fps);

      const p2 = n => String(n).padStart(2, '0');
      if (h > 0) {
        return `${p2(h)}:${p2(m)}:${p2(s)}:${p2(f)}`;
      }
      return `${p2(m)}:${p2(s)}:${p2(f)}`;
    }

    static formatDuration(seconds = 0) {
      if (isNaN(seconds) || seconds < 0) seconds = 0;
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 100);
      const p2 = n => String(n).padStart(2, '0');
      return `${p2(m)}:${p2(s)}.${p2(ms)}`;
    }

    static parseTimeString(str) {
      if (typeof str === 'number') return isNaN(str) ? null : str;
      if (!str || typeof str !== 'string') return null;
      str = str.trim();
      if (!str) return null;

      const parts = str.split(':');
      if (parts.length === 1) {
        const s = parseFloat(parts[0]);
        return isNaN(s) ? null : s;
      } else if (parts.length === 2) {
        const m = parseFloat(parts[0]);
        const s = parseFloat(parts[1]);
        if (isNaN(m) || isNaN(s)) return null;
        return m * 60 + s;
      } else if (parts.length === 3) {
        const h = parseFloat(parts[0]);
        const m = parseFloat(parts[1]);
        const s = parseFloat(parts[2]);
        if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
        return h * 3600 + m * 60 + s;
      }
      return null;
    }
  }

  TV.VideoEngine = VideoEngine;

})(window);
