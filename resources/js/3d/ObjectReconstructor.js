import * as THREE from 'three';
import { cssColor } from '../theme.js';

// Hanya benda yang memang benar-benar berbentuk geometris murni (bola, kotak,
// tabung polos) yang dipetakan ke primitive matematis. SEMUA benda alat tulis
// lain (yang punya lekukan/detail: pegangan, ujung runcing, engsel, dsb.)
// SENGAJA dibiarkan tidak terdaftar di sini supaya #resolveProfile() jatuh ke
// profile 'silhouette' — yaitu geometri yang diekstrusi mengikuti kontur asli
// hasil foto (Moore-Neighbor boundary tracing), bukan "ditimpakan" ke bentuk
// generik. Ini yang membuat model 3D akhirnya mengikuti lekukan foto asli.
const PROFILE_ALIASES = Object.freeze({
    box: new Set(['box', 'cube', 'cuboid', 'kubus', 'kotak', 'cardboard-box']),
    sphere: new Set(['ball', 'bola', 'sphere', 'spherical', 'sports-ball']),
    cylinder: new Set(['bottle', 'botol', 'water-bottle', 'plastic-bottle', 'can', 'kaleng', 'cup', 'gelas']),
    cone: new Set(['cone', 'kerucut', 'traffic-cone', 'pyramid', 'piramida']),
});

// Daftar label alat tulis/perlengkapan meja yang didukung. Semua label ini
// tidak dipetakan ke PROFILE_ALIASES di atas secara sengaja, sehingga selalu
// direkonstruksi lewat kontur silhouette (mengikuti lekukan asli foto):
// eraser (penghapus), wrinkle (correction pen/tipe-x cair), correction-tape
// (tipe-x kertas/roll), spidol, brush-pen, drawing-pen, board-marker, pencil,
// stabilo (highlighter), ruler (penggaris), protractor (busur derajat),
// paper (kertas), clip (klip kertas), binder-clip (paper clamp/penjepit),
// scissors (gunting), stapler/term, tape (selotip/lakban).
export const SUPPORTED_STATIONERY_LABELS = Object.freeze([
    'eraser', 'penghapus',
    'wrinkle', 'correction-pen', 'tipe-x', 'tipex',
    'correction-tape', 'correction-roller', 'tipe-x-roll',
    'spidol', 'permanent-marker',
    'brush-pen', 'kuas',
    'drawing-pen', 'rapido',
    'board-marker', 'whiteboard-marker',
    'pencil', 'pensil',
    'stabilo', 'highlighter',
    'ruler', 'penggaris',
    'protractor', 'busur-derajat', 'busur',
    'paper', 'kertas',
    'clip', 'paper-clip', 'klip',
    'binder-clip', 'penjepit-kertas',
    'scissor', 'scissors', 'gunting',
    'stapler', 'term', 'staples',
    'tape', 'selotip', 'lakban',
]);

export class ObjectReconstructor {
    constructor() {
        this.textureLoader = new THREE.TextureLoader();
    }
    /**
     * Reconstructs a class-aware 3D mesh from the exact ROI focused by YOLO.
     * Extracts exact concave contour shapes and extrudes 3D geometry following the image focus.
     */
    async reconstructFromDetection(detectionResult, options = {}) {
        const label = detectionResult.label || 'custom';
        const aspect = Math.max(0.05, detectionResult.bbox?.aspectRatio || 1);
        const depth = Math.max(0.1, Number(options.depth || 2.5));
        const segmentDetail = Math.max(32, Number(options.segmentDetail || 128));
        const profile = this.#resolveProfile(label);

        let width = 6;
        let height = 6 / aspect;

        if (aspect < 1) {
            height = 6;
            width = 6 * aspect;
        }

        const texture = await this.textureLoader.loadAsync(detectionResult.croppedDataUrl);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;

        const materials = this.#createMaterials(texture);
        let geometry;
        let meshMaterial;

        if (profile === 'silhouette' || profile === 'relief') {
            geometry = await this.#buildSilhouetteGeometry(
                detectionResult.croppedDataUrl,
                width,
                height,
                depth,
                segmentDetail,
            );
            meshMaterial = [materials.cap, materials.side];
        } else {
            geometry = this.#buildPrimitiveGeometry(profile, width, height, depth, segmentDetail);
            meshMaterial = materials.cap;
        }

        geometry.computeBoundingBox();
        geometry.computeVertexNormals();

