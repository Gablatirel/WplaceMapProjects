<template>
	<Dialog
		modal
		dismissable-mask
		:draggable="false"
		:visible="isOpen"
		:style="{
			width: '50rem',
			maxWidth: '100svw',
			height: 'calc(100svh - 4rem)',
		}"
		:breakpoints="{
			'500px': 'calc(100svw - 4rem)',
			'640px': '90svw',
		}"
		@update:visible="handleClose"
	>
		<template #header>
			<div class="store-header">
				<h2 class="dialog-title">Store</h2>

				<div
					class="droplet-count"
					:aria-label="`${userProfile?.droplets?.toLocaleString()} droplets`"
				>
					<span class="droplet-icon">
						<Icon name="droplet" />
					</span>
					<span class="droplet-amount">{{ userProfile?.droplets?.toLocaleString() }}</span>
				</div>
			</div>
		</template>

		<Tabs :value="tab">
			<TabList>
				<Tab :value="StoreTab.Charges">Charges</Tab>
				<Tab :value="StoreTab.Flags">Flags</Tab>
				<Tab :value="StoreTab.Colors">Colors</Tab>
			</TabList>

			<TabPanels>
				<TabPanel :value="StoreTab.Charges">
					<div class="store-items-grid">
						<StoreItem
							v-model="maxChargesQuantity"
							title="Max Charges"
							subtitle="Increase your limit of paint charges by 5"
							icon="charge"
							:cost="MAX_CHARGES_COST"
							:user-droplets="userProfile?.droplets ?? 0"
							:loading="purchasing"
							@purchase="purchaseMaxCharges"
						/>

						<StoreItem
							v-model="paintChargesQuantity"
							title="Paint Charges"
							subtitle="Instantly get 30 paint charges"
							icon="paint"
							:cost="PAINT_CHARGES_COST"
							:user-droplets="userProfile?.droplets ?? 0"
							:loading="purchasing"
							@purchase="purchasePaintCharges"
						/>
					</div>

					<!--
					TODO
					<Card class="store-item store-item--disabled">
						<template #title>
							<Icon name="manage_accounts" />
							Profile Picture
						</template>
						<template #subtitle>
							Upload a custom profile picture
						</template>
						<template #content>
						</template>
					</Card>
					-->
				</TabPanel>

				<TabPanel :value="StoreTab.Flags">
					<Card class="store-item">
						<template #title>
							<div class="store-item-title">
								<Icon name="map_vector" />
								Flags
							</div>
						</template>

						<template #subtitle>
							<p>Equip a flag to your profile to represent your country. When painting in a country where you have purchased a flag, you will receive a 10% refund on charges spent.</p>
							<p>You can only equip one flag at a time, but the refund benefit applies for all purchased flags.</p>
						</template>

						<template #content>
							<div v-if="!loading" class="flags-grid">
								<div
									v-for="country in sortedCountries"
									:key="country.id"
									class="flag-item"
								>
									<div class="flag-item-emoji">
										<FlagIcon :code="country.code" />
									</div>
									<div class="flag-item-name">{{ country.name }}</div>

									<div class="flag-item-actions">
										<Button
											v-if="isFlagOwned(country.id)"
											:label="isFlagEquipped(country.id) ? 'Unequip' : 'Equip'"
											:severity="isFlagEquipped(country.id) ? 'secondary' : 'primary'"
											:outlined="isFlagEquipped(country.id)"
											size="small"
											rounded
											class="flag-item-equip"
											:disabled="purchasing"
											@click="toggleFlagEquipped(country.id)"
										/>

										<BuyButton
											v-else
											:cost="FLAG_COST"
											size="small"
											:disabled="(userProfile?.droplets ?? 0) < FLAG_COST || purchasing"
											@click="purchaseFlag(country.id)"
										/>
									</div>
								</div>
							</div>
						</template>
					</Card>
				</TabPanel>

				<TabPanel :value="StoreTab.Colors">
					<Card class="store-item">
						<template #title>
							<div class="store-item-title">
								<Icon name="palette" />
								Colors
							</div>
						</template>

						<template #subtitle>
							<p>Unlock more colors to paint with.</p>
						</template>

						<template #content>
							<div v-if="!loading" class="colors-grid">
								<div
									v-for="color in paletteItems"
									:key="color.index"
									class="color-item"
								>
									<div class="color-item-color">
										<div
											class="color-swatch"
											:style="{ backgroundColor: color.cssValue }"
										/>
									</div>

									<div class="color-item-name">{{ color.name }}</div>

									<div class="color-item-actions">
										<Button
											v-if="color.isUnlocked"
											severity="secondary"
											outlined
											size="small"
											rounded
											class="color-item-purchased"
											disabled
										>
											Purchased
										</Button>

										<BuyButton
											v-else
											:cost="COLOR_COST"
											size="small"
											:disabled="(userProfile?.droplets ?? 0) < COLOR_COST || purchasing"
											@click="purchaseColor(color.index)"
										/>
									</div>
								</div>
							</div>
						</template>
					</Card>
				</TabPanel>
			</TabPanels>
		</Tabs>
	</Dialog>
