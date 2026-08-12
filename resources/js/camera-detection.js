import { cssColor } from './theme.js';

/**
 * camera-detection.js
 * High-performance Real-time YOLO Camera Detection Module.
 * 
 * Features:
 * - Automatic camera stream initialization with graceful fallback.
 * - Auto-scan multi-object detection (scans all objects simultaneously).
 * - Mirrored overlay alignment matching camera feed.
 * - Modern HUD overlay with dynamic color palette and corner markers.
 */

const sleep = (milliseconds) => new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
});

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
        if (blob) {
            resolve(blob);
            return;
        }
        reject(new Error('Browser gagal mengubah canvas menjadi gambar.'));
    }, type, quality);
});

// Only this many boxes/labels are drawn per frame, strongest confidence
// first. Without a cap, a noisy scene can return dozens of low-value
// detections whose labels visually cover the entire feed.
const MAX_RENDERED_DETECTIONS = 20;

// Berapa lama (ms) frame kamera boleh terlihat IDENTIK sebelum dianggap
// "beku" (track video macet) dan reset otomatis dipicu. Cukup longgar
// supaya objek diam yang sedang di-scan dengan tangan yang benar-benar
// stabil tidak salah dikira macet, tapi cukup ketat supaya pengguna tidak
// menunggu lama saat memang benar-benar macet.
const FREEZE_TIMEOUT_MS = 4000;

// Batas percobaan reset otomatis berturut-turut sebelum menyerah dan
// menampilkan pesan ke pengguna untuk reset manual / muat ulang halaman --
// mencegah loop reset tanpa henti kalau kameranya memang benar-benar tidak
// bisa dipakai lagi (mis. dipakai aplikasi lain).
const MAX_AUTO_RESET_ATTEMPTS = 3;

const createColorPalette = () => Array.from({ length: 6 }, (_, index) => ({
    border: cssColor(`--detection-${index + 1}-border`),
    fill: cssColor(`--detection-${index + 1}-fill`),
    bg: cssColor(`--detection-${index + 1}-bg`),
    text: cssColor('--detection-label-text'),
}));

const intersectionOverUnion = (first, second) => {
    const x1 = Math.max(first.x1, second.x1);
    const y1 = Math.max(first.y1, second.y1);
    const x2 = Math.min(first.x2, second.x2);
    const y2 = Math.min(first.y2, second.y2);
    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const firstArea = Math.max(0, first.x2 - first.x1) * Math.max(0, first.y2 - first.y1);
    const secondArea = Math.max(0, second.x2 - second.x1) * Math.max(0, second.y2 - second.y1);
    const union = firstArea + secondArea - intersection;

    return union > 0 ? intersection / union : 0;
};

