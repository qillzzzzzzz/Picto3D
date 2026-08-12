// Home Page Drag and Drop Upload JS Logic

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const dropZonePrompt = document.getElementById('drop-zone-prompt');
    const previewContainer = document.getElementById('preview-container');
    const imagePreview = document.getElementById('image-preview');
    const imageFilename = document.getElementById('image-filename');
    const removeImgBtn = document.getElementById('remove-img-btn');
    const openEditorBtn = document.getElementById('open-editor-btn');

    if (!dropZone || !fileInput) return;

    let currentImageDataUrl = null;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });

    dropZone.addEventListener('dragover', () => dropZone.classList.add('dragover'));
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files && files.length > 0) handleFile(files[0]);
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) handleFile(e.target.files[0]);
    });

    function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('Silakan pilih file gambar.');
            return;
        }

        const reader = new FileReader();
        reader.onload = function (e) {
            currentImageDataUrl = e.target.result;
            imagePreview.src = currentImageDataUrl;
            imageFilename.textContent = file.name;
            
            dropZonePrompt.style.display = 'none';
            previewContainer.style.display = 'flex';

            localStorage.setItem('3d_editor_image', currentImageDataUrl);
        };
        reader.readAsDataURL(file);
    }

    if (removeImgBtn) {
        removeImgBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            currentImageDataUrl = null;
            imagePreview.src = '';
            imageFilename.textContent = '';
            fileInput.value = '';
            localStorage.removeItem('3d_editor_image');

            previewContainer.style.display = 'none';
            dropZonePrompt.style.display = 'flex';
        });
    }

    if (openEditorBtn) {
        openEditorBtn.addEventListener('click', () => {
            if (currentImageDataUrl) {
                window.location.href = "/editor";
            }
        });
    }
});
