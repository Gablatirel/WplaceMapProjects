<template>
	<Dialog
		:draggable="false"
		:visible="isOpen"
		:style="{
			width: '100%',
			margin: '0',
			borderRadius: isBottom
				? 'var(--p-dialog-border-radius) var(--p-dialog-border-radius) 0 0'
				: '0 0 var(--p-dialog-border-radius) var(--p-dialog-border-radius)'
		}"
		:position="isBottom ? 'bottom' : 'top'"
	>
		<template #container>
			<div
				:class="[
					'palette-card',
					isMobile ? 'palette-card--mobile' : null
				]"
				aria-labelledby="palette-label"
			>
				<div class="palette-header">
					<div class="palette-buttons">
						<Button
							v-tooltip.top="isExpanded ? 'Show free colors' : 'Show all colors'"
							severity="secondary"
							icon="_"
							size="small"
							rounded
							outlined
							:aria-label="isExpanded ? 'Show free colors' : 'Show all colors'"
							@click="isExpanded = !isExpanded"
						>
							<Icon :name="isExpanded ? 'zoom_out' : 'zoom_in'" />
						</Button>

						<Button
							v-tooltip.top="isBottom ? 'Move to top' : 'Move to bottom'"
							severity="secondary"
							icon="_"
							size="small"
							rounded
							outlined
							:aria-label="isBottom ? 'Move to top' : 'Move to bottom'"
							@click="isBottom = !isBottom"
						>
							<Icon :name="isBottom ? 'arrow_up' : 'arrow_down'" />
						</Button>
					</div>

					<Icon name="paint" class="palette-header-icon" />

					<h3 id="palette-label" class="palette-header-label">
						Paint {{ pixelCount.toLocaleString() }} {{ pixelCount === 1 ? "pixel" : "pixels" }}
					</h3>

					<div class="palette-buttons">
						<Button
							v-tooltip.top="isEraserMode ? 'Switch to painting' : 'Switch to eraser'"
							:severity="isEraserMode ? 'danger' : 'secondary'"
							icon="_"
							size="small"
							rounded
							:outlined="!isEraserMode"
							:aria-label="isEraserMode ? 'Switch to painting' : 'Switch to eraser'"
							@click="$emit('toggleEraser')"
						>
							<Icon name="eraser" />
						</Button>

						<Button
							v-tooltip.top="pixelCount === 0 ? 'Close' : 'Discard changes'"
							:severity="pixelCount === 0 ? 'secondary' : 'danger'"
							icon="_"
							size="small"
							rounded
							text
							aria-label="Close"
							@click="$emit('close')"
						>
							<Icon name="close" />
						</Button>
					</div>
				</div>

				<div class="palette-body">
					<div class="color-grid">
						<Button
							v-for="item in paletteItems"
							:key="item.index"
							v-tooltip.top="item.name"
							:class="['color-button', {
								'color-button--transparent': item.rgba[3] === 0,
								'color-button--selected': selectedColor === item.cssValue,
								'color-button--locked': !item.isUnlocked
							}]"
							:raised="selectedColor === item.cssValue"
							:aria-label="`${item.isUnlocked ? 'Select color' : 'Purchase color'}: ${item.name}`"
							@click="handleSelectColor(item)">
							<div
								class="color-button-color"
								:style="{ backgroundColor: item.cssValue }"
							/>

							<Icon
								v-if="!item.isUnlocked"
								name="lock"
								class="color-button-lock"
							/>
						</Button>
					</div>

					<PaintButton
						class="palette-paint-button"
						:size="isMobile ? 'normal' : 'large'"
						:charges="charges"
						:max-charges="maxCharges"
						:time-until-next="timeUntilNext"
						:is-drawing="true"
						:pending-pixels="pixelCount"
						@click="$emit('submit')"
					/>
				</div>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { isColorUnlocked, PAID_PALETTE_INDEX, palette, type PaletteColor } from "~/utils/palette";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import { useViewport } from "~/composables/useViewport";

const props = defineProps<{
	isOpen: boolean;
	selectedColor: string;
	isEraserMode: boolean;
	charges: number;
	maxCharges: number;
	pixelCount: number;
	timeUntilNext: string;
	extraColorsBitmap: number;
}>();

const emit = defineEmits<{
	close: [];
	submit: [];
	selectColor: [index: number, cssValue: string];
	purchaseColor: [];
	toggleEraser: [];
}>();

