// 3D Camera Page JS Logic

document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('webcam-video');
    const canvas = document.getElementById('snapshot-canvas');
    const captureBtn = document.getElementById('capture-btn');
    const switchCamBtn = document.getElementById('switch-camera-btn');
    const errorOverlay = document.getElementById('camera-error-overlay');
    const retryCamBtn = document.getElementById('retry-camera-btn');
    
    const snapshotPlaceholder = document.getElementById('snapshot-placeholder');
    const snapshotImg = document.getElementById('snapshot-img');
    const captureActions = document.getElementById('capture-actions');
    const useInEditorBtn = document.getElementById('use-in-editor-btn');
    const retakeBtn = document.getElementById('retake-btn');

    if (!video) return;

    let currentStream = null;
    let currentFacingMode = 'user';
    let capturedDataUrl = null;

    async function startCamera() {
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
        }

        try {
            if (errorOverlay) errorOverlay.style.display = 'none';
            const constraints = {
                video: {
                    facingMode: currentFacingMode,
                    width: { ideal: 1280 },
                    height: { ideal: 960 }
                },
                audio: false
            };

            currentStream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = currentStream;
        } catch (err) {
            try {
                currentStream = await navigator.mediaDevices.getUserMedia({ video: true });
                video.srcObject = currentStream;
            } catch (fallbackErr) {
                if (errorOverlay) errorOverlay.style.display = 'flex';
            }
        }
    }

    startCamera();

    if (switchCamBtn) {
        switchCamBtn.addEventListener('click', () => {
            currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
            startCamera();
        });
    }

    if (retryCamBtn) {
        retryCamBtn.addEventListener('click', startCamera);
    }

    if (captureBtn) {
        captureBtn.addEventListener('click', () => {
            if (!video.srcObject) return;

            const context = canvas.getContext('2d');
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;

            context.save();
            context.translate(canvas.width, 0);
            context.scale(-1, 1);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            context.restore();

            capturedDataUrl = canvas.toDataURL('image/png');

            if (snapshotImg) {
                snapshotImg.src = capturedDataUrl;
                snapshotImg.style.display = 'block';
            }
            if (snapshotPlaceholder) snapshotPlaceholder.style.display = 'none';
            if (captureActions) captureActions.style.display = 'flex';
        });
    }

    if (retakeBtn) {
        retakeBtn.addEventListener('click', () => {
            capturedDataUrl = null;
            if (snapshotImg) {
                snapshotImg.src = '';
                snapshotImg.style.display = 'none';
            }
            if (snapshotPlaceholder) snapshotPlaceholder.style.display = 'block';
            if (captureActions) captureActions.style.display = 'none';
        });
    }

    if (useInEditorBtn) {
        useInEditorBtn.addEventListener('click', () => {
            if (capturedDataUrl) {
                localStorage.setItem('3d_editor_image', capturedDataUrl);
                window.location.href = "/editor";
            }
        });
    }
});
