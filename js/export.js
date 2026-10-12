/**
 * @file export.js
 * @description Export Engine for Video (Deterministic Canvas Stream), Frame PNG, ZIP packaging & SHA-256 Manifest
 * Adheres to Single Responsibility Principle & 100% Client-Side Privacy
 */

(function (global) {
  'use strict';

  const TV = (global.TV = global.TV || {});

  /* --------------------------------------------------------------------------
     Export diagnostics logger
     --------------------------------------------------------------------------
     Lightweight, timestamped stage logger to pinpoint where an export/download
     appears to "stall". Disabled by default; enable at runtime from the console
     with:  TV.exportDebug = true   (or window.localStorage 'tv_export_debug').
     Each call prints the stage label and ms elapsed since the export started.
     -------------------------------------------------------------------------- */
  TV.exportDebug = (() => {
    try { return global.localStorage?.getItem('tv_export_debug') === '1'; }
    catch (e) { return false; }
  })();

  let _exportT0 = 0;
  TV.exportLog = (stage, extra) => {
    if (!TV.exportDebug) return;
    const now = (global.performance && performance.now) ? performance.now() : Date.now();
    if (!_exportT0 || stage === 'START') _exportT0 = now;
    const ms = Math.round(now - _exportT0);
    const suffix = extra !== undefined ? ` ${typeof extra === 'object' ? JSON.stringify(extra) : extra}` : '';
    // eslint-disable-next-line no-console
    console.log(`[export +${ms}ms] ${stage}${suffix}`);
  };

  /* --------------------------------------------------------------------------
     CRC-32 & ZIP Packaging (STORE-only, 100% Local Vanilla JS)
     -------------------------------------------------------------------------- */
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  const crc32 = (u8) => {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  /**
   * Zip multiple files into a single Blob (STORE method).
   * files: [{ name: string, data: Uint8Array, date?: Date }]
   */
  TV.zip = (files) => {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;

    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const d = f.date || new Date();
      const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, f.data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);

      offset += 30 + name.length + size;
    }

    const centralSize = central.reduce((n, b) => n + (b.byteLength ?? b.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  };

  /* --------------------------------------------------------------------------
     Cryptographic SHA-256 Hash
     -------------------------------------------------------------------------- */
  TV.sha256 = async (u8) => {
    if (!global.crypto || !crypto.subtle) return null;
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
    return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  /* --------------------------------------------------------------------------
     File Naming & Timestamp Helpers
     -------------------------------------------------------------------------- */
  const p2 = (n) => String(n).padStart(2, '0');
  TV.fileStamp = (d = new Date()) =>
    `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;

  TV.humanTime = (d = new Date()) => {
    const off = -d.getTimezoneOffset(), a = Math.abs(off);
    return (
      `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ` +
      `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ` +
      `GMT${off < 0 ? '-' : '+'}${p2(Math.floor(a / 60))}:${p2(a % 60)}`
    );
  };

  TV.safeName = (s) => (s || '').trim().replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '');

  TV.downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
  };

  /* --------------------------------------------------------------------------
     Remux fragmented MP4 (from MediaRecorder) -> non-fragmented, seekable MP4
     --------------------------------------------------------------------------
     MediaRecorder produces a FRAGMENTED MP4 (moof/mdat fragments, no consolidated
     sample index). Such files play from the start but CANNOT be scrubbed/seeked in
     external players like VLC or Windows Media Player. This remux copies the already
     encoded samples (NO re-encode, no quality loss) into a progressive MP4 with a
     full sample index (stts/stsz/stco/stss) and faststart moov, which restores
     seeking everywhere. 100% client-side using vendored mp4box.js + mp4-muxer.

     Returns the original blob unchanged if remux isn't possible (libs missing,
     non-MP4, non-AVC video, or any parse error) so export never breaks.
     -------------------------------------------------------------------------- */
  const _box2u8 = (box) => {
    const DataStream = (window.MP4Box && window.MP4Box.DataStream);
    if (!DataStream) return null;
    const s = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
    box.write(s);
    return new Uint8Array(s.buffer.slice(8)); // strip 8-byte box header
  };

  TV.remuxToSeekableMp4 = async function (blob) {
    const MP4Box = window.MP4Box;
    const Mp4Muxer = window.Mp4Muxer;
    // Only attempt for MP4 input with both libs present.
    const isMp4 = blob && (blob.type.includes('mp4') || blob.type === '');
    if (!isMp4 || !MP4Box || !Mp4Muxer || !Mp4Muxer.Muxer) {
      TV.exportLog('remux.skip', { reason: !isMp4 ? 'not-mp4' : 'libs-missing' });
      return blob;
    }

    try {
      TV.exportLog('remux.begin', { bytes: blob.size });
      const ab = await blob.arrayBuffer();
      ab.fileStart = 0;

      const input = MP4Box.createFile();
      const tracks = {}; // trackId -> { info, kind, descr, samples: [] }
      let fatal = null;

      await new Promise((resolve, reject) => {
        input.onError = (e) => { fatal = e; reject(new Error('MP4Box parse error: ' + e)); };
        input.onReady = (info) => {
          try {
            for (const t of info.tracks) {
              const trak = input.getTrackById(t.id);
              const entry = trak.mdia.minf.stbl.stsd.entries[0];
              const boxes = entry.boxes || [];
              let kind = null, descr = null;
              if (t.type === 'video' && (t.codec || '').startsWith('avc')) {
                kind = 'video';
                const avcC = boxes.find((b) => b.type === 'avcC');
                descr = avcC ? _box2u8(avcC) : null;
              } else if (t.type === 'audio' && (t.codec || '').startsWith('mp4a')) {
                kind = 'audio';
                const esds = boxes.find((b) => b.type === 'esds');
                try {
                  const dsi = esds && esds.esd && esds.esd.descs[0] && esds.esd.descs[0].descs[0];
                  if (dsi && dsi.data) descr = new Uint8Array(dsi.data);
                } catch (e) {}
              } else {
                continue; // skip unsupported track types/codecs
              }
              tracks[t.id] = { info: t, kind, descr, samples: [] };
              input.setExtractionOptions(t.id, null, { nbSamples: Number.MAX_SAFE_INTEGER });
            }
            input.start();
          } catch (e) { reject(e); return; }
        };
        input.onSamples = (trackId, user, samples) => {
          const t = tracks[trackId];
          if (!t) return;
          for (const s of samples) {
            t.samples.push({
              data: new Uint8Array(s.data),
              cts: s.cts, dts: s.dts, duration: s.duration, is_sync: s.is_sync
            });
          }
        };
        // appendBuffer + flush drive onReady/onSamples synchronously for an
        // in-memory buffer; resolve on the next microtask once flushed.
        input.appendBuffer(ab);
        input.flush();
        resolve();
      });

      if (fatal) return blob;

      const vid = Object.values(tracks).find((t) => t.kind === 'video');
      const aud = Object.values(tracks).find((t) => t.kind === 'audio');
      if (!vid || !vid.samples.length) {
        TV.exportLog('remux.skip', { reason: 'no-avc-video' });
        return blob; // nothing we can safely remux
      }

      const { Muxer, ArrayBufferTarget } = Mp4Muxer;
      const target = new ArrayBufferTarget();
      const cfg = { target, fastStart: 'in-memory' };
      cfg.video = { codec: 'avc', width: vid.info.track_width, height: vid.info.track_height };
      if (aud && aud.samples.length && aud.descr) {
        cfg.audio = {
          codec: 'aac',
          numberOfChannels: aud.info.audio.channel_count || 2,
          sampleRate: aud.info.audio.sample_rate || 48000
        };
      }
      const muxer = new Muxer(cfg);

      const pump = (t, addRaw, codecStr) => {
        const ts = t.info.timescale || 1;
        let first = true;
        for (const s of t.samples) {
          const tUs = Math.round((s.cts / ts) * 1e6);
          const dUs = Math.round((s.duration / ts) * 1e6);
          const meta = (first && t.descr)
            ? { decoderConfig: { codec: codecStr, description: t.descr } }
            : undefined;
          first = false;
          addRaw(s.data, s.is_sync ? 'key' : 'delta', tUs, dUs, meta);
        }
      };

      pump(vid, muxer.addVideoChunkRaw.bind(muxer), 'avc1.42001f');
      if (cfg.audio) pump(aud, muxer.addAudioChunkRaw.bind(muxer), 'mp4a.40.2');

      muxer.finalize();
      const out = new Blob([target.buffer], { type: 'video/mp4' });
      TV.exportLog('remux.done', { bytes: out.size, video: vid.samples.length, audio: aud ? aud.samples.length : 0 });
      return out;
    } catch (err) {
      // Any failure -> keep the original (still plays, just not seekable externally).
      TV.exportLog('remux.error', String(err && err.message || err));
      console.warn('MP4 remux failed, exporting original recording:', err);
      return blob;
    }
  };

  /* --------------------------------------------------------------------------
     Frame Snapshot (PNG / Clipboard API)
     -------------------------------------------------------------------------- */
  TV.captureFrameSnapshot = async (videoElement, clip, currentTime, watermarkConfig) => {
    const canvas = document.createElement('canvas');
    canvas.width = clip.width || videoElement.videoWidth || 1920;
    canvas.height = clip.height || videoElement.videoHeight || 1080;

    // Draw active annotations & watermark via renderer with base video drawn
    const renderer = new TV.CanvasRenderer(canvas, videoElement);
    renderer.setDimensions(canvas.width, canvas.height);
    renderer.renderFrame({
      clip,
      currentTime,
      selectedAnnotationId: null,
      watermarkConfig,
      drawBaseVideo: true
    });

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  };

  TV.copySnapshotToClipboard = async (blob) => {
    if (!navigator.clipboard || !navigator.clipboard.write || !window.ClipboardItem) {
      throw new Error('Clipboard API tidak didukung pada peramban ini.');
    }
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ]);
  };

  /* --------------------------------------------------------------------------
     Video Render & Export Engine (Deterministic Client-Side Render)
     -------------------------------------------------------------------------- */
  TV.exportVideo = async function (projectSession, clip, videoElement, options = {}, onProgress = () => {}) {
    TV.exportLog('exportVideo.begin');
    const clipsToRender = (options.clips && options.clips.length)
      ? options.clips
      : (options.activeClipOnly)
        ? [clip]
        : (projectSession && projectSession.clips && projectSession.clips.length > 0)
          ? projectSession.clips
          : [clip];

    const refClip = clipsToRender[0] || clip;
    const targetFps = options.fps || (refClip ? refClip.fps : 30) || 30;

    // Calculate tasks and total export duration
    const clipTasks = [];
    let totalExportDuration = 0;

    for (const c of clipsToRender) {
      const clipTrimIn = typeof c.trimIn === 'number' ? Math.max(0, c.trimIn) : 0;
      const clipTrimOut = (typeof c.trimOut === 'number' && c.trimOut > clipTrimIn)
        ? Math.min(c.duration || Infinity, c.trimOut)
        : (c.duration || c.rawDuration || 1);
      const dur = Math.max(0.1, clipTrimOut - clipTrimIn);
      totalExportDuration += dur;
      clipTasks.push({
        clip: c,
        trimIn: clipTrimIn,
        trimOut: clipTrimOut,
        duration: dur
      });
    }

    if (totalExportDuration <= 0) totalExportDuration = 1;

    const width = refClip.width || videoElement.videoWidth || 1920;
    const height = refClip.height || videoElement.videoHeight || 1080;

    // Create offscreen canvas for rendering
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = width;
    renderCanvas.height = height;
    const renderer = new TV.CanvasRenderer(renderCanvas, videoElement);
    renderer.setDimensions(width, height);

    // Choose supported mimeType
    let mimeType = 'video/mp4';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';

    // Capture clean canvas stream. We prefer manual frame-pumping (captureStream(0))
    // so we control exactly when each frame is published to the recorder via
    // videoTrack.requestFrame(). This gives a steady output fps and lets us hold the
    // recorder's first frame until a real composite is painted (avoids a black intro).
    let stream;
    let canManualFrame = false;
    try {
      stream = renderCanvas.captureStream(0);
      const vt = stream.getVideoTracks()[0];
      canManualFrame = !!(vt && typeof vt.requestFrame === 'function');
      if (!canManualFrame) {
        // Track exists but can't be pumped manually; fall back to fixed-rate capture.
        stream.getTracks().forEach(t => t.stop());
        stream = renderCanvas.captureStream(targetFps);
      }
    } catch (e) {
      stream = renderCanvas.captureStream(targetFps);
      canManualFrame = false;
    }
    const canvasVideoTrack = stream.getVideoTracks()[0] || null;
    const publishFrame = () => {
      if (canManualFrame && canvasVideoTrack && typeof canvasVideoTrack.requestFrame === 'function') {
        try { canvasVideoTrack.requestFrame(); } catch (e) {}
      }
    };

    // Audio capture handling
    const preserveAudio = !projectSession?.audio?.muteOnExport;
    let audioTrack = null;
    if (preserveAudio && typeof videoElement.captureStream === 'function') {
      try {
        // Reuse one persistent capture stream per <video> element across exports.
        // Re-calling captureStream() every export can leave the previous export's
        // audio track in an 'ended' state; adding an ended track to the next
        // recorder corrupts the muxed output (wrong duration / empty / garbled),
        // which is exactly why the 2nd+ export came out wrong. Cache it and only
        // re-capture when the cached track is gone or ended.
        let vStream = videoElement._tvCaptureStream;
        let aTrack = vStream ? vStream.getAudioTracks()[0] : null;
        if (!vStream || !aTrack || aTrack.readyState === 'ended') {
          vStream = videoElement.captureStream();
          videoElement._tvCaptureStream = vStream;
          aTrack = vStream.getAudioTracks()[0] || null;
          TV.exportLog('audio.recaptured');
        } else {
          TV.exportLog('audio.reusedCache');
        }
        if (aTrack && aTrack.readyState === 'live') {
          audioTrack = aTrack;
          stream.addTrack(audioTrack);
        }
      } catch (err) {
        console.warn('Audio capture not available:', err);
      }
    }

    const recordedChunks = [];
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: options.bitrate || 6000000 // 6 Mbps
    });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    return new Promise(async (resolve, reject) => {
      let isCompleted = false;
      let stopWatchdog = null;
      let streamsCleaned = false;

      // Release every MediaStreamTrack we created/borrowed for this export. Without
      // this, the canvas capture track and the <video>'s audio track stay live after
      // the export finishes; the next export then reuses/collides with those stale
      // tracks and produces a wrong or empty video. Must run on EVERY exit path.
      const cleanupStreams = () => {
        if (streamsCleaned) return;
        streamsCleaned = true;
        try {
          if (audioTrack && stream) { try { stream.removeTrack(audioTrack); } catch (e) {} }
          // Stop the canvas capture track(s). We do NOT stop the audio track here
          // because it belongs to the shared <video> element's own capture stream;
          // stopping it would kill the element's audio for subsequent playback.
          if (stream) {
            stream.getVideoTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
          }
        } catch (e) {}
        TV.exportLog('streams.cleaned');
      };

      const finalizeRecording = (reason) => {
        if (isCompleted) return;
        isCompleted = true;
        if (stopWatchdog) { clearTimeout(stopWatchdog); stopWatchdog = null; }
        const videoBlob = new Blob(recordedChunks, { type: mimeType });
        TV.exportLog('recording.finalized', { reason, chunks: recordedChunks.length, bytes: videoBlob.size });
        cleanupStreams();
        onProgress(99, 'Menyelesaikan rekaman video...');
        resolve(videoBlob);
      };

      recorder.onstop = () => {
        TV.exportLog('recorder.onstop');
        finalizeRecording('onstop');
      };

      recorder.onerror = (err) => {
        TV.exportLog('recorder.onerror', String(err?.message || err));
        if (stopWatchdog) { clearTimeout(stopWatchdog); stopWatchdog = null; }
        isCompleted = true;
        cleanupStreams();
        reject(err);
      };

      // Store initial video state for restoring later
      const initialTime = videoElement.currentTime;
      const initialSrc = videoElement.src;
      const initialMuted = videoElement.muted;
      const initialVolume = videoElement.volume;

      const seekVideo = (time) => new Promise((res) => {
        if (Math.abs(videoElement.currentTime - time) < 0.02) return res();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          videoElement.removeEventListener('seeked', onSeeked);
          clearTimeout(timer);
          res();
        };
        const onSeeked = () => finish();
        const timer = setTimeout(finish, 1500);
        videoElement.addEventListener('seeked', onSeeked);
        videoElement.currentTime = time;
      });

      // Resolve once the <video> has actually presented a decoded frame, so a
      // subsequent drawImage() copies real pixels instead of a blank buffer.
      const waitForVideoFrame = (video) => new Promise((res) => {
        if ('requestVideoFrameCallback' in video) {
          let settled = false;
          const done = () => { if (!settled) { settled = true; res(); } };
          video.requestVideoFrameCallback(() => done());
          // Safety timeout so we never hang if no new frame is presented.
          setTimeout(done, 300);
        } else {
          setTimeout(res, 60);
        }
      });

      const useSource = (url) => new Promise((res) => {
        if (!url || videoElement.src === url) return res();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          videoElement.removeEventListener('loadeddata', finish);
          clearTimeout(timer);
          res();
        };
        const timer = setTimeout(finish, 3000);
        videoElement.addEventListener('loadeddata', finish);
        videoElement.src = url;
        videoElement.load();
      });

      const restore = async () => {
        try {
          videoElement.pause();
          if (videoElement.src !== initialSrc) {
            await useSource(initialSrc);
          }
          videoElement.muted = initialMuted;
          videoElement.volume = initialVolume;
          videoElement.currentTime = initialTime;
        } catch (e) {}
      };

      try {
        videoElement.pause();
        if (!preserveAudio) {
          videoElement.muted = true;
        }

        // Draw initial frame before starting recorder
        const firstTask = clipTasks[0];
        if (firstTask && firstTask.clip.blobUrl) {
          if (videoElement.src !== firstTask.clip.blobUrl) {
            await useSource(firstTask.clip.blobUrl);
          }
          const startSourceT = firstTask.clip.timelineToSourceTime(firstTask.trimIn);
          await seekVideo(startSourceT);
          // Wait until the decoder has actually presented the frame at this time,
          // otherwise drawImage() copies a blank/black buffer into the canvas and the
          // export opens with a few black frames before real pixels arrive.
          await waitForVideoFrame(videoElement);
          renderer.renderFrame({
            clip: firstTask.clip,
            currentTime: firstTask.trimIn,
            selectedAnnotationId: null,
            watermarkConfig: projectSession?.watermark,
            drawBaseVideo: true
          });
          // Publish this real first frame to the capture stream before recording starts.
          publishFrame();
        }

        recorder.start(100);
        let accumulatedExportDuration = 0;

        for (let taskIdx = 0; taskIdx < clipTasks.length; taskIdx++) {
          const task = clipTasks[taskIdx];
          const curClip = task.clip;

          if (videoElement.src !== curClip.blobUrl && curClip.blobUrl) {
            if (recorder.state === 'recording') {
              try { recorder.pause(); } catch (e) {}
            }
            await useSource(curClip.blobUrl);
          }

          const startSourceT = curClip.timelineToSourceTime(task.trimIn);
          await seekVideo(startSourceT);

          // Draw first frame of this clip
          renderer.renderFrame({
            clip: curClip,
            currentTime: task.trimIn,
            selectedAnnotationId: null,
            watermarkConfig: projectSession?.watermark,
            drawBaseVideo: true
          });

          if (recorder.state === 'paused') {
            try { recorder.resume(); } catch (e) {}
          }

          // Run real-time playback render loop for this clip
          await new Promise(async (resolveClipRaw, rejectClip) => {
            let isClipRunning = true;
            let pendingJump = null;

            // Watchdog state: detect when the <video> stops presenting new frames
            // near the end of the clip. requestVideoFrameCallback only fires while
            // frames are actually painted, so the final fraction of a second can
            // stop firing before `ended` or the trimOut threshold is hit, leaving
            // the export stuck just short of 100%.
            let watchdog = null;
            let lastSourceT = -1;
            let stalledTicks = 0;
            let drawTimer = null;

            const finishClip = () => {
              if (!isClipRunning) return;
              isClipRunning = false;
              if (watchdog) { clearInterval(watchdog); watchdog = null; }
              if (drawTimer) { clearInterval(drawTimer); drawTimer = null; }
              videoElement.removeEventListener('ended', onEnded);
              try { videoElement.pause(); } catch (e) {}
              accumulatedExportDuration += task.duration;
              resolveClipRaw();
            };

            const onEnded = () => finishClip();
            videoElement.addEventListener('ended', onEnded);

            try {
              await videoElement.play();
            } catch (playErr) {
              if (watchdog) { clearInterval(watchdog); watchdog = null; }
              videoElement.removeEventListener('ended', onEnded);
              return rejectClip(new Error('Gagal memulai playback video untuk ekspor: ' + playErr.message));
            }

            // Safety net: if frame callbacks dry up near the end, this watchdog
            // still completes the clip. It fires on a timer independent of frame
            // presentation, so a plateaued currentTime won't hang the export.
            watchdog = setInterval(() => {
              if (!isClipRunning) return;
              if (pendingJump !== null || videoElement.seeking) return;
              const curSourceT = videoElement.currentTime;
              const timelineT = curClip.sourceToTimelineTime(curSourceT);
              if (timelineT >= task.trimOut - 0.08 || videoElement.ended) {
                finishClip();
                return;
              }
              // Playback time not advancing while we're supposed to be playing =>
              // treat as a stall and finish once it has been stuck for a moment.
              if (!videoElement.paused) {
                if (Math.abs(curSourceT - lastSourceT) < 0.001) {
                  stalledTicks++;
                  if (stalledTicks >= 6) { // ~900ms of no progress
                    finishClip();
                    return;
                  }
                } else {
                  stalledTicks = 0;
                }
                lastSourceT = curSourceT;
              }
            }, 150);

            // Steady-rate frame pump. We draw + publish exactly one frame per tick at
            // targetFps instead of following the source decode cadence. This keeps the
            // output frame rate even (no choppiness) and, combined with manual
            // requestFrame(), stops the recorder from sampling stale/blank canvas states.
            const frameInterval = 1000 / targetFps;
            let drawing = false;

            const drawTick = async () => {
              if (!isClipRunning || drawing) return;
              drawing = true;
              try {
                const curSourceT = videoElement.currentTime;

                // Seamless ripple cut jump handler
                if (curClip && typeof curClip.getNextPlaybackJump === 'function') {
                  const jumpTo = curClip.getNextPlaybackJump(curSourceT);
                  if (typeof jumpTo === 'number' && pendingJump !== jumpTo) {
                    pendingJump = jumpTo;
                    videoElement.pause();
                    await seekVideo(jumpTo);
                    await waitForVideoFrame(videoElement);
                    const newTimelineT = curClip.sourceToTimelineTime(videoElement.currentTime);
                    renderer.renderFrame({
                      clip: curClip,
                      currentTime: newTimelineT,
                      selectedAnnotationId: null,
                      watermarkConfig: projectSession?.watermark,
                      drawBaseVideo: true
                    });
                    publishFrame();
                    pendingJump = null;
                    if (isClipRunning) { try { await videoElement.play(); } catch (e) {} }
                    return;
                  }
                }

                const timelineT = curClip.sourceToTimelineTime(curSourceT);

                // Check if end of trim reached or video ended
                if (timelineT >= task.trimOut - 0.03 || videoElement.ended) {
                  finishClip();
                  return;
                }

                // Draw composite frame: base video + annotations + watermark
                renderer.renderFrame({
                  clip: curClip,
                  currentTime: timelineT,
                  selectedAnnotationId: null,
                  watermarkConfig: projectSession?.watermark,
                  drawBaseVideo: true
                });
                publishFrame();

                // Update progress bar
                const currentOverallTime = accumulatedExportDuration + Math.max(0, timelineT - task.trimIn);
                const percent = Math.min(99, Math.round((currentOverallTime / totalExportDuration) * 100));
                const clipLabel = clipTasks.length > 1 ? ` [klip ${taskIdx + 1}/${clipTasks.length}]` : '';
                onProgress(
                  percent,
                  `Rendering: ${TV.VideoEngine.formatDuration(currentOverallTime)} / ${TV.VideoEngine.formatDuration(totalExportDuration)} (${percent}%)${clipLabel}`
                );
              } finally {
                drawing = false;
              }
            };

            drawTimer = setInterval(drawTick, frameInterval);
          });
        }

        // Allow final frame buffer to flush
        TV.exportLog('render.allClipsDone');
        onProgress(99, 'Menyelesaikan rekaman video...');
        await new Promise((r) => setTimeout(r, 200));
        await restore();

        if (recorder.state === 'recording' || recorder.state === 'paused') {
          TV.exportLog('recorder.stop.request', { state: recorder.state });
          // Nudge out any buffered data before stopping so the final chunk isn't lost.
          try { recorder.requestData(); } catch (e) {}
          recorder.stop();
          // Safety net: on some Chromium builds `onstop` can fire late or (rarely)
          // not at all after stop(), leaving the UI pinned at 99%. If it hasn't
          // fired shortly, finalize the blob from the chunks we already captured.
          stopWatchdog = setTimeout(() => {
            TV.exportLog('recorder.stop.watchdogFired');
            finalizeRecording('watchdog');
          }, 1500);
        } else {
          // Recorder already inactive — finalize immediately from captured chunks.
          finalizeRecording('inactive');
        }
      } catch (err) {
        await restore();
        if (recorder.state === 'recording' || recorder.state === 'paused') {
          try { recorder.stop(); } catch (e) {}
        }
        if (stopWatchdog) { clearTimeout(stopWatchdog); stopWatchdog = null; }
        cleanupStreams();
        reject(err);
      }
    });
  };

  /* --------------------------------------------------------------------------
     Evidence ZIP Package + SHA-256 Manifest
     -------------------------------------------------------------------------- */
  // Yield control back to the browser so the progress bar can repaint between
  // heavy synchronous steps (buffer reads, hashing, zip assembly).
  const _yieldToUI = () => new Promise((r) => setTimeout(r, 0));

  TV.exportEvidenceBundle = async function (projectSession, clip, videoBlob, snapshotBlob, onProgress = () => {}) {
    TV.exportLog('zip.begin', { videoBytes: videoBlob?.size });
    onProgress(30, 'Membaca data video...');
    await _yieldToUI();

    const stamp = TV.fileStamp(new Date());
    const ticket = TV.safeName(projectSession.watermark?.ticket) || 'EVIDENCE';
    const videoExt = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
    const videoFileName = `${ticket}_${stamp}.${videoExt}`;
    const snapshotFileName = `${ticket}_snapshot_${stamp}.png`;
    const projectFileName = `${ticket}_project.tandaivideo`;

    const videoU8 = new Uint8Array(await videoBlob.arrayBuffer());
    const snapshotU8 = snapshotBlob ? new Uint8Array(await snapshotBlob.arrayBuffer()) : null;
    const projectJsonStr = JSON.stringify(projectSession.toJSON(), null, 2);
    const projectU8 = new TextEncoder().encode(projectJsonStr);
    TV.exportLog('zip.buffersRead');

    onProgress(45, 'Menghitung hash SHA-256...');
    await _yieldToUI();
    const videoHash = await TV.sha256(videoU8);
    const snapshotHash = snapshotU8 ? await TV.sha256(snapshotU8) : 'N/A';
    const projectHash = await TV.sha256(projectU8);
    TV.exportLog('zip.hashed');

    onProgress(70, 'Membuat manifest integritas forensik...');
    await _yieldToUI();

    const manifestContent = [
      '========================================================================',
      ' tandai-video — Bukti Integritas Forensik (Evidence Manifest)',
      '========================================================================',
      `Referensi Tiket   : ${projectSession.watermark?.ticket || '-' }`,
      `Nama Penguji/QA    : ${projectSession.watermark?.author || '-' }`,
      `Waktu Pembuatan   : ${TV.humanTime(new Date())}`,
      `Aplikasi Generator : tandai-video (100% Client-Side Privacy Tool)`,
      '------------------------------------------------------------------------',
      'DAFTAR BERKAS & CHECKSUM SHA-256:',
      `[SHA-256] ${videoHash}  ${videoFileName}`,
      snapshotU8 ? `[SHA-256] ${snapshotHash}  ${snapshotFileName}` : '',
      `[SHA-256] ${projectHash}  ${projectFileName}`,
      '------------------------------------------------------------------------',
      'Catatan: Verifikasi keaslian berkas di atas menggunakan perintah:',
      `  sha256sum ${videoFileName}`,
      '========================================================================'
    ].filter(Boolean).join('\r\n');

    const manifestU8 = new TextEncoder().encode(manifestContent);

    onProgress(85, 'Mengemas berkas ke dalam arsip ZIP...');
    await _yieldToUI();
    const filesToZip = [
      { name: videoFileName, data: videoU8 },
      { name: 'manifest.txt', data: manifestU8 },
      { name: projectFileName, data: projectU8 }
    ];

    if (snapshotU8) {
      filesToZip.push({ name: snapshotFileName, data: snapshotU8 });
    }

    const zipBlob = TV.zip(filesToZip);
    TV.exportLog('zip.assembled', { bytes: zipBlob?.size });
    onProgress(99, 'Paket ZIP bukti siap diunduh.');

    return {
      zipBlob,
      fileName: `${ticket}_evidence_bundle_${stamp}.zip`
    };
  };

})(window);
