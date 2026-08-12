@extends('layouts.app')

@section('title', 'Home - Picto3D')

@section('bodyClass', 'page-home')

@section('content')
<div class="container">

    <!-- Decorative background accents (purely visual) -->
    <div class="decor-shape decor-blob" style="width:340px;height:340px;top:-140px;left:-160px;background:var(--color-primary-soft);"></div>
    <div class="decor-shape decor-blob" style="width:220px;height:220px;top:120px;right:-120px;background:var(--color-pink-soft);"></div>
    <div class="decor-dots" style="width:140px;height:140px;top:40px;right:6%;color:var(--color-yellow);"></div>

    <!-- Hero: text left, upload right -->
    <div class="hero-grid">
        <div class="hero-copy">
            <span class="hero-eyebrow">
                <i data-lucide="box"></i> 2D &rarr; 3D Converter
            </span>
            <h1 class="page-title">
                Ubah Gambar 2D Menjadi <span class="hero-accent-text">Model 3D</span>
            </h1>
            <div class="hero-underline"></div>
            <p class="page-subtitle">
                Unggah gambar 2D atau ambil foto lewat kamera untuk dikonversi menjadi objek 3D secara langsung.
            </p>
        </div>

        <div class="hero-upload-col">
            <div class="home-upload-wrapper">
                <div class="card">

                    <div class="upload-header">
                        <h2 class="upload-title">Upload Gambar</h2>
                        <p class="upload-subtitle">Pilih file gambar (PNG, JPG, WEBP) atau seret langsung ke area di bawah.</p>
                    </div>

                    <!-- Dropzone Area -->
                    <div id="drop-zone" class="drop-zone">
                        <input type="file" id="file-input" class="visually-hidden-input" accept="image/*">

                        <!-- Prompt State -->
                        <div id="drop-zone-prompt" class="drop-zone-prompt">
                            <div class="drop-zone-icon">
                                <i data-lucide="upload"></i>
                            </div>
                            <div>
                                <p class="drop-zone-title">Seret & Lepas Gambar Di Sini</p>
                                <p class="drop-zone-subtext">atau klik untuk membuka file explorer</p>
                            </div>
                            <button type="button" onclick="document.getElementById('file-input').click()" class="btn btn-primary">
                                Pilih File Gambar
                            </button>
                        </div>

                        <!-- Preview State -->
                        <div id="preview-container" class="preview-container">
                            <div class="preview-wrapper">
                                <img id="image-preview" src="" alt="Preview" class="preview-img">
                                <button id="remove-img-btn" type="button" class="preview-remove-btn">
                                    <i data-lucide="x" class="icon-xs"></i>
                                </button>
                            </div>
                            <p id="image-filename" class="preview-filename"></p>
                            <button id="open-editor-btn" type="button" class="btn btn-primary">
                                Buka di 3D Studio
                            </button>
                        </div>
                    </div>

                    <div class="home-camera-link-wrapper">
                        <a href="{{ route('camera') }}" class="btn btn-link">
                            Gunakan Kamera &rarr;
                        </a>
                    </div>

                </div>
            </div>
        </div>
    </div>

    <!-- Border Information Cards Section -->
    <div class="info-cards-section">
        <h3 class="info-cards-title">Informasi Fitur &amp; Panduan</h3>

        <div class="info-cards-grid">
            <!-- Card 1: Upload -->
            <div class="info-border-card">
                <div class="feature-icon"><i data-lucide="upload"></i></div>
                <h4>Drag &amp; Drop Upload</h4>
                <p>Upload gambar 2D secara langsung dari perangkat Anda untuk dikonversi menjadi tekstur &amp; mesh kedalaman 3D.</p>
                <div class="feature-bar"></div>
            </div>

            <!-- Card 2: Camera -->
            <div class="info-border-card">
                <div class="feature-icon"><i data-lucide="camera"></i></div>
                <h4>Kamera Live Interaktif</h4>
                <p>Gunakan kamera perangkat dengan tampilan cermin (mirror) untuk memotret objek fisik langsung dari browser.</p>
                <div class="feature-bar"></div>
            </div>

            <!-- Card 3: 3D Design Studio -->
            <div class="info-border-card">
                <div class="feature-icon"><i data-lucide="layers"></i></div>
                <h4>3D Design Studio</h4>
                <p>Atur ketinggian extrusion, material wireframe/solid, serta export hasil akhir model 3D dalam format .OBJ.</p>
                <div class="feature-bar"></div>
            </div>
        </div>
    </div>

</div>
@endsection
