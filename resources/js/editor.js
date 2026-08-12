import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformHandleManager } from './TransformHandleManager.js';
import { YoloDetector } from './cv/YoloDetector.js';
import { PrimitiveFactory } from './3d/PrimitiveFactory.js';
import { ObjectReconstructor } from './3d/ObjectReconstructor.js';
import { resolveModelEntry } from './3d/ModelCatalog.js';
import { loadCatalogModel } from './3d/ModelLibrary.js';
import { cssColor } from './theme.js';

// 3D Design Studio Three.js Orchestration Script

let scene, camera, renderer, controls;
let currentMesh = null;
let textureLoader = new THREE.TextureLoader();
let currentTexture = null;

let meshMaterial;
let activeRenderMode = 'textured';
let currentExtrusionDepth = 2.5;
let currentSegmentDetail = 128;
let currentGeometryShape = 'relief';
let currentImageSrc = null;

// --- Parametric Dimension & Transform State (P x L x T) ---
let objectDimensions = { width: 6, height: 4.5, depth: 2.5 };
let imageNaturalAspect = 1;
let lockAspect = true;
let snapEnabled = true;
let snapStep = 0.25;
let handlesVisible = true;

// --- Live sync dari device HP yang terhubung (lihat device-pairing.js) ---
// Dipakai supaya SETIAP kali HP berhasil scan objek baru, model 3D di
// halaman /editor ini ikut ter-update otomatis, bukan cuma pindaian pertama.
const DEVICE_ACTIVE_TOKEN_KEY = 'picto3d_active_session_token';
const DEVICE_LAST_SEQUENCE_KEY = 'picto3d_last_sequence';
// Label & confidence yang SUDAH dideteksi oleh HP saat scan. Disimpan supaya
// /editor bisa langsung pakai label ini alih-alih deteksi ulang di desktop
// (lihat catatan bug "stabilo jadi custom" di buildDetectionFromDevice()).
const DEVICE_LAST_LABEL_KEY = 'picto3d_last_label';
const DEVICE_LAST_CONFIDENCE_KEY = 'picto3d_last_confidence';
const DEVICE_LIVE_POLL_MS = 1500;
let deviceLiveSyncTimer = null;

/** @type {TransformHandleManager|null} */
let handleManager = null;
const objectReconstructor = new ObjectReconstructor();
let reconstructionRequestId = 0;

