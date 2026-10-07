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
      : (projectSession && projectSession.clips && projectSession.clips.length > 0)
        ? projectSession.clips
        : [clip];

    const refClip = clipsToRender[0] || clip;
    const targetFps = options.fps || (refClip ? refClip.fps : 30) || 30;
    const frameDuration = 1 / targetFps;

    // Calculate total frames and segments info
    const segInfo = clipsToRender.map((c) => {
      const s = typeof c.trimIn === 'number' ? c.trimIn : 0;
      const e = typeof c.trimOut === 'number' && c.trimOut > 0 ? c.trimOut : (c.duration || 0);
      const dur = Math.max(0.1, e - s);
      const frames = Math.max(1, Math.ceil(dur * targetFps));
      return { clip: c, start: s, end: e, duration: dur, frames };
    });

    const totalFrames = segInfo.reduce((acc, curr) => acc + curr.frames, 0);

    const width = refClip.width || videoElement.videoWidth || 1920;
    const height = refClip.height || videoElement.videoHeight || 1080;

    // Create offscreen canvas for rendering
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = width;
    renderCanvas.height = height;
    const renderer = new TV.CanvasRenderer(renderCanvas, videoElement);
    renderer.setDimensions(width, height);

    // Choose supported mimeType
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp8';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
    if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';

    const stream = renderCanvas.captureStream(targetFps);

    // Optional audio track handling
    if (!projectSession.audio?.muteOnExport && videoElement.captureStream) {
      try {
        const vStream = videoElement.captureStream();
        const audioTracks = vStream.getAudioTracks();
        if (audioTracks.length > 0) {
          stream.addTrack(audioTracks[0]);
        }
      } catch (err) {
        console.warn('Could not capture audio track:', err);
      }
    }

    const recordedChunks = [];
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: options.bitrate || 5000000 // 5 Mbps
    });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    return new Promise(async (resolve, reject) => {
      recorder.onstop = () => {
        const videoBlob = new Blob(recordedChunks, { type: mimeType });
        onProgress(100, 'Selesai rendering video');
        resolve(videoBlob);
      };

      recorder.onerror = (err) => reject(err);

      recorder.start();

      // Deterministic frame stepping loop
      videoElement.pause();
      const initialTime = videoElement.currentTime;
      const initialSrc = videoElement.src;

      const seekVideo = (time) => {
        return new Promise((res) => {
          const onSeeked = () => {
            videoElement.removeEventListener('seeked', onSeeked);
            res();
          };
          videoElement.addEventListener('seeked', onSeeked);
          videoElement.currentTime = time;
        });
      };

      const useSource = (url) => new Promise((res) => {
        if (!url || videoElement.src === url) return res();
        const onLoaded = () => {
          videoElement.removeEventListener('loadeddata', onLoaded);
          res();
        };
        videoElement.addEventListener('loadeddata', onLoaded);
        videoElement.src = url;
      });

      const restore = async () => {
        try {
          if (videoElement.src !== initialSrc) {
            await useSource(initialSrc);
          }
          videoElement.currentTime = initialTime;
        } catch (e) {}
      };

      try {
        let done = 0;
        for (let k = 0; k < segInfo.length; k++) {
          const seg = segInfo[k];
          if (seg.clip.blobUrl) {
            await useSource(seg.clip.blobUrl);
          }

          for (let i = 0; i < seg.frames; i++) {
            const currentTime = seg.start + i * frameDuration;
            await seekVideo(currentTime);

            // Draw full composite frame: base video + annotations + watermark
            renderer.renderFrame({
              clip: seg.clip,
              currentTime,
              selectedAnnotationId: null,
              watermarkConfig: projectSession?.watermark,
              drawBaseVideo: true
            });

            done++;
            const percent = Math.min(99, Math.round((done / totalFrames) * 100));
            const segLabel = segInfo.length > 1 ? ` [bagian ${k + 1}/${segInfo.length}]` : '';
            onProgress(percent, `Rendering frame ${done}/${totalFrames} (${percent}%)${segLabel}`);

            // Yield to browser thread for smooth progress bar update
            await new Promise((r) => setTimeout(r, 6));
          }
        }

        // Restore initial playback position and source
        await restore();
        recorder.stop();
      } catch (err) {
        await restore();
        recorder.stop();
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
