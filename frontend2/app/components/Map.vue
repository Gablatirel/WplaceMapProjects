<template>
	<div class="map-container">
		<div
			ref="mapContainer"
			class="map"
		/>
		<div
			v-if="isDev"
			class="debug-label"
		>
			<div>Zoom: {{ currentZoom.toFixed(2) }}</div>
			<div v-if="centerCoords">
				Center: Tx {{ centerCoords.tile[0] }}&times;{{ centerCoords.tile[1] }} Px {{ centerCoords.pixel[0] }}&times;{{ centerCoords.pixel[1] }}<br>
				{{ centerCoords.coords[0].toFixed(6) }}, {{ centerCoords.coords[1].toFixed(6) }}
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { CanvasSource, GeoJSONSource, Map as MaplibreMap, Marker, RasterTileSource, StyleSpecification } from "maplibre-gl";
import { getPixelBounds, getPixelsBetween, getTileBounds, type LngLat, lngLatToTileCoords, TILE_SIZE, type TileCoords, ZOOM_LEVEL } from "~/utils/coordinates";
import { useTheme } from "~/composables/useTheme";

// Expose things for user scripts to access
declare global {
	interface Window {
		map: MaplibreMap;
	}
}

export interface LocationWithZoom {
	center: LngLat;
	zoom: number;
}

export interface Pixel {
	coords: TileCoords;
	color: string;
}

interface TileCanvas {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	sourceId: string;
	layerId: string;
	originalImageData: ImageData | null;
	isDirty: boolean;
}

export interface FavoriteLocation {
	id: number;
	name: string;
	latitude: number;
	longitude: number;
}

const props = defineProps<{
	initialLocation: LocationWithZoom;
	isDrawing: boolean;
	isSatellite: boolean;
	favoriteLocations?: FavoriteLocation[];
	selectedPixelCoords?: TileCoords | null;
	selectedColor?: string;
	isEraserMode?: boolean;
	currentCharges?: number | null;
}>();

const emit = defineEmits<{
	mapClick: [event: LngLat];
	mapRightClick: [event: LngLat];
	mapHover: [event: LngLat];
	bearingChange: [bearing: number];
	favoriteClick: [favorite: FavoriteLocation];
	saveCurrentLocation: [];
	pixelCountChange: [count: number];
	pixelsReady: [pixels: Array<{ coords: TileCoords; color: string }>];
}>();

const TILE_PATH = "/files/s0/tiles/{x}/{y}.png";
// https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}.jpeg
const SATELLITE_TILE_PATH = "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";

