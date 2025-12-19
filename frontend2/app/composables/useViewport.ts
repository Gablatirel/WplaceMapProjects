import { computed, onMounted, ref } from "vue";

const isMobile = ref(false);

export function useViewport() {
	let mobileQuery: MediaQueryList | null = null;

	onMounted(() => {
		mobileQuery = globalThis.matchMedia("(max-width: 767px)");
		mobileQuery.addEventListener("change", queryChanged);
	});

	onUnmounted(() => {
		if (mobileQuery) {
			mobileQuery.removeEventListener("change", queryChanged);
			mobileQuery = null;
		}
	});

	const queryChanged = (e: MediaQueryListEvent) => {
		isMobile.value = e.matches;
	};

	return {
		isMobile: computed(() => isMobile.value)
	};
}
