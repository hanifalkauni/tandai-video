/**
 * @file render.js
 * @description Canvas rendering engine for shapes, redaction filters, watermark, spotlight & loupe
 * Adheres to Single Responsibility & High Performance standards
 */

(function (global) {
  'use strict';

  const TV = (global.TV = global.TV || {});

  class CanvasRenderer {
    constructor(canvasElement, videoElement) {
      this.canvas = canvasElement;
      this.ctx = canvasElement.getContext('2d', { willReadFrequently: true });
      this.video = videoElement;

      // Offscreen canvas for fast pixelation / redaction
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });

      // Viewport Transform State
      this.zoom = 1.0; // 0.25 to 4.0
      this.panX = 0;
      this.panY = 0;

      // Base video resolution
      this.width = 1920;
      this.height = 1080;
    }

    setDimensions(width, height) {
      this.width = width || 1920;
      this.height = height || 1080;
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }

    setZoomAndPan(zoom, panX, panY) {
      this.zoom = zoom;
      this.panX = panX;
      this.panY = panY;
    }

    /* --------------------------------------------------------------------------
       Master Render Frame
       -------------------------------------------------------------------------- */
    renderFrame({ clip, currentTime, selectedAnnotationId, hoverAnnotationId, activeHandle, isDrawing, draftAnnotation, watermarkConfig }) {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;

      ctx.clearRect(0, 0, w, h);
      if (!clip) return;

      const annotations = clip.annotations || [];

      // 1. First Pass: Render Redaction Filters (Blur / Pixelate / Blackout) on Video
      for (const ann of annotations) {
        if (ann.isActive(currentTime) && ann.type === 'redact') {
          this._renderRedact(ctx, ann);
        }
      }

      // 2. Second Pass: Render Spotlight / Dimmer (if active)
      for (const ann of annotations) {
        if (ann.isActive(currentTime) && ann.type === 'spotlight') {
          this._renderSpotlight(ctx, ann);
        }
      }

      // 3. Third Pass: Render Magnifier Loupe (if active)
      for (const ann of annotations) {
        if (ann.isActive(currentTime) && ann.type === 'magnifier') {
          this._renderMagnifier(ctx, ann);
        }
      }

      // 4. Fourth Pass: Render Vector Annotations (Rect, Ellipse, Arrow, Text, Step, Highlight)
      for (const ann of annotations) {
        if (!ann.isActive(currentTime)) continue;
        if (['redact', 'spotlight', 'magnifier'].includes(ann.type)) continue;

        const isSelected = ann.id === selectedAnnotationId;
        const isHovered = ann.id === hoverAnnotationId;
        this._renderAnnotation(ctx, ann, isSelected, isHovered);
      }

      // 5. Fifth Pass: Render Live Draft Annotation (during mouse drag creation)
      if (isDrawing && draftAnnotation) {
        this._renderAnnotation(ctx, draftAnnotation, true, false);
      }

      // 6. Sixth Pass: Selection Bounding Box & Transform Handles
      if (selectedAnnotationId) {
        const selected = annotations.find(a => a.id === selectedAnnotationId);
        if (selected && selected.isActive(currentTime)) {
          this._renderSelectionHandles(ctx, selected, activeHandle);
        }
      }

      // 7. Seventh Pass: Evidence Watermark & Burn-in Timecode
      if (watermarkConfig && watermarkConfig.enabled) {
        this._renderWatermark(ctx, watermarkConfig, currentTime, clip.fps);
      }
    }

    /* --------------------------------------------------------------------------
       Annotation Renderers
       -------------------------------------------------------------------------- */
    _renderAnnotation(ctx, ann, isSelected, isHovered) {
      ctx.save();

      const strokeColor = ann.style.strokeColor || '#ff4d4f';
      const strokeWidth = ann.style.strokeWidth || 3;
      const fillType = ann.style.fillType || 'none';
      const fillColor = ann.style.fillColor || strokeColor;
      const fillOpacity = typeof ann.style.fillOpacity === 'number' ? ann.style.fillOpacity : 0.2;

      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = fillColor;

      switch (ann.type) {
        case 'rectangle': {
          if (fillType === 'solid') {
            ctx.globalAlpha = 1.0;
            ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
          } else if (fillType === 'soft') {
            ctx.globalAlpha = fillOpacity;
            ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
          }
          ctx.globalAlpha = 1.0;
          ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
          break;
        }

        case 'ellipse': {
          const rx = ann.width / 2;
          const ry = ann.height / 2;
          const cx = ann.x + rx;
          const cy = ann.y + ry;

          ctx.beginPath();
          ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
          if (fillType === 'solid') {
            ctx.globalAlpha = 1.0;
            ctx.fill();
          } else if (fillType === 'soft') {
            ctx.globalAlpha = fillOpacity;
            ctx.fill();
          }
          ctx.globalAlpha = 1.0;
          ctx.stroke();
          break;
        }

        case 'arrow': {
          const x1 = ann.x, y1 = ann.y;
          const x2 = typeof ann.x2 === 'number' ? ann.x2 : ann.x + ann.width;
          const y2 = typeof ann.y2 === 'number' ? ann.y2 : ann.y + ann.height;
          this._drawArrow(ctx, x1, y1, x2, y2, strokeColor, strokeWidth);
          break;
        }

        case 'highlighter': {
          ctx.save();
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = strokeColor;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
          ctx.restore();
          break;
        }

        case 'text': {
          if (ann._isEditing) {
            break;
          }

          const text = ann.text || 'Catatan';
          const fontSize = ann.style.fontSize || 16;
          ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, Roboto, sans-serif`;
          ctx.textBaseline = 'top';

          // Measure multiline text
          const lines = text.split('\n');
          const lineHeight = fontSize * 1.35;
          let maxLineW = 0;
          lines.forEach(l => {
            const w = ctx.measureText(l).width;
            if (w > maxLineW) maxLineW = w;
          });

          const hasFill = ann.style.fillType && ann.style.fillType !== 'none';
          const padX = hasFill ? fontSize * 0.35 : 0;
          const padY = hasFill ? fontSize * 0.25 : 0;
          const boxW = maxLineW + padX * 2;
          const boxH = lines.length * lineHeight + padY * 2;

          if (hasFill) {
            ctx.fillStyle = ann.style.fillColor || ann.style.strokeColor || '#14b8a6';
            ctx.globalAlpha = ann.style.fillType === 'soft' ? 0.88 : 1.0;
            const rad = Math.min(8, fontSize * 0.25);
            this._drawRoundedRect(ctx, ann.x, ann.y, boxW, boxH, rad, true, false);
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = this._getContrastColor(ctx.fillStyle);
          } else {
            // Raw crisp text (matching tandai-ss) with subtle readable shadow
            ctx.fillStyle = ann.style.strokeColor || '#ef4444';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
            ctx.shadowBlur = 3;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 1;
          }

          // Text content
          lines.forEach((line, idx) => {
            ctx.fillText(line, ann.x + padX, ann.y + padY + idx * lineHeight);
          });
          break;
        }

        case 'step': {
          const radius = Math.max(16, (ann.width || 32) / 2);
          const cx = ann.x + radius;
          const cy = ann.y + radius;
          const num = ann.stepNumber || 1;

          // Outer shadow & badge circle
          ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fillStyle = ann.style.fillColor || '#4f8cff';
          ctx.fill();

          ctx.shadowBlur = 0;
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();

          // Step Number Text
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${Math.round(radius * 1.1)}px -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(num), cx, cy + 1);
          break;
        }
      }

      ctx.restore();
    }

    /* --------------------------------------------------------------------------
       Redaction Renderers (Blur, Pixelate, Blackout)
       -------------------------------------------------------------------------- */
    _renderRedact(ctx, ann) {
      const x = Math.round(ann.x);
      const y = Math.round(ann.y);
      const w = Math.round(ann.width);
      const h = Math.round(ann.height);
      if (w <= 0 || h <= 0) return;

      ctx.save();
      const mode = ann.redactMode || 'blur';

      if (mode === 'blackout') {
        ctx.fillStyle = '#0a0b0e';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(255, 82, 82, 0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
      } else if (mode === 'pixelate') {
        const pixelSize = Math.max(6, ann.pixelSize || 12);
        const smallW = Math.max(1, Math.floor(w / pixelSize));
        const smallH = Math.max(1, Math.floor(h / pixelSize));

        this.offscreenCanvas.width = smallW;
        this.offscreenCanvas.height = smallH;
        this.offscreenCtx.imageSmoothingEnabled = false;

        // Downsample video region
        this.offscreenCtx.drawImage(this.video, x, y, w, h, 0, 0, smallW, smallH);

        // Upsample back to main canvas
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.offscreenCanvas, 0, 0, smallW, smallH, x, y, w, h);
        ctx.imageSmoothingEnabled = true;

        // Subtle frame
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
      } else {
        // Gaussian Blur
        const radius = ann.blurRadius || 12;
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();

        ctx.filter = `blur(${radius}px)`;
        ctx.drawImage(this.video, 0, 0, this.width, this.height);
        ctx.filter = 'none';

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
      }

      ctx.restore();
    }

    /* --------------------------------------------------------------------------
       Spotlight Dimmer Renderer
       -------------------------------------------------------------------------- */
    _renderSpotlight(ctx, ann) {
      ctx.save();
      const opacity = typeof ann.dimmerOpacity === 'number' ? ann.dimmerOpacity : 0.7;

      // Fill entire screen with dark dimmer mask
      ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
      ctx.beginPath();
      ctx.rect(0, 0, this.width, this.height);

      // Cut out focal spotlight hole
      if (ann.shape === 'rectangle') {
        ctx.rect(ann.x + ann.width, ann.y, -ann.width, ann.height);
      } else {
        const rx = ann.width / 2;
        const ry = ann.height / 2;
        ctx.ellipse(ann.x + rx, ann.y + ry, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2, true);
      }
      ctx.fill();

      // Glowing border on cutout
      ctx.strokeStyle = 'rgba(79, 140, 255, 0.8)';
      ctx.lineWidth = 2;
      if (ann.shape === 'rectangle') {
        ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
      } else {
        const rx = ann.width / 2;
        const ry = ann.height / 2;
        ctx.beginPath();
        ctx.ellipse(ann.x + rx, ann.y + ry, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }

    /* --------------------------------------------------------------------------
       Magnifier Loupe Lens Renderer (2x / 4x Zoom)
       -------------------------------------------------------------------------- */
    _renderMagnifier(ctx, ann) {
      const x = ann.x, y = ann.y, w = ann.width, h = ann.height;
      const zoom = ann.zoomLevel || 2.5;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rx = w / 2;
      const ry = h / 2;

      ctx.save();
      // Clip to circular lens
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
      ctx.clip();

      // Draw magnified video
      ctx.drawImage(
        this.video,
        cx - (w / zoom) / 2,
        cy - (h / zoom) / 2,
        w / zoom,
        h / zoom,
        x,
        y,
        w,
        h
      );

      // Loupe crosshair & lens border
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#4f8cff';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Center crosshair tick
      ctx.strokeStyle = 'rgba(79, 140, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
      ctx.stroke();

      ctx.restore();
    }

    /* --------------------------------------------------------------------------
       Selection Handles & Bounding Box
       -------------------------------------------------------------------------- */
    _renderSelectionHandles(ctx, ann, activeHandle) {
      ctx.save();
      ctx.strokeStyle = '#4f8cff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);

      if (ann.type === 'arrow') {
        const x1 = ann.x, y1 = ann.y;
        const x2 = typeof ann.x2 === 'number' ? ann.x2 : ann.x + ann.width;
        const y2 = typeof ann.y2 === 'number' ? ann.y2 : ann.y + ann.height;

        this._drawHandle(ctx, x1, y1, activeHandle === 'p1');
        this._drawHandle(ctx, x2, y2, activeHandle === 'p2');
      } else {
        ctx.strokeRect(ann.x - 2, ann.y - 2, ann.width + 4, ann.height + 4);
        ctx.setLineDash([]);

        const handles = ann.getHandles();
        handles.forEach(h => {
          this._drawHandle(ctx, h.x, h.y, activeHandle === h.name);
        });
      }

      ctx.restore();
    }

    _drawHandle(ctx, x, y, isActive) {
      const size = 8;
      ctx.fillStyle = isActive ? '#ff4d4f' : '#ffffff';
      ctx.strokeStyle = '#1e222f';
      ctx.lineWidth = 1.5;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    }

    /* --------------------------------------------------------------------------
       Evidence Watermark & Burn-in Timecode
       -------------------------------------------------------------------------- */
    _renderWatermark(ctx, config, currentTime, fps = 30) {
      ctx.save();
      const pos = config.position || 'bottom-right';
      const ticket = (config.ticket || '').trim();
      const author = (config.author || '').trim();
      const timecode = TV.VideoEngine.formatTimecode(currentTime, fps);
      const nowStr = TV.humanTime(new Date());

      const lines = [];
      if (ticket) lines.push(`REF: ${ticket}`);
      if (author) lines.push(`TESTER: ${author}`);
      if (config.showTimecode !== false) lines.push(`TIMECODE: ${timecode}`);
      lines.push(`STAMP: ${nowStr}`);

      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      const lineHeight = 16;
      let maxW = 0;
      lines.forEach(l => {
        const w = ctx.measureText(l).width;
        if (w > maxW) maxW = w;
      });

      const padX = 10, padY = 8;
      const boxW = maxW + padX * 2;
      const boxH = lines.length * lineHeight + padY * 2;

      let x = 16, y = 16;
      if (pos.includes('right')) x = this.width - boxW - 16;
      if (pos.includes('bottom')) y = this.height - boxH - 16;

      // Dark translucent pill
      ctx.fillStyle = 'rgba(15, 17, 23, 0.85)';
      ctx.strokeStyle = 'rgba(79, 140, 255, 0.5)';
      ctx.lineWidth = 1;
      this._drawRoundedRect(ctx, x, y, boxW, boxH, 6, true, true);

      // Watermark Text
      ctx.fillStyle = '#f0f3fa';
      ctx.textBaseline = 'top';
      lines.forEach((line, i) => {
        if (line.startsWith('REF:')) ctx.fillStyle = '#4f8cff';
        else if (line.startsWith('TIMECODE:')) ctx.fillStyle = '#10b981';
        else ctx.fillStyle = '#9aa4bd';
        ctx.fillText(line, x + padX, y + padY + i * lineHeight);
      });

      ctx.restore();
    }

    /* --------------------------------------------------------------------------
       Drawing Helpers
       -------------------------------------------------------------------------- */
    _drawArrow(ctx, x1, y1, x2, y2, color, width) {
      const headLength = Math.max(14, width * 3.5);
      const angle = Math.atan2(y2 - y1, x2 - x1);

      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';

      // Arrow line
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2 - headLength * 0.5 * Math.cos(angle), y2 - headLength * 0.5 * Math.sin(angle));
      ctx.stroke();

      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - headLength * Math.cos(angle - Math.PI / 6),
        y2 - headLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        x2 - headLength * Math.cos(angle + Math.PI / 6),
        y2 - headLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    _drawRoundedRect(ctx, x, y, w, h, r, fill, stroke) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    }

    _getContrastColor(color) {
      if (!color) return '#ffffff';
      if (typeof color === 'string' && color.startsWith('#')) {
        let hex = color.slice(1);
        if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
        const r = parseInt(hex.substring(0, 2), 16) || 0;
        const g = parseInt(hex.substring(2, 4), 16) || 0;
        const b = parseInt(hex.substring(4, 6), 16) || 0;
        const yiq = (r * 299 + g * 587 + b * 114) / 1000;
        return yiq >= 140 ? '#111827' : '#ffffff';
      }
      return '#ffffff';
    }
  }

  TV.CanvasRenderer = CanvasRenderer;

})(window);
