// https://nuxt.com/docs/api/configuration/nuxt-config
import { definePreset } from "@primeuix/themes";
import Aura from "@primeuix/themes/aura";

const theme = definePreset(Aura, {
	primitive: {
		blue: {
			50: "#f6f8fe",
			100: "#d1dbf8",
			200: "#adbff2",
			300: "#89a2ec",
			400: "#6586e7",
			500: "#4169e1",
			600: "#3759bf",
			700: "#2e4a9e",
			800: "#243a7c",
			900: "#1a2a5a",
			950: "#101a38"
		}
	},

	semantic: {
		primary: {
			50: "{blue:50}",
			100: "{blue:100}",
			200: "{blue:200}",
			300: "{blue:300}",
			400: "{blue:400}",
			500: "{blue:500}",
			600: "{blue:600}",
			700: "{blue:700}",
			800: "{blue:800}",
			900: "{blue:900}",
			950: "{blue:950}"
		}
	}
});

export default defineNuxtConfig({
	compatibilityDate: "2025-07-15",

	devtools: {
		enabled: true
	},

	app: {
		baseURL: "/",

		head: {
			title: "openplace",

			htmlAttrs: {
				lang: "en"
			},

			meta: [
				{
					name: "viewport",
					content: "width=device-width, initial-scale=1"
				},
				{
					name: "color-scheme",
					content: "light dark"
				},
				{
					name: "twitter:card",
					content: "summary_large_image"
				},
				{
					property: "og:type",
					content: "website"
				},
				{
					property: "og:site_name",
					content: "openplace"
				},
				{
					property: "og:title",
					content: "openplace"
				},
				{
					property: "og:image",
					content: "/img/og-image.png"
				},
				{
					name: "description",
					content: "openplace is a free unofficial open source backend for wplace."
				},
				{
					name: "og:description",
					property: "og:description",
					content: "openplace is a free unofficial open source backend for wplace."
				},
				{
					name: "theme-color",
					content: "#f9f4f0",
					media: "(prefers-color-scheme: light)"
				},
				{
					name: "theme-color",
					content: "#38435c",
					media: "(prefers-color-scheme: dark)"
				},
				{
					name: "theme-color",
					content: "#4169e1",
					media: "only _" // Used by Discord
				}
			],

			link: [
				{
					rel: "preconnect",
					href: "https://tiles.openfreemap.org"
				},
				{
					rel: "icon",
					sizes: "96x96",
					href: "/img/favicon-96x96.png"
				},
				{
					rel: "apple-touch-icon",
					sizes: "180x180",
					href: "/img/apple-touch-icon.png"
				},
				{
					rel: "manifest",
					href: "/site.webmanifest"
				}
			]
		}
	},

	devServer: {
		host: "0.0.0.0",
		port: Number.parseInt(process.env["FRONTEND_PORT"] ?? "") || 3001
	},

	runtimeConfig: {
		public: {
			backendUrl: process.env["BACKEND_URL"] ?? ""
		}
	},

	modules: [
		"@nuxt/eslint",
		"@primevue/nuxt-module"
	],

	primevue: {
		components: {
			include: ["Avatar", "OverlayBadge", "Menu", "Badge", "Toast", "Button", "Card", "ProgressSpinner"]
		},

		options: {
			theme: {
				preset: theme,
				options: {
					darkModeSelector: ".app-dark",
					cssLayer: false
				}
			}
		}
	},

	css: [
		"bootstrap/dist/css/bootstrap-reboot.min.css",
		"maplibre-gl/dist/maplibre-gl.css",
		"@fontsource-variable/mona-sans/wght.css",
		"@fontsource-variable/pixelify-sans/wght.css",
		"~/assets/common.scss"
	]
});