const FAVORITE_STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="#ffb300" d="m6.128 21 1.548-6.65-5.181-4.484 6.835-.587L11.995 3l2.675 6.279 6.835.587-5.181 4.484L17.872 21l-5.877-3.533z"/></svg>`;

const CANVAS_PIXEL_SIZE = 100;

const TILE_RELOAD_INTERVAL = 15_000;
const LOCATION_SAVE_INTERVAL = 5000;
const ACTIVITY_TIMEOUT = 5 * 60 * 1000;

const isDev = process.env.NODE_ENV === "development";

const mapContainer = ref<HTMLDivElement | null>(null);
let map: MaplibreMap | null = null;
const favoriteMarkers: Marker[] = [];

const hoverCoords = ref<TileCoords | null>(null);
const currentZoom = ref(11);
const lastDrawnCoords = ref<TileCoords | null>(null);
const isDrawingActive = ref(false);
const centerCoords = ref<TileCoords & { coords: LngLat; } | null>(null);

let saveLocationTimeout: ReturnType<typeof setTimeout> | null = null;
let tileReloadInterval: ReturnType<typeof setInterval> | null = null;
let activityTimeout: ReturnType<typeof setTimeout> | null = null;
let lastTileRefreshTime = 0;

type PendingPixelCanvasKey = `${number},${number},${number},${number}`;
type PixelCoordsKey = `${number},${number}`;

interface PendingPixelCanvas {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	sourceId: string;
	layerId: string;
	pixelData: Map<PixelCoordsKey, Pixel>;
}

const tileCanvases = new Map<PixelCoordsKey, TileCanvas>();
const pendingPixelCanvases = new Map<PendingPixelCanvasKey, PendingPixelCanvas>();
const pendingPixelCount = ref(0);

const { isDarkMode } = useTheme();

const mapStyleLight = ref<StyleSpecification | null>(null);
const mapStyleDark = ref<StyleSpecification | null>(null);
const mapStyle = computed(() => isDarkMode.value ? mapStyleDark.value : mapStyleLight.value);

watch(() => mapStyle.value, () => {
	if (map) {
		setUpMapLayers(map);
	}
});

const getCanvasKey = ({ tile, pixel }: TileCoords): PendingPixelCanvasKey => {
	const [x, y] = [
		Math.floor(pixel[0] / CANVAS_PIXEL_SIZE) * CANVAS_PIXEL_SIZE,
		Math.floor(pixel[1] / CANVAS_PIXEL_SIZE) * CANVAS_PIXEL_SIZE
	];
	return `${tile[0]},${tile[1]},${x},${y}`;
};

const getPixelInCanvasCoords = (pixelCoord: number): number => pixelCoord % CANVAS_PIXEL_SIZE;

const getPendingPixelCanvas = (coords: TileCoords) => {
	const key = getCanvasKey(coords);
	let canvasData = pendingPixelCanvases.get(key);
	if (!canvasData) {
		const canvas = document.createElement("canvas");
		canvas.width = CANVAS_PIXEL_SIZE;
		canvas.height = CANVAS_PIXEL_SIZE;

		const ctx = canvas.getContext("2d", {
			willReadFrequently: true
		})!;
		ctx.imageSmoothingEnabled = false;

		const sourceId = `openplace-pending-pixels-canvas-${key}`;
		const layerId = `openplace-pending-pixels-canvas-layer-${key}`;

		canvasData = {
			canvas,
			ctx,
			sourceId,
			layerId,
			pixelData: new Map()
		};

		pendingPixelCanvases.set(key, canvasData);

		if (map) {
			const [tileX, tileY] = coords.tile;
			const [x, y] = coords.pixel;
			const [basePixelX, basePixelY] = [
				Math.floor(x / CANVAS_PIXEL_SIZE) * CANVAS_PIXEL_SIZE,
				Math.floor(y / CANVAS_PIXEL_SIZE) * CANVAS_PIXEL_SIZE
			];

			const topLeftBounds = getPixelBounds({
				tile: [tileX, tileY],
				pixel: [basePixelX, basePixelY]
			});
			const topRightBounds = getPixelBounds({
				tile: [tileX, tileY],
				pixel: [basePixelX + CANVAS_PIXEL_SIZE - 1, basePixelY]
			});
			const bottomRightBounds = getPixelBounds({
				tile: [tileX, tileY],
				pixel: [basePixelX + CANVAS_PIXEL_SIZE - 1, basePixelY + CANVAS_PIXEL_SIZE - 1]
			});
			const bottomLeftBounds = getPixelBounds({
				tile: [tileX, tileY],
				pixel: [basePixelX, basePixelY + CANVAS_PIXEL_SIZE - 1]
			});

			const scaledBounds: [LngLat, LngLat, LngLat, LngLat] = [
				topLeftBounds.topLeft,
				topRightBounds.topRight,
				bottomRightBounds.bottomRight,
				bottomLeftBounds.bottomLeft
			];

			if (!map.getSource(sourceId)) {
				map.addSource(sourceId, {
					type: "canvas",
					canvas,
					coordinates: [scaledBounds[0], scaledBounds[1], scaledBounds[2], scaledBounds[3]],
					animate: false
				});
			}

			if (!map.getLayer(layerId)) {
				map.addLayer({
					id: layerId,
					type: "raster",
					source: sourceId,
					paint: {
						"raster-opacity": 1,
						"raster-resampling": "nearest"
					}
				});

				// TODO: Why is the border layer falling underneath the pixel layers?
				map.moveLayer("openplace-pending-pixels-border");
			}
		}
	}

	return canvasData;
};

const getPendingPixel = (coords: TileCoords): Pixel | undefined =>
	getPendingPixelCanvas(coords)?.pixelData
		.get(`${coords.pixel[0]},${coords.pixel[1]}`);

const updatePendingPixelBorders = () => {
	const source = map?.getSource("openplace-pending-pixels-border") as GeoJSONSource;
	if (!source) {
		return;
	}

	const features = [];
	for (const canvasData of pendingPixelCanvases.values()) {
		for (const pixel of canvasData.pixelData.values()) {
			const bounds = getPixelBounds(pixel.coords);
			features.push({
				type: "Feature" as const,
				geometry: {
					type: "Polygon" as const,
					coordinates: [
						[
							bounds.topLeft,
							bounds.topRight,
							bounds.bottomRight,
							bounds.bottomLeft,
							bounds.topLeft
						]
					]
				},
				properties: {}
			});
		}
	}

	source.setData({
		type: "FeatureCollection" as const,
		features
	});
};

const drawPixelOnPendingCanvas = (coords: TileCoords, color: string | null) => {
	if (getPendingPixel(coords)?.color === color) {
		return;
	}

	const canvasData = getPendingPixelCanvas(coords);
	const [x, y] = coords.pixel;
	const [canvasX, canvasY] = [
		getPixelInCanvasCoords(coords.pixel[0]),
		getPixelInCanvasCoords(coords.pixel[1])
	];

	if (color) {
		// Draw on pending canvas
		canvasData.ctx.fillStyle = color;
		canvasData.ctx.fillRect(canvasX, canvasY, 1, 1);

		// Store it
		canvasData.pixelData.set(`${x},${y}`, { coords, color });
		pendingPixelCount.value += 1;
	} else {
		// Clear from pending canvas
		canvasData.ctx.clearRect(canvasX, canvasY, 1, 1);

		// Clear from data
		canvasData.pixelData.delete(`${x},${y}`);
		pendingPixelCount.value -= 1;
	}

	// Trigger canvas redraw
	const source = map?.getSource(canvasData.sourceId) as CanvasSource;
	source?.play();

	updatePendingPixelBorders();

	emit("pixelCountChange", pendingPixelCount.value);
};

const erasePendingPixel = (coords: TileCoords) => {
	const canvasData = getPendingPixelCanvas(coords);
	// const [x, y] = coords.pixel;
	const [canvasX, canvasY] = [
		getPixelInCanvasCoords(coords.pixel[0]),
		getPixelInCanvasCoords(coords.pixel[1])
	];

	// Clear from pending canvas
	canvasData.ctx.clearRect(canvasX, canvasY, 1, 1);

	// Trigger canvas redraw
	const source = map?.getSource(canvasData.sourceId) as CanvasSource;
	source?.play();

	updatePendingPixelBorders();

	emit("pixelCountChange", pendingPixelCount.value);
};

const getTileCanvas = (tileX: number, tileY: number): TileCanvas => {
	const key: PixelCoordsKey = `${tileX},${tileY}`;
	if (tileCanvases.has(key)) {
		return tileCanvases.get(key)!;
	}

	const canvas = document.createElement("canvas");
	canvas.width = TILE_SIZE;
	canvas.height = TILE_SIZE;

	const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
	ctx.imageSmoothingEnabled = false;

	const originalImageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);

	const sourceId = `openplace-tile-canvas-${key}`;
	const layerId = `openplace-tile-canvas-layer-${key}`;

	const tileCanvas: TileCanvas = {
		canvas,
		ctx,
		sourceId,
		layerId,
		originalImageData,
		isDirty: false
	};

	tileCanvases.set(key, tileCanvas);

	if (map) {
		const bounds = getTileBounds(tileX, tileY);

		if (!map.getSource(sourceId)) {
			map.addSource(sourceId, {
				type: "canvas",
				canvas,
				coordinates: bounds,
				animate: false
			});
		}

		if (!map.getLayer(layerId)) {
			map.addLayer({
				id: layerId,
				type: "raster",
				source: sourceId,
				paint: {
					"raster-opacity": 1,
					"raster-resampling": currentZoom.value >= ZOOM_LEVEL ? "nearest" : "linear"
				}
			});

			// Move border layer to top so it renders above all canvas layers
			if (map.getLayer("openplace-pending-pixels-border")) {
				map.moveLayer("openplace-pending-pixels-border");
			}
		}
	}

	return tileCanvas;
};

const drawPixelOnCanvas = (coords: TileCoords, color: string | null) => {
	drawPixelOnPendingCanvas(coords, color);

	const [tileX, tileY] = coords.tile;
	const [x, y] = coords.pixel;

	const tileCanvas = getTileCanvas(tileX, tileY);
	const { ctx } = tileCanvas;

	if (color === "rgba(0,0,0,0)") {
		// Drawing transparency - clear the pixel underneath
		ctx.clearRect(x, y, 1, 1);
	} else {
		ctx.fillStyle = color;
		ctx.fillRect(x, y, 1, 1);
	}

	tileCanvas.isDirty = true;
};

const cancelPaint = () => {
	for (const canvasData of pendingPixelCanvases.values()) {
		if (map?.getLayer(canvasData.layerId)) {
			map.removeLayer(canvasData.layerId);
		}
		if (map?.getSource(canvasData.sourceId)) {
			map.removeSource(canvasData.sourceId);
		}
	}
	pendingPixelCanvases.clear();
	pendingPixelCount.value = 0;
	emit("pixelCountChange", 0);

	updatePendingPixelBorders();

	// Reset tile canvases
	for (const tileCanvas of tileCanvases.values()) {
		if (tileCanvas.originalImageData) {
			tileCanvas.ctx.putImageData(tileCanvas.originalImageData, 0, 0);
			tileCanvas.isDirty = false;

			// Trigger update
			const source = map?.getSource(tileCanvas.sourceId) as CanvasSource;
			source?.play();
		}
	}
};

const commitCanvases = () => {
	// Make changes drawn by the user permanent, after submitting paint to server
	for (const tileCanvas of tileCanvases.values()) {
		if (tileCanvas.isDirty) {
			tileCanvas.originalImageData = tileCanvas.ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
			tileCanvas.isDirty = false;
		}
	}
};

const clearPendingCanvases = () => {
	for (const canvasData of pendingPixelCanvases.values()) {
		if (map?.getLayer(canvasData.layerId)) {
			map.removeLayer(canvasData.layerId);
		}
		if (map?.getSource(canvasData.sourceId)) {
			map.removeSource(canvasData.sourceId);
		}

		canvasData.ctx.clearRect(0, 0, canvasData.canvas.width, canvasData.canvas.height);
		canvasData.pixelData.clear();
	}

	pendingPixelCanvases.clear();
	pendingPixelCount.value = 0;
	emit("pixelCountChange", 0);

	updatePendingPixelBorders();
};

const getAllPendingPixels = (): Pixel[] => {
	const result: Pixel[] = [];
	for (const canvasData of pendingPixelCanvases.values()) {
		for (const pixel of canvasData.pixelData.values()) {
			result.push(pixel);
		}
	}
	return result;
};


const removeAllCanvases = () => {
	for (const tileCanvas of tileCanvases.values()) {
		if (map?.getLayer(tileCanvas.layerId)) {
			map.removeLayer(tileCanvas.layerId);
		}
		if (map?.getSource(tileCanvas.sourceId)) {
			map.removeSource(tileCanvas.sourceId);
		}
	}
	tileCanvases.clear();
};

const setUpMapLayers = (mapInstance: MaplibreMap, savedZoom?: number) => {
	// @ts-expect-error - This makes TypeScript mad
	mapInstance.setStyle(mapStyle.value, {
		diff: true,
		transformStyle: (previousStyle, nextStyle) => ({
			...nextStyle,
			layers: [
				...nextStyle.layers,
				...previousStyle?.layers.filter(({ id }) => id.startsWith("openplace-")) ?? []
			],
			sources: (previousStyle ?? nextStyle).sources
		})
	});

	// Hide unwanted layers
	const hideLayers = /^poi_|^landuse|^building(-3d)?$/;
	for (const layer of mapInstance.getStyle().layers) {
		if (hideLayers.test(layer.id)) {
			mapInstance.setLayoutProperty(layer.id, "visibility", "none");
		}
	}

	mapInstance.setFilter("water", [
		"all",
		["!=", "brunnel", "tunnel"],
		["!=", "class", "swimming_pool"]
	]);

	// Add satellite
	if (!mapInstance.getSource("openplace-satellite")) {
		mapInstance.addSource("openplace-satellite", {
			type: "raster",
			tiles: [SATELLITE_TILE_PATH],
			tileSize: 256
		});
	}

	if (props.isSatellite) {
		if (!mapInstance.getLayer("openplace-satellite")) {
			mapInstance.addLayer({
				id: "openplace-satellite",
				type: "raster",
				source: "openplace-satellite"
			}, "building");
		}
	} else {
		if (mapInstance.getLayer("openplace-satellite")) {
			mapInstance.removeLayer("openplace-satellite");
		}
	}

	if (!mapInstance.getSource("openplace-pixel-tiles")) {
		mapInstance.addSource("openplace-pixel-tiles", {
			type: "raster",
			tiles: [],
			tileSize: TILE_SIZE,
			minzoom: ZOOM_LEVEL,
			maxzoom: ZOOM_LEVEL,
			scheme: "xyz"
		});
	}

	refreshTiles();

	const zoom = savedZoom ?? mapInstance.getZoom();
	const resamplingMode = zoom >= ZOOM_LEVEL ? "nearest" : "linear";
	if (!mapInstance.getLayer("openplace-pixel-tiles-layer")) {
		mapInstance.addLayer({
			id: "openplace-pixel-tiles-layer",
			type: "raster",
			source: "openplace-pixel-tiles",
			paint: {
				"raster-opacity": 1,
				"raster-resampling": resamplingMode
			}
		});
	}

	if (!mapInstance.getSource("openplace-pending-pixels-border")) {
		mapInstance.addSource("openplace-pending-pixels-border", {
			type: "geojson",
			data: {
				type: "FeatureCollection",
				features: []
			}
		});
	}

	if (!mapInstance.getLayer("openplace-pending-pixels-border")) {
		mapInstance.addLayer({
			id: "openplace-pending-pixels-border",
			type: "line",
			source: "openplace-pending-pixels-border",
			paint: {
				"line-color": "#fff",
				"line-width": 4,
				"line-opacity": 0.5
			}
		});
	}

	if (!mapInstance.getSource("openplace-hover")) {
		mapInstance.addSource("openplace-hover", {
			type: "geojson",
			data: {
				type: "FeatureCollection",
				features: []
			}
		});
	}

	if (!mapInstance.getLayer("openplace-hover-border")) {
		mapInstance.addLayer({
			id: "openplace-hover-border",
			type: "line",
			source: "openplace-hover",
			paint: {
				"line-color": "#fff",
				"line-width": 4,
				"line-opacity": 0.5
			}
		});
	}
};

const updateHoverGeoJSON = () => {
	const coords = props.selectedPixelCoords ?? hoverCoords.value;
	const source = map?.getSource("openplace-hover") as GeoJSONSource;

	if (!source || !coords) {
		return;
	}

	const bounds = getPixelBounds(coords);
	source.setData({
		type: "FeatureCollection" as const,
		features: [
			{
				type: "Feature" as const,
				geometry: {
					type: "Polygon" as const,
					coordinates: [
						[
							bounds.topLeft,
							bounds.topRight,
							bounds.bottomRight,
							bounds.bottomLeft,
							bounds.topLeft
						]
					]
				},
				properties: {}
			}
		]
	});
};

const updateFavoriteMarkers = async () => {
	if (!map) {
		return;
	}

	// Dynamically import maplibre-gl
	const maplibregl = (await import("maplibre-gl")).default;

	// Remove all existing markers
	for (const marker of favoriteMarkers) {
		marker.remove();
	}
	favoriteMarkers.length = 0;

	for (const favorite of props.favoriteLocations ?? []) {
		// TODO: Tidy this up
		const star = document.createElement("button");
		star.className = "favorite-marker";
		star.innerHTML = FAVORITE_STAR_SVG;
		star.title = "Click to visit favorite location";
		star.setAttribute("aria-label", "Favorite location");
		star.addEventListener("click", e => {
			e.stopPropagation();
			emit("favoriteClick", favorite);
		});

		const marker = new maplibregl.Marker({ element: star })
			.setLngLat([favorite.longitude, favorite.latitude])
			.addTo(map);

		favoriteMarkers.push(marker);
	}
};

const refreshTiles = () => {
	if (map && map.getSource("openplace-pixel-tiles")) {
		const config = useRuntimeConfig();
		const source = map.getSource("openplace-pixel-tiles") as RasterTileSource;
		if (source) {
			try {
				// Force maplibre to fetch again by using a fragment
				source.setTiles([`${config.public.backendUrl}${TILE_PATH}#${Date.now()}`]);
			} catch {
				// Can throw AbortError, ignore
			}
			lastTileRefreshTime = Date.now();
		}
	}
};