export class CameraDetectionApp {
    /**
     * @param {HTMLElement} root
     * @param {object} [options]
     * @param {(image: string, label: string, confidence: number) => void} [options.onStableDetection]
     *        Dipanggil ketika sebuah label bertahan sebagai deteksi ter-
     *        confident selama `stabilityFrames` frame berturut-turut. Dipakai
     *        oleh halaman device-pairing (HP) untuk mengirim hasil deteksi ke
     *        sesi desktop tanpa perlu tombol manual.
     * @param {number} [options.stabilityFrames=4] Jumlah frame stabil sebelum onStableDetection dipanggil.
     * @param {number} [options.publishCooldownMs=4000] Jeda minimum antar pemanggilan onStableDetection
     *        UNTUK LABEL YANG SAMA (lihat #maybePublishStableDetection) — objek dengan label
     *        berbeda tidak menunggu cooldown ini sama sekali.
     */
    constructor(root, options = {}) {
        this.root = root;
        this.detectUrl = root.dataset.detectUrl;

        this.onStableDetection = typeof options.onStableDetection === 'function'
            ? options.onStableDetection
            : null;
        this.stabilityRequiredFrames = Math.max(1, Number(options.stabilityFrames || 4));
        this.publishCooldownMs = Math.max(0, Number(options.publishCooldownMs ?? 4000));
        this._stabilityLabel = null;
        this._stabilityCount = 0;
        this._lastPublishAt = 0;
        // Label terakhir yang berhasil dipublish. Cooldown (publishCooldownMs)
        // hanya berlaku kalau label BERIKUTNYA sama dengan ini -- supaya
        // setelah satu objek terkirim ke 3D Studio, mengarahkan kamera ke
        // objek LAIN tidak perlu menunggu jeda apa pun, hanya perlu stabil
        // `stabilityRequiredFrames` frame seperti biasa.
        this._lastPublishedLabel = null;

        this.video = root.querySelector('#camera-video');
        this.captureCanvas = root.querySelector('#capture-canvas');
        this.overlayCanvas = root.querySelector('#detection-overlay');
        this.stage = root.querySelector('#camera-stage');
        this.placeholder = root.querySelector('#camera-placeholder');

        this.startButton = root.querySelector('#start-camera');
        this.stopButton = root.querySelector('#stop-camera');
        // Tombol terpisah dari "Akhiri Sesi"/stop: hanya me-restart kamera +
        // loop deteksi, TANPA mengakhiri sesi pairing (lihat resetCamera()).
        this.resetButton = root.querySelector('#reset-camera');
        this.buildButton = root.querySelector('#build-3d-btn');
        this.topDetectionBar = root.querySelector('#top-detection-bar');
        this.topDetectionName = root.querySelector('#top-detection-name');
        this.topDetectionConfidence = root.querySelector('#top-detection-confidence');
        this.confidenceInput = root.querySelector('#confidence');
        this.confidenceOutput = root.querySelector('#confidence-value');
        this.fpsInput = root.querySelector('#target-fps');
        // Dropdown opsional: kelas yang TIDAK boleh dipilih sebagai "top
        // detection" (dan karena itu tidak akan auto-terkirim/dipakai tombol
        // build). Box-nya tetap digambar di overlay seperti biasa -- ini
        // cuma mempengaruhi kelas mana yang "menang" jadi deteksi utama,
        // supaya kelas yang paling sering nongol (mis. stabilo) tidak selalu
        // mengalahkan objek lain yang sedang diarahkan pengguna.
        this.ignoreClassSelect = root.querySelector('#ignore-class');
        this.ignoredClass = '';

        this.statusBadge = root.querySelector('#status-badge');
        this.errorMessage = root.querySelector('#error-message');
        this.objectCount = root.querySelector('#object-count');
        this.inferenceTime = root.querySelector('#inference-time');
        this.roundtripTime = root.querySelector('#roundtrip-time');
        this.modelName = root.querySelector('#model-name');
        this.deviceName = root.querySelector('#device-name');

        if (!this.video || !this.captureCanvas || !this.overlayCanvas || !this.detectUrl) {
            throw new Error('Elemen kamera atau endpoint deteksi belum dikonfigurasi lengkap.');
        }

        this.captureContext = this.captureCanvas.getContext('2d', { alpha: false });
        this.overlayContext = this.overlayCanvas.getContext('2d');

        this.stream = null;
        this.running = false;
        this.abortController = null;
        this.previousDetections = [];
        // Deteksi dengan confidence tertinggi pada frame TERAKHIR yang berhasil
        // diproses, beserta dimensi frame tersebut (koordinat mengikuti
        // `payload.image`). Dipakai saat pengguna menekan tombol "Buat Objek
        // 3D dari Label Ini" agar crop-nya presisi mengikuti bbox asli.
        this.topDetection = null;
        this.topDetectionFrameSize = { width: 0, height: 0 };
        this.captureMaxWidth = Math.max(640, Number(root.dataset.captureMaxWidth || 1280));
        this.colorPalette = createColorPalette();
        // True only when the active camera is genuinely front-facing. The
        // preview is mirrored (and detection boxes re-mirrored to match)
        // only in that case; a rear/environment camera or a generic webcam
        // must never be mirrored.
        this.isFrontFacing = false;

        // --- Freeze watchdog ------------------------------------------------
        // Sebagian browser HP (bukan cuma iOS Safari -- beberapa Chrome
        // Android juga, terutama sesaat setelah kamera lama dilepas & yang
        // baru diminta lagi) bisa memberi MediaStreamTrack yang menurut API
        // "hidup" (readyState tetap 'live', tidak ada error) tapi sebenarnya
        // tidak pernah mengirim frame baru lagi. Efeknya: canvas capture
        // terus menggambar frame BEKU yang sama persis, YOLO otomatis selalu
        // mengembalikan hasil dari gambar itu-itu saja (biasanya nol deteksi
        // untuk objek baru), dan karena tidak ada exception, tidak ada pesan
        // error yang muncul sama sekali -- persis seperti "objek berikutnya
        // tidak terdeteksi" tanpa sebab yang kelihatan.
        //
        // Watchdog ini membandingkan sidik jari kecil dari tiap frame yang
        // di-capture; kalau sidik jarinya IDENTIK terus-menerus selama
        // FREEZE_TIMEOUT_MS meski kamera masih "running", itu tandanya video
        // benar-benar beku (bukan cuma "tidak ada objek di depan kamera" --
        // pemandangan kosong pun sidik jarinya tetap sedikit berubah karena
        // noise sensor kamera). Begitu terdeteksi, kamera di-reset otomatis
        // tanpa perlu pengguna menekan tombol reset manual.
        this._lastFrameSignature = null;
        this._frameUnchangedSinceMs = null;
        this._autoRecovering = false;
        this._autoResetAttempts = 0;

        this.bindEvents();
    }

