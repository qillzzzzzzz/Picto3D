
function cssColor(variableName) {
    return window.getComputedStyle(document.documentElement)
        .getPropertyValue(variableName)
        .trim();
}
// 3D Design Studio Three.js JS Logic

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

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('three-container');
    const sourceImg = document.getElementById('current-source-img');
    const editorFileInput = document.getElementById('editor-file-input');

    if (!container) return;

    const depthSlider = document.getElementById('depth-slider');
    const depthVal = document.getElementById('depth-val');
    const segmentSlider = document.getElementById('segment-slider');
    const segmentVal = document.getElementById('segment-val');
    const geometryType = document.getElementById('geometry-type');

    const roughnessSlider = document.getElementById('roughness-slider');
    const metalnessSlider = document.getElementById('metalness-slider');

    const statVertices = document.getElementById('stat-vertices');
    const statPolygons = document.getElementById('stat-polygons');

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

        controls = new THREE.OrbitControls(camera, renderer.domElement);
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

    function loadImageSource() {
        const savedImage = localStorage.getItem('3d_editor_image');
        if (savedImage) {
            currentImageSrc = savedImage;
        } else {
            currentImageSrc = createFallbackImageDataUrl();
        }

        if (sourceImg) sourceImg.src = currentImageSrc;
        build3DMeshFromImage(currentImageSrc);
    }

    function build3DMeshFromImage(imgUrl) {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = imgUrl;

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = currentSegmentDetail;
            canvas.height = currentSegmentDetail;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, currentSegmentDetail, currentSegmentDetail);

            const imgData = ctx.getImageData(0, 0, currentSegmentDetail, currentSegmentDetail).data;

            textureLoader.load(imgUrl, (texture) => {
                currentTexture = texture;
                currentTexture.minFilter = THREE.LinearFilter;

                if (currentMesh) {
                    scene.remove(currentMesh);
                    currentMesh.geometry.dispose();
                    if (Array.isArray(currentMesh.material)) {
                        currentMesh.material.forEach(m => m.dispose());
                    } else {
                        currentMesh.material.dispose();
                    }
                }

                let geometry;
                const aspect = img.width / img.height || 1;
                const width = 6;
                const height = width / aspect;

                if (currentGeometryShape === 'relief') {
                    geometry = new THREE.PlaneGeometry(width, height, currentSegmentDetail - 1, currentSegmentDetail - 1);
                    geometry.rotateX(-Math.PI / 2);

                    const posAttr = geometry.attributes.position;
                    for (let i = 0; i < posAttr.count; i++) {
                        const px = i % currentSegmentDetail;
                        const py = Math.floor(i / currentSegmentDetail);
                        const idx = (py * currentSegmentDetail + px) * 4;

                        const r = imgData[idx];
                        const g = imgData[idx + 1];
                        const b = imgData[idx + 2];
                        const brightness = (r + g + b) / (3 * 255);

                        posAttr.setY(i, brightness * currentExtrusionDepth);
                    }
                    geometry.computeVertexNormals();

                } else if (currentGeometryShape === 'curved') {
                    geometry = new THREE.CylinderGeometry(width / 2, width / 2, height, currentSegmentDetail, currentSegmentDetail, true, 0, Math.PI);
                    
                    const posAttr = geometry.attributes.position;
                    for (let i = 0; i < posAttr.count; i++) {
                        const px = i % currentSegmentDetail;
                        const py = Math.floor(i / currentSegmentDetail);
                        const idx = (py * currentSegmentDetail + px) * 4;

                        const brightness = (imgData[idx] + imgData[idx + 1] + idx[2]) / (3 * 255);
                        const push = brightness * (currentExtrusionDepth * 0.5);

                        posAttr.setX(i, posAttr.getX(i) * (1 + push * 0.2));
                        posAttr.setZ(i, posAttr.getZ(i) * (1 + push * 0.2));
                    }
                    geometry.computeVertexNormals();

                } else if (currentGeometryShape === 'box') {
                    geometry = new THREE.BoxGeometry(width, currentExtrusionDepth || 1, height, currentSegmentDetail / 2, 1, currentSegmentDetail / 2);
                }

                meshMaterial = new THREE.MeshStandardMaterial({
                    map: currentTexture,
                    roughness: roughnessSlider ? parseFloat(roughnessSlider.value) : 0.4,
                    metalness: metalnessSlider ? parseFloat(metalnessSlider.value) : 0.1,
                    side: THREE.DoubleSide
                });

                currentMesh = new THREE.Mesh(geometry, meshMaterial);
                currentMesh.castShadow = true;
                currentMesh.receiveShadow = true;
                currentMesh.position.y = currentExtrusionDepth / 2;

                scene.add(currentMesh);

                if (statVertices) statVertices.textContent = geometry.attributes.position.count.toLocaleString();
                if (statPolygons) statPolygons.textContent = (geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3).toLocaleString();

                applyRenderMode(activeRenderMode);
            });
        };
    }

    function applyRenderMode(mode) {
        activeRenderMode = mode;
        if (!currentMesh) return;

        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        const activeBtn = document.getElementById('mode-' + mode);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }

        if (mode === 'textured') {
            currentMesh.material = new THREE.MeshStandardMaterial({
                map: currentTexture,
                roughness: roughnessSlider ? parseFloat(roughnessSlider.value) : 0.4,
                metalness: metalnessSlider ? parseFloat(metalnessSlider.value) : 0.1,
                side: THREE.DoubleSide
            });
        } else if (mode === 'wireframe') {
            currentMesh.material = new THREE.MeshBasicMaterial({
                color: cssColor('--color-primary'),
                wireframe: true
            });
        } else if (mode === 'solid') {
            currentMesh.material = new THREE.MeshStandardMaterial({
                color: cssColor('--color-primary-medium'),
                roughness: 0.3,
                metalness: 0.2,
                side: THREE.DoubleSide
            });
        } else if (mode === 'depth') {
            currentMesh.material = new THREE.MeshNormalMaterial({
                side: THREE.DoubleSide
            });
        }
    }

    function setupEventListeners() {
        if (editorFileInput) {
            editorFileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    const reader = new FileReader();
                    reader.onload = (evt) => {
                        currentImageSrc = evt.target.result;
                        if (sourceImg) sourceImg.src = currentImageSrc;
                        localStorage.setItem('3d_editor_image', currentImageSrc);
                        build3DMeshFromImage(currentImageSrc);
                    };
                    reader.readAsDataURL(e.target.files[0]);
                }
            });
        }

        if (depthSlider) {
            depthSlider.addEventListener('input', (e) => {
                currentExtrusionDepth = parseFloat(e.target.value);
                if (depthVal) depthVal.textContent = currentExtrusionDepth;
                build3DMeshFromImage(currentImageSrc);
            });
        }

        if (segmentSlider) {
            segmentSlider.addEventListener('input', (e) => {
                currentSegmentDetail = parseInt(e.target.value);
                if (segmentVal) segmentVal.textContent = currentSegmentDetail;
                build3DMeshFromImage(currentImageSrc);
            });
        }

        if (geometryType) {
            geometryType.addEventListener('change', (e) => {
                currentGeometryShape = e.target.value;
                build3DMeshFromImage(currentImageSrc);
            });
        }

        ['textured', 'wireframe', 'solid', 'depth'].forEach(mode => {
            const btn = document.getElementById('mode-' + mode);
            if (btn) btn.addEventListener('click', () => applyRenderMode(mode));
        });

        if (roughnessSlider) roughnessSlider.addEventListener('input', () => applyRenderMode(activeRenderMode));
        if (metalnessSlider) metalnessSlider.addEventListener('input', () => applyRenderMode(activeRenderMode));

        const isoBtn = document.getElementById('view-iso');
        if (isoBtn) isoBtn.addEventListener('click', () => { camera.position.set(8, 8, 10); controls.target.set(0, 1, 0); });

        const frontBtn = document.getElementById('view-front');
        if (frontBtn) frontBtn.addEventListener('click', () => { camera.position.set(0, 2, 12); controls.target.set(0, 1, 0); });

        const topBtn = document.getElementById('view-top');
        if (topBtn) topBtn.addEventListener('click', () => { camera.position.set(0, 14, 0.01); controls.target.set(0, 1, 0); });

        const resetBtn = document.getElementById('view-reset');
        if (resetBtn) resetBtn.addEventListener('click', () => { camera.position.set(0, 8, 14); controls.target.set(0, 0, 0); });

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
            const objData = generateOBJString(currentMesh.geometry);
            const blob = new Blob([objData], { type: 'text/plain' });
            const link = document.createElement('a');
            link.download = 'model-3d.obj';
            link.href = URL.createObjectURL(blob);
            link.click();
        });
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
            build3DMeshFromImage(sampleUrl);
        }
    };

    initThreeJS();
    loadImageSource();
    setupEventListeners();
});
