import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const gltfCache = new Map();

function loadGltf(path) {
    if (!gltfCache.has(path)) {
        gltfCache.set(path, loader.loadAsync(path).catch((error) => {
            // Jangan cache promise yang gagal -- biar percobaan berikutnya
            // (mis. setelah user menambah file model) bisa retry.
            gltfCache.delete(path);
            throw error;
        }));
    }
    return gltfCache.get(path);
}

/**
 * Memuat model .glb/.gltf dari public/models, menormalkan ukurannya supaya
 * sisi terpanjang bounding box-nya sama dengan targetSize, lalu memusatkan
 * pivot-nya di (0, 0, 0) -- persis seperti mesh hasil ObjectReconstructor,
 * supaya semua fitur editor (handle transform, snap, parametric scaling P x
 * L x T, dsb.) tetap bekerja sama untuk kedua jenis objek.
 *
 * @param {string} modelPath Path diawali "/models/..."
 * @param {object} [options]
 * @param {number} [options.targetSize=6] Ukuran sisi terpanjang bounding box setelah normalisasi.
 * @param {string} [options.label] Label deteksi, disimpan di userData untuk referensi/debug.
 * @returns {Promise<{ mesh: THREE.Group, dimensions: {width:number,height:number,depth:number} }>}
 */
export async function loadCatalogModel(modelPath, options = {}) {
    const targetSize = Number(options.targetSize || 6);
    const gltf = await loadGltf(modelPath);
    const source = gltf.scene || gltf.scenes?.[0];
    if (!source) {
        throw new Error(`Model 3D "${modelPath}" tidak berisi scene yang valid.`);
    }

    // Clone supaya tiap objek yang dibuat di scene punya geometry/instance
    // sendiri (tidak berbagi transform/material dengan clone lain).
    const innerGroup = source.clone(true);

    innerGroup.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        // Clone material per-instance juga, supaya mode wireframe/solid/depth
        // pada satu objek tidak "membocorkan" perubahan ke model lain yang
        // memakai file .glb yang sama.
        child.material = Array.isArray(child.material)
            ? child.material.map((mat) => mat.clone())
            : child.material.clone();
        child.userData.originalMaterial = child.material;
    });

    const box = new THREE.Box3().setFromObject(innerGroup);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const largestDimension = Math.max(size.x, size.y, size.z, 0.0001);
    const scale = targetSize / largestDimension;

    // v' = position + scale * v. Bounding box di editor (TransformHandleManager)
    // selalu digambar dari y=0 (lantai) sampai y=height, BUKAN dipusatkan di
    // y=0 -- jadi X/Z dipusatkan ke origin seperti biasa, tapi Y harus
    // ditempatkan supaya titik terendah model (box.min.y) jatuh tepat di
    // y=0, bukan titik tengahnya. Kalau tidak, separuh model akan berada di
    // bawah lantai/box (di luar bounding box).
    innerGroup.scale.setScalar(scale);
    innerGroup.position.set(
        -center.x * scale,
        -box.min.y * scale,
        -center.z * scale,
    );

    // outerGroup adalah objek yang dikembalikan ke editor.js: posisinya
    // tetap identity supaya applyParametricScaleToMesh() (yang men-set
    // .scale langsung) tidak menimpa normalisasi ukuran di atas.
    const outerGroup = new THREE.Group();
    outerGroup.add(innerGroup);

    const width = size.x * scale;
    const height = size.y * scale;
    const depth = size.z * scale;

    outerGroup.name = `CatalogModel_${options.label || 'object'}_${Date.now()}`;
    outerGroup.userData = {
        isGltf: true,
        label: options.label || null,
        modelPath,
        baseWidth: Number(width.toFixed(3)) || 1,
        baseHeight: Number(height.toFixed(3)) || 1,
        baseDepth: Number(depth.toFixed(3)) || 1,
    };

    return {
        mesh: outerGroup,
        dimensions: {
            width: Number(width.toFixed(2)),
            height: Number(height.toFixed(2)),
            depth: Number(depth.toFixed(2)),
        },
    };
}