</template>

<script setup lang="ts">
import Dialog from "primevue/dialog";
import Card from "primevue/card";
import Button from "primevue/button";
import { WplaceBitMap } from "../../../src/utils/bitmap";
import { COUNTRIES } from "../../../src/utils/country";
import BuyButton from "./store/BuyButton.vue";
import { isColorUnlocked, PAID_PALETTE_INDEX, palette, type PaletteColor } from "~/utils/palette";

interface PaletteItem extends PaletteColor {
	cssValue: string;
	isUnlocked: boolean;
}

const props = defineProps<{
	isOpen: boolean;
	userProfile: UserProfile | null;
	initialTab?: StoreTab | null;
}>();

const emit = defineEmits<{
	close: [];
	refresh: [];
}>();

const config = useRuntimeConfig();
const { showToast, handleError } = useErrorToast();

const MAX_CHARGES_PRODUCT = 70;
const PAINT_CHARGES_PRODUCT = 80;
const COLOR_PRODUCT = 100;
const FLAG_PRODUCT = 110;
// const PROFILE_PICTURE_PRODUCT = 120;

const MAX_CHARGES_COST = 500;
const PAINT_CHARGES_COST = 500;
const FLAG_COST = 20_000;
const COLOR_COST = 2000;
// const PROFILE_PICTURE_COST = 20_000;

const tab = ref<StoreTab>(props.initialTab ?? StoreTab.Charges);

const sortedCountries = COUNTRIES
	.sort((a, b) => a.name.localeCompare(b.name));

const maxChargesQuantity = ref(1);
const paintChargesQuantity = ref(1);
const purchasing = ref(false);
const loading = ref(false);

const flagsBitmap = ref<WplaceBitMap | null>(null);

const paletteItems = computed(() => palette
	.filter(item => item.index >= PAID_PALETTE_INDEX)
	.map((item): PaletteItem => ({
		...item,
		cssValue: `rgba(${item.rgba.join(",")})`,
		isUnlocked: isColorUnlocked(item.index, props.userProfile?.extraColorsBitmap ?? 0)
	})));

watch(() => props.userProfile, profile => {
	flagsBitmap.value = null;

	if (profile?.flagsBitmap) {
		try {
			flagsBitmap.value = WplaceBitMap.fromBase64(profile.flagsBitmap);
		} catch {
			// Ignore
		}
	}
});

const isFlagOwned = (flagId: number): boolean => flagsBitmap.value?.get(flagId) ?? false;
const isFlagEquipped = (flagId: number): boolean => props.userProfile?.equippedFlag === flagId;

