<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>@yield('title', 'Picto3D')</title>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Outfit:wght@400..700&family=Plus+Jakarta+Sans:wght@400..700&display=swap"
    >

    @yield('styles')
    @vite('resources/js/app.js')
</head>
<body class="@yield('bodyClass')">
    @include('components.navbar')

    <main>
        @yield('content')
    </main>

    @include('components.footer')
    @yield('scripts')
</body>
</html>
