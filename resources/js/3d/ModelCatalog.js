/**
 * ModelCatalog.js
 *
 * Mapping label hasil object detection -> model 3D yang benar-benar tersedia
 * di public/models. Label dinormalisasi agar spasi, underscore, dan tanda
 * hubung diperlakukan sama (mis. "paper clip", "paper_clip", "paper-clip").
 *
 * Dua kelas yang memang belum memiliki asset saat ini (`correction tape` dan
 * `brush pen`) tetap didaftarkan sebagai known-but-unavailable. Dengan begitu
 * editor tidak salah memakai model lain atau jatuh ke rekonstruksi foto.
 */

function slug(label) {
    return String(label || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

const CATALOG = [
    {
        id: 'pen',
        labels: ['pen', 'pulpen', 'ballpoint', 'ballpoint pen', 'bolpoin'],
        model: 'pen/scene.gltf',
    },
    {
        id: 'eraser',
        labels: ['eraser', 'penghapus'],
        model: 'eraser/scene.gltf',
    },
    {
        id: 'wrinkle',
        labels: ['wrinkle'],
        model: 'wrinkle/scene.gltf',
    },
    {
        id: 'correction-tape',
        labels: ['correction tape', 'correction-tape', 'correction roller', 'tipe x roll', 'tipex roll'],
        model: null,
    },
    {
        id: 'spidol',
        labels: ['spidol', 'permanent marker'],
        model: 'spidol/scene.gltf',
    },
    {
        id: 'brush-pen',
        labels: ['brush pen', 'brush-pen'],
        model: null,
    },
    {
        id: 'drawing-pen',
        labels: ['drawing pen', 'drawing-pen', 'rapido', 'fineliner'],
        model: 'drawing_pen/scene.gltf',
    },
    {
        id: 'board-marker',
        labels: ['board marker', 'board-marker', 'whiteboard marker', 'whiteboard-marker'],
        // Nama folder asset memang `board_maker` (tanpa huruf r) pada project.
        model: 'board_maker/scene.gltf',
    },
    {
        id: 'pencil',
        labels: ['pencil', 'pensil'],
        model: 'pencil/scene.gltf',
    },
    {
        id: 'stabilo',
        labels: ['stabilo', 'highlighter', 'stabilo boss'],
        model: 'stabilo/scene.gltf',
    },
    {
        id: 'ruler',
        labels: ['ruler', 'penggaris'],
        model: 'ruler/scene.gltf',
    },
    {
        id: 'protractor',
        // Model deteksi saat ini memakai typo `protactor`; keduanya didukung.
        labels: ['protactor', 'protractor', 'busur derajat'],
        model: 'protractor/scene.gltf',
    },
    {
        id: 'paper-clip',
        labels: ['paper clip', 'paper-clip', 'clip', 'klip'],
        model: 'paper_clip/scene.gltf',
    },
    {
        id: 'binder-clip',
        labels: ['binder clip', 'binder-clip', 'penjepit kertas'],
        model: 'binder_clip/scene.gltf',
    },
    {
        id: 'scissor',
        labels: ['scissor', 'scissors', 'gunting'],
        model: 'scissors/scene.gltf',
    },
    {
        id: 'term',
        labels: ['term'],
        model: 'term/scene.gltf',
    },
    {
        id: 'tape',
        labels: ['tape', 'selotip', 'lakban'],
        model: 'tape/scene.gltf',
    },
];

const LOOKUP = new Map();
for (const entry of CATALOG) {
    for (const label of entry.labels) {
        LOOKUP.set(slug(label), entry);
    }
}

/**
 * @param {string} label Label mentah dari hasil deteksi.
 * @returns {{ id: string, modelPath: string | null, available: boolean } | null}
 */
export function resolveModelEntry(label) {
    const normalized = slug(label);
    if (!normalized) return null;

    const entry = LOOKUP.get(normalized);
    if (!entry) return null;

    return {
        id: entry.id,
        modelPath: entry.model ? `/models/${entry.model}` : null,
        available: Boolean(entry.model),
    };
}