    bindEvents() {
        this.startButton?.addEventListener('click', () => this.start());
        this.stopButton?.addEventListener('click', () => this.stop());
        this.resetButton?.addEventListener('click', () => this.resetCamera());
        this.buildButton?.addEventListener('click', () => this.buildObjectFromTopDetection());

        this.confidenceInput?.addEventListener('input', () => {
            if (this.confidenceOutput) {
                this.confidenceOutput.value = Number(this.confidenceInput.value).toFixed(2);
            }
        });

        this.ignoreClassSelect?.addEventListener('change', () => {
            this.ignoredClass = String(this.ignoreClassSelect.value || '').trim().toLowerCase();
        });

        window.addEventListener('resize', () => this.syncOverlayResolution());
        window.addEventListener('beforeunload', () => this.stop(), { once: true });
    }

    async start() {
        if (this.running) return;

        if (!navigator.mediaDevices?.getUserMedia) {
            this.showError('Browser Anda tidak mendukung akses kamera.');
            return;
        }

        this.hideError();
        this.setStatus('starting', 'Meminta akses kamera…');

        try {
            try {
                // Object detection needs a camera pointed AT objects, so the
                // rear/environment camera is the correct default (not the
                // front-facing "selfie" camera). We still fall back to
                // whatever camera is available on devices without a rear
                // camera (laptops, desktops).
                this.stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                        facingMode: { ideal: 'environment' },
                        frameRate: { ideal: 30 },
                    },
                });
            } catch (errConstraint) {
                console.warn('Setelan kamera spesifik gagal, menggunakan stream video bawaan.', errConstraint);
                this.stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: true,
                });
            }

            this.video.srcObject = this.stream;
            await this.waitForVideoMetadata();
            await this.video.play();

            this.updateMirrorState();
            this.syncOverlayResolution();
            if (this.placeholder) this.placeholder.style.display = 'none';
            this.running = true;
            this.previousDetections = [];

            if (this.startButton) this.startButton.disabled = true;
            if (this.stopButton) this.stopButton.disabled = false;
            if (this.resetButton) this.resetButton.disabled = false;
            this.setStatus('running', 'Sensor Deteksi Aktif');

            void this.runDetectionLoop();
        } catch (error) {
            this.showError(this.cameraErrorMessage(error));
            this.setStatus('error', 'Kamera Gagal');
            this.releaseCamera();
        }
    }

    stop() {
        if (!this.running && !this.stream) return;

        this.running = false;
        this.abortController?.abort();
        this.abortController = null;

        this.releaseCamera();
        this.clearOverlay();
        this.previousDetections = [];
        this.topDetection = null;
        this.#updateTopDetectionUI();
        this._lastFrameSignature = null;
        this._frameUnchangedSinceMs = null;

        if (this.placeholder) this.placeholder.style.display = 'flex';
        if (this.startButton) this.startButton.disabled = false;
        if (this.stopButton) this.stopButton.disabled = true;
        if (this.resetButton) this.resetButton.disabled = true;
        if (this.objectCount) this.objectCount.textContent = '0';
        if (this.inferenceTime) this.inferenceTime.textContent = '—';
        if (this.roundtripTime) this.roundtripTime.textContent = '—';
        this.setStatus('idle', 'Kamera Berhenti');
    }

    /**
     * Menghentikan lalu langsung menyalakan ulang kamera & loop deteksi,
     * TANPA mengakhiri sesi pairing (beda dengan tombol "Akhiri Sesi").
     *
     * Dipakai saat sensor kamera "macet" -- mis. setelah lama diarahkan ke
     * objek yang sama, sebagian browser HP (terutama iOS Safari) membuat
     * video track jadi diam/tidak ter-update meski `running` masih true,
     * sehingga deteksi baru tidak pernah muncul lagi sampai kamera
     * benar-benar di-restart. Reset ini juga MELUPAKAN sepenuhnya objek yang
     * sudah terdeteksi/terkirim sebelumnya (label stabilitas & cooldown
     * publish), supaya begitu kamera menyala lagi, objek apa pun -- termasuk
     * objek yang barusan dikirim -- bisa langsung terdeteksi dari awal tanpa
     * sisa status lama yang "mengunci".
     */
    async resetCamera() {
        if (this.resetButton) this.resetButton.disabled = true;
        this.hideError();
        this.setStatus('starting', 'Mereset kamera…');

        this.stop();
        // Jeda supaya browser benar-benar melepas track kamera lama sebelum
        // diminta lagi -- tanpa ini beberapa HP (terutama sejumlah Android
        // yang HAL kameranya lebih lambat melepas resource) bisa gagal
        // re-acquire secara bersih dan malah dapat track yang "hidup" tapi
        // tidak pernah mengirim frame baru (lihat watchdog freeze di atas).
        await sleep(600);

        this._stabilityLabel = null;
        this._stabilityCount = 0;
        this._lastPublishAt = 0;
        this._lastPublishedLabel = null;
        this._lastFrameSignature = null;
        this._frameUnchangedSinceMs = null;

        await this.start();
        if (this.resetButton) this.resetButton.disabled = false;
    }

    releaseCamera() {
        if (this.stream) {
            for (const track of this.stream.getTracks()) {
                track.stop();
            }
        }
        this.stream = null;
        if (this.video) this.video.srcObject = null;
    }

    waitForVideoMetadata() {
        if (this.video.readyState >= HTMLMediaElement.HAVE_METADATA) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.video.addEventListener('loadedmetadata', resolve, { once: true });
        });
    }

    updateMirrorState() {
        const track = this.stream?.getVideoTracks?.()[0];
        const settings = track?.getSettings?.() ?? {};
        // Only mirror when the browser explicitly reports a user-facing
        // camera. Unknown/undefined facingMode (typical for laptop webcams)
        // is treated as NOT mirrored.
        this.isFrontFacing = settings.facingMode === 'user';
        this.video?.classList.toggle('mirrored', this.isFrontFacing);
    }

    syncOverlayResolution() {
        if (!this.video.videoWidth || !this.video.videoHeight) return;

        this.stage.style.aspectRatio = `${this.video.videoWidth} / ${this.video.videoHeight}`;
        this.overlayCanvas.width = this.video.videoWidth;
        this.overlayCanvas.height = this.video.videoHeight;
    }

    async runDetectionLoop() {
        while (this.running) {
            const cycleStartedAt = performance.now();

            try {
                await this.detectCurrentFrame();
            } catch (error) {
                if (error.name !== 'AbortError') {
                    this.showError(error.message || 'Frame gagal diproses.');
                    this.setStatus('error', 'Inference Bermasalah');
                }
            }

            const targetFps = Math.max(1, Number(this.fpsInput?.value || 5));
            const interval = 1000 / targetFps;
            const elapsed = performance.now() - cycleStartedAt;

            await sleep(Math.max(0, interval - elapsed));
        }
    }

    async detectCurrentFrame() {
        if (!this.running || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

        const sourceWidth = this.video.videoWidth;
        const sourceHeight = this.video.videoHeight;
        const captureWidth = Math.min(this.captureMaxWidth, sourceWidth);
        const captureHeight = Math.round(sourceHeight * (captureWidth / sourceWidth));

        if (this.captureCanvas.width !== captureWidth || this.captureCanvas.height !== captureHeight) {
            this.captureCanvas.width = captureWidth;
            this.captureCanvas.height = captureHeight;
            this.captureContext.imageSmoothingEnabled = true;
            this.captureContext.imageSmoothingQuality = 'high';
        }

        this.captureContext.drawImage(this.video, 0, 0, captureWidth, captureHeight);

        // Cek watchdog SEBELUM frame dikirim ke server -- freeze terjadi di
        // level capture (video track), jadi tidak bergantung pada berhasil
        // tidaknya request deteksi. Kalau frame ini beku, langsung berhenti
        // di sini (jangan lanjut kirim frame beku ke server) dan biarkan
        // pemulihan otomatis yang menangani.
        if (this.#checkFrameFreeze()) {
            return;
        }

        const frameBlob = await canvasToBlob(this.captureCanvas, 'image/jpeg', 0.94);
        const formData = new FormData();
        formData.append('frame', frameBlob, 'frame.jpg');
        formData.append('confidence', this.confidenceInput?.value || '0.35');

        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
        this.abortController = new AbortController();
        const timeoutId = window.setTimeout(() => this.abortController?.abort(), 10000);
        const requestStartedAt = performance.now();

        try {
            const response = await fetch(this.detectUrl, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'X-CSRF-TOKEN': csrfToken,
                },
                body: formData,
                credentials: 'same-origin',
                signal: this.abortController.signal,
            });

            const payload = await response.json().catch(() => null);

            if (!response.ok) {
                const validationMessage = payload?.errors
                    ? Object.values(payload.errors).flat().join(' ')
                    : null;
                throw new Error(
                    validationMessage || payload?.message || `Server mengembalikan HTTP ${response.status}.`,
                );
            }

            const roundtripMs = performance.now() - requestStartedAt;
            const stablePayload = this.stabilizePayload(payload);

            this.hideError();
            const totalCount = stablePayload.detections?.length || 0;
            this.setStatus('running', totalCount > 0 ? `Aktif · ${totalCount} Objek Terdeteksi` : 'Aktif · Pindai Objek...');
            this.drawDetections(stablePayload);
            this.updateMetrics(stablePayload, roundtripMs);
            this.#captureTopDetection(stablePayload);
        } finally {
            window.clearTimeout(timeoutId);
            this.abortController = null;
        }
    }

    stabilizePayload(payload) {
        const current = Array.isArray(payload?.detections) ? payload.detections : [];
        const alpha = 0.70;
        const smoothed = current.map((detection) => {
            const previous = this.previousDetections
                .filter((candidate) => candidate.class_id === detection.class_id)
                .sort((a, b) => intersectionOverUnion(b, detection) - intersectionOverUnion(a, detection))[0];

            if (!previous || intersectionOverUnion(previous, detection) < 0.25) {
                return detection;
            }

            return {
                ...detection,
                x1: previous.x1 * (1 - alpha) + detection.x1 * alpha,
                y1: previous.y1 * (1 - alpha) + detection.y1 * alpha,
                x2: previous.x2 * (1 - alpha) + detection.x2 * alpha,
                y2: previous.y2 * (1 - alpha) + detection.y2 * alpha,
            };
        });

        this.previousDetections = smoothed;
        return { ...payload, detections: smoothed };
    }

    drawDetections(payload) {
        const context = this.overlayContext;
        const sourceWidth = Number(payload.image?.width || 1);
        const sourceHeight = Number(payload.image?.height || 1);
        const scaleX = this.overlayCanvas.width / sourceWidth;
        const scaleY = this.overlayCanvas.height / sourceHeight;

        this.clearOverlay();

        // Compact but readable font size (slightly larger than before).
        const fontSize = Math.max(12, Math.min(15, Math.round(this.overlayCanvas.width / 80)));
        context.font = `600 ${fontSize}px sans-serif`;
        context.textBaseline = 'top';

        // Detections already arrive sorted by confidence (highest first)
        // from the backend; cap how many we draw so a noisy frame can't
        // paint dozens of overlapping labels across the whole screen.
        const detections = (payload.detections || []).slice(0, MAX_RENDERED_DETECTIONS);
        for (let i = 0; i < detections.length; i++) {
            const detection = detections[i];
            const color = this.colorPalette[i % this.colorPalette.length];

            const rawX = detection.x1 * scaleX;
            const y = detection.y1 * scaleY;
            const width = (detection.x2 - detection.x1) * scaleX;
            const height = (detection.y2 - detection.y1) * scaleY;

            // Only re-mirror coordinates when the preview itself is
            // mirrored (front-facing camera). Rear cameras/webcams render
            // the overlay in the same orientation the frame was captured.
            const x = this.isFrontFacing
                ? this.overlayCanvas.width - rawX - width
                : rawX;
            const label = `${detection.class_name} ${Math.round(detection.confidence * 100)}%`;

            // Thin 1px bounding box border
            context.strokeStyle = color.border;
            context.lineWidth = 1;
            context.strokeRect(x, y, width, height);

            // Tiny corner brackets
            const bracketLen = Math.min(width / 5, height / 5, 12);
            context.fillStyle = color.border;
            context.fillRect(x, y, bracketLen, 2);
            context.fillRect(x, y, 2, bracketLen);
            context.fillRect(x + width - bracketLen, y, bracketLen, 2);
            context.fillRect(x + width - 2, y, 2, bracketLen);
            context.fillRect(x, y + height - 2, bracketLen, 2);
            context.fillRect(x, y + height - bracketLen, 2, bracketLen);
            context.fillRect(x + width - bracketLen, y + height - 2, bracketLen, 2);
            context.fillRect(x + width - 2, y + height - bracketLen, 2, bracketLen);

            // Compact pill label, clamped so it always stays inside
            // the visible canvas instead of spilling off an edge.
            const textMetrics = context.measureText(label);
            const pillH = fontSize + 6;
            const pillW = Math.min(textMetrics.width + 12, this.overlayCanvas.width);
            const labelY = Math.max(0, y - pillH - 2);
            const labelX = Math.min(Math.max(0, x), this.overlayCanvas.width - pillW);

            context.fillStyle = color.fill;
            context.beginPath();
            if (context.roundRect) {
                context.roundRect(labelX, labelY, pillW, pillH, 4);
                context.fill();
            } else {
                context.fillRect(labelX, labelY, pillW, pillH);
            }

            context.fillStyle = color.text;
            context.fillText(label, labelX + 5, labelY + 3);
        }
    }

    clearOverlay() {
        this.overlayContext.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }

    /**
     * Mengambil deteksi dengan persentase confidence TERTINGGI dari frame
     * yang baru saja diproses, lalu menyimpan referensinya bersama dimensi
     * frame sumber sehingga tombol "Buat Objek 3D dari Label Ini" selalu
     * memakai deteksi paling akurat pada momen tersebut.
     */
    #captureTopDetection(payload) {
        const detections = Array.isArray(payload.detections) ? payload.detections : [];
        // Kelas yang diabaikan (lihat this.ignoreClassSelect) tetap
        // digambar di overlay lewat drawDetections(payload) di atas -- di
        // sini kita hanya menyingkirkannya dari kandidat "top detection"
        // supaya objek lain yang sedang diarahkan pengguna punya kesempatan
        // menang, walau kelas yang diabaikan itu confidence-nya lebih tinggi.
        const eligible = this.ignoredClass
            ? detections.filter((detection) => String(detection.class_name || '').toLowerCase() !== this.ignoredClass)
            : detections;
        const top = eligible.reduce((best, detection) => (
            !best || Number(detection.confidence || 0) > Number(best.confidence || 0)
                ? detection
                : best
        ), null);

        this.topDetection = top;
        this.topDetectionFrameSize = {
            width: Number(payload.image?.width || this.captureCanvas.width),
            height: Number(payload.image?.height || this.captureCanvas.height),
        };
        this.#updateTopDetectionUI();
        this.#maybePublishStableDetection();
    }

    /**
     * Melacak apakah label dengan confidence tertinggi bertahan konsisten
     * selama beberapa frame berturut-turut. Begitu stabil (dan cooldown
     * sebelumnya sudah lewat), `onStableDetection` dipanggil dengan potongan
     * gambar objek tersebut — dipakai untuk mode device-pairing di mana HP
     * tidak punya tombol "Buat Objek 3D" manual, semuanya otomatis.
     */
    #maybePublishStableDetection() {
        if (!this.onStableDetection) return;

        if (!this.topDetection) {
            this._stabilityLabel = null;
            this._stabilityCount = 0;
            return;
        }

        const label = this.topDetection.class_name;
        if (label === this._stabilityLabel) {
            this._stabilityCount += 1;
        } else {
            this._stabilityLabel = label;
            this._stabilityCount = 1;
        }

        const now = performance.now();
        // Cooldown HANYA berlaku kalau label yang mau dipublish SAMA dengan
        // yang terakhir kali berhasil dipublish -- ini mencegah spam publish
        // ulang untuk objek yang sama, tapi tidak menahan objek LAIN sama
        // sekali. Sebelumnya cooldown ini global untuk semua label, jadi
        // begitu satu objek terkirim, objek berikutnya (walau beda kelas)
        // ikut tertahan sampai 4 detik -- itu yang bikin serasa "tidak bisa
        // scan objek lain" setelah kirim.
        const isRepeatOfLastPublish = label === this._lastPublishedLabel;
        const cooledDown = !isRepeatOfLastPublish || (now - this._lastPublishAt) >= this.publishCooldownMs;
        const isStable = this._stabilityCount >= this.stabilityRequiredFrames;

        if (!isStable || !cooledDown) return;

        const confidence = Number(this.topDetection.confidence || 0);
        const dataUrl = this.#buildCroppedDataUrl();
        if (!dataUrl) return;

        this._lastPublishAt = now;
        this._lastPublishedLabel = label;
        this._stabilityCount = 0;
        this.onStableDetection(dataUrl, label, confidence);
    }

    /**
     * Memotong frame kamera terakhir mengikuti bounding box dari label
     * berconfidence tertinggi. Dipakai bersama oleh tombol manual "Buat
     * Objek 3D dari Label Ini" dan oleh mode auto-publish device-pairing.
     */
    #buildCroppedDataUrl() {
        if (!this.topDetection) return null;

        const frameWidth = this.topDetectionFrameSize.width || this.captureCanvas.width;
        const frameHeight = this.topDetectionFrameSize.height || this.captureCanvas.height;
        const scaleX = this.captureCanvas.width / Math.max(1, frameWidth);
        const scaleY = this.captureCanvas.height / Math.max(1, frameHeight);

        const rawWidth = (this.topDetection.x2 - this.topDetection.x1) * scaleX;
        const rawHeight = (this.topDetection.y2 - this.topDetection.y1) * scaleY;
        const marginX = Math.max(2, rawWidth * 0.06);
        const marginY = Math.max(2, rawHeight * 0.06);

        const x1 = this.#clamp(this.topDetection.x1 * scaleX - marginX, 0, this.captureCanvas.width - 1);
        const y1 = this.#clamp(this.topDetection.y1 * scaleY - marginY, 0, this.captureCanvas.height - 1);
        const x2 = this.#clamp(this.topDetection.x2 * scaleX + marginX, x1 + 1, this.captureCanvas.width);
        const y2 = this.#clamp(this.topDetection.y2 * scaleY + marginY, y1 + 1, this.captureCanvas.height);

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = Math.max(1, Math.round(x2 - x1));
        cropCanvas.height = Math.max(1, Math.round(y2 - y1));
        cropCanvas.getContext('2d').drawImage(
            this.captureCanvas,
            Math.round(x1), Math.round(y1), cropCanvas.width, cropCanvas.height,
            0, 0, cropCanvas.width, cropCanvas.height,
        );

        return cropCanvas.toDataURL('image/png');
    }

    #updateTopDetectionUI() {
        const hasTop = Boolean(this.topDetection);

        if (this.buildButton) this.buildButton.disabled = !hasTop;
        if (this.topDetectionBar) this.topDetectionBar.hidden = !hasTop;

        if (hasTop) {
            if (this.topDetectionName) {
                this.topDetectionName.textContent = String(this.topDetection.class_name || 'objek').toUpperCase();
            }
            if (this.topDetectionConfidence) {
                this.topDetectionConfidence.textContent = `${Math.round(Number(this.topDetection.confidence || 0) * 100)}%`;
            }
        }
    }

    /**
     * Memotong frame kamera terakhir mengikuti bounding box dari label
     * berconfidence tertinggi, menyimpannya sebagai gambar sumber 3D Design
     * Studio (kunci localStorage yang sama dipakai oleh halaman Home), lalu
     * mengarahkan pengguna ke /editor supaya objek 3D langsung dibuat dari
     * label tersebut.
     */
    async buildObjectFromTopDetection() {
        if (!this.topDetection || !this.buildButton) return;

        this.buildButton.disabled = true;
        const originalLabel = this.buildButton.textContent;
        this.buildButton.textContent = 'Menyiapkan objek 3D…';

        try {
            const dataUrl = this.#buildCroppedDataUrl();
            if (!dataUrl) throw new Error('Gagal memotong frame kamera.');

            localStorage.setItem('3d_editor_image', dataUrl);
            window.location.href = '/editor';
        } catch (error) {
            console.error('Gagal menyiapkan objek 3D dari deteksi kamera.', error);
            this.showError('Gagal menyiapkan objek 3D dari label ini. Coba lagi.');
            this.buildButton.disabled = false;
            this.buildButton.textContent = originalLabel;
        }
    }

    #clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    /**
     * Sidik jari murah dari isi captureCanvas SAAT INI -- diambil dari petak
     * kecil di tengah frame (bukan seluruh frame) supaya cukup ringan untuk
     * dihitung tiap siklus deteksi. Return null kalau canvas belum siap
     * (mis. dimensi masih 0) supaya pemanggil tahu untuk melewati cek ini.
     */
    #computeFrameSignature() {
        const width = this.captureCanvas.width;
        const height = this.captureCanvas.height;
        if (!width || !height) return null;

        const sampleSize = Math.min(16, width, height);
        const sampleX = Math.max(0, Math.floor((width - sampleSize) / 2));
        const sampleY = Math.max(0, Math.floor((height - sampleSize) / 2));

        let pixels;
        try {
            pixels = this.captureContext.getImageData(sampleX, sampleY, sampleSize, sampleSize).data;
        } catch (error) {
            // Kalau gagal dibaca (harusnya tidak terjadi, canvas ini bukan
            // hasil sumber cross-origin), lewati saja cek freeze kali ini.
            return null;
        }

        let signature = 0;
        for (let i = 0; i < pixels.length; i += 4) {
            signature = (signature + pixels[i] + pixels[i + 1] + pixels[i + 2]) | 0;
        }
        return signature;
    }

    /**
     * Membandingkan sidik jari frame saat ini dengan yang sebelumnya. Kalau
     * identik terus selama FREEZE_TIMEOUT_MS, kamera dianggap macet dan
     * pemulihan otomatis (#recoverFromFreeze) dipicu.
     *
     * @returns {boolean} true kalau frame ini beku (pemanggil sebaiknya
     *          tidak melanjutkan kirim frame beku ini ke server).
     */
    #checkFrameFreeze() {
        const signature = this.#computeFrameSignature();
        if (signature === null) return false;

        const now = performance.now();

        if (signature !== this._lastFrameSignature) {
            // Frame berubah -> kamera hidup normal. Reset penghitung freeze
            // DAN penghitung percobaan auto-reset (pemulihan berhasil).
            this._lastFrameSignature = signature;
            this._frameUnchangedSinceMs = now;
            this._autoResetAttempts = 0;
            return false;
        }

        if (this._frameUnchangedSinceMs === null) {
            this._frameUnchangedSinceMs = now;
            return false;
        }

        const frozenForMs = now - this._frameUnchangedSinceMs;
        if (frozenForMs < FREEZE_TIMEOUT_MS) {
            return false;
        }

        if (!this._autoRecovering) {
            void this.#recoverFromFreeze();
        }
        return true;
    }

    /**
     * Reset kamera otomatis begitu watchdog mendeteksi frame beku --
     * dipanggil tanpa perlu pengguna menekan tombol reset manual sama
     * sekali. Dibatasi MAX_AUTO_RESET_ATTEMPTS supaya tidak reset
     * tanpa henti kalau kameranya memang tidak bisa dipulihkan (mis. sedang
     * dipakai aplikasi lain di HP).
     */
    async #recoverFromFreeze() {
        if (this._autoRecovering || !this.running) return;
        this._autoRecovering = true;
        this._autoResetAttempts += 1;

        if (this._autoResetAttempts > MAX_AUTO_RESET_ATTEMPTS) {
            this.showError('Kamera tampak macet dan gagal pulih otomatis. Coba tekan tombol reset, atau muat ulang halaman.');
            this.setStatus('error', 'Kamera Macet');
            this._autoRecovering = false;
            return;
        }

        console.warn(
            `[camera-detection] Frame kamera tidak berubah selama ${FREEZE_TIMEOUT_MS}ms -- `
            + `kemungkinan video track macet. Reset otomatis #${this._autoResetAttempts}.`,
        );
        this.setStatus('starting', 'Kamera macet, memulihkan otomatis…');

        this._lastFrameSignature = null;
        this._frameUnchangedSinceMs = null;

        await this.resetCamera();
        this._autoRecovering = false;
    }

    updateMetrics(payload, roundtripMs) {
        if (this.objectCount) this.objectCount.textContent = String(payload.detections?.length ?? 0);
        if (this.inferenceTime) this.inferenceTime.textContent = `${Number(payload.inference_ms || 0).toFixed(1)} ms`;
        if (this.roundtripTime) this.roundtripTime.textContent = `${roundtripMs.toFixed(1)} ms`;
        if (this.modelName) this.modelName.textContent = payload.model ? payload.model.toUpperCase() : 'Auto Scan';
        if (this.deviceName) {
            // Backend inferensi GPU (lihat backend-gpu-reference/python/yolo_gpu_server.py)
            // mengirim string seperti "cuda:0 (NVIDIA GeForce RTX 4070)". Kalau field ini
            // tidak ada (backend lama/CPU-only), tampilkan status default.
            const device = String(payload.device || '').trim();
            const isGpu = /^cuda/i.test(device);
            this.deviceName.textContent = device
                ? device.replace(/^cuda:0\s*/i, 'GPU · ').replace(/^cpu$/i, 'CPU')
                : 'Tidak diketahui';
            this.deviceName.classList.toggle('device-gpu', isGpu);
            this.deviceName.classList.toggle('device-cpu', !isGpu && Boolean(device));
        }
    }

    setStatus(state, text) {
        if (this.statusBadge) {
            this.statusBadge.dataset.state = state;
            this.statusBadge.textContent = text;
        }
    }

    showError(message) {
        if (this.errorMessage) {
            this.errorMessage.textContent = message;
            this.errorMessage.hidden = false;
        }
    }

    hideError() {
        if (this.errorMessage) {
            this.errorMessage.textContent = '';
            this.errorMessage.hidden = true;
        }
    }

    cameraErrorMessage(error) {
        switch (error.name) {
            case 'NotAllowedError':
                return 'Izin kamera ditolak. Izinkan akses kamera pada browser Anda.';
            case 'NotFoundError':
                return 'Kamera tidak ditemukan pada perangkat ini.';
            case 'NotReadableError':
                return 'Kamera sedang digunakan aplikasi lain.';
            case 'OverconstrainedError':
                return 'Kamera tidak mendukung setelan yang diminta.';
            default:
                return error.message || 'Kamera tidak dapat diakses.';
        }
    }
}

export function initCameraPage() {
    const root = document.querySelector('#camera-app');

    if (!root || root.dataset.cameraInitialized === 'true') {
        return null;
    }

    root.dataset.cameraInitialized = 'true';
    const app = new CameraDetectionApp(root);
    app.start();

    return app;
}
