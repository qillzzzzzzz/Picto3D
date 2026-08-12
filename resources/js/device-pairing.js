/**
 * device-pairing.js
 * Sisi desktop dari fitur "Tambah Device": membuat sesi pairing, menampilkan
 * QR code untuk dipindai HP, lalu polling status sesi tersebut. Begitu HP
 * mengirim objek dengan confidence tertinggi, gambarnya disimpan ke
 * localStorage yang sama dipakai 3D Design Studio dan halaman diarahkan ke
 * /editor secara otomatis.
 *
 * Sesi pairing sekarang berumur panjang (30 hari, lihat
 * DeviceSessionController::TTL_SECONDS) supaya HP yang sudah pernah connect
 * bisa dipakai lagi tanpa scan QR ulang — cukup buka link yang sama lagi
 * (idealnya lewat "Tambah ke Layar Utama" di HP). Daftar perangkat yang
 * pernah tersambung disimpan di localStorage desktop ini supaya bisa
 * langsung "Sambung Ulang" tanpa generate QR baru.
 */

import QRCode from 'qrcode';

const POLL_INTERVAL_MS = 1500;
const KNOWN_DEVICES_KEY = 'picto3d_known_devices';
const MAX_KNOWN_DEVICES = 6;

// Kunci localStorage yang sama dipakai oleh /editor (lihat editor.js) supaya
// halaman editor bisa lanjut polling sesi ini sendiri begitu user pindah ke
// sana — jadi pindaian KEDUA dan seterusnya dari HP tetap ter-update, bukan
// cuma pindaian pertama.
const ACTIVE_TOKEN_KEY = 'picto3d_active_session_token';
const LAST_SEQUENCE_KEY = 'picto3d_last_sequence';
// Sama seperti di editor.js -- dipakai supaya /editor bisa langsung pakai
// label yang sudah dideteksi HP untuk pindaian PERTAMA juga (sebelum live
// sync polling sempat jalan), tanpa perlu deteksi ulang di desktop.
const LAST_LABEL_KEY = 'picto3d_last_label';
const LAST_CONFIDENCE_KEY = 'picto3d_last_confidence';

function csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content;
}

