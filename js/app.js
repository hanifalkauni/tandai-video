/**
 * @file app.js
 * @description Main Application Controller, Event Orchestrator, Shortcuts Manager & UI Bindings
 * Adheres to Clean Architecture, SOLID & Robust Error Handling
 */

(function (global) {
  'use strict';

  const TV = (global.TV = global.TV || {});

  class AppController {
    constructor() {
      // Core Models & Engines
      this.session = new TV.ProjectSession();
      this.videoEngine = null;
      this.renderer = null;
      this.timeline = null;

      // Active UI Tool State
      this.activeTool = 'select'; // 'select', 'rectangle', 'ellipse', 'arrow', 'highlighter', 'text', 'step', 'redact', 'spotlight', 'magnifier'
      this.toolProperties = {
        strokeColor: '#ef4444',
        strokeWidth: 3,
        fillType: 'none', // 'none', 'soft', 'solid'
        fillOpacity: 0.2,
        redactMode: 'blur', // 'blur', 'pixelate', 'blackout'
        blurRadius: 14,
        pixelSize: 12,
        fontSize: 16,
        stepNumber: 1,
        dimmerOpacity: 0.7,
        zoomLevel: 2.5
      };

      // Selection & Interaction State
      this.selectedAnnotationId = null;
      this.hoverAnnotationId = null;
      this.activeHandle = null;
      this.isDrawing = false;
      this.drawStartX = 0;
      this.drawStartY = 0;
      this.draftAnnotation = null;

      // Viewport Pan & Zoom State
      this.viewportZoom = 1.0;
      this.panX = 0;
      this.panY = 0;
      this.isPanning = false;
      this.isSpacePressed = false;
      this.panStartX = 0;
      this.panStartY = 0;

      // DOM Cache
      this._dom = {};
      this._init();
    }

    _init() {
      this._cacheDomElements();
      this._initEngines();
      this._bindToolbarEvents();
      this._bindViewportEvents();
      this._bindInspectorEvents();
      this._bindModalEvents();
      this._bindKeyboardShortcuts();
      this._bindDropzoneEvents();
      this._loadDraftFromStorage();

      this._startRenderLoop();
      this.showToast('Selamat datang di tandai-video!', 'info');
    }

    _cacheDomElements() {
      const d = this._dom;
      d.video = document.getElementById('videoElement');
      d.canvas = document.getElementById('overlayCanvas');
      d.viewportContainer = document.querySelector('.viewport-canvas-container');
      d.viewportWrapper = document.querySelector('.viewport-canvas-wrapper');
      d.emptyDropzone = document.getElementById('emptyDropzone');
      d.fileInput = document.getElementById('videoFileInput');
      d.recordBtn = document.getElementById('recordScreenBtn');
      d.openFileBtn = document.getElementById('openFileBtn');

      // Playback Controls
      d.playPauseBtn = document.getElementById('playPauseBtn');
      d.prevFrameBtn = document.getElementById('prevFrameBtn');
      d.nextFrameBtn = document.getElementById('nextFrameBtn');
      d.timecodeDisplay = document.getElementById('timecodeDisplay');
      d.timecodeCurrent = document.getElementById('timecodeCurrent');
      d.timecodeTotal = document.getElementById('timecodeTotal');
      d.speedSelect = document.getElementById('playbackSpeedSelect');
      d.muteBtn = document.getElementById('muteToggleBtn');
      d.zoomIndicator = document.getElementById('zoomIndicator');

      // Modals
      d.watermarkModal = document.getElementById('watermarkModal');
      d.exportModal = document.getElementById('exportModal');
      d.shortcutsModal = document.getElementById('shortcutsModal');
      d.projectModal = document.getElementById('projectModal');
      d.toastContainer = document.querySelector('.toast-container');
    }

    _initEngines() {
      this.videoEngine = new TV.VideoEngine(this._dom.video);
      this.renderer = new TV.CanvasRenderer(this._dom.canvas, this._dom.video);
      this.timeline = new TV.TimelineController(document.querySelector('.app-timeline'), this.videoEngine);

      // Video Engine Events
      this.videoEngine.on('loadedmetadata', (meta) => {
        const clip = this.session.getActiveClip();
        if (clip) {
          clip.duration = meta.duration;
          clip.width = meta.width;
          clip.height = meta.height;
          clip.fps = meta.fps;
          clip.trimOut = meta.duration;
          this.renderer.setDimensions(meta.width, meta.height);
          this._fitViewportToContainer();
          this._dom.emptyDropzone.hidden = true;
          this._updatePlaybackUI();
          this.timeline.render({
            projectSession: this.session,
            currentTime: this.videoEngine.currentTime,
            selectedAnnotationId: this.selectedAnnotationId
          });
          this._updateInspector();
          this._saveDraftToStorage();
        }
      });

      this.videoEngine.on('timeupdate', ({ currentTime }) => {
        this._updatePlaybackUI();
        this.timeline._updatePlayhead(currentTime);
      });

      this.videoEngine.on('playstate', ({ isPlaying }) => {
        this._dom.playPauseBtn.innerHTML = isPlaying
          ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
          : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
      });

      // Timeline Events
      this.timeline.on('seek', ({ time }) => {
        this.videoEngine.currentTime = time;
      });

      this.timeline.on('selectAnnotation', ({ id }) => {
        this.selectAnnotation(id);
      });

      this.timeline.on('selectAnnotationFast', ({ id }) => {
        this.selectedAnnotationId = id;
        this._updateInspector();
      });

      this.timeline.on('annotationLiveChange', () => {
        this._updateInspector();
      });

      this.timeline.on('annotationChange', () => {
        this._updateInspector();
        this._saveDraftToStorage();
      });

      this.timeline.on('trimChange', ({ trimIn, trimOut }) => {
        this.showToast(`Batas Video: ${TV.VideoEngine.formatDuration(trimIn)} (START) - ${TV.VideoEngine.formatDuration(trimOut)} (END)`, 'info');
        this._saveDraftToStorage();
      });

      this.timeline.on('clipSwitch', ({ index }) => {
        this.switchClip(index);
      });

      this.timeline.on('clipRemove', ({ index }) => {
        this.removeClip(index);
      });
    }

    /* --------------------------------------------------------------------------
       Render Loop
       -------------------------------------------------------------------------- */
    _startRenderLoop() {
      const render = () => {
        const clip = this.session.getActiveClip();
        this.renderer.renderFrame({
          clip,
          currentTime: this.videoEngine.currentTime,
          selectedAnnotationId: this.selectedAnnotationId,
          hoverAnnotationId: this.hoverAnnotationId,
          activeHandle: this.activeHandle,
          isDrawing: this.isDrawing,
          draftAnnotation: this.draftAnnotation,
          watermarkConfig: this.session.watermark
        });
        requestAnimationFrame(render);
      };
      requestAnimationFrame(render);
    }

    /* --------------------------------------------------------------------------
       Toolbar & Tool Selection
       -------------------------------------------------------------------------- */
    _bindToolbarEvents() {
      const toolButtons = document.querySelectorAll('.tool-btn[data-tool]');
      toolButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.setTool(btn.getAttribute('data-tool'));
        });
      });

      // Quick Action Buttons in Header & Timeline
      document.getElementById('watermarkBtn')?.addEventListener('click', () => this.openWatermarkModal());
      document.getElementById('exportBtn')?.addEventListener('click', () => this.openExportModal());
      document.getElementById('projectBtn')?.addEventListener('click', () => this.openProjectModal());
      document.getElementById('shortcutsBtn')?.addEventListener('click', () => this.openShortcutsModal());
      document.getElementById('themeToggleBtn')?.addEventListener('click', () => this.toggleTheme());
      document.getElementById('splitClipBtn')?.addEventListener('click', () => this.splitAtPlayhead());
    }

    setTool(toolName) {
      this.activeTool = toolName;
      document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tool') === toolName);
      });

      this._dom.canvas.classList.toggle('mode-select', toolName === 'select');
      if (toolName !== 'select') {
        this.selectedAnnotationId = null;
      }
      this._updateInspector();
    }

    /* --------------------------------------------------------------------------
       Viewport & Canvas Drawing Interactions
       -------------------------------------------------------------------------- */
    _bindViewportEvents() {
      const canvas = this._dom.canvas;
      const container = this._dom.viewportContainer;

      // Transform Coordinates from Screen/Pointer to Video Canvas
      const getCanvasPoint = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = this.renderer.width / rect.width;
        const scaleY = this.renderer.height / rect.height;
        return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY
        };
      };

      // Pointer Down
      canvas.addEventListener('pointerdown', (e) => {
        if (this.isSpacePressed || e.button === 1) {
          // Pan mode
          this.isPanning = true;
          this.panStartX = e.clientX - this.panX;
          this.panStartY = e.clientY - this.panY;
          container.classList.add('panning');
          return;
        }

        const pt = getCanvasPoint(e);
        const clip = this.session.getActiveClip();
        if (!clip) return;

        const curT = this.videoEngine.currentTime;

        if (this.activeTool === 'select') {
          // Check if clicking on an active handle of the currently selected annotation
          if (this.selectedAnnotationId) {
            const selected = clip.getAnnotation(this.selectedAnnotationId);
            if (selected && selected.isActive(curT)) {
              const handles = selected.getHandles ? selected.getHandles() : [];
              for (const h of handles) {
                if (Math.hypot(pt.x - h.x, pt.y - h.y) <= 12) {
                  this.activeHandle = h.name;
                  this._startHandleDrag(selected, h.name, pt);
                  return;
                }
              }
            }
          }

          // Hit test on all active annotations (top-to-bottom)
          let hit = null;
          for (let i = clip.annotations.length - 1; i >= 0; i--) {
            const ann = clip.annotations[i];
            if (ann.hitTest(pt.x, pt.y, curT)) {
              hit = ann;
              break;
            }
          }

          if (hit) {
            this.selectAnnotation(hit.id);
            this._startObjectMove(hit, pt);
          } else {
            this.selectAnnotation(null);
          }
        } else if (this.activeTool === 'text') {
          // Direct Text Creation with Immediate Inline Text Editor
          this.commitInlineTextEditor();

          // Check if clicking directly on an existing text annotation
          let hitText = null;
          for (let i = clip.annotations.length - 1; i >= 0; i--) {
            const a = clip.annotations[i];
            if (a.type === 'text' && a.hitTest(pt.x, pt.y, curT)) {
              hitText = a;
              break;
            }
          }

          if (hitText) {
            this.selectAnnotation(hitText.id);
            this.openInlineTextEditor(hitText);
            return;
          }

          const textAnn = TV.AnnotationFactory.create({
            type: 'text',
            tStart: curT,
            tEnd: Math.min(clip.duration, curT + 4.0),
            x: pt.x,
            y: pt.y,
            text: '',
            style: {
              strokeColor: this.toolProperties.strokeColor,
              strokeWidth: this.toolProperties.strokeWidth,
              fillType: this.toolProperties.fillType,
              fillColor: this.toolProperties.strokeColor === '#ef4444' ? '#1e222f' : this.toolProperties.strokeColor,
              fillOpacity: 0.9,
              fontSize: this.toolProperties.fontSize
            }
          });

          clip.addAnnotation(textAnn);
          this.selectAnnotation(textAnn.id);
          this.timeline.render({
            projectSession: this.session,
            currentTime: curT,
            selectedAnnotationId: textAnn.id
          });
          this.openInlineTextEditor(textAnn);
          return;
        } else {
          // Drawing / Creating a new vector annotation
          this.isDrawing = true;
          this.drawStartX = pt.x;
          this.drawStartY = pt.y;

          // Compute duration: Default from current time to current time + 3s (or clip duration)
          const tStart = curT;
          const tEnd = Math.min(clip.duration, curT + 4.0);

          const baseConfig = {
            tStart,
            tEnd,
            x: pt.x,
            y: pt.y,
            width: 0,
            height: 0,
            style: {
              strokeColor: this.toolProperties.strokeColor,
              strokeWidth: this.toolProperties.strokeWidth,
              fillType: this.toolProperties.fillType,
              fillColor: this.toolProperties.strokeColor,
              fillOpacity: this.toolProperties.fillOpacity,
              fontSize: this.toolProperties.fontSize
            }
          };

          if (this.activeTool === 'step') {
            baseConfig.stepNumber = this._getNextStepNumber(clip);
            baseConfig.width = 32;
            baseConfig.height = 32;
          } else if (this.activeTool === 'redact') {
            baseConfig.redactMode = this.toolProperties.redactMode;
            baseConfig.blurRadius = this.toolProperties.blurRadius;
            baseConfig.pixelSize = this.toolProperties.pixelSize;
          } else if (this.activeTool === 'spotlight') {
            baseConfig.dimmerOpacity = this.toolProperties.dimmerOpacity;
          } else if (this.activeTool === 'magnifier') {
            baseConfig.zoomLevel = this.toolProperties.zoomLevel;
          }

          baseConfig.type = this.activeTool;
          this.draftAnnotation = TV.AnnotationFactory.create(baseConfig);
        }
      });

      // Double-click on text annotation to edit text
      canvas.addEventListener('dblclick', (e) => {
        const pt = getCanvasPoint(e);
        const clip = this.session.getActiveClip();
        if (!clip) return;
        const curT = this.videoEngine.currentTime;

        for (let i = clip.annotations.length - 1; i >= 0; i--) {
          const ann = clip.annotations[i];
          if (ann.type === 'text' && ann.hitTest(pt.x, pt.y, curT)) {
            this.selectAnnotation(ann.id);
            this.openInlineTextEditor(ann);
            return;
          }
        }
      });

      // Pointer Move
      window.addEventListener('pointermove', (e) => {
        if (this.isPanning) {
          this.panX = e.clientX - this.panStartX;
          this.panY = e.clientY - this.panStartY;
          this._applyViewportTransform();
          return;
        }

        if (this.isDrawing && this.draftAnnotation) {
          const pt = getCanvasPoint(e);
          const isShift = e.shiftKey;

          if (this.draftAnnotation.type === 'arrow') {
            this.draftAnnotation.x = this.drawStartX;
            this.draftAnnotation.y = this.drawStartY;
            let endX = pt.x;
            let endY = pt.y;

            if (isShift) {
              // 45 degree snap
              const dx = endX - this.drawStartX;
              const dy = endY - this.drawStartY;
              const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
              const dist = Math.hypot(dx, dy);
              endX = this.drawStartX + dist * Math.cos(angle);
              endY = this.drawStartY + dist * Math.sin(angle);
            }
            this.draftAnnotation.x2 = endX;
            this.draftAnnotation.y2 = endY;
            this.draftAnnotation.width = endX - this.drawStartX;
            this.draftAnnotation.height = endY - this.drawStartY;
          } else {
            let w = pt.x - this.drawStartX;
            let h = pt.y - this.drawStartY;
            if (isShift) {
              const maxDim = Math.max(Math.abs(w), Math.abs(h));
              w = w < 0 ? -maxDim : maxDim;
              h = h < 0 ? -maxDim : maxDim;
            }
            this.draftAnnotation.x = w < 0 ? pt.x : this.drawStartX;
            this.draftAnnotation.y = h < 0 ? pt.y : this.drawStartY;
            this.draftAnnotation.width = Math.abs(w);
            this.draftAnnotation.height = Math.abs(h);
          }
        }
      });

      // Pointer Up
      window.addEventListener('pointerup', () => {
        if (this.isPanning) {
          this.isPanning = false;
          container.classList.remove('panning');
        }

        if (this.isDrawing && this.draftAnnotation) {
          const clip = this.session.getActiveClip();
          const draft = this.draftAnnotation;
          this.isDrawing = false;
          this.draftAnnotation = null;

          // If size is too small, provide default minimum size
          if (draft.type !== 'arrow' && draft.width < 10 && draft.height < 10) {
            draft.width = draft.type === 'step' ? 32 : 120;
            draft.height = draft.type === 'step' ? 32 : 80;
          } else if (draft.type === 'arrow' && Math.hypot(draft.width, draft.height) < 10) {
            draft.x2 = draft.x + 100;
            draft.y2 = draft.y + 60;
          }

          if (clip) {
            clip.addAnnotation(draft);
            this.selectAnnotation(draft.id);
            this.setTool('select');
            this.timeline.render({
              projectSession: this.session,
              currentTime: this.videoEngine.currentTime,
              selectedAnnotationId: draft.id
            });
            this._saveDraftToStorage();
          }
        }
      });

      // Zoom via Mouse Wheel
      container.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
          this.setViewportZoom(this.viewportZoom + zoomDelta);
        }
      });
    }

    _startObjectMove(ann, startPt) {
      const initialX = ann.x;
      const initialY = ann.y;
      const initialX2 = ann.x2;
      const initialY2 = ann.y2;
      const clip = this.session.getActiveClip();

      const onMove = (ev) => {
        const pt = this._screenToCanvas(ev);
        const dx = pt.x - startPt.x;
        const dy = pt.y - startPt.y;

        ann.x = initialX + dx;
        ann.y = initialY + dy;
        if (ann.type === 'arrow') {
          ann.x2 = initialX2 + dx;
          ann.y2 = initialY2 + dy;
        }
        this._updateInspector();
      };

      const onUp = () => {
        if (clip) clip.saveHistorySnapshot();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        this._saveDraftToStorage();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    _startHandleDrag(ann, handleName, startPt) {
      const initialX = ann.x;
      const initialY = ann.y;
      const initialW = ann.width;
      const initialH = ann.height;
      const initialX2 = ann.x2;
      const initialY2 = ann.y2;
      const clip = this.session.getActiveClip();

      const onMove = (ev) => {
        const pt = this._screenToCanvas(ev);
        const dx = pt.x - startPt.x;
        const dy = pt.y - startPt.y;

        if (ann.type === 'arrow') {
          if (handleName === 'p1') {
            ann.x = initialX + dx;
            ann.y = initialY + dy;
          } else {
            ann.x2 = initialX2 + dx;
            ann.y2 = initialY2 + dy;
          }
        } else {
          if (handleName.includes('e')) ann.width = Math.max(10, initialW + dx);
          if (handleName.includes('s')) ann.height = Math.max(10, initialH + dy);
          if (handleName.includes('w')) {
            const newW = initialW - dx;
            if (newW >= 10) {
              ann.x = initialX + dx;
              ann.width = newW;
            }
          }
          if (handleName.includes('n')) {
            const newH = initialH - dy;
            if (newH >= 10) {
              ann.y = initialY + dy;
              ann.height = newH;
            }
          }
        }
        this._updateInspector();
      };

      const onUp = () => {
        this.activeHandle = null;
        if (clip) clip.saveHistorySnapshot();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        this._saveDraftToStorage();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    _screenToCanvas(e) {
      const rect = this._dom.canvas.getBoundingClientRect();
      const scaleX = this.renderer.width / rect.width;
      const scaleY = this.renderer.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    }

    _getNextStepNumber(clip) {
      let max = 0;
      clip.annotations.forEach((a) => {
        if (a.type === 'step' && typeof a.stepNumber === 'number') {
          if (a.stepNumber > max) max = a.stepNumber;
        }
      });
      return max + 1;
    }

    /* --------------------------------------------------------------------------
       Inline Text Editor on Canvas
       -------------------------------------------------------------------------- */
    openInlineTextEditor(ann) {
      this.commitInlineTextEditor();
      if (!ann || ann.type !== 'text') return;

      ann._isEditing = true;
      const rect = this._dom.canvas.getBoundingClientRect();
      const scaleX = rect.width / this.renderer.width;
      const scaleY = rect.height / this.renderer.height;

      const screenX = rect.left + ann.x * scaleX;
      const screenY = rect.top + ann.y * scaleY;
      const fontSize = Math.max(12, Math.round((ann.style.fontSize || 16) * scaleY));

      const hasFill = ann.style.fillType && ann.style.fillType !== 'none';
      const ta = document.createElement('textarea');
      ta.id = 'canvasTextEditor';
      ta.value = ann.text === 'Tulis catatan...' || ann.text === 'Catatan' || ann.text === 'Tulis catatan bukti...' ? '' : ann.text;
      ta.placeholder = 'Ketik catatan...';
      ta.style.left = `${screenX}px`;
      ta.style.top = `${screenY}px`;
      ta.style.fontSize = `${fontSize}px`;
      ta.style.color = hasFill ? '#ffffff' : (ann.style.strokeColor || '#ef4444');
      ta.style.backgroundColor = hasFill ? (ann.style.fillColor || '#14b8a6') : 'transparent';

      const updateSize = () => {
        ann.text = ta.value;
        if (ann.recalculateBounds) ann.recalculateBounds();
        const curRect = this._dom.canvas.getBoundingClientRect();
        const curScaleX = curRect.width / this.renderer.width;
        const curScaleY = curRect.height / this.renderer.height;
        ta.style.left = `${curRect.left + ann.x * curScaleX}px`;
        ta.style.top = `${curRect.top + ann.y * curScaleY}px`;
        ta.style.width = `${Math.max(80, ann.width * curScaleX + 8)}px`;
        ta.style.height = `${Math.max(26, ann.height * curScaleY + 4)}px`;
        this._updateInspector();
      };

      ta.addEventListener('input', updateSize);

      ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.commitInlineTextEditor();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.commitInlineTextEditor();
        }
      });

      ta.addEventListener('blur', () => {
        this.commitInlineTextEditor();
      });

      document.body.appendChild(ta);
      this._inlineEditor = { textarea: ta, annotation: ann };
      updateSize();
      ta.focus();
      ta.select();
    }

    commitInlineTextEditor() {
      if (!this._inlineEditor) return;
      const { textarea, annotation } = this._inlineEditor;
      this._inlineEditor = null;
      annotation._isEditing = false;

      const val = textarea.value.trim();
      if (val) {
        annotation.text = textarea.value;
      } else {
        annotation.text = 'Catatan';
      }
      if (annotation.recalculateBounds) annotation.recalculateBounds();
      textarea.remove();

      const clip = this.session.getActiveClip();
      if (clip) clip.saveHistorySnapshot();
      this.setTool('select');
      this.selectAnnotation(annotation.id);
      this._saveDraftToStorage();
    }

    /* --------------------------------------------------------------------------
       Viewport Zoom & Pan Transforms
       -------------------------------------------------------------------------- */
    setViewportZoom(zoom) {
      this.viewportZoom = Math.max(0.25, Math.min(zoom, 4.0));
      this._applyViewportTransform();
      this._dom.zoomIndicator.textContent = `${Math.round(this.viewportZoom * 100)}%`;
    }

    _applyViewportTransform() {
      this._dom.viewportWrapper.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.viewportZoom})`;
    }

    _fitViewportToContainer() {
      const container = this._dom.viewportContainer;
      const clip = this.session.getActiveClip();
      if (!clip) return;

      const contW = container.clientWidth - 40;
      const contH = container.clientHeight - 40;
      const scale = Math.min(contW / clip.width, contH / clip.height, 1.0);

      this.viewportZoom = Math.max(0.25, scale);
      this.panX = 0;
      this.panY = 0;
      this._applyViewportTransform();
      this._dom.zoomIndicator.textContent = `${Math.round(this.viewportZoom * 100)}%`;
    }

    /* --------------------------------------------------------------------------
       Inspector Property Bindings
       -------------------------------------------------------------------------- */
    _bindInspectorEvents() {
      // Color swatches
      document.querySelectorAll('.color-swatch[data-color]').forEach((swatch) => {
        swatch.addEventListener('click', () => {
          const col = swatch.getAttribute('data-color');
          this._applyColorChange(col);
        });
      });

      document.getElementById('customColorPicker')?.addEventListener('input', (e) => {
        this._applyColorChange(e.target.value);
      });

      // Stroke width slider
      document.getElementById('strokeWidthSlider')?.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.toolProperties.strokeWidth = val;
        document.getElementById('strokeWidthVal').textContent = `${val}px`;
        this._applyPropertyChange('strokeWidth', val);
      });

      // Blur radius slider
      document.getElementById('blurRadiusSlider')?.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.toolProperties.blurRadius = val;
        document.getElementById('blurRadiusVal').textContent = `${val}px`;
        this._applyPropertyChange('blurRadius', val);
      });

      // Fill style selector
      document.getElementById('fillStyleSelect')?.addEventListener('change', (e) => {
        this.toolProperties.fillType = e.target.value;
        this._applyPropertyChange('fillType', e.target.value);
      });

      // Redact mode selector
      document.getElementById('redactModeSelect')?.addEventListener('change', (e) => {
        this.toolProperties.redactMode = e.target.value;
        this._applyPropertyChange('redactMode', e.target.value);
      });

      // Text Annotation inspector inputs
      const textInput = document.getElementById('inspectorTextInput');
      textInput?.addEventListener('input', (e) => {
        if (!this.selectedAnnotationId) return;
        const clip = this.session.getActiveClip();
        const ann = clip ? clip.getAnnotation(this.selectedAnnotationId) : null;
        if (!ann || ann.type !== 'text') return;
        ann.text = e.target.value;
        if (ann.recalculateBounds) ann.recalculateBounds();
        this._saveDraftToStorage();
      });

      textInput?.addEventListener('change', () => {
        const clip = this.session.getActiveClip();
        if (clip) clip.saveHistorySnapshot();
        this._saveDraftToStorage();
      });

      // Font size slider
      const fontSizeSlider = document.getElementById('fontSizeSlider');
      const fontSizeVal = document.getElementById('fontSizeVal');
      fontSizeSlider?.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.toolProperties.fontSize = val;
        if (fontSizeVal) fontSizeVal.textContent = `${val}px`;
        if (!this.selectedAnnotationId) return;
        const clip = this.session.getActiveClip();
        const ann = clip ? clip.getAnnotation(this.selectedAnnotationId) : null;
        if (!ann) return;
        ann.style.fontSize = val;
        if (ann.recalculateBounds) ann.recalculateBounds();
        clip.saveHistorySnapshot();
        this._saveDraftToStorage();
      });

      // Split Annotation Button in Inspector
      document.getElementById('splitAnnotationInspectorBtn')?.addEventListener('click', () => {
        if (!this.selectedAnnotationId) return;
        const clip = this.session.getActiveClip();
        const ann = clip ? clip.getAnnotation(this.selectedAnnotationId) : null;
        if (ann) {
          const curT = this.videoEngine.currentTime;
          if (curT > ann.tStart + 0.05 && curT < ann.tEnd - 0.05) {
            this.splitSelectedAnnotation(ann, curT);
          } else {
            this.showToast(`Pindahkan playhead ke antara ${TV.VideoEngine.formatDuration(ann.tStart)} dan ${TV.VideoEngine.formatDuration(ann.tEnd)} untuk membagi anotasi ini.`, 'warning');
          }
        }
      });

      // Delete button in inspector
      document.getElementById('deleteAnnotationBtn')?.addEventListener('click', () => {
        this.deleteSelectedAnnotation();
      });

      // Editable Time Start (Waktu Mulai)
      const timeInInput = document.getElementById('inspectorTimeIn');
      const handleTimeInChange = () => {
        if (!this.selectedAnnotationId) return;
        const clip = this.session.getActiveClip();
        const ann = clip ? clip.getAnnotation(this.selectedAnnotationId) : null;
        if (!ann || !clip) return;

        const val = timeInInput.value;
        const parsed = TV.VideoEngine.parseTimeString(val);

        if (parsed === null) {
          this.showToast('Format waktu tidak valid (Gunakan format MM:SS.ms atau detik)', 'error');
          timeInInput.value = TV.VideoEngine.formatDuration(ann.tStart);
          return;
        }

        let newStart = Math.max(0, parsed);

        if (newStart > clip.duration) {
          this.showToast(`Waktu mulai tidak boleh melebihi durasi video (${TV.VideoEngine.formatDuration(clip.duration)})`, 'error');
          timeInInput.value = TV.VideoEngine.formatDuration(ann.tStart);
          return;
        }

        if (newStart >= ann.tEnd) {
          this.showToast(`Waktu mulai (${TV.VideoEngine.formatDuration(newStart)}) tidak boleh lebih besar atau sama dengan waktu selesai (${TV.VideoEngine.formatDuration(ann.tEnd)})`, 'error');
          timeInInput.value = TV.VideoEngine.formatDuration(ann.tStart);
          return;
        }

        ann.tStart = newStart;
        timeInInput.value = TV.VideoEngine.formatDuration(ann.tStart);
        clip.saveHistorySnapshot();
        this.timeline.render({
          projectSession: this.session,
          currentTime: this.videoEngine.currentTime,
          selectedAnnotationId: ann.id
        });
        this._saveDraftToStorage();
        this.showToast(`Waktu mulai diubah ke ${TV.VideoEngine.formatDuration(newStart)}`, 'success');
      };

      timeInInput?.addEventListener('change', handleTimeInChange);
      timeInInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          timeInInput.blur();
        }
      });

      // Editable Time End (Waktu Selesai)
      const timeOutInput = document.getElementById('inspectorTimeOut');
      const handleTimeOutChange = () => {
        if (!this.selectedAnnotationId) return;
        const clip = this.session.getActiveClip();
        const ann = clip ? clip.getAnnotation(this.selectedAnnotationId) : null;
        if (!ann || !clip) return;

        const val = timeOutInput.value;
        const parsed = TV.VideoEngine.parseTimeString(val);

        if (parsed === null) {
          this.showToast('Format waktu tidak valid (Gunakan format MM:SS.ms atau detik)', 'error');
          timeOutInput.value = TV.VideoEngine.formatDuration(ann.tEnd);
          return;
        }

        let newEnd = parsed;

        if (newEnd > clip.duration) {
          newEnd = clip.duration;
          this.showToast(`Waktu selesai disesuaikan ke batas maksimal video (${TV.VideoEngine.formatDuration(clip.duration)})`, 'info');
        }

        if (newEnd <= ann.tStart) {
          this.showToast(`Waktu selesai (${TV.VideoEngine.formatDuration(newEnd)}) tidak boleh lebih kecil atau sama dengan waktu mulai (${TV.VideoEngine.formatDuration(ann.tStart)})`, 'error');
          timeOutInput.value = TV.VideoEngine.formatDuration(ann.tEnd);
          return;
        }

        ann.tEnd = newEnd;
        timeOutInput.value = TV.VideoEngine.formatDuration(ann.tEnd);
        clip.saveHistorySnapshot();
        this.timeline.render({
          projectSession: this.session,
          currentTime: this.videoEngine.currentTime,
          selectedAnnotationId: ann.id
        });
        this._saveDraftToStorage();
        this.showToast(`Waktu selesai diubah ke ${TV.VideoEngine.formatDuration(newEnd)}`, 'success');
      };

      timeOutInput?.addEventListener('change', handleTimeOutChange);
      timeOutInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          timeOutInput.blur();
        }
      });
    }

    _applyColorChange(col) {
      this.toolProperties.strokeColor = col;
      document.querySelectorAll('.color-swatch').forEach((s) => {
        s.classList.toggle('active', s.getAttribute('data-color') === col);
      });
      const customPicker = document.getElementById('customColorPicker');
      if (customPicker) customPicker.value = col;

      if (this.selectedAnnotationId) {
        const clip = this.session.getActiveClip();
        const ann = clip ? clip.getAnnotation(this.selectedAnnotationId) : null;
        if (ann) {
          ann.style.strokeColor = col;
          if (ann.type === 'step') ann.style.fillColor = col;
          clip.saveHistorySnapshot();
          this.timeline.updateView();
          this._saveDraftToStorage();
        }
      }
    }

    _applyPropertyChange(key, val) {
      if (!this.selectedAnnotationId) return;
      const clip = this.session.getActiveClip();
      const ann = clip ? clip.getAnnotation(this.selectedAnnotationId) : null;
      if (!ann) return;

      if (key === 'strokeWidth' || key === 'fillType' || key === 'fontSize') {
        ann.style[key] = val;
        if (ann.recalculateBounds) ann.recalculateBounds();
      } else {
        ann[key] = val;
      }
      clip.saveHistorySnapshot();
      this.timeline.updateView();
      this._saveDraftToStorage();
    }

    selectAnnotation(id) {
      this.selectedAnnotationId = id;
      this._updateInspector();
      this.timeline.setSelectedAnnotation(id);
    }

    deleteSelectedAnnotation() {
      if (!this.selectedAnnotationId) return;
      const clip = this.session.getActiveClip();
      if (clip) {
        clip.removeAnnotation(this.selectedAnnotationId);
        this.selectedAnnotationId = null;
        this._updateInspector();
        this.timeline.render({
          projectSession: this.session,
          currentTime: this.videoEngine.currentTime,
          selectedAnnotationId: null
        });
        this.showToast('Objek anotasi berhasil dihapus.', 'info');
        this._saveDraftToStorage();
      }
    }

    /* --------------------------------------------------------------------------
       Split / Cut Video & Annotations (Razor Tool)
       -------------------------------------------------------------------------- */
    splitAtPlayhead() {
      const clip = this.session.getActiveClip();
      if (!clip || clip.duration <= 0) {
        this.showToast('Muat video terlebih dahulu untuk membagi klip.', 'info');
        return;
      }

      const curT = this.videoEngine.currentTime;

      // 1. If an annotation is selected and playhead is within its duration, split the annotation
      if (this.selectedAnnotationId) {
        const ann = clip.getAnnotation(this.selectedAnnotationId);
        if (ann && curT > ann.tStart + 0.05 && curT < ann.tEnd - 0.05) {
          this.splitSelectedAnnotation(ann, curT);
          return;
        }
      }

      // 2. Otherwise split the video clip into two sequential parts
      this.splitCurrentClip(curT);
    }

    splitSelectedAnnotation(ann, splitTime) {
      const clip = this.session.getActiveClip();
      if (!clip || !ann) return;

      const origEnd = ann.tEnd;
      ann.tEnd = splitTime;

      const cloned = ann.clone();
      cloned.tStart = splitTime;
      cloned.tEnd = origEnd;
      clip.addAnnotation(cloned);

      this.selectedAnnotationId = cloned.id;
      clip.saveHistorySnapshot();

      this.timeline.render({
        projectSession: this.session,
        currentTime: splitTime,
        selectedAnnotationId: cloned.id
      });
      this._updateInspector();
      this._saveDraftToStorage();

      this.showToast(`Anotasi berhasil dipotong di detik ${TV.VideoEngine.formatDuration(splitTime)}!`, 'success');
    }

    splitCurrentClip(splitTime) {
      const clipA = this.session.getActiveClip();
      if (!clipA) return;

      const tStart = typeof clipA.trimIn === 'number' ? clipA.trimIn : 0;
      const tEnd = typeof clipA.trimOut === 'number' ? clipA.trimOut : clipA.duration;

      if (splitTime <= tStart + 0.1 || splitTime >= tEnd - 0.1) {
        this.showToast(`Pindahkan playhead ke antara ${TV.VideoEngine.formatDuration(tStart)} dan ${TV.VideoEngine.formatDuration(tEnd)} untuk memotong klip.`, 'warning');
        return;
      }

      const origTrimOut = tEnd;
      const baseName = (clipA.name || 'Video').replace(/\s*\(Bagian\s*\d+\)/i, '').replace(/\s*\(Part\s*\d+\)/i, '');
      const curIndex = this.session.clips.indexOf(clipA);

      // Distribute annotations between Part 1 and Part 2
      const annotationsForA = [];
      const annotationsForB = [];

      clipA.annotations.forEach((ann) => {
        if (ann.tEnd <= splitTime) {
          annotationsForA.push(ann);
        } else if (ann.tStart >= splitTime) {
          annotationsForB.push(ann);
        } else {
          // Crosses split point: divide into two annotations
          const partA = ann;
          const origEnd = ann.tEnd;
          partA.tEnd = splitTime;
          annotationsForA.push(partA);

          const partB = ann.clone();
          partB.tStart = splitTime;
          partB.tEnd = origEnd;
          annotationsForB.push(partB);
        }
      });

      // Update Clip A (Part 1)
      clipA.name = `${baseName} (Bagian 1)`;
      clipA.trimOut = splitTime;
      clipA.annotations = annotationsForA;
      clipA.saveHistorySnapshot();

      // Create Clip B (Part 2)
      const partNum = curIndex + 2;
      const clipB = new TV.VideoClip({
        name: `${baseName} (Bagian ${partNum})`,
        file: clipA.file,
        blobUrl: clipA.blobUrl,
        duration: clipA.duration,
        width: clipA.width,
        height: clipA.height,
        fps: clipA.fps,
        trimIn: splitTime,
        trimOut: origTrimOut,
        annotations: annotationsForB
      });

      this.session.insertClip(curIndex + 1, clipB);
      this.session.activeClipIndex = curIndex + 1;

      this.timeline.render({
        projectSession: this.session,
        currentTime: splitTime,
        selectedAnnotationId: null
      });
      this._updateInspector();
      this._saveDraftToStorage();

      this.showToast(`Klip berhasil dibagi di ${TV.VideoEngine.formatDuration(splitTime)}! (Bagian 1 & Bagian ${partNum})`, 'success');
    }

    _updateInspector() {
      const clip = this.session.getActiveClip();
      const ann = clip && this.selectedAnnotationId ? clip.getAnnotation(this.selectedAnnotationId) : null;
      const inspectorEl = document.querySelector('.app-inspector');
      const emptyStateEl = document.getElementById('inspectorEmptyState');
      const propFormEl = document.getElementById('inspectorPropertyForm');
      const markerListEl = document.getElementById('markerListContainer');

      // Update Marker List
      if (markerListEl && clip) {
        markerListEl.innerHTML = '';
        clip.annotations.forEach((a, i) => {
          const item = document.createElement('div');
          item.className = `marker-item ${a.id === this.selectedAnnotationId ? 'active' : ''}`;
          item.innerHTML = `
            <div class="marker-item-info">
              <div class="marker-item-badge" style="background:${this.timeline._getAnnotationTrackColor(a)}"></div>
              <span>${a.type.toUpperCase()} #${i + 1}</span>
            </div>
            <span class="marker-item-time">${TV.VideoEngine.formatDuration(a.tStart)} - ${TV.VideoEngine.formatDuration(a.tEnd)}</span>
          `;
          item.addEventListener('click', () => {
            this.videoEngine.currentTime = a.tStart;
            this.selectAnnotation(a.id);
          });
          markerListEl.appendChild(item);
        });
      }

      if (!ann) {
        if (emptyStateEl) emptyStateEl.hidden = false;
        if (propFormEl) propFormEl.hidden = true;
        return;
      }

      if (emptyStateEl) emptyStateEl.hidden = true;
      if (propFormEl) propFormEl.hidden = false;

      // Fill values in form (only when not actively focused by user)
      document.getElementById('inspectorTypeVal').textContent = ann.type.toUpperCase();
      
      const timeInInput = document.getElementById('inspectorTimeIn');
      const timeOutInput = document.getElementById('inspectorTimeOut');
      if (timeInInput && document.activeElement !== timeInInput) {
        timeInInput.value = TV.VideoEngine.formatDuration(ann.tStart);
      }
      if (timeOutInput && document.activeElement !== timeOutInput) {
        timeOutInput.value = TV.VideoEngine.formatDuration(ann.tEnd);
      }

      // Toggle control groups based on type
      const redactGroup = document.getElementById('inspectorRedactControls');
      if (redactGroup) redactGroup.hidden = ann.type !== 'redact';

      const textGroup = document.getElementById('inspectorTextControls');
      if (textGroup) {
        textGroup.hidden = ann.type !== 'text';
        if (ann.type === 'text') {
          const textInput = document.getElementById('inspectorTextInput');
          if (textInput && document.activeElement !== textInput) {
            textInput.value = ann.text || '';
          }
          const fontSlider = document.getElementById('fontSizeSlider');
          const fontVal = document.getElementById('fontSizeVal');
          if (fontSlider) fontSlider.value = ann.style.fontSize || 16;
          if (fontVal) fontVal.textContent = `${ann.style.fontSize || 16}px`;
        }
      }
    }

    /* --------------------------------------------------------------------------
       Playback UI Helpers
       -------------------------------------------------------------------------- */
    _updatePlaybackUI() {
      const curT = this.videoEngine.currentTime;
      const dur = this.videoEngine.duration;
      const fps = this.session.getActiveClip()?.fps || 30;

      this._dom.timecodeCurrent.textContent = TV.VideoEngine.formatTimecode(curT, fps);
      this._dom.timecodeTotal.textContent = TV.VideoEngine.formatTimecode(dur, fps);
    }

    /* --------------------------------------------------------------------------
       Keyboard Shortcuts
       -------------------------------------------------------------------------- */
    _bindKeyboardShortcuts() {
      window.addEventListener('keydown', (e) => {
        // Ignore shortcuts if typing in text input/textarea
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
          return;
        }

        const isCtrl = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();

        // Enter on a selected text annotation opens inline text editor
        if (e.key === 'Enter' && !isCtrl && this.selectedAnnotationId) {
          const clip = this.session.getActiveClip();
          const ann = clip ? clip.getAnnotation(this.selectedAnnotationId) : null;
          if (ann && ann.type === 'text') {
            e.preventDefault();
            this.openInlineTextEditor(ann);
            return;
          }
        }

        if (e.code === 'Space') {
          e.preventDefault();
          if (!this.isSpacePressed) {
            this.isSpacePressed = true;
            this.videoEngine.togglePlay();
          }
          return;
        }

        if (key === '.' || key === '>') {
          this.videoEngine.stepFrame(1);
        } else if (key === ',' || key === '<') {
          this.videoEngine.stepFrame(-1);
        } else if (key === 'arrowleft') {
          this.videoEngine.jumpSeconds(e.shiftKey ? -5 : -1);
        } else if (key === 'arrowright') {
          this.videoEngine.jumpSeconds(e.shiftKey ? 5 : 1);
        } else if (key === 'i') {
          const clip = this.session.getActiveClip();
          if (clip) {
            clip.trimIn = this.videoEngine.currentTime;
            this.timeline.render({
              projectSession: this.session,
              currentTime: this.videoEngine.currentTime,
              selectedAnnotationId: this.selectedAnnotationId
            });
            this.showToast(`Set Batas Mulai (START): ${TV.VideoEngine.formatDuration(clip.trimIn)}`, 'info');
          }
        } else if (key === 'o') {
          const clip = this.session.getActiveClip();
          if (clip) {
            clip.trimOut = this.videoEngine.currentTime;
            this.timeline.render({
              projectSession: this.session,
              currentTime: this.videoEngine.currentTime,
              selectedAnnotationId: this.selectedAnnotationId
            });
            this.showToast(`Set Batas Akhir (END): ${TV.VideoEngine.formatDuration(clip.trimOut)}`, 'info');
          }
        } else if (isCtrl && key === 'c') {
          e.preventDefault();
          this.copyFrameSnapshot();
        } else if ((!isCtrl && (key === 'c' || key === 'k')) || (isCtrl && key === 'k')) {
          e.preventDefault();
          this.splitAtPlayhead();
        } else if (isCtrl && key === 's') {
          e.preventDefault();
          this.saveFrameSnapshotPNG();
        } else if (isCtrl && key === 'e') {
          e.preventDefault();
          this.openExportModal();
        } else if (isCtrl && key === 'z') {
          e.preventDefault();
          this.undo();
        } else if (isCtrl && key === 'y') {
          e.preventDefault();
          this.redo();
        } else if (key === 'delete' || key === 'backspace') {
          this.deleteSelectedAnnotation();
        } else if (key === 'v') this.setTool('select');
        else if (key === 'r') this.setTool('rectangle');
        else if (key === 'a') this.setTool('arrow');
        else if (key === 'h') this.setTool('highlighter');
        else if (key === 't') this.setTool('text');
        else if (key === 'n') this.setTool('step');
        else if (key === 'b') this.setTool('redact');
        else if (key === 's') this.setTool('spotlight');
        else if (key === 'm') this.setTool('magnifier');
      });

      window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
          this.isSpacePressed = false;
        }
      });
    }

    undo() {
      const clip = this.session.getActiveClip();
      if (clip && clip.undo()) {
        this.selectedAnnotationId = null;
        this._updateInspector();
        this.timeline.render({
          projectSession: this.session,
          currentTime: this.videoEngine.currentTime,
          selectedAnnotationId: null
        });
        this.showToast('Undo berhasil.', 'info');
      }
    }

    redo() {
      const clip = this.session.getActiveClip();
      if (clip && clip.redo()) {
        this.selectedAnnotationId = null;
        this._updateInspector();
        this.timeline.render({
          projectSession: this.session,
          currentTime: this.videoEngine.currentTime,
          selectedAnnotationId: null
        });
        this.showToast('Redo berhasil.', 'info');
      }
    }

    /* --------------------------------------------------------------------------
       Snapshot & Export Handlers
       -------------------------------------------------------------------------- */
    async copyFrameSnapshot() {
      const clip = this.session.getActiveClip();
      if (!clip) return;
      try {
        const blob = await TV.captureFrameSnapshot(
          this._dom.video,
          clip,
          this.videoEngine.currentTime,
          this.session.watermark
        );
        await TV.copySnapshotToClipboard(blob);
        this.showToast('Tangkapan frame disalin ke clipboard!', 'success');
      } catch (err) {
        this.showToast(`Gagal menyalin frame: ${err.message}`, 'error');
      }
    }

    async saveFrameSnapshotPNG() {
      const clip = this.session.getActiveClip();
      if (!clip) return;
      try {
        const blob = await TV.captureFrameSnapshot(
          this._dom.video,
          clip,
          this.videoEngine.currentTime,
          this.session.watermark
        );
        const stamp = TV.fileStamp(new Date());
        const ref = TV.safeName(this.session.watermark?.ticket) || 'EVIDENCE';
        TV.downloadBlob(blob, `${ref}_snapshot_${stamp}.png`);
        this.showToast('Frame snapshot PNG berhasil diunduh.', 'success');
      } catch (err) {
        this.showToast(`Gagal menyimpan snapshot: ${err.message}`, 'error');
      }
    }

    /* --------------------------------------------------------------------------
       Dropzone, Ingestion & Screen Recording
       -------------------------------------------------------------------------- */
    _bindDropzoneEvents() {
      const dropzone = this._dom.emptyDropzone;
      const fileInput = this._dom.fileInput;

      this._dom.openFileBtn?.addEventListener('click', () => fileInput.click());
      document.getElementById('headerOpenBtn')?.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.loadVideoFile(e.target.files[0]);
        }
      });

      // Drag and Drop
      ['dragenter', 'dragover'].forEach((eventName) => {
        window.addEventListener(eventName, (e) => {
          e.preventDefault();
          dropzone.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach((eventName) => {
        window.addEventListener(eventName, (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
        });
      });

      window.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          this.loadVideoFile(e.dataTransfer.files[0]);
        }
      });

      // Screen Recording
      this._dom.recordBtn?.addEventListener('click', () => this.startScreenRecording());
      document.getElementById('headerRecordBtn')?.addEventListener('click', () => this.startScreenRecording());

      // Playback Controls bindings
      this._dom.playPauseBtn.addEventListener('click', () => this.videoEngine.togglePlay());
      this._dom.prevFrameBtn.addEventListener('click', () => this.videoEngine.stepFrame(-1));
      this._dom.nextFrameBtn.addEventListener('click', () => this.videoEngine.stepFrame(1));
      this._dom.speedSelect.addEventListener('change', (e) => {
        this.videoEngine.setPlaybackRate(parseFloat(e.target.value));
      });
      this._dom.muteBtn.addEventListener('click', () => {
        const muted = this.videoEngine.toggleMute();
        this._dom.muteBtn.textContent = muted ? '🔇' : '🔊';
      });
    }

    async loadVideoFile(file) {
      try {
        this.showToast(`Memuat video: ${file.name}...`, 'info');
        const clip = new TV.VideoClip({
          name: file.name,
          file,
          blobUrl: URL.createObjectURL(file)
        });

        this.session.addClip(clip);
        await this.videoEngine.loadSource(clip.blobUrl);
        this.showToast('Video berhasil dimuat!', 'success');
      } catch (err) {
        this.showToast(`Gagal memuat video: ${err.message}`, 'error');
      }
    }

    async startScreenRecording() {
      const banner = document.getElementById('screenRecordingBanner');
      const timerDisplay = document.getElementById('recordingTimerDisplay');
      const stopBtn = document.getElementById('stopRecordingFloatingBtn');
      let timerInterval = null;
      let startTime = null;

      try {
        this.showToast('Memilih layar untuk direkam...', 'info');
        const session = await TV.VideoEngine.recordScreen();

        // Show banner & start live running seconds timer
        if (banner) banner.hidden = false;
        startTime = Date.now();

        const updateTimer = () => {
          const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
          const m = Math.floor(elapsedSec / 60);
          const s = elapsedSec % 60;
          const p2 = (n) => String(n).padStart(2, '0');
          if (timerDisplay) {
            timerDisplay.textContent = `${p2(m)}:${p2(s)}`;
          }
        };
        updateTimer();
        timerInterval = setInterval(updateTimer, 500);

        // Bind stop button on floating banner
        const onStopClick = () => {
          session.stop();
        };
        if (stopBtn) {
          stopBtn.onclick = onStopClick;
        }

        this.showToast('Perekaman aktif! Klik "Selesai Rekam" atau bilah peramban untuk mengakhiri.', 'info');

        // Await the recording promise when recording stops
        const { blob, file } = await session.complete;

        if (timerInterval) clearInterval(timerInterval);
        if (banner) banner.hidden = true;
        if (stopBtn) stopBtn.onclick = null;

        this.showToast('Perekaman selesai! Memuat video...', 'info');
        await this.loadVideoFile(file);
      } catch (err) {
        if (timerInterval) clearInterval(timerInterval);
        if (banner) banner.hidden = true;
        if (stopBtn) stopBtn.onclick = null;

        if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
          this.showToast('Perekam layar dibatalkan oleh pengguna.', 'info');
        } else {
          this.showToast(`Perekam layar gagal: ${err.message}`, 'error');
        }
      }
    }

    switchClip(index) {
      this.session.activeClipIndex = index;
      const clip = this.session.getActiveClip();
      if (clip && clip.blobUrl) {
        const startT = typeof clip.trimIn === 'number' ? clip.trimIn : 0;
        if (this._dom.video.src === clip.blobUrl) {
          this.videoEngine.currentTime = startT;
        } else {
          this.videoEngine.loadSource(clip.blobUrl);
          this.videoEngine.currentTime = startT;
        }
        this.timeline.render({
          projectSession: this.session,
          currentTime: startT,
          selectedAnnotationId: null
        });
      }
    }

    removeClip(index) {
      this.session.removeClip(index);
      const clip = this.session.getActiveClip();
      if (clip && clip.blobUrl) {
        this.videoEngine.loadSource(clip.blobUrl);
      } else {
        this._dom.emptyDropzone.hidden = false;
      }
      this.timeline.render({
        projectSession: this.session,
        currentTime: 0,
        selectedAnnotationId: null
      });
    }

    /* --------------------------------------------------------------------------
       Modals & Dialogs
       -------------------------------------------------------------------------- */
    _bindModalEvents() {
      // Close modal triggers
      document.querySelectorAll('.modal-close-trigger').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const modal = e.target.closest('.modal-backdrop');
          if (modal) modal.classList.remove('active');
        });
      });

      // Save Watermark Settings
      document.getElementById('saveWatermarkSettingsBtn')?.addEventListener('click', () => {
        this.session.watermark.ticket = document.getElementById('wmTicketInput').value;
        this.session.watermark.author = document.getElementById('wmAuthorInput').value;
        this.session.watermark.position = document.getElementById('wmPositionSelect').value;
        this.session.watermark.showTimecode = document.getElementById('wmTimecodeToggle').checked;
        this._dom.watermarkModal.classList.remove('active');
        this.showToast('Pengaturan stempel bukti disimpan.', 'success');
        this._saveDraftToStorage();
      });

      // Start Export Action
      document.getElementById('startExportBtn')?.addEventListener('click', () => {
        this._executeExport();
      });

      // Project JSON Import/Export
      document.getElementById('exportJsonBtn')?.addEventListener('click', () => {
        const jsonStr = JSON.stringify(this.session.toJSON(), null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        TV.downloadBlob(blob, `tandai_video_project_${TV.fileStamp(new Date())}.tandaivideo`);
        this.showToast('Berkas proyek JSON berhasil diunduh.', 'success');
      });

      document.getElementById('importJsonBtn')?.addEventListener('click', () => {
        document.getElementById('jsonFileInput')?.click();
      });

      document.getElementById('jsonFileInput')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              const data = JSON.parse(ev.target.result);
              if (data.project) {
                this.session = new TV.ProjectSession(data.project);
                this.showToast('Proyek JSON berhasil dimuat!', 'success');
                this._dom.projectModal.classList.remove('active');
                this.timeline.render({
                  projectSession: this.session,
                  currentTime: this.videoEngine.currentTime,
                  selectedAnnotationId: null
                });
              }
            } catch (err) {
              this.showToast('Gagal mem-parsing JSON proyek.', 'error');
            }
          };
          reader.readAsText(file);
        }
      });
    }

    openWatermarkModal() {
      const wm = this.session.watermark;
      document.getElementById('wmTicketInput').value = wm.ticket || '';
      document.getElementById('wmAuthorInput').value = wm.author || '';
      document.getElementById('wmPositionSelect').value = wm.position || 'bottom-right';
      document.getElementById('wmTimecodeToggle').checked = wm.showTimecode !== false;
      this._dom.watermarkModal.classList.add('active');
    }

    openExportModal() {
      this._dom.exportModal.classList.add('active');
      document.getElementById('exportProgressContainer').hidden = true;
      document.getElementById('startExportBtn').disabled = false;
    }

    openProjectModal() {
      this._dom.projectModal.classList.add('active');
    }

    openShortcutsModal() {
      this._dom.shortcutsModal.classList.add('active');
    }

    async _executeExport() {
      const clip = this.session.getActiveClip();
      if (!clip) {
        this.showToast('Tidak ada video untuk diekspor!', 'error');
        return;
      }

      const format = document.getElementById('exportFormatSelect').value;
      const progressContainer = document.getElementById('exportProgressContainer');
      const progressFill = document.getElementById('exportProgressFill');
      const progressLabel = document.getElementById('exportProgressLabel');
      const startBtn = document.getElementById('startExportBtn');

      progressContainer.hidden = false;
      startBtn.disabled = true;

      try {
        if (format === 'snapshot') {
          const blob = await TV.captureFrameSnapshot(
            this._dom.video,
            clip,
            this.videoEngine.currentTime,
            this.session.watermark
          );
          TV.downloadBlob(blob, `snapshot_${TV.fileStamp(new Date())}.png`);
          this.showToast('Snapshot PNG berhasil disimpan!', 'success');
          this._dom.exportModal.classList.remove('active');
          return;
        }

        // Render video klip
        const videoBlob = await TV.exportVideo(
          this.session,
          clip,
          this._dom.video,
          { fps: clip.fps || 30 },
          (percent, text) => {
            progressFill.style.width = `${percent}%`;
            progressLabel.textContent = text;
          }
        );

        if (format === 'zip') {
          // Export full bundle
          const snapshotBlob = await TV.captureFrameSnapshot(
            this._dom.video,
            clip,
            this.videoEngine.currentTime,
            this.session.watermark
          );
          const { zipBlob, fileName } = await TV.exportEvidenceBundle(
            this.session,
            clip,
            videoBlob,
            snapshotBlob,
            (percent, text) => {
              progressFill.style.width = `${percent}%`;
              progressLabel.textContent = text;
            }
          );
          TV.downloadBlob(zipBlob, fileName);
          this.showToast('Paket ZIP Bukti + SHA-256 berhasil diunduh!', 'success');
        } else {
          // Single video file
          const ext = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
          const ticket = TV.safeName(this.session.watermark?.ticket) || 'EVIDENCE';
          TV.downloadBlob(videoBlob, `${ticket}_${TV.fileStamp(new Date())}.${ext}`);
          this.showToast('Video beranotasi berhasil diunduh!', 'success');
        }

        this._dom.exportModal.classList.remove('active');
      } catch (err) {
        this.showToast(`Ekspor gagal: ${err.message}`, 'error');
      } finally {
        startBtn.disabled = false;
      }
    }

    /* --------------------------------------------------------------------------
       Theme & Storage Persistence
       -------------------------------------------------------------------------- */
    toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('tandai_video_theme', next);
    }

    _saveDraftToStorage() {
      try {
        const draft = this.session.toJSON();
        localStorage.setItem('tandai_video_draft', JSON.stringify(draft));
      } catch (e) {
        // LocalStorage quota may be exceeded
      }
    }

    _loadDraftFromStorage() {
      const savedTheme = localStorage.getItem('tandai_video_theme') || 'dark';
      document.documentElement.setAttribute('data-theme', savedTheme);

      try {
        const savedDraft = localStorage.getItem('tandai_video_draft');
        if (savedDraft) {
          const data = JSON.parse(savedDraft);
          if (data.project?.watermark) {
            this.session.watermark = Object.assign(this.session.watermark, data.project.watermark);
          }
        }
      } catch (e) {}
    }

    showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.innerHTML = `
        <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
        <span>${message}</span>
      `;
      this._dom.toastContainer.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 250);
      }, 3500);
    }
  }

  // Auto-boot application on DOM load
  window.addEventListener('DOMContentLoaded', () => {
    global.app = new AppController();
  });

})(window);