export function initEditorPage() {
    const container = document.getElementById('three-container');
    const sourceImg = document.getElementById('current-source-img');
    const editorFileInput = document.getElementById('editor-file-input');

    if (!container) return;

    const yoloDetector = new YoloDetector({
        yoloEndpoint: container.dataset.detectUrl || '/api/detections',
        confidenceThreshold: Number(container.dataset.confidence || 0.18),
    });
    let lastDetection = null;
    let gestureSystem = null;

    // UI references
    const depthSlider = document.getElementById('depth-slider');
    const depthVal = document.getElementById('depth-val');
    const segmentSlider = document.getElementById('segment-slider');
    const segmentVal = document.getElementById('segment-val');
    const geometryType = document.getElementById('geometry-type');

    const roughnessSlider = document.getElementById('roughness-slider');
    const metalnessSlider = document.getElementById('metalness-slider');

    const statVertices = document.getElementById('stat-vertices');
    const statPolygons = document.getElementById('stat-polygons');

    // Dimension & YOLO UI references
    const dimWidthInput = document.getElementById('dim-width');
    const dimHeightInput = document.getElementById('dim-height');
    const dimDepthInput = document.getElementById('dim-depth');
    const aspectLockBtn = document.getElementById('aspect-lock-btn');
    const snapSelect = document.getElementById('snap-select');
    const handlesToggleBtn = document.getElementById('handles-toggle-btn');

    const yoloLabelTag = document.getElementById('yolo-label');
    const yoloConfSpan = document.getElementById('yolo-conf');
    const yoloBboxSpan = document.getElementById('yolo-bbox');

    const resetObjectBtn = document.getElementById('reset-object-btn');
    const deviceLiveBadge = document.getElementById('device-live-badge');
    const deviceLiveText = document.getElementById('device-live-text');

    const hudW = document.getElementById('hud-w');
    const hudH = document.getElementById('hud-h');
    const hudD = document.getElementById('hud-d');
    const hudSnapBadge = document.getElementById('hud-snap-badge');
    const hudAspectBadge = document.getElementById('hud-aspect-badge');
    const hudAnchorBadge = document.getElementById('hud-anchor-badge');

    // Primitives buttons
    const addCubeBtn = document.getElementById('add-cube-btn');
    const addSphereBtn = document.getElementById('add-sphere-btn');
    const addTriangleBtn = document.getElementById('add-triangle-btn');

    // =========================================================================
    //  Utility & UI Sync
    // =========================================================================

    function createFallbackImageDataUrl() {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 512;
        const ctx = c.getContext('2d');

        ctx.fillStyle = cssColor('--color-primary');
        ctx.fillRect(0, 0, 512, 512);

        ctx.fillStyle = cssColor('--color-surface');
        ctx.beginPath();
        ctx.arc(256, 256, 130, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = cssColor('--color-primary-hover');
        ctx.font = 'bold 70px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('3D EDIT', 256, 256);

        return c.toDataURL();
    }

    /** Sync parametric UI values (Panjang X, Tinggi Y, Lebar Z) */
    function syncDimensionsUI() {
        if (dimWidthInput) dimWidthInput.value = objectDimensions.width.toFixed(2);
        if (dimHeightInput) dimHeightInput.value = objectDimensions.height.toFixed(2);
        if (dimDepthInput) dimDepthInput.value = objectDimensions.depth.toFixed(2);

        if (hudW) hudW.textContent = objectDimensions.width.toFixed(2);
        if (hudH) hudH.textContent = objectDimensions.height.toFixed(2);
        if (hudD) hudD.textContent = objectDimensions.depth.toFixed(2);

        if (depthSlider) depthSlider.value = objectDimensions.depth;
        if (depthVal) depthVal.textContent = objectDimensions.depth.toFixed(1);
    }

    function syncSnapUI() {
        if (hudSnapBadge) {
            hudSnapBadge.textContent = snapEnabled ? `Snap: ${snapStep}` : 'Snap: Off';
            hudSnapBadge.className = `hud-indicator-badge ${snapEnabled ? 'hud-snap-on' : 'hud-snap-off'}`;
        }
    }

    function syncAspectUI() {
        if (hudAspectBadge) {
            hudAspectBadge.textContent = lockAspect ? 'AR Lock' : 'AR Free';
            hudAspectBadge.className = `hud-indicator-badge ${lockAspect ? 'hud-aspect-on' : 'hud-aspect-off'}`;
        }
        if (aspectLockBtn) aspectLockBtn.classList.toggle('active', lockAspect);
    }

    function updateYoloBadgeUI(detection) {
        if (!detection) return;
        if (yoloLabelTag) yoloLabelTag.textContent = detection.label.toUpperCase();
        if (yoloConfSpan) yoloConfSpan.textContent = `${Math.round(detection.confidence * 100)}%`;
        if (yoloBboxSpan) yoloBboxSpan.textContent = `${detection.bbox.width}x${detection.bbox.height}px`;
    }

    // =========================================================================
    //  Three.js Initialization
    // =========================================================================

    function initThreeJS() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(cssColor('--color-surface-subtle'));

        camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
        camera.position.set(0, 8, 14);

        renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(renderer.domElement);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.maxPolarAngle = Math.PI / 2 + 0.1;

        const ambientLight = new THREE.AmbientLight(cssColor('--color-surface'), 0.7);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(cssColor('--color-surface'), 0.8);
        dirLight.position.set(10, 15, 10);
        dirLight.castShadow = true;
        scene.add(dirLight);

        const fillLight = new THREE.DirectionalLight(cssColor('--color-primary-border'), 0.4);
        fillLight.position.set(-10, 10, -10);
        scene.add(fillLight);

        const gridHelper = new THREE.GridHelper(20, 20, cssColor('--color-primary-medium'), cssColor('--color-border'));
        gridHelper.position.y = -0.01;
        scene.add(gridHelper);

        // TransformHandleManager for real-time parametric scaling
        handleManager = new TransformHandleManager({
            scene,
            camera,
            renderer,
            controls,
            onTransformUpdate: (info) => {
                objectDimensions.width = info.width;
                objectDimensions.height = info.height;
                objectDimensions.depth = info.depth;
                currentExtrusionDepth = info.depth;

                syncDimensionsUI();
                applyParametricScaleToMesh();
            },
            onSelectionChange: (handleId) => {
                if (hudAnchorBadge) {
                    hudAnchorBadge.textContent = handleId ? `Pivot: ${handleId}` : 'Pivot: Center';
                    hudAnchorBadge.classList.toggle('hud-anchor-on', Boolean(handleId));
                }
            },
        });

        handleManager.setLockAspect(lockAspect);
        handleManager.setSnapSettings(snapEnabled, snapStep);
        handleManager.setHandlesVisible(handlesVisible);

        window.addEventListener('resize', onWindowResize);
        animate();
    }

    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }

    function onWindowResize() {
        if (!container) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    }

    // =========================================================================
    //  YOLO CV Detection & Picture-to-3D Reconstruction
    // =========================================================================

    function csrfToken() {
        return document.querySelector('meta[name="csrf-token"]')?.content;
    }

    /**
     * Toast kecil di pojok 3D Studio, dipakai untuk konfirmasi "Model 3D
     * berhasil dibuat" -- baik dari upload manual maupun dari deteksi HP.
     * Elemen dibuat sekali lalu dipakai ulang (bukan numpuk tiap kali toast
     * baru muncul).
     */
    let editorToastEl = null;
    let editorToastHideTimer = null;
    function showEditorToast(message, { tone = 'success', durationMs = 3200 } = {}) {
        if (!editorToastEl) {
            editorToastEl = document.createElement('div');
            editorToastEl.className = 'editor-toast';
            document.body.appendChild(editorToastEl);
        }

        editorToastEl.textContent = message;
        editorToastEl.dataset.tone = tone;
        editorToastEl.classList.add('editor-toast-visible');

        window.clearTimeout(editorToastHideTimer);
        editorToastHideTimer = window.setTimeout(() => {
            editorToastEl.classList.remove('editor-toast-visible');
        }, durationMs);
    }

    /**
     * Lapor ke backend bahwa mesh untuk sequence deteksi tertentu SUDAH
     * selesai dibangun di scene. HP (device-camera-pair.js) polling status
     * ini untuk menampilkan notif "Model 3D berhasil dibuat" -- bukan cuma
     * "terkirim". Gagal kirim ack tidak fatal (mesh di desktop tetap jadi),
     * jadi errornya cukup dicatat di console saja.
     */
    async function sendDeviceAck(token, sequence) {
        if (!token || !sequence) return;
        try {
            await fetch(`/device-sessions/${token}/ack`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-CSRF-TOKEN': csrfToken(),
                },
                credentials: 'same-origin',
                body: JSON.stringify({ sequence }),
            });
        } catch (error) {
            console.error('Gagal mengirim konfirmasi generate ke sesi device.', error);
        }
    }

    function loadHTMLImageEl(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Gambar dari device tidak dapat dimuat.'));
            image.src = src;
        });
    }

    /**
     * BUG FIX: sebelumnya, gambar yang sudah dikirim HP (lengkap dengan label
     * hasil deteksi YOLO on-device, mis. "stabilo") tetap dikirim LAGI ke
     * endpoint YOLO desktop lewat yoloDetector.detect() di processPictureTo3D.
     * Karena gambar itu SUDAH di-crop ketat di sekitar objek oleh HP, model
     * YOLO di server sering gagal mengenalinya lagi (kurang konteks di
     * sekitar objek) dan balik dengan label fallback "custom" -- padahal HP
     * sudah benar mendeteksinya sebagai "stabilo". Efeknya persis seperti
     * yang dilaporkan: benar di HP, jadi "custom" di 3D Studio.
     *
     * Perbaikannya: untuk gambar yang datang dari sesi device (live sync
     * maupun pindaian pertama), PAKAI LANGSUNG label & confidence yang sudah
     * dikirim HP -- jangan deteksi ulang di desktop sama sekali.
     */
    async function buildDetectionFromDevice({ image, label, confidence }) {
        const el = await loadHTMLImageEl(image);
        const width = el.naturalWidth || el.width || 1;
        const height = el.naturalHeight || el.height || 1;

        return {
            label: String(label || 'custom'),
            confidence: Number(confidence || 0),
            bbox: {
                x: 0,
                y: 0,
                width,
                height,
                aspectRatio: Number((width / Math.max(height, 1)).toFixed(4)),
            },
            croppedDataUrl: image,
            source: 'device',
        };
    }

    async function loadImageSource() {
        const savedImage = localStorage.getItem('3d_editor_image');
        currentImageSrc = savedImage ? savedImage : createFallbackImageDataUrl();

        if (sourceImg) sourceImg.src = currentImageSrc;

        // Kalau gambar ini datang dari HP yang baru saja scan (bukan sample
        // bawaan), kirim ack begitu mesh-nya selesai supaya HP tahu objeknya
        // sudah benar-benar tergenerate, bukan cuma terkirim.
        const deviceToken = getDeviceActiveToken();
        const deviceSequence = getDeviceLastSequence();
        const deviceAck = (savedImage && deviceToken && deviceSequence > 0)
            ? { token: deviceToken, sequence: deviceSequence }
            : null;

        // Pakai label yang sudah dikirim HP kalau ada -- lihat catatan bug di
        // buildDetectionFromDevice() di atas.
        const deviceLabel = localStorage.getItem(DEVICE_LAST_LABEL_KEY);
        const presetDetection = (savedImage && deviceLabel)
            ? await buildDetectionFromDevice({
                image: savedImage,
                label: deviceLabel,
                confidence: Number(localStorage.getItem(DEVICE_LAST_CONFIDENCE_KEY) || 0),
            })
            : null;

        await processPictureTo3D(currentImageSrc, { deviceAck, presetDetection });
    }

    /** Membuang mesh/group hasil reconstruction yang "kalah" (request basi). */
    function disposeReconstructionResult(reconstruction) {
        if (!reconstruction?.mesh) return;
        reconstruction.mesh.traverse((child) => {
            if (!child.isMesh) return;
            child.geometry?.dispose();
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => material?.dispose());
        });
        reconstruction.texture?.dispose();
    }

    /**
     * Kalau label yang terdeteksi punya model siap-pakai di public/models
     * (lihat ModelCatalog.js), muat model itu langsung. Dua label yang dikenal
     * tapi belum memiliki asset (`correction tape` dan `brush pen`) dikembalikan
     * sebagai unavailable agar tidak salah memakai model lain / rekonstruksi foto.
     * Label lain di luar katalog tetap memakai fallback lama agar fitur existing
     * yang tidak berkaitan dengan daftar object scanning ini tidak berubah.
     */
    async function reconstructFromDetection(detection) {
        const catalogEntry = resolveModelEntry(detection.label);

        if (catalogEntry && !catalogEntry.available) {
            return { unavailable: true, fromCatalog: true, modelId: catalogEntry.id };
        }

        if (catalogEntry?.modelPath) {
            try {
                const targetSize = detection.bbox.aspectRatio >= 1 ? 6 : 6 * detection.bbox.aspectRatio;
                const catalogResult = await loadCatalogModel(catalogEntry.modelPath, {
                    targetSize: Math.max(4, targetSize),
                    label: detection.label,
                });
                return { ...catalogResult, texture: null, fromCatalog: true, modelId: catalogEntry.id };
            } catch (error) {
                console.error(`Model katalog "${catalogEntry.modelPath}" gagal dimuat.`, error);
                return {
                    unavailable: true,
                    loadError: true,
                    fromCatalog: true,
                    modelId: catalogEntry.id,
                    modelPath: catalogEntry.modelPath,
                };
            }
        }

        const reconstruction = await objectReconstructor.reconstructFromDetection(detection, {
            depth: currentExtrusionDepth,
            segmentDetail: currentSegmentDetail,
        });
        return { ...reconstruction, fromCatalog: false };
    }

    /**
     * Executes YOLO Object Detection and 3D Reconstruction pipeline.
     */
    async function processPictureTo3D(imgUrl, { reuseDetection = false, deviceAck = null, presetDetection = null } = {}) {
        const requestId = ++reconstructionRequestId;

        if (yoloLabelTag) yoloLabelTag.textContent = 'SCANNING...';

        try {
            const detection = presetDetection
                ? presetDetection
                : (reuseDetection && lastDetection ? lastDetection : await yoloDetector.detect(imgUrl));
            lastDetection = detection;

            const catalogEntry = resolveModelEntry(detection.label);
            const sameCatalogModelAlreadyActive = Boolean(
                catalogEntry?.modelPath
                && currentMesh?.userData?.isGltf
                && currentMesh.userData.modelPath === catalogEntry.modelPath
            );

            // Kamera dapat mem-publish label stabil yang sama lagi setelah cooldown.
            // Kalau model katalog yang sesuai sudah aktif, cukup update badge + ACK;
            // jangan load/clone model yang sama berulang-ulang.
            if (sameCatalogModelAlreadyActive) {
                updateYoloBadgeUI(detection);
                if (deviceAck) {
                    await sendDeviceAck(deviceAck.token, deviceAck.sequence);
                }
                return;
            }

            const reconstruction = await reconstructFromDetection(detection);

            if (requestId !== reconstructionRequestId) {
                // Ada request yang lebih baru sudah menang duluan (mis. user
                // ganti gambar lagi sebelum yang ini selesai) -- buang hasil
                // ini supaya TIDAK ikut ditambahkan ke scene dan menumpuk di
                // atas objek yang sedang aktif.
                disposeReconstructionResult(reconstruction);
                return;
            }

            updateYoloBadgeUI(detection);

            if (reconstruction.unavailable) {
                // Jangan biarkan model objek sebelumnya tetap tampil ketika label
                // baru tidak punya asset / file-nya gagal dimuat.
                cleanUpCurrentMesh();

                const message = reconstruction.loadError
                    ? `⚠️ Model 3D "${detection.label}" tidak dapat dimuat dari public/models.`
                    : `ℹ️ Model 3D "${detection.label}" belum tersedia.`;
                showEditorToast(message, { tone: reconstruction.loadError ? 'error' : 'success' });

                if (deviceAck) {
                    await sendDeviceAck(deviceAck.token, deviceAck.sequence);
                }
                return;
            }

            // setMainMesh selalu membuang mesh sebelumnya (lihat
            // cleanUpCurrentMesh) sebelum menambahkan yang baru, jadi hasil
            // deteksi kamera HP dan objek yang diunggah/ditambah manual
            // TIDAK PERNAH tampil bertumpuk -- selalu saling menggantikan.
            setMainMesh(reconstruction.mesh, reconstruction.dimensions, detection.bbox.aspectRatio);

            const sourceNote = reconstruction.fromCatalog ? '' : ' (rekonstruksi dari foto)';
            showEditorToast(`✅ Model 3D "${detection.label}" berhasil dibuat${sourceNote}.`);

            if (deviceAck) {
                await sendDeviceAck(deviceAck.token, deviceAck.sequence);
            }
        } catch (error) {
            console.error('Gagal membuat model 3D dari hasil YOLO.', error);
            if (yoloLabelTag) yoloLabelTag.textContent = 'ERROR';
            if (yoloConfSpan) yoloConfSpan.textContent = '--';
            showEditorToast('⚠️ Gagal membuat model 3D dari deteksi ini.', { tone: 'error' });
        }
    }

    // =========================================================================
    //  3D Primitive Add Feature (Kubus, Bola, Segitiga 3D)
    // =========================================================================

    function addPrimitiveObject(type) {
        const initialDim = { width: 4, height: 4, depth: 4 };
        const primitiveMesh = PrimitiveFactory.createPrimitive(type, initialDim);
        setMainMesh(primitiveMesh, initialDim, 1);
    }

    // =========================================================================
    //  Mesh Management & Parametric Scaling ($P \times L \times T$)
    // =========================================================================

    function setMainMesh(mesh, dimensions, aspect) {
        cleanUpCurrentMesh();

        currentMesh = mesh;
        currentTexture = mesh.userData.sourceTexture || null;
        scene.add(currentMesh);

        objectDimensions = { ...dimensions };
        imageNaturalAspect = aspect || 1;
        syncDimensionsUI();

        updateStats(currentMesh);
        applyRenderMode(activeRenderMode);

        if (handleManager) {
            handleManager.attach(currentMesh, objectDimensions, imageNaturalAspect);
        }
    }

    /**
     * Applies parametric scale (X=Panjang, Y=Tinggi, Z=Lebar/Depth) to currentMesh in real-time.
     */
    function applyParametricScaleToMesh() {
        if (!currentMesh || !currentMesh.userData.baseWidth) return;

        const baseW = currentMesh.userData.baseWidth || 6;
        const baseH = currentMesh.userData.baseHeight || 4.5;
        const baseD = currentMesh.userData.baseDepth || 2.5;

        // Scale factors relative to original base dimensions
        const scaleX = objectDimensions.width / baseW;
        const scaleY = objectDimensions.height / baseH;
        const scaleZ = objectDimensions.depth / baseD;

        currentMesh.scale.set(scaleX, scaleY, scaleZ);
    }

    /**
     * Mengembalikan objek yang sedang aktif ke ukuran, posisi, dan rotasi
     * awal saat pertama kali muncul (hasil scan/primitive/model), tanpa
     * perlu scan ulang. Berguna kalau user sudah kebanyakan drag/gesture
     * dan ingin mulai ulang dari bentuk semula.
     */
    function resetCurrentObject() {
        if (!currentMesh) return;

        const baseW = currentMesh.userData.baseWidth;
        const baseH = currentMesh.userData.baseHeight;
        const baseD = currentMesh.userData.baseDepth;
        if (baseW == null || baseH == null || baseD == null) return;

        currentMesh.position.set(0, 0, 0);
        currentMesh.quaternion.identity();
        currentMesh.scale.set(1, 1, 1);
        currentMesh.updateMatrixWorld(true);

        objectDimensions = { width: baseW, height: baseH, depth: baseD };
        currentExtrusionDepth = baseD;
        syncDimensionsUI();

        if (handleManager) {
            handleManager.attach(currentMesh, objectDimensions, imageNaturalAspect);
        }
    }

    function cleanUpCurrentMesh() {
        if (currentMesh) {
            scene.remove(currentMesh);
            currentMesh.traverse((child) => {
                if (!child.isMesh) return;
                child.geometry?.dispose();
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => material?.dispose());
            });
            currentMesh.userData.sourceTexture?.dispose();
            currentTexture?.dispose();
            currentMesh = null;
            currentTexture = null;
        }

        // Saat label baru memang tidak punya model, tidak ada setMainMesh()
        // sesudah cleanup. Lepaskan handle agar bounding box/transform control
        // objek sebelumnya juga tidak tertinggal di scene.
        handleManager?.detach();
    }

    /** Bekerja untuk mesh tunggal (procedural) maupun group multi-mesh (model katalog). */
    function updateStats(target) {
        let vertexCount = 0;
        let triangleCount = 0;

        target.traverse((child) => {
            if (!child.isMesh || !child.geometry) return;
            const geometry = child.geometry;
            vertexCount += geometry.attributes.position?.count || 0;
            triangleCount += geometry.index
                ? geometry.index.count / 3
                : (geometry.attributes.position?.count || 0) / 3;
        });

        if (statVertices) statVertices.textContent = vertexCount.toLocaleString();
        if (statPolygons) statPolygons.textContent = Math.round(triangleCount).toLocaleString();
    }

    function applyRenderMode(mode) {
        activeRenderMode = mode;
        if (!currentMesh) return;

        document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.getElementById('mode-' + mode);
        if (activeBtn) activeBtn.classList.add('active');

        const isCatalogModel = Boolean(currentMesh.userData?.isGltf);

        currentMesh.traverse((child) => {
            if (!child.isMesh) return;

            if (!child.userData.originalMaterial) {
                child.userData.originalMaterial = child.material;
            }

            if (mode === 'wireframe') {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => { mat.wireframe = true; });
                } else {
                    child.material = new THREE.MeshBasicMaterial({ color: cssColor('--color-primary'), wireframe: true });
                }
            } else if (mode === 'solid') {
                child.material = new THREE.MeshStandardMaterial({ color: cssColor('--color-primary-medium'), roughness: 0.3, metalness: 0.2, side: THREE.DoubleSide });
            } else if (mode === 'depth') {
                child.material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
            } else if (mode === 'textured') {
                if (isCatalogModel) {
                    // Model katalog sudah punya material/tekstur aslinya sendiri.
                    child.material = child.userData.originalMaterial;
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => { mat.wireframe = false; });
                    }
                } else if (currentTexture) {
                    child.material = new THREE.MeshStandardMaterial({
                        map: currentTexture,
                        roughness: roughnessSlider ? parseFloat(roughnessSlider.value) : 0.4,
                        metalness: metalnessSlider ? parseFloat(metalnessSlider.value) : 0.1,
                        side: THREE.DoubleSide,
                    });
                }
            }
        });
    }

    // =========================================================================
    //  Event Handlers
    // =========================================================================

    function setupEventListeners() {
        // --- Add Primitives toolbar buttons ---
        if (addCubeBtn) addCubeBtn.addEventListener('click', () => addPrimitiveObject('kubus'));
        if (addSphereBtn) addSphereBtn.addEventListener('click', () => addPrimitiveObject('bola'));
        if (addTriangleBtn) addTriangleBtn.addEventListener('click', () => addPrimitiveObject('segitiga'));

        // --- File Input ---
        if (editorFileInput) {
            editorFileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    const reader = new FileReader();
                    reader.onload = async (evt) => {
                        currentImageSrc = evt.target.result;
                        if (sourceImg) sourceImg.src = currentImageSrc;
                        localStorage.setItem('3d_editor_image', currentImageSrc);
                        await processPictureTo3D(currentImageSrc);
                    };
                    reader.readAsDataURL(e.target.files[0]);
                }
            });
        }

        // --- Depth slider ---
        if (depthSlider) {
            depthSlider.addEventListener('input', (e) => {
                currentExtrusionDepth = parseFloat(e.target.value);
                objectDimensions.depth = currentExtrusionDepth;
                syncDimensionsUI();
                if (handleManager) handleManager.setDimensions(objectDimensions.width, objectDimensions.height, objectDimensions.depth);
                applyParametricScaleToMesh();
            });
        }

        // --- Segment slider ---
        if (segmentSlider) {
            segmentSlider.addEventListener('input', (e) => {
                currentSegmentDetail = parseInt(e.target.value);
                if (segmentVal) segmentVal.textContent = currentSegmentDetail;
                if (currentImageSrc) processPictureTo3D(currentImageSrc, { reuseDetection: true });
            });
        }

        // --- Render mode buttons ---
        ['textured', 'wireframe', 'solid', 'depth'].forEach(mode => {
            const btn = document.getElementById('mode-' + mode);
            if (btn) btn.addEventListener('click', () => applyRenderMode(mode));
        });

        if (roughnessSlider) roughnessSlider.addEventListener('input', () => applyRenderMode(activeRenderMode));
        if (metalnessSlider) metalnessSlider.addEventListener('input', () => applyRenderMode(activeRenderMode));

        // --- View presets ---
        const isoBtn = document.getElementById('view-iso');
        if (isoBtn) isoBtn.addEventListener('click', () => { camera.position.set(8, 8, 10); controls.target.set(0, 0, 0); });

        const frontBtn = document.getElementById('view-front');
        if (frontBtn) frontBtn.addEventListener('click', () => { camera.position.set(0, 2, 12); controls.target.set(0, 0, 0); });

        const topBtn = document.getElementById('view-top');
        if (topBtn) topBtn.addEventListener('click', () => { camera.position.set(0, 14, 0.01); controls.target.set(0, 0, 0); });

        const resetBtn = document.getElementById('view-reset');
        if (resetBtn) resetBtn.addEventListener('click', () => {
            camera.position.set(0, 8, 14);
            controls.target.set(0, 0, 0);
            // Tombol "Reset" ini juga mengembalikan objek ke posisi/rotasi/skala
            // awal hasil scan -- supaya perubahan dari gesture (rotate objek,
            // tarik panjang) ikut ter-reset, bukan cuma sudut pandang kameranya.
            resetCurrentObject();
        });

        // --- Exports ---
        const pngBtn = document.getElementById('export-png-btn');
        if (pngBtn) pngBtn.addEventListener('click', () => {
            renderer.render(scene, camera);
            const dataUrl = renderer.domElement.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = 'snapshot-3d.png';
            link.href = dataUrl;
            link.click();
        });

        const objBtn = document.getElementById('export-obj-btn');
        if (objBtn) objBtn.addEventListener('click', () => {
            if (!currentMesh) return;

            if (currentMesh.userData?.isGltf) {
                // Model katalog terdiri dari banyak mesh/material sekaligus;
                // exporter OBJ single-geometry di bawah tidak menanganinya.
                window.alert('Ekspor OBJ untuk model pustaka (public/models) belum didukung. Gunakan tombol PNG untuk snapshot, atau ekspor OBJ khusus untuk objek hasil foto.');
                return;
            }

            const objData = generateOBJString(currentMesh.geometry);
            const blob = new Blob([objData], { type: 'text/plain' });
            const link = document.createElement('a');
            link.download = 'model-3d.obj';
            link.href = URL.createObjectURL(blob);
            link.click();
        });

        // --- Parametric Dimension Inputs ($P \times L \times T$) ---
        const handleDimInput = (inputEl, axis) => {
            if (!inputEl) return;
            inputEl.addEventListener('change', () => {
                let val = parseFloat(inputEl.value);
                if (isNaN(val) || val < 0.1) val = 0.2;

                if (axis === 'width') {
                    objectDimensions.width = val;
                    if (lockAspect) objectDimensions.height = val / imageNaturalAspect;
                } else if (axis === 'height') {
                    objectDimensions.height = val;
                    if (lockAspect) objectDimensions.width = val * imageNaturalAspect;
                } else if (axis === 'depth') {
                    objectDimensions.depth = val;
                    currentExtrusionDepth = val;
                }

                syncDimensionsUI();
                if (handleManager) handleManager.setDimensions(objectDimensions.width, objectDimensions.height, objectDimensions.depth);
                applyParametricScaleToMesh();
            });
        };

        handleDimInput(dimWidthInput, 'width');
        handleDimInput(dimHeightInput, 'height');
        handleDimInput(dimDepthInput, 'depth');

        // Reset Objek: balikin ke bentuk/ukuran/posisi awal hasil scan
        if (resetObjectBtn) {
            resetObjectBtn.addEventListener('click', resetCurrentObject);
        }

        // Aspect Lock Toggle
        if (aspectLockBtn) {
            aspectLockBtn.addEventListener('click', () => {
                lockAspect = !lockAspect;
                syncAspectUI();
                if (handleManager) handleManager.setLockAspect(lockAspect);
            });
        }

        // Snap Settings
        if (snapSelect) {
            snapSelect.addEventListener('change', () => {
                const val = parseFloat(snapSelect.value);
                snapEnabled = val > 0;
                snapStep = val;
                syncSnapUI();
                if (handleManager) handleManager.setSnapSettings(snapEnabled, snapStep);
            });
        }

        // Handles Toggle
        if (handlesToggleBtn) {
            handlesToggleBtn.addEventListener('click', () => {
                handlesVisible = !handlesVisible;
                handlesToggleBtn.classList.toggle('active', handlesVisible);
                if (handleManager) handleManager.setHandlesVisible(handlesVisible);
            });
        }
    }

    function generateOBJString(geometry) {
        let output = "# 2D to 3D Editor OBJ Export\n";
        const pos = geometry.attributes.position;
        const uv = geometry.attributes.uv;

        for (let i = 0; i < pos.count; i++) {
            output += `v ${pos.getX(i).toFixed(4)} ${pos.getY(i).toFixed(4)} ${pos.getZ(i).toFixed(4)}\n`;
        }

        if (uv) {
            for (let i = 0; i < uv.count; i++) {
                output += `vt ${uv.getX(i).toFixed(4)} ${uv.getY(i).toFixed(4)}\n`;
            }
        }

        if (geometry.index) {
            const idx = geometry.index;
            for (let i = 0; i < idx.count; i += 3) {
                output += `f ${idx.getX(i)+1} ${idx.getX(i+1)+1} ${idx.getX(i+2)+1}\n`;
            }
        } else {
            for (let i = 0; i < pos.count; i += 3) {
                output += `f ${i+1} ${i+2} ${i+3}\n`;
            }
        }
        return output;
    }

    // =========================================================================
    //  Live Sync dengan HP yang Terhubung (Device Pairing)
    // =========================================================================
    //  Begitu HP tersambung lewat QR (lihat device-pairing.js), token sesinya
    //  disimpan di localStorage. Selama tab /editor ini terbuka, kita polling
    //  sesi itu terus-menerus supaya SETIAP pindaian baru dari HP langsung
    //  membangun ulang model 3D di sini — bukan cuma pindaian yang pertama.

    function getDeviceActiveToken() {
        try {
            return localStorage.getItem(DEVICE_ACTIVE_TOKEN_KEY);
        } catch (error) {
            return null;
        }
    }

    function getDeviceLastSequence() {
        try {
            return Number(localStorage.getItem(DEVICE_LAST_SEQUENCE_KEY) || 0);
        } catch (error) {
            return 0;
        }
    }

    function setDeviceLastSequence(seq) {
        try {
            localStorage.setItem(DEVICE_LAST_SEQUENCE_KEY, String(seq));
        } catch (error) {
            // abaikan, tidak fatal
        }
    }

    function clearDeviceActiveToken() {
        try {
            localStorage.removeItem(DEVICE_ACTIVE_TOKEN_KEY);
        } catch (error) {
            // abaikan
        }
    }

    function setDeviceLiveText(text) {
        if (deviceLiveText) deviceLiveText.textContent = text;
    }

    function stopDeviceLiveSync() {
        if (deviceLiveSyncTimer) {
            window.clearInterval(deviceLiveSyncTimer);
            deviceLiveSyncTimer = null;
        }
    }

    async function pollDeviceSession(token) {
        try {
            const response = await fetch(`/device-sessions/${token}`, {
                headers: { Accept: 'application/json' },
                credentials: 'same-origin',
            });

            if (response.status === 404) {
                clearDeviceActiveToken();
                if (deviceLiveBadge) deviceLiveBadge.hidden = true;
                stopDeviceLiveSync();
                return;
            }

            if (!response.ok) return;

            const session = await response.json();
            const detection = session.detection;
            if (!detection || detection.sequence <= getDeviceLastSequence()) return;

            setDeviceLastSequence(detection.sequence);
            setDeviceLiveText(`📷 Objek "${detection.label}" terdeteksi — memperbarui model 3D…`);

            currentImageSrc = detection.image;
            if (sourceImg) sourceImg.src = currentImageSrc;
            try {
                localStorage.setItem('3d_editor_image', currentImageSrc);
                localStorage.setItem(DEVICE_LAST_LABEL_KEY, detection.label || '');
                localStorage.setItem(DEVICE_LAST_CONFIDENCE_KEY, String(detection.confidence || 0));
            } catch (error) {
                // abaikan, tidak fatal
            }

            // Pakai label yang sudah dideteksi HP langsung -- JANGAN deteksi
            // ulang di desktop. Lihat catatan bug di buildDetectionFromDevice().
            const presetDetection = await buildDetectionFromDevice({
                image: detection.image,
                label: detection.label,
                confidence: detection.confidence,
            });

            await processPictureTo3D(currentImageSrc, {
                deviceAck: { token, sequence: detection.sequence },
                presetDetection,
            });
            setDeviceLiveText('🔗 Terhubung — arahkan HP ke objek baru untuk update otomatis.');
        } catch (error) {
            console.error('Gagal sinkronisasi live dari HP.', error);
        }
    }

    function initDeviceLiveSync() {
        const token = getDeviceActiveToken();
        if (!token) return;

        if (deviceLiveBadge) deviceLiveBadge.hidden = false;
        setDeviceLiveText('🔗 Terhubung — arahkan HP ke objek baru untuk update otomatis.');

        stopDeviceLiveSync();
        deviceLiveSyncTimer = window.setInterval(() => pollDeviceSession(token), DEVICE_LIVE_POLL_MS);
    }

    window.loadSampleImage = function (type) {
        let sampleUrl = '';
        if (type === 'logo') {
            sampleUrl = createFallbackImageDataUrl();
        } else if (type === 'abstract') {
            const c = document.createElement('canvas');
            c.width = 512; c.height = 512;
            const ctx = c.getContext('2d');
            ctx.fillStyle = cssColor('--color-dark'); ctx.fillRect(0,0,512,512);
            for(let i=0; i<8; i++){
                ctx.fillStyle = i % 2 === 0 ? cssColor('--color-primary') : cssColor('--color-info-bright');
                ctx.beginPath();
                ctx.arc(256 + Math.cos(i)*100, 256 + Math.sin(i)*100, 40 + i*8, 0, Math.PI*2);
                ctx.fill();
            }
            sampleUrl = c.toDataURL();
        } else if (type === 'character') {
            const c = document.createElement('canvas');
            c.width = 512; c.height = 512;
            const ctx = c.getContext('2d');
            ctx.fillStyle = cssColor('--color-primary-soft'); ctx.fillRect(0,0,512,512);
            ctx.fillStyle = cssColor('--color-primary-hover'); ctx.fillRect(150, 150, 212, 212);
            ctx.fillStyle = cssColor('--color-surface'); ctx.fillRect(190, 190, 40, 40); ctx.fillRect(282, 190, 40, 40);
            ctx.fillStyle = cssColor('--color-primary-border'); ctx.fillRect(200, 280, 112, 30);
            sampleUrl = c.toDataURL();
        }

        if (sampleUrl) {
            currentImageSrc = sampleUrl;
            if (sourceImg) sourceImg.src = sampleUrl;
            localStorage.setItem('3d_editor_image', sampleUrl);
            processPictureTo3D(sampleUrl);
        }
    };

    // Boot editor
    initThreeJS();
    loadImageSource();
    setupEventListeners();
    syncSnapUI();
    syncAspectUI();
    initDeviceLiveSync();

    const gestureButton = document.getElementById('gesture-toggle-btn');
    const gestureStatus = document.getElementById('gesture-status');

    const loadGestureSystem = async () => {
        if (gestureSystem) return;

        gestureButton.disabled = true;
        if (gestureStatus) gestureStatus.textContent = 'Memuat modul gesture...';

        try {
            const { EditorGestureSystem } = await import('./gesture/EditorGestureSystem.js');
            gestureSystem = new EditorGestureSystem({
                button: gestureButton,
                statusElement: gestureStatus,
                video: document.getElementById('gesture-video'),
                canvas: document.getElementById('gesture-canvas'),
                camera,
                controls,
                handleManager,
                getObject: () => currentMesh,
                onStretch: (factor) => {
                    objectDimensions.height *= factor;
                    syncDimensionsUI();
                    handleManager?.setDimensions(
                        objectDimensions.width,
                        objectDimensions.height,
                        objectDimensions.depth,
                    );
                },
            });
            gestureSystem.bind();
            await gestureSystem.start();
        } catch (error) {
            console.error('Modul gesture gagal dimuat.', error);
            if (gestureStatus) gestureStatus.textContent = 'Gesture gagal dimuat';
            gestureSystem = null;
        } finally {
            gestureButton.disabled = false;
        }
    };

    gestureButton?.addEventListener('click', loadGestureSystem, { once: true });
    window.addEventListener(
        'beforeunload',
        () => {
            gestureSystem?.destroy();
            handleManager?.destroy();
            stopDeviceLiveSync();
        },
        { once: true },
    );
}
