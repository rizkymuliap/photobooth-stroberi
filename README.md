# StoriBerry Photobooth 🍓

Photobooth web app sederhana bertema stroberi, dibuat dengan Next.js (App Router) + TypeScript.

## Fitur

1. Tombol **Mulai** untuk membuka kamera.
2. Mengambil **8 foto** otomatis, masing-masing dengan hitungan mundur 3-2-1.
3. **Filter stroberi**: saat aktif, wajah yang terdeteksi akan otomatis diberi ikon stroberi lucu di atas kepala. Filter ini bisa dimatikan/dinyalakan sebelum sesi dimulai (toggle di layar awal).
4. Setelah 8 foto selesai, pilih **3 foto** favorit dari hasil jepretan.
5. Layar hasil menyusun 3 foto terpilih menjadi satu **strip foto** dengan judul, tanggal, dan **stiker stroberi** dekoratif (bisa ditampilkan/disembunyikan).
6. Tombol **Unduh** menyimpan strip foto sebagai file PNG.

Filter wajah dan stiker dibuat murni dengan kode canvas (tidak memakai gambar/aset dari luar), jadi aman dari isu lisensi gambar dan tetap ringan.

## Menjalankan secara lokal

Butuh Node.js 18+.

```bash
npm install
npm run dev
```

Buka http://localhost:3000 di browser, lalu izinkan akses kamera saat diminta.

> Deteksi wajah menggunakan `face-api.js` (model TinyFaceDetector). Berkas model sudah disertakan di `public/models/`, jadi tidak perlu unduh tambahan.

## Build untuk produksi

```bash
npm run build
npm run start
```

## Struktur proyek

```
app/
  layout.tsx        # font & metadata
  page.tsx           # merender komponen utama
  globals.css         # tema visual (warna, tipografi, layout)
components/
  PhotoBooth.tsx      # seluruh logika: kamera, capture, filter, seleksi, hasil
lib/
  strawberry.ts       # fungsi untuk menggambar ikon stroberi di canvas
public/
  models/             # model TinyFaceDetector (face-api.js)
```

## Catatan & ide pengembangan lanjutan

- Filter stroberi hanya mendeteksi satu wajah per foto (`detectSingleFace`). Untuk foto berkelompok, bisa diganti ke `detectAllFaces` agar tiap wajah mendapat stiker.
- Ukuran/posisi hasil strip foto diatur di dalam `PhotoBooth.tsx` pada bagian `useEffect` yang menggambar `resultCanvasRef` — mudah disesuaikan bila ingin layout horizontal atau 4 foto.
- Karena kamera hanya bisa diakses lewat HTTPS atau `localhost`, saat deploy pastikan menggunakan domain HTTPS (Vercel, dsb).