function loadKnownDevices() {
    try {
        const raw = localStorage.getItem(KNOWN_DEVICES_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (error) {
        console.error('Gagal membaca daftar perangkat tersimpan.', error);
        return [];
    }
}

function saveKnownDevices(list) {
    try {
        localStorage.setItem(KNOWN_DEVICES_KEY, JSON.stringify(list.slice(0, MAX_KNOWN_DEVICES)));
    } catch (error) {
        console.error('Gagal menyimpan daftar perangkat.', error);
    }
}

function upsertKnownDevice({ token, label, joinUrl }) {
    const list = loadKnownDevices().filter((device) => device.token !== token);
    list.unshift({
        token,
        label: label || 'Perangkat',
        joinUrl: joinUrl || null,
        lastConnected: new Date().toISOString(),
    });
    saveKnownDevices(list);
    return list;
}

function removeKnownDevice(token) {
    saveKnownDevices(loadKnownDevices().filter((device) => device.token !== token));
}

function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const diffMs = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'baru saja';
    if (minutes < 60) return `${minutes} menit lalu`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} jam lalu`;
    const days = Math.floor(hours / 24);
    return `${days} hari lalu`;
}

export class DevicePairingManager {
    constructor() {
        this.addButton = document.getElementById('add-device-btn');
        this.modal = document.getElementById('device-pairing-modal');
        this.statusEl = document.getElementById('device-modal-status');
        this.qrCanvas = document.getElementById('device-qr-canvas');
        this.qrBox = document.getElementById('device-qr-box');
        this.urlEl = document.getElementById('device-pair-url');
        this.cancelButton = document.getElementById('device-cancel-btn');
        this.knownListEl = document.getElementById('device-known-list');
        this.newQrButton = document.getElementById('device-new-qr-btn');

        this.token = null;
        this.pollTimer = null;
        this.lastSequence = 0;
        this.currentLabel = null;
        this.currentJoinUrl = null;
        this.hasNavigated = false;

        if (!this.addButton || !this.modal) return;

        this.addButton.addEventListener('click', () => this.openModal());
        this.cancelButton?.addEventListener('click', () => this.endSession());
        this.newQrButton?.addEventListener('click', () => this.createNewSession());
        this.modal.querySelectorAll('[data-close-modal]').forEach((el) => {
            el.addEventListener('click', () => this.closeModal());
        });
    }

    async openModal() {
        this.modal.hidden = false;
        this.renderKnownDevices();

        const devices = loadKnownDevices();
        if (devices.length > 0) {
            // Ada perangkat yang pernah tersambung — tampilkan daftarnya dulu,
            // biarkan user pilih "Sambung Ulang" atau bikin QR baru sendiri.
            this.setStatus('idle', 'Pilih perangkat tersimpan, atau buat QR baru.');
            if (this.qrBox) this.qrBox.hidden = true;
            if (this.urlEl) this.urlEl.textContent = '—';
            return;
        }

        await this.createNewSession();
    }

    async createNewSession() {
        this.setStatus('loading', 'Membuat sesi…');
        if (this.qrBox) this.qrBox.hidden = false;
        if (this.qrCanvas) {
            const ctx = this.qrCanvas.getContext('2d');
            ctx?.clearRect(0, 0, this.qrCanvas.width, this.qrCanvas.height);
        }
        if (this.urlEl) this.urlEl.textContent = '—';

        try {
            const response = await fetch('/device-sessions', {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'X-CSRF-TOKEN': csrfToken(),
                },
                credentials: 'same-origin',
            });

            if (!response.ok) {
                throw new Error('Gagal membuat sesi device.');
            }

            const data = await response.json();
            this.token = data.token;
            this.currentJoinUrl = data.join_url;
            this.currentLabel = null;
            this.lastSequence = 0;
            this.hasNavigated = false;
            this.rememberActiveSession(this.token, 0);

            if (this.urlEl) this.urlEl.textContent = data.join_url;

            const qrRendered = await this.renderQr(data.join_url);
            if (qrRendered) {
                this.setStatus('pending', 'Menunggu HP memindai QR code…');
            }
            this.startPolling();
        } catch (error) {
            console.error('Gagal membuat sesi device.', error);
            this.setStatus('error', error.message || 'Gagal membuat sesi device. Coba lagi.');
        }
    }

    /** Sambung ulang ke token lama tanpa bikin sesi/QR baru. */
    async reconnectDevice(device) {
        this.setStatus('loading', `Menghubungkan ke ${device.label}…`);
        if (this.qrBox) this.qrBox.hidden = true;

        try {
            const response = await fetch(`/device-sessions/${device.token}`, {
                headers: { Accept: 'application/json' },
                credentials: 'same-origin',
            });

            if (response.status === 404) {
                this.setStatus('error', 'Sesi perangkat ini sudah kedaluwarsa. Buat QR baru untuk sambung ulang.');
                removeKnownDevice(device.token);
                this.renderKnownDevices();
                return;
            }

            if (!response.ok) throw new Error('Gagal memuat sesi.');

            this.token = device.token;
            this.currentJoinUrl = device.joinUrl;
            this.currentLabel = device.label;
            this.lastSequence = 0;
            this.hasNavigated = false;
            this.rememberActiveSession(this.token, 0);

            if (this.urlEl) this.urlEl.textContent = device.joinUrl || '—';
            this.setStatus('pending', `Menunggu ${device.label} membuka kembali halaman kameranya…`);
            this.startPolling();
        } catch (error) {
            console.error('Gagal menyambung ulang ke perangkat.', error);
            this.setStatus('error', 'Gagal menyambung ulang. Coba buat QR baru.');
        }
    }

    renderKnownDevices() {
        if (!this.knownListEl) return;

        const devices = loadKnownDevices();
        this.knownListEl.innerHTML = '';

        if (devices.length === 0) {
            this.knownListEl.hidden = true;
            return;
        }

        this.knownListEl.hidden = false;

        devices.forEach((device) => {
            const row = document.createElement('div');
            row.className = 'device-known-row';

            const info = document.createElement('div');
            info.className = 'device-known-info';
            info.innerHTML = `<strong>${device.label}</strong><span>Terakhir: ${formatRelativeTime(device.lastConnected)}</span>`;

            const actions = document.createElement('div');
            actions.className = 'device-known-actions';

            const connectBtn = document.createElement('button');
            connectBtn.type = 'button';
            connectBtn.className = 'button btn btn-primary btn-sm';
            connectBtn.textContent = 'Sambung Ulang';
            connectBtn.addEventListener('click', () => this.reconnectDevice(device));

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'device-known-remove';
            removeBtn.setAttribute('aria-label', `Hapus ${device.label}`);
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', () => {
                removeKnownDevice(device.token);
                this.renderKnownDevices();
            });

            actions.append(connectBtn, removeBtn);
            row.append(info, actions);
            this.knownListEl.appendChild(row);
        });
    }

    async renderQr(url) {
        if (!this.qrCanvas) return false;

        try {
            await QRCode.toCanvas(this.qrCanvas, url, { width: 220, margin: 1 });
            return true;
        } catch (error) {
            console.error('Gagal membuat QR code.', error);
            this.setStatus('error', 'Gagal menampilkan QR code. Buka tautan manual di bawah lewat HP.');
            return false;
        }
    }

    startPolling() {
        this.stopPolling();
        this.pollTimer = window.setInterval(() => this.poll(), POLL_INTERVAL_MS);
    }

    stopPolling() {
        if (this.pollTimer) {
            window.clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    async poll() {
        if (!this.token) return;

        try {
            const response = await fetch(`/device-sessions/${this.token}`, {
                headers: { Accept: 'application/json' },
                credentials: 'same-origin',
            });

            if (response.status === 404) {
                this.setStatus('error', 'Sesi kedaluwarsa. Klik "Tambah Device" lagi untuk QR baru.');
                removeKnownDevice(this.token);
                this.stopPolling();
                return;
            }

            if (!response.ok) return;

            const session = await response.json();

            if (session.status === 'connected') {
                this.currentLabel = session.device_label || this.currentLabel || 'Perangkat';
                this.setStatus('connected', `📱 ${this.currentLabel} terhubung — arahkan kameranya ke objek.`);
                upsertKnownDevice({ token: this.token, label: this.currentLabel, joinUrl: this.currentJoinUrl });
            }

            const detection = session.detection;
            if (detection && detection.sequence > this.lastSequence) {
                this.lastSequence = detection.sequence;
                this.handleIncomingDetection(detection);
            }
        } catch (error) {
            console.error('Polling sesi device gagal.', error);
        }
    }

    /** Simpan token sesi aktif supaya /editor bisa lanjut polling sendiri. */
    rememberActiveSession(token, sequence) {
        try {
            localStorage.setItem(ACTIVE_TOKEN_KEY, token);
            localStorage.setItem(LAST_SEQUENCE_KEY, String(sequence));
        } catch (error) {
            console.error('Gagal menyimpan sesi device aktif.', error);
        }
    }

    handleIncomingDetection(detection) {
        const confidencePct = Math.round(Number(detection.confidence || 0) * 100);

        try {
            localStorage.setItem('3d_editor_image', detection.image);
            localStorage.setItem(LAST_LABEL_KEY, detection.label || '');
            localStorage.setItem(LAST_CONFIDENCE_KEY, String(detection.confidence || 0));
            this.rememberActiveSession(this.token, detection.sequence);
        } catch (error) {
            console.error('Gagal menyimpan gambar dari device ke localStorage.', error);
            this.setStatus('error', 'Gagal menyimpan gambar dari HP. Coba pindai ulang.');
            return;
        }

        // Pindaian pertama: pindah ke 3D Studio. Setelah itu halaman /editor
        // sendiri yang melanjutkan polling sesi ini (lihat editor.js), jadi
        // pindaian kedua dan seterusnya tetap ter-update tanpa perlu balik
        // ke sini lagi. Polling di modal ini TIDAK dihentikan supaya kalau
        // user masih di halaman ini (belum sempat pindah), status tetap live.
        if (!this.hasNavigated) {
            this.hasNavigated = true;
            this.setStatus('connected', `✅ Objek "${detection.label}" terdeteksi (${confidencePct}%) — membuka 3D Studio…`);
            window.setTimeout(() => {
                window.location.href = '/editor';
            }, 900);
        } else {
            this.setStatus('connected', `✅ Objek "${detection.label}" terdeteksi (${confidencePct}%) — model diperbarui.`);
        }
    }

    setStatus(state, text) {
        if (!this.statusEl) return;
        this.statusEl.dataset.state = state;
        this.statusEl.textContent = text;
    }

    closeModal() {
        if (this.modal) this.modal.hidden = true;
    }

    async endSession() {
        this.stopPolling();

        if (this.token) {
            try {
                await fetch(`/device-sessions/${this.token}`, {
                    method: 'DELETE',
                    headers: { 'X-CSRF-TOKEN': csrfToken() },
                    credentials: 'same-origin',
                });
            } catch (error) {
                console.error('Gagal mengakhiri sesi device.', error);
            }
            removeKnownDevice(this.token);

            try {
                if (localStorage.getItem(ACTIVE_TOKEN_KEY) === this.token) {
                    localStorage.removeItem(ACTIVE_TOKEN_KEY);
                    localStorage.removeItem(LAST_SEQUENCE_KEY);
                    localStorage.removeItem(LAST_LABEL_KEY);
                    localStorage.removeItem(LAST_CONFIDENCE_KEY);
                }
            } catch (error) {
                // abaikan
            }
        }

        this.token = null;
        this.closeModal();
    }
}

export function initDevicePairing() {
    if (!document.getElementById('add-device-btn')) return null;
    return new DevicePairingManager();
}
