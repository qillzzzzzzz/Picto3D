@extends('layouts.app')

@section('title', 'Laravel YOLO Camera 3D')

@section('bodyClass', 'page-camera')

@section('content')
<main
    id="camera-app"
    class="app-shell container camera-container"
>
    <div class="decor-shape decor-blob" style="width:260px;height:260px;top:-100px;right:-120px;background:var(--color-camera-soft);"></div>
    <div class="decor-dots" style="width:120px;height:120px;bottom:10%;left:-2%;color:var(--color-primary);"></div>

    <section class="app-card card camera-dashboard">
        <header class="app-header camera-dashboard-header">
            <div>
                <span class="eyebrow"><i data-lucide="camera"></i> YOLO Live Detection</span>
                <h1 class="page-title camera-page-title">Object Detection Kamera 3D</h1>
                <p class="subtitle page-subtitle camera-page-subtitle">
                    Kamera dijalankan dari HP yang tersambung — arahkan ke objek dan modelnya otomatis
                    dibangun di 3D Studio memakai <code>best.pt</code>.
                </p>
            </div>
        </header>

        <!-- Modal Pairing Device (QR Code) -->
        <div id="device-pairing-modal" class="device-modal" hidden>
            <div class="device-modal-backdrop" data-close-modal></div>
            <div class="device-modal-card" role="dialog" aria-modal="true" aria-labelledby="device-modal-title">
                <button type="button" class="device-modal-close" data-close-modal aria-label="Tutup">&times;</button>

                <h2 id="device-modal-title" class="device-modal-title">Tambah Device (HP)</h2>
                <p class="device-modal-copy">
                    Scan QR code ini pakai kamera HP. Setelah discan, kamera HP langsung aktif — objek dengan
                    persentase tertinggi otomatis dikirim ke sini dan langsung dibuatkan model 3D-nya. Link ini
                    bisa dipakai berkali-kali — simpan sebagai Layar Utama di HP biar lain kali gak perlu scan lagi.
                </p>

                <div id="device-modal-status" class="device-modal-status" data-state="loading">Membuat sesi…</div>

                <div id="device-known-list" class="device-known-list" hidden></div>

                <div id="device-qr-box" class="device-qr-box">
                    <canvas id="device-qr-canvas" width="220" height="220"></canvas>
                </div>

                <p class="device-modal-code">Atau buka manual di HP: <code id="device-pair-url">—</code></p>

                <div class="device-modal-actions">
                    <button id="device-new-qr-btn" type="button" class="button btn btn-outline btn-sm">
                        Buat QR Baru (Device Lain)
                    </button>
                    <button id="device-cancel-btn" type="button" class="button btn btn-secondary btn-sm">
                        Batalkan Sesi
                    </button>
                </div>
            </div>
        </div>

        <!-- Kamera browser dihapus: satu-satunya cara memindai objek adalah
             menyambungkan kamera HP lewat "Tambah Device" di bawah. -->
        <div class="camera-body-grid">
            <div class="camera-hero">
                <div class="camera-hero-icon" aria-hidden="true">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
                </div>
                <h2 class="camera-hero-title">Belum Ada Kamera Tersambung</h2>
                <p class="camera-hero-copy">
                    Sambungkan kamera HP untuk mulai memindai objek. Scan QR code, arahkan kamera HP ke
                    objek, dan model 3D-nya otomatis dibuat di sini.
                </p>

                <button id="add-device-btn" type="button" class="button btn btn-camera camera-hero-cta">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
                    Tambah Device
                </button>

                <!-- Scan -> Detect -> Generate workflow -->
                <div class="camera-workflow" aria-hidden="true">
                    <div class="camera-workflow-step">
                        <span class="camera-workflow-badge">1</span>
                        <span class="camera-workflow-label">Scan</span>
                    </div>
                    <span class="camera-workflow-arrow">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                    </span>
                    <div class="camera-workflow-step">
                        <span class="camera-workflow-badge">2</span>
                        <span class="camera-workflow-label">Detect</span>
                    </div>
                    <span class="camera-workflow-arrow">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                    </span>
                    <div class="camera-workflow-step">
                        <span class="camera-workflow-badge">3</span>
                        <span class="camera-workflow-label">Generate</span>
                    </div>
                </div>
            </div>

            <!-- Cara Memulai -->
            <aside class="cara-memulai-card" aria-label="Cara memulai">
                <span class="cara-memulai-title">Cara Memulai</span>

                <div class="cara-memulai-step">
                    <div class="cara-memulai-icon"><i data-lucide="smartphone"></i></div>
                    <div class="cara-memulai-text">
                        <strong>Sambungkan HP Anda</strong>
                        <span>Scan QR code untuk menghubungkan kamera.</span>
                    </div>
                </div>

                <div class="cara-memulai-step">
                    <div class="cara-memulai-icon"><i data-lucide="target"></i></div>
                    <div class="cara-memulai-text">
                        <strong>Arahkan ke Objek</strong>
                        <span>Pastikan objek berada di area kamera dengan jelas.</span>
                    </div>
                </div>

                <div class="cara-memulai-step">
                    <div class="cara-memulai-icon"><i data-lucide="box"></i></div>
                    <div class="cara-memulai-text">
                        <strong>Model 3D Otomatis</strong>
                        <span>Objek akan dibuat menjadi model 3D secara otomatis.</span>
                    </div>
                </div>
            </aside>
        </div>
    </section>
</main>
@endsection
