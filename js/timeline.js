/**
 * @file timeline.js
 * @description Interactive Multi-Track Timeline Controller, Scrubber, In/Out Trim & Playlist Bar
 * Adheres to Single Responsibility & High Interactivity standards
 */

(function (global) {
  'use strict';

  const TV = (global.TV = global.TV || {});

  class TimelineController {
    constructor(containerElement, videoEngine) {
      this.container = containerElement;
      this.engine = videoEngine;

      // DOM Elements
      this.rulerEl = this.container.querySelector('.timeline-ruler');
      this.tracksAreaEl = this.container.querySelector('.timeline-tracks-area');
      this.trackHeadersEl = this.container.querySelector('.timeline-track-headers');
      this.scrollContainer = this.container.querySelector('.timeline-scroll-container');
      this.contentWrapper = this.container.querySelector('.timeline-content-wrapper');
      this.playheadEl = this.container.querySelector('.timeline-playhead');
      this.playheadHandleEl = this.container.querySelector('.timeline-playhead-handle');
      this.trimLeftDimmer = this.container.querySelector('.timeline-trim-dimmer-left');
      this.trimRightDimmer = this.container.querySelector('.timeline-trim-dimmer-right');
      this.trimHandleIn = this.container.querySelector('.timeline-trim-handle-in');
      this.trimHandleOut = this.container.querySelector('.timeline-trim-handle-out');
      this.trimInTooltip = this.container.querySelector('#trimInTooltip');
      this.trimOutTooltip = this.container.querySelector('#trimOutTooltip');
      this.trimStartInput = this.container.querySelector('#trimStartInput');
      this.trimEndInput = this.container.querySelector('#trimEndInput');
      this.trimDurationBadge = this.container.querySelector('#trimDurationBadge');
      this.playlistBarEl = this.container.querySelector('.playlist-bar');

      // State
      this.pixelsPerSecond = 80; // Baseline zoom level
      this.zoomScale = 1.0; // 0.5x, 1.0x, 2.0x, 4.0x
      this.isScrubbing = false;
      this.activeDrag = null; // { type: 'move'|'resize-left'|'resize-right'|'trim-in'|'trim-out'|'playhead', annId, startX, startT, ... }

      this.listeners = {
        seek: [],
        selectAnnotation: [],
        annotationChange: [],
        trimChange: [],
        trimLiveChange: [],
        clipSwitch: [],
        clipRemove: []
      };

      this._bindEvents();
    }

    _bindEvents() {
      // 1. Ruler & Playhead Scrubbing
      this.rulerEl.addEventListener('pointerdown', (e) => {
        this.isScrubbing = true;
        this._handleScrub(e);
        const onMove = (ev) => {
          if (this.isScrubbing) this._handleScrub(ev);
        };
        const onUp = () => {
          this.isScrubbing = false;
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });

      this.playheadHandleEl.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.isScrubbing = true;
        const onMove = (ev) => {
          if (this.isScrubbing) this._handleScrub(ev);
        };
        const onUp = () => {
          this.isScrubbing = false;
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });

      // 2. Trim Handles Dragging
      this.trimHandleIn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._startTrimDrag('in', e);
      });

      this.trimHandleOut.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._startTrimDrag('out', e);
      });

      // 3. Mouse Wheel Scrolling in Timeline (Horizontal Slide & Ctrl+Wheel Zoom)
      this.scrollContainer.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const zoomDelta = e.deltaY < 0 ? 1.2 : 0.83;
          this.setZoom(this.zoomScale * zoomDelta);
        } else {
          e.preventDefault();
          const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
          this.scrollContainer.scrollLeft += delta;
        }
      }, { passive: false });

      // 4. Manual START & END Time Input Handlers (synced both ways with the slider)
      const bindTrimInput = (input, type) => {
        if (!input) return;
        const commit = () => {
          const clip = this._currentClip;
          if (!clip) return;
          const curIn = clip.trimIn || 0;
          const curOut = clip.trimOut || clip.duration;
          const parsed = TV.VideoEngine.parseTimeString(input.value.replace(',', '.'));
          if (parsed === null || parsed < 0) {
            this._syncTrimInputs(clip, true);
            return;
          }
          if (type === 'in') {
            clip.trimIn = Math.max(0, Math.min(parsed, curOut - 0.2));
          } else {
            clip.trimOut = Math.min(clip.duration, Math.max(parsed, curIn + 0.2));
          }
          this._renderTrimOverlay(clip, true);
          this._emit('trimChange', { trimIn: clip.trimIn, trimOut: clip.trimOut });
        };
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            input.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            if (this._currentClip) this._syncTrimInputs(this._currentClip, true);
            input.blur();
          }
        });
        input.addEventListener('focus', () => input.select());
        input.addEventListener('blur', commit);
      };
      bindTrimInput(this.trimStartInput, 'in');
      bindTrimInput(this.trimEndInput, 'out');
    }

    _syncTrimInputs(clip, force = false) {
      if (!clip) return;
      const out = clip.trimOut || clip.duration;
      if (this.trimStartInput && (force || document.activeElement !== this.trimStartInput)) {
        this.trimStartInput.value = TV.VideoEngine.formatDuration(clip.trimIn || 0);
      }
      if (this.trimEndInput && (force || document.activeElement !== this.trimEndInput)) {
        this.trimEndInput.value = TV.VideoEngine.formatDuration(out);
      }
      if (this.trimDurationBadge) {
        this.trimDurationBadge.textContent = `Durasi: ${TV.VideoEngine.formatDuration(Math.max(0, out - (clip.trimIn || 0)))}`;
      }
    }

    setZoom(scale = 1.0) {
      this.zoomScale = Math.max(0.25, Math.min(scale, 8.0));
      this.pixelsPerSecond = 80 * this.zoomScale;
      this.updateView();
    }

    _timeToPx(t) {
      return t * this.pixelsPerSecond;
    }

    _pxToTime(px) {
      return px / this.pixelsPerSecond;
    }

    _handleScrub(e) {
      const rect = this.contentWrapper.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const targetTime = Math.max(0, Math.min(this._pxToTime(clickX), this.engine.duration));
      this._emit('seek', { time: targetTime });
    }

    _startTrimDrag(type, e) {
      const clip = this._currentClip;
      if (!clip) return;

      const onMove = (ev) => {
        const rect = this.contentWrapper.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const t = Math.max(0, Math.min(this._pxToTime(px), clip.duration));

        if (type === 'in') {
          clip.trimIn = Math.min(t, clip.trimOut - 0.2);
        } else {
          clip.trimOut = Math.max(t, clip.trimIn + 0.2);
        }
        this._renderTrimOverlay(clip);
        this._emit('trimLiveChange', { trimIn: clip.trimIn, trimOut: clip.trimOut });
      };

      const onUp = () => {
        this._emit('trimChange', { trimIn: clip.trimIn, trimOut: clip.trimOut });
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    /* --------------------------------------------------------------------------
       Update & Render Timeline View
       -------------------------------------------------------------------------- */
    render({ projectSession, currentTime, selectedAnnotationId }) {
      if (!projectSession) return;
      this._lastRenderParams = { projectSession, currentTime, selectedAnnotationId: selectedAnnotationId ?? this.selectedAnnotationId };
      const clip = projectSession.getActiveClip();
      this._currentClip = clip;

      if (clip && clip.duration <= 0) {
        if (typeof clip.getDuration === 'function') {
          clip.duration = clip.getDuration();
        }
        if (clip.duration <= 0 && clip.rawDuration > 0) {
          clip.segments = [{ start: 0, end: clip.rawDuration }];
          clip.duration = clip.rawDuration;
        } else if (clip.duration <= 0 && this.engine && this.engine.video && isFinite(this.engine.video.duration) && this.engine.video.duration > 0) {
          clip.rawDuration = this.engine.video.duration;
          clip.segments = [{ start: 0, end: clip.rawDuration }];
          clip.duration = clip.rawDuration;
        }
      }

      if (!clip || clip.duration <= 0) {
        this.contentWrapper.style.width = '100%';
        this._renderEmpty();
        return;
      }

      const totalWidth = Math.max(
        this.scrollContainer.clientWidth,
        Math.ceil(clip.duration * this.pixelsPerSecond) + 120
      );
      this.contentWrapper.style.width = `${totalWidth}px`;

      // 1. Render Ruler Ticks
      this._renderRuler(clip.duration);

      // 2. Render Trim Overlay
      this._renderTrimOverlay(clip);

      // 3. Render Tracks & Blocks
      this._renderTracks(clip, selectedAnnotationId);

      // 4. Update Playhead Position
      this._updatePlayhead(currentTime);

      // 5. Render Playlist Bar
      this._renderPlaylist(projectSession);
    }

    updateView() {
      if (this._lastRenderParams) {
        this.render(this._lastRenderParams);
      }
    }

    setSelectedAnnotation(id) {
      this.selectedAnnotationId = id;
      const headerItems = this.trackHeadersEl.querySelectorAll('.track-header-item');
      const blocks = this.tracksAreaEl.querySelectorAll('.annotation-block');

      if (this._currentClip && this._currentClip.annotations) {
        this._currentClip.annotations.forEach((ann, idx) => {
          const isSel = ann.id === id;
          if (headerItems[idx]) {
            headerItems[idx].classList.toggle('selected', isSel);
          }
          if (blocks[idx]) {
            blocks[idx].classList.toggle('selected', isSel);
          }
        });
      }
    }

    _renderEmpty() {
      this.rulerEl.innerHTML = '';
      this.tracksAreaEl.innerHTML = '<div style="padding: 20px; font-size: 11px; color: var(--text-muted);">Tidak ada video aktif.</div>';
      this.trackHeadersEl.innerHTML = '<div class="track-header-ruler-spacer">TRACKS</div>';
      this.trimLeftDimmer.style.width = '0px';
      this.trimRightDimmer.style.width = '0px';
      this.trimHandleIn.style.display = 'none';
      this.trimHandleOut.style.display = 'none';
      if (this.trimStartInput) this.trimStartInput.value = '00:00.00';
      if (this.trimEndInput) this.trimEndInput.value = '00:00.00';
      if (this.trimDurationBadge) this.trimDurationBadge.textContent = 'Durasi: 00:00.00';
    }

    _renderRuler(duration) {
      this.rulerEl.innerHTML = '';
      let step = 1; // 1 second per step
      if (this.pixelsPerSecond < 30) step = 5;
      else if (this.pixelsPerSecond < 15) step = 10;
      else if (this.pixelsPerSecond > 200) step = 0.5;

      const totalSteps = Math.ceil(duration / step);
      for (let i = 0; i <= totalSteps; i++) {
        const t = i * step;
        const px = this._timeToPx(t);

        const tick = document.createElement('div');
        tick.className = `ruler-tick ${i % 2 === 0 ? 'major' : ''}`;
        tick.style.left = `${px}px`;

        if (i % (step < 1 ? 2 : 1) === 0) {
          const label = document.createElement('div');
          label.className = 'ruler-label';
          label.style.left = `${px + 3}px`;
          label.textContent = TV.VideoEngine.formatDuration(t);
          this.rulerEl.appendChild(label);
        }
        this.rulerEl.appendChild(tick);
      }
    }

    _renderTrimOverlay(clip, force = false) {
      const inPx = this._timeToPx(clip.trimIn);
      const outPx = this._timeToPx(clip.trimOut || clip.duration);

      this.trimLeftDimmer.style.display = 'block';
      this.trimLeftDimmer.style.width = `${inPx}px`;

      this.trimHandleIn.style.display = 'flex';
      this.trimHandleIn.style.left = `${inPx}px`;

      this.trimHandleOut.style.display = 'flex';
      this.trimHandleOut.style.left = `${outPx}px`;

      this.trimRightDimmer.style.display = 'block';
      this.trimRightDimmer.style.left = `${outPx}px`;
      this.trimRightDimmer.style.right = '0';

      // Realtime sync of header START / END inputs with the slider
      this._syncTrimInputs(clip, force);
    }

    _renderTracks(clip, selectedAnnotationId) {
      this.tracksAreaEl.innerHTML = '';
      this.trackHeadersEl.innerHTML = '<div class="track-header-ruler-spacer">TRACKS</div>';

      const annotations = clip.annotations || [];

      annotations.forEach((ann, index) => {
        const isHidden = Boolean(ann.hidden);
        const isSelected = ann.id === selectedAnnotationId;

        // Track Header Item
        const header = document.createElement('div');
        header.className = `track-header-item ${isSelected ? 'selected' : ''}`;

        const eyeSvg = isHidden
          ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
          : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

        header.innerHTML = `
          <span class="track-header-name" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:80px; ${isHidden ? 'opacity:0.4; text-decoration:line-through;' : ''}">
            ${ann.type.toUpperCase()} #${index + 1}
          </span>
          <div class="track-actions">
            <button class="btn btn-ghost btn-icon btn-sm track-vis-btn ${isHidden ? 'is-hidden' : ''}" title="${isHidden ? 'Tampilkan Objek' : 'Sembunyikan Objek'}" style="width:22px;height:22px;padding:0;">
              ${eyeSvg}
            </button>
          </div>
        `;

        // Track Row in Main Area
        const row = document.createElement('div');
        row.className = 'timeline-track-row';

        // Annotation Block
        const block = document.createElement('div');
        block.className = `annotation-block ${isSelected ? 'selected' : ''} ${isHidden ? 'is-hidden-block' : ''}`;
        const startPx = this._timeToPx(ann.tStart);
        const widthPx = Math.max(14, this._timeToPx(ann.tEnd - ann.tStart));

        block.style.left = `${startPx}px`;
        block.style.width = `${widthPx}px`;
        block.style.backgroundColor = this._getAnnotationTrackColor(ann);

        block.innerHTML = `
          <div class="annotation-resize-handle left" title="Tarik untuk mengubah waktu mulai"></div>
          <div class="annotation-block-title">
            <span>${this._getAnnotationIcon(ann.type)}</span>
            <span>${ann.type} (${TV.VideoEngine.formatDuration(ann.tStart)} - ${TV.VideoEngine.formatDuration(ann.tEnd)})</span>
          </div>
          <div class="annotation-resize-handle right" title="Tarik untuk mengubah durasi / waktu selesai"></div>
        `;

        // Eye Button toggle interaction
        const visBtn = header.querySelector('.track-vis-btn');
        const nameSpan = header.querySelector('.track-header-name');

        visBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          ann.hidden = !ann.hidden;
          const hiddenNow = Boolean(ann.hidden);

          visBtn.classList.toggle('is-hidden', hiddenNow);
          visBtn.title = hiddenNow ? 'Tampilkan Objek' : 'Sembunyikan Objek';
          visBtn.innerHTML = hiddenNow
            ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
            : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

          if (nameSpan) {
            nameSpan.style.opacity = hiddenNow ? '0.4' : '1';
            nameSpan.style.textDecoration = hiddenNow ? 'line-through' : 'none';
          }

          block.classList.toggle('is-hidden-block', hiddenNow);
          clip.saveHistorySnapshot();
          this._emit('annotationChange', { annotation: ann });
        });

        // Track header click selects annotation
        header.addEventListener('click', () => {
          this._emit('selectAnnotation', { id: ann.id });
        });

        // Block Drag Interaction
        this._bindBlockDrag(block, ann, clip);

        this.trackHeadersEl.appendChild(header);
        row.appendChild(block);
        this.tracksAreaEl.appendChild(row);
      });
    }

    _bindBlockDrag(blockEl, ann, clip) {
      blockEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        // 1. Instantly select this annotation without destroying DOM
        this.setSelectedAnnotation(ann.id);
        this._emit('selectAnnotationFast', { id: ann.id });

        const isResizeLeft = e.target.classList.contains('left');
        const isResizeRight = e.target.classList.contains('right');
        const startX = e.clientX;
        const initialStart = ann.tStart;
        const initialEnd = ann.tEnd;

        try {
          blockEl.setPointerCapture(e.pointerId);
        } catch (err) {}

        // Visual cursor feedback
        document.body.style.cursor = isResizeLeft || isResizeRight ? 'ew-resize' : 'grabbing';
        const titleTextEl = blockEl.querySelector('.annotation-block-title span:last-child');

        const onMove = (ev) => {
          const deltaX = ev.clientX - startX;
          const deltaT = this._pxToTime(deltaX);

          if (isResizeLeft) {
            ann.tStart = Math.max(0, Math.min(initialStart + deltaT, ann.tEnd - 0.2));
          } else if (isResizeRight) {
            ann.tEnd = Math.min(clip.duration, Math.max(initialEnd + deltaT, ann.tStart + 0.2));
          } else {
            // Move entire block
            const duration = initialEnd - initialStart;
            let newStart = initialStart + deltaT;
            let newEnd = initialEnd + deltaT;

            if (newStart < 0) {
              newStart = 0;
              newEnd = duration;
            }
            if (newEnd > clip.duration) {
              newEnd = clip.duration;
              newStart = Math.max(0, clip.duration - duration);
            }
            ann.tStart = newStart;
            ann.tEnd = newEnd;
          }

          // 1. Update block position and width on DOM live
          const startPx = this._timeToPx(ann.tStart);
          const widthPx = Math.max(14, this._timeToPx(ann.tEnd - ann.tStart));
          blockEl.style.left = `${startPx}px`;
          blockEl.style.width = `${widthPx}px`;

          // 2. Update block title text live with start and end times
          if (titleTextEl) {
            titleTextEl.textContent = `${ann.type} (${TV.VideoEngine.formatDuration(ann.tStart)} - ${TV.VideoEngine.formatDuration(ann.tEnd)})`;
          }

          // 3. Emit live change event so inspector and canvas update immediately at 60fps
          this._emit('annotationLiveChange', { annotation: ann });
        };

        const onUp = (ev) => {
          try {
            blockEl.releasePointerCapture(ev.pointerId);
          } catch (err) {}
          document.body.style.cursor = '';
          clip.saveHistorySnapshot();
          this._emit('annotationChange', { annotation: ann });
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }

    _updatePlayhead(currentTime) {
      const px = this._timeToPx(currentTime);
      this.playheadEl.style.left = `${px}px`;
    }

    _renderPlaylist(projectSession) {
      this.playlistBarEl.innerHTML = '<span class="playlist-bar-title">Sesi Video:</span>';
      projectSession.clips.forEach((clip, idx) => {
        const item = document.createElement('div');
        item.className = `playlist-item ${idx === projectSession.activeClipIndex ? 'active' : ''}`;
        item.innerHTML = `
          <span>🎬</span>
          <span style="max-width:120px; overflow:hidden; text-overflow:ellipsis;">${clip.name}</span>
          <span class="playlist-item-duration">(${TV.VideoEngine.formatDuration(clip.duration)})</span>
          ${projectSession.clips.length > 1 ? '<span class="playlist-item-close" title="Hapus klip">×</span>' : ''}
        `;

        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('playlist-item-close')) {
            e.stopPropagation();
            this._emit('clipRemove', { index: idx });
          } else {
            this._emit('clipSwitch', { index: idx });
          }
        });

        this.playlistBarEl.appendChild(item);
      });
    }

    _getAnnotationTrackColor(ann) {
      switch (ann.type) {
        case 'redact': return '#ff5252';
        case 'step': return '#4f8cff';
        case 'spotlight': return '#8b5cf6';
        case 'magnifier': return '#06b6d4';
        case 'arrow': return '#f59e0b';
        case 'highlighter': return '#eab308';
        case 'text': return '#10b981';
        case 'rectangle':
        case 'ellipse':
        default:
          return ann.style.strokeColor || '#ff4d4f';
      }
    }

    _getAnnotationIcon(type) {
      switch (type) {
        case 'rectangle': return '▭';
        case 'ellipse': return '◯';
        case 'arrow': return '➔';
        case 'highlighter': return '🖍';
        case 'text': return '💬';
        case 'step': return '❶';
        case 'redact': return '🔒';
        case 'spotlight': return '🔦';
        case 'magnifier': return '🔍';
        default: return '✦';
      }
    }

    /* --------------------------------------------------------------------------
       Observer Pattern
       -------------------------------------------------------------------------- */
    on(event, callback) {
      if (this.listeners[event]) this.listeners[event].push(callback);
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
          try { cb(data); } catch (err) { console.error(`Timeline error [${event}]:`, err); }
        });
      }
    }
  }

  TV.TimelineController = TimelineController;

})(window);
