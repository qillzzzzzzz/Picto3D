/**
 * device-camera-pair.js
 * Sisi HP dari fitur "Tambah Device". Halaman ini dibuka begitu QR code
 * dipindai — tidak ada langkah manual lain: kamera langsung diminta &
 * diaktifkan, deteksi objek berjalan otomatis, dan begitu satu label
 * bertahan sebagai deteksi paling tinggi confidence-nya, potongan gambarnya
 * langsung dikirim ke sesi supaya desktop bisa membangun model 3D-nya.
 */

import { CameraDetectionApp } from './camera-detection.js';

function csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content;
}

async function connectSession(connectUrl) {
    const response = await fetch(connectUrl, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'X-CSRF-TOKEN': csrfToken(),
        },
        credentials: 'same-origin',
    });

    if (!response.ok) {
        throw new Error('Sesi tidak ditemukan atau sudah kedaluwarsa.');
    }

    return response.json();
}

async function endSession(token) {
    try {
        await fetch(`/device-sessions/${token}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-TOKEN': csrfToken() },
            credentials: 'same-origin',
        });
    } catch (error) {
        console.error('Gagal mengakhiri sesi device.', error);
    }
}

async function publishDetection(publishUrl, { label, confidence, image }) {
    const response = await fetch(publishUrl, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-CSRF-TOKEN': csrfToken(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({ label, confidence, image }),
    });

    if (!response.ok) {
        throw new Error('Gagal mengirim deteksi ke 3D Studio.');
    }

    return response.json();
}

/**
 * Setelah gambar terkirim, halaman /editor di desktop butuh waktu sepersekian
 * detik (siklus polling 1.5s + waktu build mesh) untuk benar-benar membangun
 * modelnya. Fungsi ini menunggu (polling status sesi) sampai
 * `processed_sequence` di server >= sequence yang baru kita kirim, supaya
 * notif "berhasil digenerate" di HP itu BENERAN sudah tergenerate -- bukan
 * cuma tanda sudah terkirim.
 */
async function waitForGeneration(statusUrl, sequence, { timeoutMs = 15000, intervalMs = 900 } = {}) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(statusUrl, {
                headers: { Accept: 'application/json' },
                credentials: 'same-origin',
            });
            if (response.ok) {
                const session = await response.json();
                if (Number(session.processed_sequence || 0) >= sequence) return true;
            }
        } catch (error) {
            // abaikan, coba lagi sampai timeout
        }
        await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    }

    return false;
}

function setPairStatus(root, state, text) {
    const badge = root.querySelector('#device-pair-status');
    if (badge) {
        badge.dataset.state = state;
        badge.textContent = text;
    }
}

function showToast(root, message) {
    const toast = root.querySelector('#device-pair-toast');
    if (!toast) return;

    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toast._hideTimer);
    toast._hideTimer = window.setTimeout(() => {
        toast.hidden = true;
    }, 3500);
}

function showFatalError(root, message) {
    // Reuses the same centered loading screen for the error state instead
    // of layering a second error banner on top of the topbar/bottombar —
    // that stacking is exactly what made the pre-connection UI look messy.
    const loadingTitle = root.querySelector('#pair-loading-title');
    const loadingCopy = root.querySelector('#pair-loading-copy');
    if (loadingTitle) loadingTitle.textContent = 'Sesi Tidak Tersedia';
    if (loadingCopy) loadingCopy.textContent = message || 'Minta QR code baru dari 3D Camera Studio, lalu scan ulang.';
}

export async function initDeviceCameraPairPage() {
    const root = document.getElementById('device-pair-app');
    if (!root || root.dataset.pairInitialized === 'true') return null;
    root.dataset.pairInitialized = 'true';

    const connectUrl = root.dataset.connectUrl;
    const publishUrl = root.dataset.publishUrl;
    // Sama seperti endpoint polling yang dipakai desktop (device-pairing.js /
    // editor.js) -- dipakai di sini untuk menunggu konfirmasi "processed_sequence"
    // setelah publish, bukan untuk polling status terus-menerus.
    const statusUrl = `/device-sessions/${root.dataset.token}`;

    setPairStatus(root, 'connecting', 'Menghubungkan ke 3D Studio…');

    try {
        await connectSession(connectUrl);
    } catch (error) {
        console.error('Gagal terhubung ke sesi device.', error);
        setPairStatus(root, 'error', 'Gagal terhubung');
        // Only the initial connect failure switches the page into the
        // "error" screen (see .pair-loading gating in app.css). Anything
        // that happens later — e.g. the user tapping "Akhiri Sesi" — must
        // NOT re-trigger this, or the toast/bottombar it relies on would
        // vanish along with everything else.
        root.dataset.connection = 'error';
        showFatalError(root, error.message || 'Sesi tidak valid atau sudah kedaluwarsa.');
        return null;
    }

    // Session confirmed: reveal the status pill, bottombar controls,
    // settings panel and bookmark hint (all hidden until now) and retire
    // the connecting screen for good.
    root.dataset.connection = 'ready';
    setPairStatus(root, 'connected', 'Terhubung — arahkan kamera ke objek');

    const app = new CameraDetectionApp(root, {
        stabilityFrames: 4,
        publishCooldownMs: 4000,
        onStableDetection: async (image, label, confidence) => {
            setPairStatus(root, 'sending', `Mengirim "${label}"…`);

            let publishResult;
            try {
                publishResult = await publishDetection(publishUrl, { label, confidence, image });
                showToast(root, `📤 Terkirim: ${label} (${Math.round(confidence * 100)}%) — menunggu 3D Studio…`);
                // Kamera & deteksi TETAP jalan selama proses build ini --
                // status di bawah cuma info, bukan tanda sistem berhenti
                // memindai. Objek lain (beda kelas) bisa langsung terdeteksi
                // dan terkirim tanpa menunggu proses ini selesai.
                setPairStatus(root, 'sending', `Menyimpan "${label}" — kamera tetap memindai objek lain…`);
            } catch (error) {
                console.error('Gagal mengirim deteksi ke sesi.', error);
                showToast(root, '⚠️ Gagal mengirim ke 3D Studio. Coba lagi.');
                setPairStatus(root, 'connected', 'Terhubung — arahkan kamera ke objek');
                return;
            }

            // Dari sini seterusnya kegagalan (mis. koneksi putus saat polling)
            // TIDAK dianggap fatal -- gambar sudah tersimpan di server, jadi
            // /editor akan tetap mengambilnya lewat polling normal walau HP
            // tidak sempat lihat konfirmasinya.
            const sequence = Number(publishResult?.sequence || 0);
            const generated = sequence > 0 && await waitForGeneration(statusUrl, sequence);

            if (generated) {
                showToast(root, `✅ Model 3D "${label}" berhasil dibuat di 3D Studio!`);
                setPairStatus(root, 'connected', 'Model 3D berhasil dibuat — arahkan ke objek lain jika perlu.');
            } else {
                showToast(root, `⏳ Terkirim, tapi belum ada konfirmasi dari 3D Studio. Pastikan halaman /editor terbuka di desktop.`);
                setPairStatus(root, 'connected', 'Terhubung — arahkan kamera ke objek');
            }
        },
    });

    app.start();

    const stopButton = root.querySelector('#stop-camera');
    stopButton?.addEventListener('click', () => {
        setPairStatus(root, 'error', 'Sesi diakhiri');
        showToast(root, 'Sesi ditutup. Minta QR code baru untuk memindai lagi.');
        endSession(root.dataset.token);
    }, { once: true });

    return app;
}
