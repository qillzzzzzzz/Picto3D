@extends('layouts.bare')

@section('title', 'Kamera HP - Picto3D')

@section('bodyClass', 'device-pair-page')

@section('content')
<main
    id="device-pair-app"
    class="pair-shell"
    data-connection="connecting"
    data-token="{{ $token }}"
    data-detect-url="{{ route('detections.store') }}"
    data-connect-url="{{ route('device-sessions.connect', $token) }}"
    data-publish-url="{{ route('device-sessions.detection', $token) }}"
    data-capture-max-width="1280"
>
    <div id="camera-stage" class="pair-stage">
        <video
            id="camera-video"
            autoplay
            muted
            playsinline
        ></video>

        <canvas id="detection-overlay"></canvas>

        <div id="camera-placeholder" class="camera-placeholder pair-placeholder">
            <div class="camera-placeholder-icon" aria-hidden="true">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </div>
            <span class="camera-placeholder-title">Menyiapkan Kamera…</span>
            <span class="camera-placeholder-copy">Izinkan akses kamera untuk mulai memindai objek secara otomatis.</span>
        </div>

        <!-- Single, focused loading/error screen shown until the session is
             actually confirmed. Nothing else (topbar pill, bottombar,
             settings, bookmark hint) renders at the same time as this, so
             the page can never look "menumpuk" while connecting. -->
        <div id="pair-loading" class="pair-loading">
            <div class="pair-loading-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            </div>
            <span class="pair-loading-spinner" aria-hidden="true"></span>
            <p id="pair-loading-title" class="pair-loading-title">Menghubungkan ke 3D Studio…</p>
            <p id="pair-loading-copy" class="pair-loading-copy">Menyiapkan sesi kamera, mohon tunggu sebentar.</p>
        </div>

        <!-- Top overlay: brand + connection status -->
        <div class="pair-topbar">
            <span class="pair-brand">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                Picto3D
            </span>

            <span id="device-pair-status" class="pair-status-pill" data-state="connecting">
                Menghubungkan…
            </span>
        </div>

        <div class="pair-bookmark-hint">
            💡 Tambahkan halaman ini ke Layar Utama (menu ⋮ browser) — lain kali gak perlu scan QR lagi.
        </div>

        <!-- Bottom overlay: detection readout + controls -->
        <div class="pair-bottombar">
            <div id="top-detection-bar" class="pair-detection-readout" hidden>
                <span class="pair-detection-label">Terdeteksi</span>
                <strong id="top-detection-name">—</strong>
                <span id="top-detection-confidence" class="pair-detection-confidence">0%</span>
            </div>

            <div id="device-pair-toast" class="device-pair-toast pair-toast" hidden></div>

            <p id="error-message" class="error-message pair-error" hidden></p>

            <div class="pair-controls-row">
                <button id="pair-settings-toggle" type="button" class="pair-icon-btn" aria-label="Pengaturan" aria-expanded="false">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                </button>

                <button id="reset-camera" type="button" class="pair-icon-btn" aria-label="Reset Kamera" title="Reset kamera jika deteksi macet" disabled>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                </button>

                <button id="stop-camera" type="button" class="pair-end-btn" disabled>
                    Akhiri Sesi
                </button>
            </div>

            <div id="pair-settings-panel" class="pair-settings-panel" hidden>
                <label class="pair-settings-field">
                    <span>Confidence</span>
                    <input
                        id="confidence"
                        type="range"
                        min="0.05"
                        max="0.80"
                        step="0.01"
                        value="0.30"
                        class="form-slider"
                    >
                    <output id="confidence-value">0.30</output>
                </label>

                <label class="pair-settings-field">
                    <span>Kecepatan Scan</span>
                    <select id="target-fps" class="form-select form-select-sm">
                        <option value="2">2 FPS</option>
                        <option value="5" selected>5 FPS (Optimal)</option>
                        <option value="8">8 FPS</option>
                    </select>
                </label>

                <label class="pair-settings-field">
                    <span>Abaikan Kelas</span>
                    <select id="ignore-class" class="form-select form-select-sm">
                        <option value="" selected>Tidak ada (semua kelas)</option>
                        <option value="pen">Pen</option>
                        <option value="eraser">Eraser</option>
                        <option value="wrinkle">Wrinkle</option>
                        <option value="correction tape">Correction Tape</option>
                        <option value="spidol">Spidol</option>
                        <option value="brush pen">Brush Pen</option>
                        <option value="drawing pen">Drawing Pen</option>
                        <option value="board marker">Board Marker</option>
                        <option value="pencil">Pencil</option>
                        <option value="stabilo">Stabilo</option>
                        <option value="ruler">Ruler</option>
                        <option value="protactor">Protractor</option>
                        <option value="paper clip">Paper Clip</option>
                        <option value="binder clip">Binder Clip</option>
                        <option value="scissor">Scissor</option>
                        <option value="term">Term</option>
                        <option value="tape">Tape</option>
                    </select>
                </label>
                <p class="pair-settings-hint">
                    Kelas yang diabaikan tetap terlihat kotaknya di kamera, tapi tidak akan
                    dipilih sebagai deteksi utama / dikirim otomatis — supaya objek lain
                    berkesempatan terdeteksi kalau satu kelas (mis. Stabilo) terlalu sering menang.
                </p>
            </div>
        </div>
    </div>

    <canvas id="capture-canvas" hidden></canvas>
</main>
@endsection

@section('scripts')
<script>
    (function () {
        var toggle = document.getElementById('pair-settings-toggle');
        var panel = document.getElementById('pair-settings-panel');
        if (!toggle || !panel) return;

        toggle.addEventListener('click', function () {
            var isHidden = panel.hidden;
            panel.hidden = !isHidden;
            toggle.setAttribute('aria-expanded', String(isHidden));
            toggle.classList.toggle('is-active', isHidden);
        });
    })();

    // Sembunyikan hint "tambah ke layar utama" otomatis setelah beberapa detik.
    (function () {
        var hint = document.querySelector('.pair-bookmark-hint');
        if (!hint) return;
        window.setTimeout(function () {
            hint.style.opacity = '0';
            hint.style.transition = 'opacity 0.4s ease';
            window.setTimeout(function () { hint.hidden = true; }, 500);
        }, 6000);
    })();
</script>
@endsection
