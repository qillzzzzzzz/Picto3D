<!-- Navbar Component -->
<header class="site-header">
    <div class="navbar">
        
        <!-- Logo Left -->
        <a href="{{ route('home') }}" class="nav-brand">
            <div class="nav-brand-icon">
                <i data-lucide="box"></i>
            </div>
            <span>3D Studio</span>
        </a>

        <!-- Right Aligned Navigation Links (With Professional Vector Icons) -->
        <ul class="nav-menu">
            <li>
                <a href="{{ route('home') }}" data-accent="primary"
                   class="nav-link {{ request()->routeIs('home') ? 'active' : '' }}">
                    <i data-lucide="home"></i>
                    <span>Home</span>
                </a>
            </li>
            <li>
                <a href="{{ route('camera') }}" data-accent="camera"
                   class="nav-link {{ request()->routeIs('camera') ? 'active' : '' }}">
                    <i data-lucide="camera"></i>
                    <span>3D Camera</span>
                </a>
            </li>
            <li>
                <a href="{{ route('editor') }}" data-accent="studio"
                   class="nav-link {{ request()->routeIs('editor') ? 'active' : '' }}">
                    <i data-lucide="layers"></i>
                    <span>3D Design Studio</span>
                </a>
            </li>
        </ul>

        <!-- Mobile Toggle Button -->
        <button id="mobile-menu-btn" class="mobile-toggle" aria-label="Toggle Navigation">
            <i data-lucide="menu"></i>
        </button>
    </div>

    <!-- Mobile Navigation Menu -->
    <div id="mobile-menu" class="mobile-menu">
        <a href="{{ route('home') }}" data-accent="primary" class="nav-link {{ request()->routeIs('home') ? 'active' : '' }}">
            <i data-lucide="home"></i> Home
        </a>
        <a href="{{ route('camera') }}" data-accent="camera" class="nav-link {{ request()->routeIs('camera') ? 'active' : '' }}">
            <i data-lucide="camera"></i> 3D Camera
        </a>
        <a href="{{ route('editor') }}" data-accent="studio" class="nav-link {{ request()->routeIs('editor') ? 'active' : '' }}">
            <i data-lucide="layers"></i> 3D Design Studio
        </a>
    </div>
</header>