const startTileReloadTimer = () => {
	stopTileReloadTimer();
	tileReloadInterval = setInterval(refreshTiles, TILE_RELOAD_INTERVAL);

	if (Date.now() - lastTileRefreshTime >= TILE_RELOAD_INTERVAL) {
		refreshTiles();
	}
};

const stopTileReloadTimer = () => {
	if (tileReloadInterval) {
		clearInterval(tileReloadInterval);
		tileReloadInterval = null;
	}
};

const resetActivityTimeout = () => {
	if (activityTimeout) {
		clearTimeout(activityTimeout);
	}
	activityTimeout = setTimeout(stopTileReloadTimer, ACTIVITY_TIMEOUT);
};

const resumeAfterActivity = () => {
	if (Date.now() - lastTileRefreshTime >= TILE_RELOAD_INTERVAL) {
		refreshTiles();
	}
	startTileReloadTimer();
	resetActivityTimeout();
};

const handleActivity = () => {
	if (tileReloadInterval) {
		// Not timed out yet, reset timer
		resetActivityTimeout();
	} else {
		// Timed out, resume
		resumeAfterActivity();
	}
};

const updateCursor = () => {
	const canvas = map!.getCanvas();
	canvas.style.cursor = props.isDrawing || map!.getZoom() >= ZOOM_LEVEL ? "crosshair" : "grab";
};

