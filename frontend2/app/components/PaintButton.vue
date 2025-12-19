<template>
	<Button
		severity="primary"
		:size="isMobile ? 'small' : 'large'"
		raised
		rounded
		class="paint-button"
		@click="$emit('click')"
	>
		<Icon name="paint" class="paint-button-icon" />
		<span :class="{ 'shimmer-text': hasPendingPixels }">
			Paint {{ charges.toLocaleString() }}/{{ maxCharges.toLocaleString() }}
		</span>
		<span class="paint-button-time">{{ timeUntilNext }}</span>
	</Button>
</template>

<script setup lang="ts">
import Button from "primevue/button";
import { computed } from "vue";
import { useViewport } from "~/composables/useViewport";

const props = defineProps<{
	charges: number;
	maxCharges: number;
	isDrawing: boolean;
	timeUntilNext: string;
	pendingPixels?: number;
}>();

const { isMobile } = useViewport();

const hasPendingPixels = computed(() => (props.pendingPixels ?? 0) > 0);

defineEmits<{
	click: [];
}>();
</script>

<style scoped>
.paint-button {
	font-weight: 600;
	font-feature-settings: "tnum";
}

.paint-button-icon {
	font-size: 1.5em;
}

.paint-button-time {
	font-size: 0.8em;
	font-weight: 500;
	vertical-align: baseline;
}

.shimmer-text {
	--p-button-info-color-shimmer: #aaa;
	background: linear-gradient(
		90deg,
		var(--p-button-info-color) 0%,
		var(--p-button-info-color) 30%,
		var(--p-button-info-color-shimmer) 50%,
		var(--p-button-info-color) 70%,
		var(--p-button-info-color) 100%
	);
	background-size: 200% 100%;
	background-clip: text;
	-webkit-background-clip: text;
	-webkit-text-fill-color: transparent;
	animation: shimmer 3s linear infinite;
}

@media (prefers-color-scheme: dark) {
	.shimmer-text {
		--p-button-info-color-shimmer: #666;
	}
}

@keyframes shimmer {
	0% {
		background-position: 200% 0;
	}
	100% {
		background-position: -200% 0;
	}
}
</style>
