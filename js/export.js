/**
 * @file export.js
 * @description Export Engine for Video (Deterministic Canvas Stream), Frame PNG, ZIP packaging & SHA-256 Manifest
 * Adheres to Single Responsibility Principle & 100% Client-Side Privacy
 */

(function (global) {
  'use strict';

  const TV = (global.TV = global.TV || {});

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

    // Capture clean canvas stream
    const stream = renderCanvas.captureStream(targetFps);

    // Audio capture handling
    const preserveAudio = !projectSession?.audio?.muteOnExport;
    let audioTrack = null;
    if (preserveAudio && typeof videoElement.captureStream === 'function') {
      try {
        const vStream = videoElement.captureStream();
        const aTracks = vStream.getAudioTracks();
        if (aTracks && aTracks.length > 0) {
          audioTrack = aTracks[0];
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

      recorder.onstop = () => {
        if (isCompleted) return;
        isCompleted = true;
        const videoBlob = new Blob(recordedChunks, { type: mimeType });
        onProgress(100, 'Selesai rendering video');
        resolve(videoBlob);
      };

      recorder.onerror = (err) => {
        isCompleted = true;
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
          renderer.renderFrame({
            clip: firstTask.clip,
            currentTime: firstTask.trimIn,
            selectedAnnotationId: null,
            watermarkConfig: projectSession?.watermark,
            drawBaseVideo: true
          });
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
          await new Promise(async (resolveClip, rejectClip) => {
            let isClipRunning = true;
            let pendingJump = null;

            try {
              await videoElement.play();
            } catch (playErr) {
              return rejectClip(new Error('Gagal memulai playback video untuk ekspor: ' + playErr.message));
            }

            const onFrame = async () => {
              if (!isClipRunning) return;

              const curSourceT = videoElement.currentTime;

              // Seamless ripple cut jump handler
              if (curClip && typeof curClip.getNextPlaybackJump === 'function') {
                const jumpTo = curClip.getNextPlaybackJump(curSourceT);
                if (typeof jumpTo === 'number' && pendingJump !== jumpTo) {
                  pendingJump = jumpTo;
                  if (recorder.state === 'recording') {
                    try { recorder.pause(); } catch (e) {}
                  }
                  videoElement.pause();
                  await seekVideo(jumpTo);
                  const newTimelineT = curClip.sourceToTimelineTime(videoElement.currentTime);
                  renderer.renderFrame({
                    clip: curClip,
                    currentTime: newTimelineT,
                    selectedAnnotationId: null,
                    watermarkConfig: projectSession?.watermark,
                    drawBaseVideo: true
                  });
                  if (recorder.state === 'paused') {
                    try { recorder.resume(); } catch (e) {}
                  }
                  pendingJump = null;
                  try {
                    await videoElement.play();
                  } catch (e) {}
                  if ('requestVideoFrameCallback' in videoElement) {
                    videoElement.requestVideoFrameCallback(onFrame);
                  } else {
                    requestAnimationFrame(onFrame);
                  }
                  return;
                }
              }

              const timelineT = curClip.sourceToTimelineTime(curSourceT);

              // Check if end of trim reached or video ended
              if (timelineT >= task.trimOut - 0.03 || videoElement.ended) {
                isClipRunning = false;
                videoElement.pause();
                accumulatedExportDuration += task.duration;
                resolveClip();
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

              // Update progress bar
              const currentOverallTime = accumulatedExportDuration + Math.max(0, timelineT - task.trimIn);
              const percent = Math.min(99, Math.round((currentOverallTime / totalExportDuration) * 100));
              const clipLabel = clipTasks.length > 1 ? ` [klip ${taskIdx + 1}/${clipTasks.length}]` : '';
              onProgress(
                percent,
                `Rendering: ${TV.VideoEngine.formatDuration(currentOverallTime)} / ${TV.VideoEngine.formatDuration(totalExportDuration)} (${percent}%)${clipLabel}`
              );

              if ('requestVideoFrameCallback' in videoElement) {
                videoElement.requestVideoFrameCallback(onFrame);
              } else {
                requestAnimationFrame(onFrame);
              }
            };

            if ('requestVideoFrameCallback' in videoElement) {
              videoElement.requestVideoFrameCallback(onFrame);
            } else {
              requestAnimationFrame(onFrame);
            }
          });
        }

        // Allow final frame buffer to flush
        await new Promise((r) => setTimeout(r, 200));
        await restore();

        if (recorder.state === 'recording' || recorder.state === 'paused') {
          recorder.stop();
        }
      } catch (err) {
        await restore();
        if (recorder.state === 'recording' || recorder.state === 'paused') {
          recorder.stop();
        }
        reject(err);
      }
    });
  };

  /* --------------------------------------------------------------------------
     Evidence ZIP Package + SHA-256 Manifest
     -------------------------------------------------------------------------- */
  TV.exportEvidenceBundle = async function (projectSession, clip, videoBlob, snapshotBlob, onProgress = () => {}) {
    onProgress(10, 'Menghitung hash kriptografi SHA-256...');

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

    onProgress(40, 'Membuat manifest integritas forensik...');
    const videoHash = await TV.sha256(videoU8);
    const snapshotHash = snapshotU8 ? await TV.sha256(snapshotU8) : 'N/A';
    const projectHash = await TV.sha256(projectU8);

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

    onProgress(70, 'Mengemas berkas ke dalam arsip ZIP...');
    const filesToZip = [
      { name: videoFileName, data: videoU8 },
      { name: 'manifest.txt', data: manifestU8 },
      { name: projectFileName, data: projectU8 }
    ];

    if (snapshotU8) {
      filesToZip.push({ name: snapshotFileName, data: snapshotU8 });
    }

    const zipBlob = TV.zip(filesToZip);
    onProgress(100, 'Paket ZIP bukti siap diunduh.');

    return {
      zipBlob,
      fileName: `${ticket}_evidence_bundle_${stamp}.zip`
    };
  };

})(window);
