/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Space Grotesk', 'sans-serif'],
                space: ['Space Grotesk', 'sans-serif'],
                mono: ['IBM Plex Mono', 'monospace'],
            },
            colors: {
                dark: {
                    bg: '#030407',
                    panel: 'rgba(10, 14, 21, 0.76)',
                    border: 'rgba(255, 255, 255, 0.05)',
                },
                neon: {
                    cyan: '#00f3ff',
                    green: '#10b981',
                    purple: '#a68dff',
                },
            },
        },
    },
    plugins: [],
}
