/**
 * @file model.js
 * @description Data models and Object-Oriented hierarchy for tandai-video
 * Adheres to SOLID principles (Single Responsibility & Open/Closed)
 */

(function (global) {
  'use strict';

  const TV = (global.TV = global.TV || {});

  /** Generate random unique ID */
  TV.generateId = function (prefix = 'ann') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  };

  /**
   * Base class for all temporal annotation objects.
   */
  class BaseAnnotation {
    constructor(config = {}) {
      this.id = config.id || TV.generateId('ann');
      this.type = config.type || 'rectangle';
      this.tStart = typeof config.tStart === 'number' ? config.tStart : 0;
      this.tEnd = typeof config.tEnd === 'number' ? config.tEnd : 5;
      this.x = config.x || 0;
      this.y = config.y || 0;
      this.width = config.width || 120;
      this.height = config.height || 80;
      this.locked = Boolean(config.locked);
      this.hidden = Boolean(config.hidden);
      this.style = Object.assign({
        strokeColor: '#ef4444',
        strokeWidth: 3,
        fillType: 'none', // 'none', 'soft', 'solid'
        fillColor: '#ef4444',
        fillOpacity: 0.2,
        fontSize: 16,
        fontFamily: 'sans-serif',
        text: ''
      }, config.style || {});
    }

    /** Check if annotation is active at time t */
    isActive(t) {
      if (this.hidden) return false;
      return t >= this.tStart && t <= this.tEnd;
    }

    /** Normalize bounding box (ensures width and height are positive) */
    normalizeBounds() {
      if (this.width < 0) {
        this.x += this.width;
        this.width = Math.abs(this.width);
      }
      if (this.height < 0) {
        this.y += this.height;
        this.height = Math.abs(this.height);
      }
    }

    /** Hit test on annotation at point (px, py) */
    hitTest(px, py, t) {
      if (!this.isActive(t)) return false;
      const pad = 6;
      return (
        px >= this.x - pad &&
        px <= this.x + this.width + pad &&
        py >= this.y - pad &&
        py <= this.y + this.height + pad
      );
    }

    /** Get bounding handles for resizing [nw, ne, se, sw, n, e, s, w] */
    getHandles() {
      const x = this.x, y = this.y, w = this.width, h = this.height;
      return [
        { name: 'nw', x: x, y: y },
        { name: 'ne', x: x + w, y: y },
        { name: 'se', x: x + w, y: y + h },
        { name: 'sw', x: x, y: y + h },
        { name: 'n', x: x + w / 2, y: y },
        { name: 'e', x: x + w, y: y + h / 2 },
        { name: 's', x: x + w / 2, y: y + h },
        { name: 'w', x: x, y: y + h / 2 }
      ];
    }

    /** Clone object */
    clone() {
      const json = this.toJSON();
      json.id = TV.generateId(this.type);
      return TV.AnnotationFactory.create(json);
    }

    /** Serialize to JSON */
    toJSON() {
      return {
        id: this.id,
        type: this.type,
        tStart: this.tStart,
        tEnd: this.tEnd,
        x: this.x,
        y: this.y,
        width: this.width,
        height: this.height,
        locked: this.locked,
        hidden: this.hidden,
        style: Object.assign({}, this.style)
      };
    }
  }

  /**
   * Rectangle Annotation
   */
  class RectangleAnnotation extends BaseAnnotation {
    constructor(config = {}) {
      super(config);
      this.type = 'rectangle';
    }
  }

  /**
   * Ellipse / Circle Annotation
   */
  class EllipseAnnotation extends BaseAnnotation {
    constructor(config = {}) {
      super(config);
      this.type = 'ellipse';
    }

    hitTest(px, py, t) {
      if (!this.isActive(t)) return false;
      const rx = this.width / 2;
      const ry = this.height / 2;
      if (rx <= 0 || ry <= 0) return false;
      const cx = this.x + rx;
      const cy = this.y + ry;
      const normX = (px - cx) / (rx + 6);
      const normY = (py - cy) / (ry + 6);
      return normX * normX + normY * normY <= 1;
    }
  }

  /**
   * Arrow Annotation
   */
  class ArrowAnnotation extends BaseAnnotation {
    constructor(config = {}) {
      super(config);
      this.type = 'arrow';
      this.x2 = typeof config.x2 === 'number' ? config.x2 : this.x + this.width;
      this.y2 = typeof config.y2 === 'number' ? config.y2 : this.y + this.height;
    }

    getHandles() {
      return [
        { name: 'p1', x: this.x, y: this.y },
        { name: 'p2', x: this.x2, y: this.y2 }
      ];
    }

    hitTest(px, py, t) {
      if (!this.isActive(t)) return false;
      const dist = TV.distToSegment({ x: px, y: py }, { x: this.x, y: this.y }, { x: this.x2, y: this.y2 });
      return dist <= (this.style.strokeWidth || 3) + 8;
    }

    toJSON() {
      const obj = super.toJSON();
      obj.x2 = this.x2;
      obj.y2 = this.y2;
      return obj;
    }
  }

  /**
   * Highlighter Annotation
   */
  class HighlighterAnnotation extends BaseAnnotation {
    constructor(config = {}) {
      super(config);
      this.type = 'highlighter';
      this.style.strokeColor = this.style.strokeColor || '#ffd13b';
      this.style.fillOpacity = 0.35;
    }
  }

  /**
   * Text Callout Annotation
   */
  const _textMeasureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const _textMeasureCtx = _textMeasureCanvas ? _textMeasureCanvas.getContext('2d') : null;

  class TextAnnotation extends BaseAnnotation {
    constructor(config = {}) {
      super(config);
      this.type = 'text';
      this.text = config.text || config.style?.text || 'Tulis catatan...';
      this.style.fontSize = this.style.fontSize || 16;
      this.style.strokeColor = this.style.strokeColor || '#ef4444';
      this.style.fillType = this.style.fillType || 'none';
      this.style.fillColor = this.style.fillColor || '#14b8a6';
      this.style.fillOpacity = 0.85;
      this.recalculateBounds();
    }

    getHandles() {
      // Text annotations do not have resize handles (drag to move only)
      return [];
    }

    recalculateBounds() {
      const fontSize = this.style.fontSize || 16;
      const lines = (this.text || ' ').split('\n');
      const lineHeight = fontSize * 1.35;
      let maxW = 20;

      if (_textMeasureCtx) {
        _textMeasureCtx.font = `600 ${fontSize}px "Segoe UI", system-ui, -apple-system, sans-serif`;
        lines.forEach((l) => {
          const w = _textMeasureCtx.measureText(l).width;
          if (w > maxW) maxW = w;
        });
      }

      const hasFill = this.style.fillType && this.style.fillType !== 'none';
      const padX = hasFill ? fontSize * 0.35 : 0;
      const padY = hasFill ? fontSize * 0.25 : 0;
      this.width = Math.max(30, Math.round(maxW + padX * 2));
      this.height = Math.max(20, Math.round(lines.length * lineHeight + padY * 2));
    }

    toJSON() {
      const obj = super.toJSON();
      obj.text = this.text;
      return obj;
    }
  }

  /**
   * Step Number Badge Annotation (1, 2, 3...)
   */
  class StepAnnotation extends BaseAnnotation {
    constructor(config = {}) {
      super(config);
      this.type = 'step';
      this.stepNumber = typeof config.stepNumber === 'number' ? config.stepNumber : 1;
      this.width = config.width || 32;
      this.height = config.height || 32;
      this.style.fillColor = this.style.fillColor || '#4f8cff';
      this.style.strokeColor = '#ffffff';
    }

    toJSON() {
      const obj = super.toJSON();
      obj.stepNumber = this.stepNumber;
      return obj;
    }
  }

  /**
   * Sensitive Redaction / Sensor Annotation (Pixelate, Gaussian Blur, Solid Black)
   */
  class RedactAnnotation extends BaseAnnotation {
    constructor(config = {}) {
      super(config);
      this.type = 'redact';
      this.redactMode = config.redactMode || 'blur'; // 'blur', 'pixelate', 'blackout'
      this.blurRadius = typeof config.blurRadius === 'number' ? config.blurRadius : 12;
      this.pixelSize = typeof config.pixelSize === 'number' ? config.pixelSize : 12;
    }

    toJSON() {
      const obj = super.toJSON();
      obj.redactMode = this.redactMode;
      obj.blurRadius = this.blurRadius;
      obj.pixelSize = this.pixelSize;
      return obj;
    }
  }

  /**
   * Spotlight / Dimmer Annotation
   */
  class SpotlightAnnotation extends BaseAnnotation {
    constructor(config = {}) {
      super(config);
      this.type = 'spotlight';
      this.shape = config.shape || 'ellipse'; // 'ellipse', 'rectangle'
      this.dimmerOpacity = typeof config.dimmerOpacity === 'number' ? config.dimmerOpacity : 0.7;
    }

    toJSON() {
      const obj = super.toJSON();
      obj.shape = this.shape;
      obj.dimmerOpacity = this.dimmerOpacity;
      return obj;
    }
  }

  /**
   * Magnifier Loupe Lens Annotation (2x / 4x zoom)
   */
  class MagnifierAnnotation extends BaseAnnotation {
    constructor(config = {}) {
      super(config);
      this.type = 'magnifier';
      this.zoomLevel = typeof config.zoomLevel === 'number' ? config.zoomLevel : 2.5;
      this.width = config.width || 140;
      this.height = config.height || 140;
    }

    toJSON() {
      const obj = super.toJSON();
      obj.zoomLevel = this.zoomLevel;
      return obj;
    }
  }

  /**
   * Factory for creating annotations by type.
   */
  TV.AnnotationFactory = {
    create(data) {
      switch (data.type) {
        case 'ellipse':
          return new EllipseAnnotation(data);
        case 'arrow':
          return new ArrowAnnotation(data);
        case 'highlighter':
          return new HighlighterAnnotation(data);
        case 'text':
          return new TextAnnotation(data);
        case 'step':
          return new StepAnnotation(data);
        case 'redact':
          return new RedactAnnotation(data);
        case 'spotlight':
          return new SpotlightAnnotation(data);
        case 'magnifier':
          return new MagnifierAnnotation(data);
        case 'rectangle':
        default:
          return new RectangleAnnotation(data);
      }
    }
  };

  /**
   * Undo/Redo State History Stack
   */
  class UndoRedoHistory {
    constructor(maxDepth = 50) {
      this.maxDepth = maxDepth;
      this.undoStack = [];
      this.redoStack = [];
    }

    pushState(state) {
      const snapshot = JSON.stringify(state);
      // Avoid duplicate consecutive states
      if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snapshot) {
        return;
      }
      this.undoStack.push(snapshot);
      if (this.undoStack.length > this.maxDepth) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    }

    canUndo() {
      return this.undoStack.length > 1;
    }

    canRedo() {
      return this.redoStack.length > 0;
    }

    undo() {
      if (!this.canUndo()) return null;
      const current = this.undoStack.pop();
      this.redoStack.push(current);
      return JSON.parse(this.undoStack[this.undoStack.length - 1]);
    }

    redo() {
      if (!this.canRedo()) return null;
      const state = this.redoStack.pop();
      this.undoStack.push(state);
      return JSON.parse(state);
    }

    clear() {
      this.undoStack = [];
      this.redoStack = [];
    }
  }

  /**
   * VideoClip Model representing a video asset in session
   */
  class VideoClip {
    constructor(config = {}) {
      this.id = config.id || TV.generateId('clip');
      this.name = config.name || 'Screen_Recording.mp4';
      this.blobUrl = config.blobUrl || null;
      this.file = config.file || null;
      this.duration = config.duration || 0;
      this.width = config.width || 1920;
      this.height = config.height || 1080;
      this.fps = config.fps || 30;
      this.trimIn = typeof config.trimIn === 'number' ? config.trimIn : 0;
      this.trimOut = typeof config.trimOut === 'number' ? config.trimOut : config.duration || 0;
      this.annotations = (config.annotations || []).map(a => 
        a instanceof BaseAnnotation ? a : TV.AnnotationFactory.create(a)
      );
      this.history = new UndoRedoHistory();
      this.saveHistorySnapshot();
    }

    saveHistorySnapshot() {
      this.history.pushState(this.annotations.map(a => a.toJSON()));
    }

    addAnnotation(ann) {
      this.annotations.push(ann);
      this.saveHistorySnapshot();
    }

    removeAnnotation(id) {
      const idx = this.annotations.findIndex(a => a.id === id);
      if (idx !== -1) {
        this.annotations.splice(idx, 1);
        this.saveHistorySnapshot();
      }
    }

    getAnnotation(id) {
      return this.annotations.find(a => a.id === id) || null;
    }

    undo() {
      const state = this.history.undo();
      if (state) {
        this.annotations = state.map(a => TV.AnnotationFactory.create(a));
        return true;
      }
      return false;
    }

    redo() {
      const state = this.history.redo();
      if (state) {
        this.annotations = state.map(a => TV.AnnotationFactory.create(a));
        return true;
      }
      return false;
    }

    toJSON() {
      return {
        id: this.id,
        name: this.name,
        duration: this.duration,
        width: this.width,
        height: this.height,
        fps: this.fps,
        trimIn: this.trimIn,
        trimOut: this.trimOut,
        annotations: this.annotations.map(a => a.toJSON())
      };
    }
  }

  /**
   * ProjectSession Master Data Model
   */
  class ProjectSession {
    constructor(config = {}) {
      this.title = config.title || 'Video Evidence Project';
      this.createdAt = config.createdAt || new Date().toISOString();
      this.clips = (config.clips || []).map(c => new VideoClip(c));
      this.activeClipIndex = config.activeClipIndex || 0;
      this.watermark = Object.assign({
        enabled: true,
        ticket: '',
        author: '',
        position: 'bottom-right', // 'top-left', 'top-right', 'bottom-left', 'bottom-right'
        showTimecode: true,
        showFrameNumber: false
      }, config.watermark || {});
      this.audio = Object.assign({
        muteOnExport: false
      }, config.audio || {});
    }

    getActiveClip() {
      if (this.clips.length === 0) return null;
      if (this.activeClipIndex < 0 || this.activeClipIndex >= this.clips.length) {
        this.activeClipIndex = 0;
      }
      return this.clips[this.activeClipIndex];
    }

    addClip(clip) {
      this.clips.push(clip);
      this.activeClipIndex = this.clips.length - 1;
    }

    removeClip(index) {
      if (index >= 0 && index < this.clips.length) {
        const [removed] = this.clips.splice(index, 1);
        if (removed && removed.blobUrl) {
          URL.revokeObjectURL(removed.blobUrl);
        }
        if (this.activeClipIndex >= this.clips.length) {
          this.activeClipIndex = Math.max(0, this.clips.length - 1);
        }
      }
    }

    toJSON() {
      return {
        version: '1.2.0',
        project: {
          title: this.title,
          createdAt: this.createdAt,
          watermark: this.watermark,
          audio: this.audio,
          clips: this.clips.map(c => c.toJSON()),
          activeClipIndex: this.activeClipIndex
        }
      };
    }
  }

  // Geometric Math Helpers
  TV.distToSegment = function (p, v, w) {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
  };

  // Expose Classes
  TV.BaseAnnotation = BaseAnnotation;
  TV.RectangleAnnotation = RectangleAnnotation;
  TV.EllipseAnnotation = EllipseAnnotation;
  TV.ArrowAnnotation = ArrowAnnotation;
  TV.HighlighterAnnotation = HighlighterAnnotation;
  TV.TextAnnotation = TextAnnotation;
  TV.StepAnnotation = StepAnnotation;
  TV.RedactAnnotation = RedactAnnotation;
  TV.SpotlightAnnotation = SpotlightAnnotation;
  TV.MagnifierAnnotation = MagnifierAnnotation;
  TV.VideoClip = VideoClip;
  TV.ProjectSession = ProjectSession;
  TV.UndoRedoHistory = UndoRedoHistory;

})(window);