const purchase = async (product: { id: number; amount: number; variant?: number; }, successMessage: string) => {
	purchasing.value = true;
	try {
		await $fetch(`${config.public.backendUrl}/purchase`, {
			method: "POST",
			credentials: "include",
			body: {
				product
			}
		});
		maxChargesQuantity.value = 1;
		emit("refresh");

		showToast({
			severity: "success",
			summary: successMessage
		});
	} catch (error) {
		handleError(error);
	}
	purchasing.value = false;
};

const purchaseMaxCharges = async () => await purchase(
	{
		id: MAX_CHARGES_PRODUCT,
		amount: maxChargesQuantity.value
	},
	`Purchased ${maxChargesQuantity.value * 5} max charges`
);

const purchasePaintCharges = async () => await purchase(
	{
		id: PAINT_CHARGES_PRODUCT,
		amount: paintChargesQuantity.value
	},
	`Purchased ${paintChargesQuantity.value * 5} max charges`
);

const purchaseFlag = async (flagId: number) => await purchase(
	{
		id: FLAG_PRODUCT,
		amount: 1,
		variant: flagId
	},
	"Purchased flag"
);

const purchaseColor = async (color: number) => await purchase(
	{
		id: COLOR_PRODUCT,
		amount: 1,
		variant: color
	},
	"Purchased color"
);

const toggleFlagEquipped = async (flagId: number) => {
	purchasing.value = true;
	try {
		const state = !isFlagEquipped(flagId);
		await $fetch(`${config.public.backendUrl}/flag/equip/${state ? flagId : 0}`, {
			method: "POST",
			credentials: "include"
		});

		showToast({
			severity: "success",
			summary: state ? "Flag equipped" : "Flag unequipped"
		});

		emit("refresh");
	} catch (error) {
		handleError(error);
	}
	purchasing.value = false;
};

const handleClose = () => emit("close");

const selectTab = (newTab: StoreTab) => {
	tab.value = newTab;
};

defineExpose({
	selectTab
});
</script>

<script lang="ts">
export enum StoreTab {
	Charges = "charges",
	Flags = "flags",
	Colors = "colors"
}
</script>

<style scoped>
.store-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	width: 100%;
}

.dialog-title {
	margin: 0;
	font-size: inherit;
}

.store-item {
	/* Work around shadow being cut off */
	margin-top: 2px;
}

.store-item-title {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.store-item-title :deep(.icon-wrapper) {
	font-size: 1.5rem;
}

.droplet-count {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin-right: 0.75rem;
}

.droplet-icon {
	font-size: 1.5rem;
	line-height: 0;
}

.store-items-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	gap: 1rem;
	margin-bottom: 1rem;
}

.flags-grid,
.colors-grid {
	--item-width: 150px;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(var(--item-width), 1fr));
	grid-auto-rows: 1fr;
	gap: 2.5rem 2rem;
	margin: 1.5rem 0;
}

.colors-grid {
	--item-width: 90px;
}

.flag-item,
.color-item {
	display: grid;
	grid-template-rows: auto 1fr auto;
	gap: 0.25rem;
	width: 100%;
	flex: 1;
	text-align: center;
}

.flag-item-emoji,
.color-item-color {
	font-size: 5rem;
	line-height: 1em;
}

.flag-item-name,
.color-item-name {
	min-height: 2.5em;
	display: flex;
	align-items: center;
	justify-content: center;
}

.flag-item-actions,
.color-item-actions {
	width: 100%;
	display: flex;
	justify-content: center;
	align-items: center;
}

.flag-item-equip,
.color-item-purchased {
	min-width: 6rem;
}

.color-swatch {
	--border-color: var(--p-gray-300);
	width: 0.75em;
	height: 0.75em;
	margin-inline: auto;
	padding: 0;
	border: 1px solid var(--border-color);
	border-radius: 6px;
}

.app-dark .color-swatch {
	--border-color: var(--p-gray-600);
}
</style>