        const mesh = new THREE.Mesh(geometry, meshMaterial);
        mesh.name = `YoloObject3D_${this.#normalizeLabel(label)}_${Date.now()}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(0, 0, 0);
        mesh.userData = {
            label,
            geometryProfile: profile,
            baseWidth: width,
            baseHeight: height,
            baseDepth: depth,
            detection: detectionResult,
            sourceTexture: texture,
        };

        return {
            mesh,
            texture,
            profile,
            dimensions: {
                width: Number(width.toFixed(2)),
                height: Number(height.toFixed(2)),
                depth: Number(depth.toFixed(2)),
            },
        };
    }

    #resolveProfile(label) {
        const normalized = this.#normalizeLabel(label);

        for (const [profile, aliases] of Object.entries(PROFILE_ALIASES)) {
            if (aliases.has(normalized)) {
                return profile;
            }
        }

        return 'silhouette';
    }

    #normalizeLabel(label) {
        return String(label)
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-');
    }

    #createMaterials(texture) {
        return {
            cap: new THREE.MeshStandardMaterial({
                map: texture,
                roughness: 0.35,
                metalness: 0.1,
                side: THREE.DoubleSide,
            }),
            side: new THREE.MeshStandardMaterial({
                color: cssColor('--color-primary'),
                roughness: 0.42,
                metalness: 0.18,
                side: THREE.DoubleSide,
            }),
        };
    }

    #buildPrimitiveGeometry(profile, width, height, depth, segmentDetail) {
        const radialSegments = Math.max(16, Math.min(64, Math.round(segmentDetail / 3)));
        let geometry;

        if (profile === 'box') {
            geometry = new THREE.BoxGeometry(width, height, depth);
            geometry.translate(0, height / 2, 0);
            return geometry;
        }

        if (profile === 'sphere') {
            geometry = new THREE.SphereGeometry(0.5, radialSegments, Math.max(12, radialSegments / 2));
            geometry.scale(width, height, depth);
            geometry.translate(0, height / 2, 0);
            return geometry;
        }

        if (profile === 'cylinder') {
            geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, radialSegments, 1, false);
            geometry.scale(width, height, depth);
            geometry.translate(0, height / 2, 0);
            return geometry;
        }

        geometry = new THREE.ConeGeometry(0.5, 1, 4, 1, false);
        geometry.scale(width, height, depth);
        geometry.translate(0, height / 2, 0);
        return geometry;
    }

    async #buildSilhouetteGeometry(sourceUrl, width, height, depth, segmentDetail) {
        const image = await this.#loadImage(sourceUrl);
        const mask = this.#createLargestForegroundMask(image, segmentDetail);
        const points = this.#extractHull(mask, width, height);
        const shape = new THREE.Shape(points);
        const uvGenerator = this.#createUvGenerator(width, height, depth);

        const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: depth,
            bevelEnabled: true,
            bevelSegments: 3,
            bevelSize: Math.min(0.1, depth * 0.04),
            bevelThickness: Math.min(0.1, depth * 0.04),
            curveSegments: 16,
            steps: 1,
            UVGenerator: uvGenerator,
        });

        // ExtrudeGeometry secara default mengekstrusi dari Z=0 sampai Z=depth
        // (menjorok ke satu sisi saja), padahal bounding box di editor selalu
        // digambar terpusat di Z=-depth/2..depth/2. Makanya perlu digeser
        // -depth/2 juga di sini, bukan cuma dinaikkan di Y, supaya objek
        // benar-benar pas di tengah box (bukan nongol keluar di sisi Z).
        geometry.translate(0, height / 2, -depth / 2);
        return geometry;
    }

    #createLargestForegroundMask(image, segmentDetail) {
        // Resolusi mask dinaikkan (maks. 384px, sebelumnya 256px) supaya lekukan
        // tipis/detail seperti gagang gunting, celah busur derajat, atau ujung
        // runcing pensil tidak hilang saat proses tracing kontur.
        const longSide = Math.max(64, Math.min(384, Math.round(segmentDetail * 2)));
        const aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
        const width = aspect >= 1 ? longSide : Math.max(48, Math.round(longSide * aspect));
        const height = aspect >= 1 ? Math.max(48, Math.round(longSide / aspect)) : longSide;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, width, height);

        const pixels = context.getImageData(0, 0, width, height).data;
        const borderSamples = [];
        const sampleCount = 10;

        for (let index = 0; index < sampleCount; index += 1) {
            const x = Math.round(index * (width - 1) / (sampleCount - 1));
            const y = Math.round(index * (height - 1) / (sampleCount - 1));
            borderSamples.push((x * 4), (((height - 1) * width + x) * 4));
            borderSamples.push((y * width) * 4, (y * width + width - 1) * 4);
        }

        const background = borderSamples.reduce(
            (sum, pixelIndex) => ({
                r: sum.r + pixels[pixelIndex] / borderSamples.length,
                g: sum.g + pixels[pixelIndex + 1] / borderSamples.length,
                b: sum.b + pixels[pixelIndex + 2] / borderSamples.length,
            }),
            { r: 0, g: 0, b: 0 },
        );

        const binary = new Uint8Array(width * height);

        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const index = y * width + x;
                const pixelIndex = index * 4;
                const distance = Math.hypot(
                    pixels[pixelIndex] - background.r,
                    pixels[pixelIndex + 1] - background.g,
                    pixels[pixelIndex + 2] - background.b,
                );
                binary[index] = pixels[pixelIndex + 3] > 40 && distance > 25 ? 1 : 0;
            }
        }

        const largest = this.#largestConnectedComponent(binary, width, height);
        const foregroundRatio = largest.reduce((sum, value) => sum + value, 0) / largest.length;

        if (foregroundRatio < 0.01 || foregroundRatio > 0.96) {
            largest.fill(1);
        }

        return { data: largest, width, height };
    }

    #largestConnectedComponent(binary, width, height) {
        const visited = new Uint8Array(binary.length);
        let largestIndices = [];
        const queue = new Int32Array(binary.length);

        for (let start = 0; start < binary.length; start += 1) {
            if (!binary[start] || visited[start]) {
                continue;
            }

            let head = 0;
            let tail = 0;
            const component = [];
            queue[tail++] = start;
            visited[start] = 1;

            while (head < tail) {
                const index = queue[head++];
                component.push(index);
                const x = index % width;
                const y = Math.floor(index / width);
                const neighbors = [
                    x > 0 ? index - 1 : -1,
                    x < width - 1 ? index + 1 : -1,
                    y > 0 ? index - width : -1,
                    y < height - 1 ? index + width : -1,
                ];

                for (const neighbor of neighbors) {
                    if (neighbor >= 0 && binary[neighbor] && !visited[neighbor]) {
                        visited[neighbor] = 1;
                        queue[tail++] = neighbor;
                    }
                }
            }

            if (component.length > largestIndices.length) {
                largestIndices = component;
            }
        }

        const result = new Uint8Array(binary.length);
        largestIndices.forEach(index => { result[index] = 1; });
        return result;
    }

    #extractHull(mask, objectWidth, objectHeight) {
        const grid = mask.data;
        const w = mask.width;
        const h = mask.height;

        let startX = -1, startY = -1;
        outer: for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (grid[y * w + x]) {
                    startX = x;
                    startY = y;
                    break outer;
                }
            }
        }

        if (startX === -1) {
            return [
                new THREE.Vector2(-objectWidth / 2, -objectHeight / 2),
                new THREE.Vector2(objectWidth / 2, -objectHeight / 2),
                new THREE.Vector2(objectWidth / 2, objectHeight / 2),
                new THREE.Vector2(-objectWidth / 2, objectHeight / 2),
            ];
        }

        // Moore-Neighbor Boundary Tracing algorithm for exact concave silhouettes
        const contour = [];
        let currX = startX;
        let currY = startY;
        const dx = [1, 1, 0, -1, -1, -1, 0, 1];
        const dy = [0, 1, 1, 1, 0, -1, -1, -1];
        let dir = 0;

        const maxSteps = w * h * 2;
        let stepCount = 0;

        do {
            contour.push({ x: currX, y: currY });
            
            const searchStartDir = (dir + 5) % 8;
            let foundNext = false;

            for (let i = 0; i < 8; i++) {
                const checkDir = (searchStartDir + i) % 8;
                const nx = currX + dx[checkDir];
                const ny = currY + dy[checkDir];

                if (nx >= 0 && nx < w && ny >= 0 && ny < h && grid[ny * w + nx]) {
                    currX = nx;
                    currY = ny;
                    dir = checkDir;
                    foundNext = true;
                    break;
                }
            }

            if (!foundNext) break;
            stepCount++;
        } while ((currX !== startX || currY !== startY) && stepCount < maxSteps);

        // Simplify polygon using Ramer-Douglas-Peucker algorithm to preserve exact shape contour.
        // Epsilon diperkecil (0.6, sebelumnya 1.0) supaya lekukan halus tetap terjaga,
        // dan batas titik dinaikkan (200, sebelumnya 120) supaya kontur benda dengan
        // banyak detail (gunting, busur derajat, klip) tidak jadi terlalu bersudut.
        let simplified = this.#simplifyPolygon(contour, 0.6);

        if (simplified.length < 3) {
            simplified = contour;
        }

        if (simplified.length > 200) {
            const step = simplified.length / 200;
            simplified = Array.from({ length: 200 }, (_, i) => simplified[Math.floor(i * step)]);
        }

        // PENTING: normalisasi titik kontur memakai bounding box milik siluet
        // itu sendiri (minX..maxX, minY..maxY), BUKAN ukuran kanvas crop (w, h).
        // Hasil deteksi YOLO jarang pas menempel di keempat sisi crop-nya,
        // jadi kalau dipetakan ke ukuran kanvas penuh, siluet berakhir lebih
        // kecil dari width/height nominal dan posisinya nggak center --
        // persis kelihatan sebagai "objek nggak penuh ada di dalam box".
        // Dengan dinormalisasi ke bounding box siluet sendiri, hasilnya selalu
        // menyentuh tepi -width/2..width/2 dan -height/2..height/2, jadi pas
        // mengisi penuh bounding box wireframe di editor.
        const xsPx = simplified.map(pt => pt.x);
        const ysPx = simplified.map(pt => pt.y);
        const minXPx = Math.min(...xsPx);
        const maxXPx = Math.max(...xsPx);
        const minYPx = Math.min(...ysPx);
        const maxYPx = Math.max(...ysPx);
        const spanXPx = Math.max(1e-6, maxXPx - minXPx);
        const spanYPx = Math.max(1e-6, maxYPx - minYPx);

        return simplified.map(pt => new THREE.Vector2(
            ((pt.x - minXPx) / spanXPx - 0.5) * objectWidth,
            (0.5 - (pt.y - minYPx) / spanYPx) * objectHeight,
        ));
    }

    #simplifyPolygon(points, epsilon) {
        if (points.length <= 2) return points;

        let maxDistance = 0;
        let index = 0;
        const end = points.length - 1;

        for (let i = 1; i < end; i++) {
            const d = this.#perpendicularDistance(points[i], points[0], points[end]);
            if (d > maxDistance) {
                maxDistance = d;
                index = i;
            }
        }

        if (maxDistance > epsilon) {
            const left = this.#simplifyPolygon(points.slice(0, index + 1), epsilon);
            const right = this.#simplifyPolygon(points.slice(index), epsilon);
            return left.slice(0, -1).concat(right);
        } else {
            return [points[0], points[end]];
        }
    }

    #perpendicularDistance(pt, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const mag = Math.hypot(dx, dy);
        if (mag === 0) return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y);
        return Math.abs(dy * pt.x - dx * pt.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / mag;
    }

    #createUvGenerator(width, height, depth) {
        // Corrected UV Generator:
        // Adding + height/2 and + width/2 normalizes V & U from 0.0 to 1.0, preventing texture from shifting upwards!
        const topUv = (vertices, index) => new THREE.Vector2(
            this.#clamp((vertices[index * 3] + width / 2) / width, 0, 1),
            this.#clamp((vertices[index * 3 + 1] + height / 2) / height, 0, 1),
        );

        return {
            generateTopUV: (geometry, vertices, indexA, indexB, indexC) => [
                topUv(vertices, indexA),
                topUv(vertices, indexB),
                topUv(vertices, indexC),
            ],
            generateSideWallUV: (geometry, vertices, indexA, indexB, indexC, indexD) => {
                const ax = vertices[indexA * 3];
                const ay = vertices[indexA * 3 + 1];
                const bx = vertices[indexB * 3];
                const by = vertices[indexB * 3 + 1];
                const useX = Math.abs(ax - bx) >= Math.abs(ay - by);
                const coordinate = (index) => useX
                    ? (vertices[index * 3] + width / 2) / width
                    : (vertices[index * 3 + 1] + height / 2) / height;
                const z = (index) => (vertices[index * 3 + 2] + depth / 2) / depth;

                return [indexA, indexB, indexC, indexD].map(index => new THREE.Vector2(
                    this.#clamp(coordinate(index), 0, 1),
                    this.#clamp(z(index), 0, 1),
                ));
            },
        };
    }

    #loadImage(source) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('ROI YOLO tidak dapat dimuat untuk rekonstruksi.'));
            image.src = source;
        });
    }

    #clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
}