onMounted(async () => {
	if (!mapContainer.value) {
		return;
	}

	[mapStyleLight.value, mapStyleDark.value] = await Promise.all([
		$fetch<StyleSpecification>("/maps/styles/liberty"),
		$fetch<StyleSpecification>("/maps/styles/fiord")
	]);

	// Dynamically import maplibre-gl as it can’t be SSR rendered
	const maplibregl = (await import("maplibre-gl")).default;

	map = new maplibregl.Map({
		container: mapContainer.value,
		style: mapStyle.value!,
		center: props.initialLocation.center,
		zoom: props.initialLocation.zoom,
		minZoom: 0,
		maxZoom: 22,
		doubleClickZoom: false,
		attributionControl: false
	});

	// Expose map on window
	// @ts-expect-error - idk why this type doesn’t work
	globalThis.map = map;

	// Gestures
	let isRotating = false;
	let rotateStart: { x: number; y: number } | null = null;

	const canvas = map.getCanvas();
	canvas.addEventListener("mousedown", (e: MouseEvent) => {
		// Support rotation with right-click + shift or alt
		if (e.button === 2 && (e.shiftKey || e.altKey)) {
			isRotating = true;
			rotateStart = { x: e.clientX, y: e.clientY };
			e.preventDefault();
		}
	});

	canvas.addEventListener("mousemove", (e: MouseEvent) => {
		if (isRotating && rotateStart) {
			const dx = e.clientX - rotateStart.x;
			const bearing = map!.getBearing() - dx * 0.5;
			map!.setBearing(bearing);
			rotateStart = { x: e.clientX, y: e.clientY };
		}
	});

	canvas.addEventListener("mouseup", (e: MouseEvent) => {
		if (e.button === 2) {
			isRotating = false;
			rotateStart = null;
		}
	});

	// Disable default right-click rotation
	map.dragRotate.disable();

	map.on("load", () => {
		setUpMapLayers(map!, props.initialLocation?.zoom ?? CLOSE_ZOOM_LEVEL);
		updateFavoriteMarkers();
	});

	map.on("style.load", () => {
		setUpMapLayers(map!);
		updateFavoriteMarkers();
	});

	map.on("click", e => {
		emit("mapClick", [e.lngLat.lng, e.lngLat.lat]);
	});

	map.on("contextmenu", e => {
		e.preventDefault();

		// Only emit right-click event if shift is not held
		if (!e.originalEvent.shiftKey) {
			emit("mapRightClick", [e.lngLat.lng, e.lngLat.lat]);
		}
	});

	// Handle double-click to zoom to native size
	map.on("dblclick", e => {
		if (map!.getZoom() < CLOSE_ZOOM_LEVEL) {
			map!.flyTo({
				center: e.lngLat,
				zoom: CLOSE_ZOOM_LEVEL
			});
		}
	});

	map.on("mousemove", e => {
		const { lng, lat } = e.lngLat;
		const coords = lngLatToTileCoords([lng, lat]);
		hoverCoords.value = coords;

		if (props.isDrawing && isDrawingActive.value && lastDrawnCoords.value) {
			if (props.currentCharges ?? 0 <= 0) {
				// TODO: Needed?
				isDrawingActive.value = false;
			} else {
				const pixelsToDraw = getPixelsBetween(lastDrawnCoords.value, coords);
				if (pixelsToDraw.length > 0) {
					for (const pixel of pixelsToDraw) {
						const color = props.isEraserMode ? "rgba(0,0,0,0)" : props.selectedColor!;
						drawPixelOnCanvas(pixel, color);
					}
					lastDrawnCoords.value = coords;
				}
			}
		}

		emit("mapHover", [lng, lat]);
	});

	const handleKeyDown = (e: KeyboardEvent) => {
		// Lock drawing mode when spacebar held down
		if (e.code === "Space" && !e.repeat && props.isDrawing) {
			e.preventDefault();

			// TODO: Needed?
			if (props.currentCharges ?? 0 <= 0) {
				return;
			}

			isDrawingActive.value = true;

			if (hoverCoords.value) {
				lastDrawnCoords.value = hoverCoords.value;
				const color = props.isEraserMode ? "rgba(0,0,0,0)" : props.selectedColor!;
				drawPixelOnCanvas(hoverCoords.value, color);
			}
		}
	};

	const handleKeyUp = (e: KeyboardEvent) => {
		if (e.code === "Space") {
			e.preventDefault();
			isDrawingActive.value = false;
			lastDrawnCoords.value = null;
		}
	};

	globalThis.addEventListener("keydown", handleKeyDown);
	globalThis.addEventListener("keyup", handleKeyUp);

	const updateCenterCoords = () => {
		if (map && isDev) {
			const { lng, lat } = map.getCenter();
			centerCoords.value = {
				coords: [lng, lat],
				...lngLatToTileCoords([lng, lat])
			};
		}
	};

	const saveLocation = () => {
		if (map) {
			emit("saveCurrentLocation");
		}
	};

	const scheduleSaveLocation = () => {
		if (saveLocationTimeout) {
			clearTimeout(saveLocationTimeout);
		}
		saveLocationTimeout = setTimeout(saveLocation, LOCATION_SAVE_INTERVAL);
	};

	map.on("zoom", () => {
		currentZoom.value = map!.getZoom();

		// Switch to nearest neighbor when above native zoom level
		if (map!.getLayer("openplace-pixel-tiles-layer")) {
			const resamplingMode = currentZoom.value >= ZOOM_LEVEL ? "nearest" : "linear";
			map!.setPaintProperty("openplace-pixel-tiles-layer", "raster-resampling", resamplingMode);
		}

		updateCursor();
	});

	map.on("move", () => {
		updateCenterCoords();
		scheduleSaveLocation();
	});

	map.on("rotate", () => {
		emit("bearingChange", Math.round(map!.getBearing()));
	});

	currentZoom.value = map.getZoom();
	updateCenterCoords();

	map.on("mousedown", () => {
		if (!props.isDrawing) {
			const canvas = map!.getCanvas();
			canvas.style.cursor = "grabbing";
		}
	});

	map.on("mouseup", () => {
		updateCursor();
	});

	updateCursor();

	// Reload tiles every 15 seconds
	startTileReloadTimer();
	resetActivityTimeout();

	// Idle timeout handlers
	globalThis.addEventListener("blur", stopTileReloadTimer);
	globalThis.addEventListener("focus", resumeAfterActivity);
	globalThis.addEventListener("mousemove", handleActivity);
	globalThis.addEventListener("click", handleActivity);
	globalThis.addEventListener("keydown", handleActivity);
	globalThis.addEventListener("scroll", handleActivity);
	globalThis.addEventListener("touchstart", handleActivity);
});


