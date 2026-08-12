// Component & Global Application JavaScript

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Lucide Vector Icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // 2. Navbar Mobile Menu Toggle
    const mobileToggleBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');

    if (mobileToggleBtn && mobileMenu) {
        mobileToggleBtn.addEventListener('click', () => {
            mobileMenu.classList.toggle('open');
        });
    }
});
