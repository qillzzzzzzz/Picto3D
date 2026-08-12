@extends('layouts.app')

@section('title', '3D Design Studio - 2D to 3D & YOLO Studio')

@section('bodyClass', 'page-studio')

@section('content')
<div class="container-wide">

    <!-- Workspace Header -->
    <div class="editor-header">
        <div>
            <h1 class="editor-title">3D Design Studio</h1>
        </div>

        <!-- Toolbar: Add Primitives & Camera Presets -->
        <div class="view-presets-bar">
            <!-- Add 3D Object Primitives -->
            <div class="primitives-button-group">
                <span class="toolbar-label">Add Mesh:</span>
                <button id="add-cube-btn" class="btn btn-outline btn-sm btn-primitive" title="Tambah Kubus (Cube)">+ Kubus</button>
                <button id="add-sphere-btn" class="btn btn-outline btn-sm btn-primitive" title="Tambah Bola (Sphere)">+ Bola</button>
                <button id="add-triangle-btn" class="btn btn-outline btn-sm btn-primitive" title="Tambah Segitiga 3D (Prisma/Tetrahedron)">+ Segitiga 3D</button>
            </div>

            <div class="v-divider"></div>

            <button id="view-reset" class="btn btn-secondary btn-sm">Reset</button>
        </div>
    </div>

    <!-- Workspace Grid Layout -->
    <div class="editor-layout">
        
        <!-- Left Sidebar: Controls -->
        <div class="editor-sidebar">
            
            <div class="sidebar-section">
                <!-- Source Image & YOLO Detection Status -->
                <div>
                    <div class="sidebar-header-row sidebar-header-spaced">
                        <span class="sidebar-title">Preview Gambar</span>
                        <button id="change-img-btn" onclick="document.getElementById('editor-file-input').click()" class="btn btn-link btn-sm btn-compact">
                            Ganti
                        </button>
                        <input type="file" id="editor-file-input" class="visually-hidden-input" accept="image/*">
                    </div>
                    
                    <div class="source-img-box">
                        <img id="current-source-img" src="" alt="Source 2D" class="source-img">
                    </div>

                    <!-- YOLO Object Detection Result Badge -->
                    <div id="yolo-detection-badge" class="yolo-badge">
                        <div class="yolo-badge-header">
                            <span class="yolo-badge-title">Objek Terdeteksi:</span>
                            <span id="yolo-label" class="yolo-label-tag">Scanning...</span>
                        </div>
                        <div id="yolo-details" class="yolo-details-text">
                            Conf: <strong id="yolo-conf">--</strong> | ROI: <span id="yolo-bbox">--</span>
                        </div>
                    </div>

                    <!-- Live sync status dari HP yang terhubung (device pairing) -->
                    <div id="device-live-badge" class="yolo-badge device-live-badge" hidden>
                        <div class="yolo-badge-header">
                            <span class="yolo-badge-title">🔗 Live dari HP</span>
                        </div>
                        <div id="device-live-text" class="yolo-details-text">Menunggu pindaian…</div>
                    </div>
                </div>

                <hr class="divider">

                <!-- Parametric Object Dimensions (P x L x T / X, Y, Z) -->
                <div class="sidebar-section">
                    <div class="sidebar-header-row">
                        <span class="sidebar-title">Kustomisasi Dimensi (P x L x T)</span>
                        <div class="dimension-header-actions">
                            <button id="aspect-lock-btn" class="aspect-lock-btn active" title="Kunci rasio aspek">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                                <span class="aspect-lock-label">Rasio</span>
                            </button>
                        </div>
                    </div>

                    <div class="dimension-inputs-row">
                        <div class="dimension-input-group">
                            <label class="dimension-label" for="dim-width">Panjang (X)</label>
                            <input type="number" id="dim-width" class="dimension-input" value="6.00" step="0.1" min="0.2">
                        </div>
                        <div class="dimension-input-group">
                            <label class="dimension-label" for="dim-height">Tinggi (Y)</label>
                            <input type="number" id="dim-height" class="dimension-input" value="4.50" step="0.1" min="0.2">
                        </div>
                        <div class="dimension-input-group">
                            <label class="dimension-label" for="dim-depth">Lebar/Depth (Z)</label>
                            <input type="number" id="dim-depth" class="dimension-input" value="2.50" step="0.1" min="0.1">
                        </div>
                    </div>
                </div>

                <hr class="divider">

                <!-- 3D Extrusion & Mesh Settings -->
                <div class="sidebar-section">
                    <span class="sidebar-title">Kedalaman & Form 3D</span>

                    <!-- Depth Slider -->
                    <div class="slider-group">
                        <div class="slider-header">
                            <span>Kedalaman (Depth)</span>
                            <span id="depth-val" class="slider-value">2.5</span>
                        </div>
                        <input type="range" id="depth-slider" min="0.1" max="8" step="0.1" value="2.5" class="form-slider">
                    </div>

                    <!-- Mesh Resolution -->
                    <div class="slider-group">
                        <div class="slider-header">
                            <span>Resolusi Mesh</span>
                            <span id="segment-val" class="slider-value">128</span>
                        </div>
                        <input type="range" id="segment-slider" min="32" max="256" step="32" value="128" class="form-slider">
                    </div>
                </div>

                <hr class="divider">

                <!-- Transform Tools -->
                <div class="sidebar-section">
                    <span class="sidebar-title">Transform & Handles</span>

                    <div class="transform-tools-row">
                        <div class="tool-option">
                            <label class="tool-label" for="snap-select">Grid Snap</label>
                            <select id="snap-select" class="form-select form-select-sm">
                                <option value="0">Off</option>
                                <option value="0.1">0.1</option>
                                <option value="0.25" selected>0.25</option>
                                <option value="0.5">0.5</option>
                                <option value="1">1.0</option>
                            </select>
                        </div>
                        <div class="tool-option">
                            <label class="tool-label">3D Handles</label>
                            <button id="handles-toggle-btn" class="toggle-switch active" title="Tampilkan/Sembunyikan handle 3D">
                                <span class="toggle-knob"></span>
                            </button>
                        </div>
                    </div>
                </div>

                <hr class="divider">

                <!-- Material & Shading -->
                <div class="sidebar-section">
                    <span class="sidebar-title">Render & Material</span>

                    <div class="mode-grid">
                        <button id="mode-textured" class="mode-btn active">Textured</button>
                        <button id="mode-wireframe" class="mode-btn">Wireframe</button>
                        <button id="mode-solid" class="mode-btn">Solid</button>
                        <button id="mode-depth" class="mode-btn">Height Map</button>
                    </div>

                    <div class="material-sliders-grid">
                        <div class="slider-group">
                            <span class="slider-caption">Roughness</span>
                            <input type="range" id="roughness-slider" min="0" max="1" step="0.05" value="0.4" class="form-slider">
                        </div>
                        <div class="slider-group">
                            <span class="slider-caption">Metalness</span>
                            <input type="range" id="metalness-slider" min="0" max="1" step="0.05" value="0.1" class="form-slider">
                        </div>
                    </div>
                </div>

            </div>

            <!-- Quick Sample Picker -->
            <div class="sample-picker">
                <span class="sample-picker-label">Sampel Gambar:</span>
                <div class="sample-buttons-grid">
                    <button onclick="loadSampleImage('logo')" class="sample-btn">Logo</button>
                    <button onclick="loadSampleImage('abstract')" class="sample-btn">Abstrak</button>
                    <button onclick="loadSampleImage('character')" class="sample-btn">Karakter</button>
                </div>
            </div>

        </div>

        <!-- Center Viewport Canvas -->
        <div class="editor-viewport-box">
            
            <!-- Three.js Canvas Container -->
            <div
                id="three-container"
                class="viewport-canvas-container"
                data-detect-url="{{ route('detections.store') }}"
                data-confidence="0.18"
            >
                <!-- Viewport HUD Overlay -->
                <div id="viewport-hud" class="viewport-hud">
                    <div class="hud-dimensions">
                        <span class="hud-dim-badge hud-badge-x" title="Panjang (X)">P <strong id="hud-w">6.00</strong></span>
                        <span class="hud-dim-badge hud-badge-y" title="Tinggi (Y)">T <strong id="hud-h">4.50</strong></span>
                        <span class="hud-dim-badge hud-badge-z" title="Lebar/Depth (Z)">L <strong id="hud-d">2.50</strong></span>
                    </div>
                    <div class="hud-indicators">
                        <span id="hud-snap-badge" class="hud-indicator-badge hud-snap-on">Snap: 0.25</span>
                        <span id="hud-aspect-badge" class="hud-indicator-badge hud-aspect-on">AR Lock</span>
                        <span id="hud-anchor-badge" class="hud-indicator-badge">Pivot: Center</span>
                    </div>
                </div>

                <!-- Floating Viewport Toolbar: Move / Rotate / Focus / Reset -->
                <div class="viewport-toolbar" role="toolbar" aria-label="Kontrol viewport">
                    <button type="button" class="viewport-tool-btn" title="Geser (klik kanan + drag pada viewport)">
                        <i data-lucide="move"></i>
                    </button>
                    <button type="button" class="viewport-tool-btn" title="Putar (klik kiri + drag pada viewport)">
                        <i data-lucide="rotate-cw"></i>
                    </button>
                    <div class="viewport-tool-divider"></div>
                    <button id="view-iso" type="button" class="viewport-tool-btn" title="Fokus ke objek (tampilan isometrik)">
                        <i data-lucide="crosshair"></i>
                    </button>
                    <button type="button" class="viewport-tool-btn viewport-tool-reset" title="Reset tampilan & objek" onclick="document.getElementById('view-reset').click()">
                        <i data-lucide="rotate-ccw"></i>
                    </button>
                </div>
            </div>

            <!-- MediaPipe Gesture Controls -->
            <aside class="gesture-panel" aria-label="Kontrol gesture MediaPipe">
                <div class="gesture-panel-header">
                    <div>
                        <span class="gesture-panel-title">Gesture Control</span>
                        <p id="gesture-status" class="gesture-status" aria-live="polite">Gesture nonaktif</p>
                    </div>
                    <button id="gesture-toggle-btn" type="button" class="btn btn-outline btn-sm">
                        Aktifkan Gesture
                    </button>
                </div>

                <div class="gesture-preview">
                    <video id="gesture-video" autoplay muted playsinline></video>
                    <canvas id="gesture-canvas" aria-hidden="true"></canvas>
                </div>

                <div class="gesture-help">
                    <span><strong>Rotate objek:</strong> cubit jempol + telunjuk tangan kiri, lalu gerakkan tangan.</span>
                    <span><strong>Tarik panjang:</strong> buka jari telunjuk &amp; jari tengah membentuk peace sign (huruf V), jari lain mengepal.</span>
                    <span><strong>Rotate point of view:</strong> kepalkan tangan, lalu gerakkan untuk mengorbit kamera.</span>
                    <span><strong>Istirahat:</strong> buka telapak atau lepaskan cubitan untuk menghentikan aksi.</span>
                </div>
            </aside>

            <!-- Viewport Bottom Stats & Export Bar -->
            <div class="viewport-bar">
                <div class="stats-group">
                    <div>
                        <span class="stats-label">Vertices:</span>
                        <span id="stat-vertices" class="stats-value">0</span>
                    </div>
                    <div>
                        <span class="stats-label">Polygons:</span>
                        <span id="stat-polygons" class="stats-value">0</span>
                    </div>
                </div>

                <div class="export-actions-group">
                    <button id="export-png-btn" class="btn btn-outline btn-sm">Snapshot PNG</button>
                    <button id="export-obj-btn" class="btn btn-studio btn-sm">Export OBJ</button>
                </div>
            </div>

        </div>

    </div>

</div>

@endsection