watch([() => props.selectedPixelCoords, hoverCoords], updateHoverGeoJSON);

watch(() => props.isDrawing, updateCursor);

watch(() => props.isSatellite, () => {
	if (map) {
		setUpMapLayers(map);
	}
});

watch(() => props.favoriteLocations, updateFavoriteMarkers, { deep: true });

onUnmounted(() => {
	for (const marker of favoriteMarkers) {
		marker.remove();
	}
	favoriteMarkers.length = 0;

	stopTileReloadTimer();
	if (saveLocationTimeout) {
		clearTimeout(saveLocationTimeout);
	}
	if (activityTimeout) {
		clearTimeout(activityTimeout);
	}

	globalThis.removeEventListener("blur", stopTileReloadTimer);
	globalThis.removeEventListener("focus", resumeAfterActivity);
	globalThis.removeEventListener("mousemove", handleActivity);
	globalThis.removeEventListener("click", handleActivity);
	globalThis.removeEventListener("keydown", handleActivity);
	globalThis.removeEventListener("scroll", handleActivity);
	globalThis.removeEventListener("touchstart", handleActivity);

	removeAllCanvases();
});

// Reset map bearing to 0
const resetBearing = () => {
	if (map) {
		map.easeTo({ bearing: 0, duration: 300 });
	}
};