interface PaletteItem extends PaletteColor {
	cssValue: string;
	isUnlocked: boolean;
}

const paletteItems = computed(() => palette
	.filter(item => isExpanded.value || item.index < PAID_PALETTE_INDEX)
	.map((item): PaletteItem => ({
		...item,
		cssValue: `rgba(${item.rgba.join(",")})`,
		isUnlocked: isColorUnlocked(item.index, props.extraColorsBitmap)
	})));

const { isMobile } = useViewport();

const isExpanded = ref(false);
const isBottom = ref(true);

onMounted(() => {
	try {
		isExpanded.value = localStorage["show-all-colors"] === "true";
	} catch {
		// Ignore
	}
});

watch(() => isExpanded, () => {
	localStorage["show-all-colors"] = isExpanded.value ? "true" : "false";
});

const handleSelectColor = (item: PaletteItem) => {
	if (item.isUnlocked) {
		emit("selectColor", item.index, item.cssValue);
	} else {
		emit("purchaseColor");
	}
};
</script>

<style scoped>
.palette-container {
	width: 100%;
}

.palette-card--mobile {
	--p-card-body-padding: 0.75rem;
}

.palette-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: calc(var(--p-card-body-padding) * 0.8) var(--p-card-body-padding) calc(var(--p-card-body-padding) * 0.2) var(--p-card-body-padding);
	gap: 0.25rem;
	border-bottom: 1px solid var(--p-surface-border);
}

.palette-header-icon {
	font-size: 1.5rem;
	margin-inline-start: 0.25rem;
}

.palette-header-label {
	font-size: 1.1rem;
	font-weight: 500;
	margin-block: 0;
	margin-inline-start: 0.25rem;
	margin-inline-end: auto;
	font-feature-settings: "tnum";
}

.palette-buttons {
	display: flex;
	gap: 0.5rem;
}

.palette-buttons > * {
	aspect-ratio: 1;
	font-size: 1rem;
}

.palette-body {
	display: flex;
	flex-direction: column;
	gap: calc(var(--p-card-body-padding) * 0.8);
	margin: calc(var(--p-card-body-padding) * 0.6) calc(var(--p-card-body-padding) * 0.8);
	margin-bottom: calc((var(--p-card-body-padding) * 0.8) - 1px);
}

.color-grid {
	--cols: 8;
	--gap: 0.25rem;
	display: grid;
	grid-template-columns: repeat(var(--cols), 1fr);
	grid-auto-flow: row;
	gap: var(--gap);
}

@media (min-width: 768px) {
	.color-grid {
		--cols: 16;
		--size: 35px;
	}
}

@media (min-width: 1500px) {
	.color-grid {
		--cols: 32;
	}
}

.color-button {
	--border-color: var(--p-gray-300);
	--foreground-color: var(--p-gray-500);
	position: relative;
	min-width: 30px;
	min-height: 30px;
	padding: 0;
	border: 1px solid var(--border-color);
	border-radius: 6px;
}

.app-dark .color-button {
	--border-color: var(--p-gray-600);
	--foreground-color: var(--p-gray-400);
}

.color-button,
.color-button:hover,
.color-button:active {
	background: none;
}

.color-button-color {
	position: absolute;
	inset: 0;
}

.color-button-lock {
	position: relative;
	width: 1.5em;
	height: 1.5em;
	background: color-mix(in srgb, var(--p-dialog-background), transparent 50%);
	border: 1px solid color-mix(in srgb, var(--border-color), transparent 50%);
	border-radius: 100%;
	color: var(--foreground-color);
}

@media (min-height: 700px) {
	.color-grid {
		--gap: 0.5rem;
	}

	.color-button {
		min-height: 40px;
	}
}

.color-button--selected,
.color-button--selected:hover,
.color-button--selected:active {
	border: 3px solid var(--p-primary-color);
}

.color-button--locked .color-button-color {
	opacity: 0.9;
}

.color-button--transparent::before {
	content: "";
	position: absolute;
	inset: 0;
	background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Cpath d='M0 0h8v16h8V8H0z' fill='%23000' fill-opacity='.2'/%3E%3C/svg%3E") 0 0/50% 50% repeat;
}

.app-dark .color-button--transparent::before {
	background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Cpath d='M0 0h8v16h8V8H0z' fill='%23fff' fill-opacity='.2'/%3E%3C/svg%3E");
}

.palette-paint-button {
	align-self: center;
	margin-inline: auto;
}
</style>
