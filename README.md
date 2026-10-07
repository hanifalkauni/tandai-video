# tandai-video 🎬🔍

[![Demo Online](https://img.shields.io/badge/Demo-Live%20Online-0d9488?style=flat-square&logo=github&logoColor=white)](https://hanifalkauni.github.io/tandai-video/)
[![License: MIT](https://img.shields.io/badge/License-MIT-3b82f6.svg?style=flat-square)](LICENSE)
[![Vanilla JS](https://img.shields.io/badge/Vanilla_JS-ES6+-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](js/app.js)
[![HTML5 / CSS3](https://img.shields.io/badge/Stack-HTML5%20%7C%20CSS3-E34F26?style=flat-square&logo=html5&logoColor=white)](index.html)
[![Privacy 100% Client-Side](https://img.shields.io/badge/Privacy-100%25%20Client--Side-10b981?style=flat-square&logo=shield)](README.md)

> **Aplikasi Anotasi Rekaman Video, Sensor Data Sensitif & Stempel Bukti Forensik Berbasis Web yang Cepat, Praktis, dan 100% Lokal.**

**tandai-video** adalah aplikasi web statis modern dan ringan untuk memberi tanda, catatan, panah, sorotan nomor langkah, dan sensor data pada rekaman video (*screen recording*) sebelum dilampirkan ke tiket bug QA, laporan audit kepatuhan, atau investigasi keamanan.

Semua proses decoding, rendering, sensor, dan ekspor dilakukan **100% di peramban pengguna (*client-side*)** tanpa server backend (*Zero-data sent to network*).

---

## ✨ Fitur Utama

- 🎥 **Media Ingestion & Perekam Layar Bawaan**:
  - Drag-and-drop file video (`.mp4`, `.webm`, `.mov`, `.mkv`).
  - **Perekam Layar Langsung**: Rekam tab / jendela / seluruh layar langsung dari aplikasi via `getDisplayMedia()`.
  - **Multi-Clip Session Playlist**: Kelola beberapa rekaman video sekaligus dalam satu sesi pengujian QA.
- ✂️ **Pecah (Split) & Potong Video Otomatis Gabung (Cut)**:
  - **Pecah Klip (Split)**: Bagi klip video atau anotasi aktif menjadi dua di posisi playhead saat ini (`C` / `K`).
  - **Potong Video (Cut)**: Buang rentang bagian tengah video yang tidak diinginkan (misal menit `02:00` s/d `03:00`) dan **langsung otomatis menyambungkan** bagian sebelum dan sesudahnya menjadi 1 video utuh di timeline (`X`). Pemutar melompati potongan secara instan (*seamless jump cut*) dan video hasil ekspor langsung berupa 1 berkas terpadu tanpa bagian yang dipotong.
- 🖐️ **Alat Tangan (Hand Pan) & Zoom Berpusat Kursor**:
  - Geser viewport secara leluasa saat kondisi zoom (25% - 400%) dengan tombol **Alat Tangan (`H`)** atau tahan **`Spasi + Drag`**.
  - Navigasi zoom in/out dengan `Ctrl + Scroll` yang berpusat langsung pada koordinat kursor mouse (*cursor-anchored zoom*).
- ⏱️ **Player Presisi Frame & Batas START/END Realtime**:
  - Maju / mundur per 1 frame (`.` / `,`) untuk menemukan momen bug yang presisi.
  - Kontrol kecepatan (*Playback Speed* `0.25x` - `2.0x`) dengan *pitch preservation*.
  - **Input Waktu START & END Realtime**: Kolom waktu di header timeline tersinkronisasi dua arah secara realtime dengan pegangan slider pemangkasan visual. Dapat diketik manual (format `MM:SS.ms` atau detik angka).
- 📜 **Navigasi Roda Mouse di Timeline**:
  - Gulir roda mouse (*mouse wheel*) di area timeline untuk menggeser timeline secara horizontal (*horizontal slide*).
  - Tahan `Ctrl + Scroll` di timeline untuk memperbesar/memperkecil skala zoom timeline (0.5x, 1.0x, 2.0x).
- 📐 **Peralatan Anotasi & Penanda Temporal**:
  - **Kotak (`R`)** & **Elips (`O`)**: Pilihan outline, semi-transparan, atau solid.
  - **Panah (`A`)**: Kepala panah otomatis dan snapping sudut 45° via `Shift`.
  - **Highlighter (`D`)**: Stabilo transparan untuk menyorot teks log atau pesan error.
  - **Teks Callout (`T`)**: Label catatan penjelasan dengan background pill.
  - **Nomor Langkah (`N`)**: Badge nomor urut otomatis (1, 2, 3...) untuk alur reproduksi.
  - **Spotlight Dimmer (`S`)**: Menggelapkan seluruh layar kecuali area fokus lingkaran/kotak.
  - **Kaca Pembesar Loupe (`M`)**: Pembesaran lensa 2x/4x untuk memperjelas teks kode atau UI kecil.
- 🔒 **Sensor Data Sensitif Dinamis (`B`)**:
  - **Pixelate (Mosaic)**: Menyamarkan teks dan angka.
  - **Gaussian Blur**: Blur halus dengan proteksi sudut.
  - **Solid Blackout**: Balok hitam pekat untuk password, token API, atau kartu identitas.
- 📊 **Timeline Multi-Track Visual**:
  - Setiap anotasi memiliki balok durasi temporal $[t_{start}, t_{end}]$ yang dapat digeser dan diubah ukurannya secara visual.
- 🏷️ **Stempel Bukti Formal (Evidence Watermark)**:
  - Cap otomatis di sudut video: No. Tiket, Nama Penguji, Waktu Presisi, dan *Dynamic Burn-in Timecode*.
- 📦 **Ekspor Lengkap & Integritas Bukti**:
  - **Ekspor Video (MP4 / WebM)**: Video beranotasi hasil *burn-in* dengan rentang trim yang dipilih (mendukung penggabungan multi-segmen otomatis).
  - **Frame Snapshot PNG / Clipboard (`Ctrl+C`)**: Tangkap frame saat ini beresolusi penuh untuk langsung di-paste ke Slack, Jira, atau GitHub.
  - **Paket ZIP + Manifest SHA-256**: Mengunduh seluruh paket bukti dengan catatan hash kriptografi SHA-256 untuk membuktikan integritas keaslian berkas.
  - **Proyek JSON (`.tandaivideo`)**: Simpan dan buka sesi kerja untuk kolaborasi tim.

---

## ⌨️ Daftar Pintasan Keyboard (Shortcuts)

| Shortcut | Aksi |
|---|---|
| `Space` | Putar / Jeda video (atau tahan + drag untuk pan saat zoom) |
| `.` atau `>` | Maju 1 frame |
| `,` atau `<` | Mundur 1 frame |
| `←` / `→` | Lompat mundur / maju 1 detik (`Shift` untuk 5 detik) |
| `I` | Set Batas Mulai Pemangkasan (START) |
| `O` | Set Batas Akhir Pemangkasan (END) |
| `C` / `K` | Pecah Klip / Anotasi di Playhead (Split) |
| `X` | Potong Rentang Video & Sambung Otomatis (Cut) |
| `V` | Mode Seleksi / Pilih Objek |
| `H` | Alat Tangan (Hand Pan Kanvas) |
| `R` | Alat Kotak (Rectangle) |
| `O` | Alat Elips (Circle/Ellipse) |
| `A` | Alat Panah (Arrow) |
| `D` | Alat Highlighter (Stabilo) |
| `T` | Alat Teks Catatan |
| `N` | Alat Nomor Langkah (1, 2, 3...) |
| `B` | Alat Sensor (Blur / Pixelate / Hitam) |
| `S` | Alat Spotlight |
| `M` | Alat Kaca Pembesar Loupe |
| `Scroll di Timeline` | Geser Timeline Horizontal |
| `Ctrl + Scroll di Timeline` | Ubah Skala Zoom Timeline |
| `Ctrl + Scroll di Kanvas` | Zoom In / Out Viewport Video (25% - 400%) |
| `Ctrl + C` | Salin frame aktif beranotasi ke Clipboard |
| `Ctrl + S` | Simpan frame aktif sebagai gambar PNG |
| `Ctrl + E` | Buka dialog Ekspor Video / Paket Bukti |
| `Ctrl + Z` / `Ctrl + Y` | Undo / Redo (Mendukung pembatalan potongan video) |
| `Delete` / `Backspace` | Hapus objek anotasi yang dipilih |
| `Shift` (tahan saat gambar) | Kunci aspek rasio persegi/lingkaran atau snap sudut panah 45° |

---

## 🚀 Cara Menjalankan

Aplikasi ini bersifat **Zero-Build & Zero-Dependency**. Cukup clone repo dan buka `index.html` di browser modern mana pun (Chrome, Edge, Firefox, Safari):

```bash
git clone https://github.com/hanifalkauni/tandai-video.git
cd tandai-video
# Buka file index.html di browser
```

---

## 📁 Struktur Direktori

```
tandai-video/
├── index.html               # Shell antarmuka utama, kanvas & modal
├── README.md                # Dokumentasi proyek
├── PRD.md                   # Dokumen spesifikasi kebutuhan produk (PRD v1.2)
├── LICENSE                  # Lisensi Open-Source (MIT)
├── css/
│   ├── style.css            # Desain tema Dark Studio, layout grid, CSS tokens
│   ├── timeline.css         # Styling multi-track timeline, scrubber, & trim handles
│   └── components.css       # Toolbar, inspector properties, dialog & modals
└── js/
    ├── model.js             # Data model: Annotation, Multi-Clip Playlist, History Undo/Redo
    ├── video-engine.js      # Video controller, screen recorder API, time sync, frame stepper
    ├── render.js            # Canvas rendering engine (shapes, blur, pixelate, watermark, magnifier)
    ├── timeline.js          # Controller timeline interaktif (drag, resize duration, scrub bar)
    ├── export.js            # Video recorder/muxer, Frame snapshot PNG, ZIP + SHA-256
    └── app.js               # Main Controller, event listener, shortcut bindings, UI state
```

---

## 📄 Lisensi

[MIT License](LICENSE) © 2026 Hanif Al-Kauni