const flyToLocation = (latitude: number, longitude: number, zoom = ZOOM_LEVEL) => {
	if (map) {
		map.flyTo({
			center: [longitude, latitude],
			zoom,
			duration: 4000
		});
	}
};

const jumpToLocation = (latitude: number, longitude: number, zoom = ZOOM_LEVEL) => {
	if (map) {
		map.jumpTo({
			center: [longitude, latitude],
			zoom
		});
	}
};

const zoomIn = () => map?.zoomIn();
const zoomOut = () => map?.zoomOut();
const getZoom = () => map?.getZoom() ?? ZOOM_LEVEL;
const getCenter = () => map?.getCenter();

const hasUncommittedPixels = () => {
	return tileCanvases.values()
		.some(tileCanvas => tileCanvas.isDirty);
};

defineExpose({
	cancelPaint,
	commitCanvases,
	clearPendingCanvases,
	drawPixelOnCanvas,
	erasePendingPixel,
	getAllPendingPixels,
	getPendingPixel,
	refreshTiles,
	resetBearing,
	flyToLocation,
	jumpToLocation,
	zoomIn,
	zoomOut,
	getZoom,
	getCenter,
	hasUncommittedPixels
});
</script>

<style scoped>
.map-container {
	width: 100vw;
	height: 100dvh;
	position: relative;
}

.map {
	width: 100%;
	height: 100%;
}

.debug-label {
	position: absolute;
	top: 0;
	left: 0;
	z-index: 1000;
	padding: 6px 8px;
	border-bottom-right-radius: 8px;
	background: rgba(0, 0, 0, 0.7);
	color: white;
	font-family: ui-monospace, monospace;
	font-size: 12px;
	line-height: 1.5;
	pointer-events: none;
}

:deep(.favorite-marker) {
	margin: 0;
	padding: 0;
	border: none;
	background: none;
	cursor: pointer;
}
</style>
