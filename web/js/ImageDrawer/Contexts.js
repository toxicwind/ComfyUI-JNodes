import { $el } from "/scripts/ui.js";
import { api } from "/scripts/api.js";

import * as ExtraNetworks from "./ExtraNetworks.js";
import * as ImageElements from "./ImageElements.js";
import * as Sorting from "./Sorting.js";
import { getCurrentContextName } from "./ContextSelector.js";
import {
	getImageListChildren, replaceImageListChildren, clearImageListChildren,
	addElementToImageList, setImageListScrollLevel, setSearchTextAndExecute,
	clearAndHandleSearch, setColumnCount, setDrawerSize, setContextToolbarWidget
} from "./imageDrawer.js"

import { decodeReadableStream, sleep, checkIfAllImagesAreComplete } from "../common/utils.js"

let Contexts;

export function initializeContexts() {
	if (!Contexts) {
		Contexts = {
			feed: new ContextFeed(),
			temp: new ContextTemp(),
			input: new ContextInput(),
			output: new ContextOutput(),
			lora: new ContextLora(),
			embeddings: new ContextEmbeddings(),
			savedPrompts: new ContextSavedPrompts(),
			//			metadata: new ContextMetadataReader(),
			//			compare: new ContextCompare(),
		};
	}
};

export function getContexts() {
	return Contexts;
}

export function getContextObjectFromName(contextName) {
	const contextValues = Object.values(Contexts);

	let foundContext;

	for (const context of contextValues) {
		if (context.name == contextName) {
			foundContext = context;
			break;
		}
	}

	if (foundContext) {
		return foundContext;
	} else {
		console.error(`ImageDrawerContext with name '${contextName}' not found.`);
		return null;
	}
}

export class ImageDrawerContextCache {
	constructor(scrollLevel, searchBarText, columnCount, drawerSize, childElements, sortType) {
		this.scrollLevel = scrollLevel;
		this.searchBarText = searchBarText;
		this.columnCount = columnCount;
		this.drawerSize = drawerSize;
		this.childElements = childElements;
		this.sortType = sortType;
	}
};

class ImageDrawerContext {
	constructor(name, description) {
		this.name = name;
		this.description = description;
		this.cache = null;
	}

	hasCache() {
		return this.cache != null;
	}

	setCache(newCache) {
		if (!(newCache instanceof ImageDrawerContextCache)) {
			console.error("Invalid cache type. Expected ImageDrawerContextCache.");
			return;
		}
		this.cache = newCache;
	}

	reverseItemsInCache() {
		if (this.cache && this.cache.childElements.length > 1) {
			this.cache.childElements.reverse();
		}
	}

	async switchToContext(bSkipRestore = false) {
		const bSuccessfulRestore = bSkipRestore || await this.checkAndRestoreContextCache();
		if (!bSuccessfulRestore) {
			clearAndHandleSearch(); // Reset search if no cache
		}

		setContextToolbarWidget(await this.makeToolbar());

		return bSuccessfulRestore;
	}

	async makeToolbar() {
		return $el("div", { //Inner container so it can maintain 'flex' display attribute
			style: {
				alignItems: 'center',
				display: 'flex',
				gap: '.5rem',
				flex: '0 1 fit-content',
				justifyContent: 'flex-end',
			}
		});
	}

	async checkAndRestoreContextCache() {
		if (this.hasCache()) {
			if (this.cache.childElements.length > 0) {
				// Replace children
				replaceImageListChildren(this.cache.childElements);
				// Execute Search
				setSearchTextAndExecute(this.cache.searchBarText);
				// Drawer column count and size
				setColumnCount(this.cache.columnCount);
				setDrawerSize(this.cache.drawerSize);
				// Restore sort type
				Sorting.setOptionSelectedFromOptionName(this.cache.sortType);
				// Restore scroll level
				setImageListScrollLevel(this.cache.scrollLevel);

				return true;
			}
		}
		return false;
	}

	getSupportedSortTypes() {
		return [Sorting.SortTypeFriendlyName, Sorting.SortTypeFilename, Sorting.SortTypeDate];
	}

	getDesiredSortType() {
		return this.cache?.sortType || this.getDefaultSortType();
	}

	getDefaultSortType() {
		return { type: Sorting.SortTypeFriendlyName, bIsAscending: true };
	}
}

class ContextClearable extends ImageDrawerContext {
	async onClearClicked() { }

	async makeToolbar() {
		// Remove all images from the list
		let clearButton = $el("button.JNodes-image-drawer-btn", {
			textContent: "Clear",
			onclick: async () => {
				await this.onClearClicked();
			},
			style: {
				width: "fit-content",
				padding: '3px',
			},
		});

		const finalWidget = await super.makeToolbar();

		finalWidget.appendChild(clearButton);

		return finalWidget;
	}
}

class ContextRefreshable extends ImageDrawerContext {

	async onRefreshClicked() {
		Sorting.sortWithCurrentType();
	}

	async makeToolbar() {
		// Refresh button
		let refreshButton = $el("button.JNodes-image-drawer-btn", {
			textContent: "Refresh",
			onclick: async () => {
				await this.onRefreshClicked();
			},
			style: {
				width: "fit-content",
				padding: '3px',
			},
		});

		const finalWidget = await super.makeToolbar();

		finalWidget.appendChild(refreshButton);

		return finalWidget;
	}
}

class ContextModel extends ContextRefreshable {
	constructor(name, description, type) {
		super(name, description);
		this.type = type;
	}

	async getModels(bForceRefresh = false) { }

	async loadModels(bForceRefresh = false) {
		clearImageListChildren();
		await addElementToImageList($el("label", { textContent: `Loading ${this.name}...` }));
		let modelDicts = await this.getModels(bForceRefresh);
		clearImageListChildren(); // Remove loading indicator
		//console.log("modelDicts: " + JSON.stringify(loraDicts));
		const modelKeys = Object.keys(modelDicts);
		if (modelKeys.length > 0) {
			let count = 0;
			let maxCount = 0;
			for (const modelKey of modelKeys) {
				if (maxCount > 0 && count > maxCount) { break; }
				let element = await ExtraNetworks.createExtraNetworkCard(modelKey, modelDicts[modelKey], this.type);
				if (element == undefined) {
					console.log("Attempting to add undefined element for model named: " + modelKey + " with dict: " + JSON.stringify(modelDicts[modelKey]));
				}
				await addElementToImageList(element);
				count++;
			}
		}
		else {
			await addElementToImageList($el("label", { textContent: "No models were found." }));
		}
	}

	async switchToContext() {
		if (!await super.switchToContext()) {
			await this.loadModels();
		}
	}

	async onRefreshClicked() {
		await this.loadModels(true);
		super.onRefreshClicked();
	}
}

class ContextSubFolderExplorer extends ContextRefreshable {
	constructor(name, description, folderName) {
		super(name, description);
		this.folderName = folderName;
	}

	async loadFolder() {
		clearImageListChildren();
		await addElementToImageList($el("label", { textContent: `Loading ${this.folderName} folder...` }));
		const allItems = await api.fetchApi(`/jnodes_comfyui_subfolder_items?subfolder=${this.folderName}`);

		// Decode into a string
		const decodedString = await decodeReadableStream(allItems.body);

		const asJson = JSON.parse(decodedString);

		clearImageListChildren(); // Remove loading indicator
		//for (const folder of allOutputItems) {
		//if (!folder.files) { continue; }
		if (asJson.files.length > 0) {
			for (const file of asJson.files) {
				let element = await ImageElements.createImageElementFromImgSrc(
					{ filename: file.item, type: this.folderName, subfolder: asJson.folder_path, file_age: file.file_age });
				if (element == undefined) { console.log(`Attempting to add undefined image element in ${this.name}`); }
				await addElementToImageList(element);
			}
		}
	}

	async switchToContext() {
		if (!await super.switchToContext()) {
			await this.loadFolder();
		}
	}

	async onRefreshClicked() {
		await this.loadFolder();
		super.onRefreshClicked();
	}
}

export class ContextFeed extends ContextClearable {
	constructor() {
		super("Feed", "The latest generations from this web session (cleared on page refresh)");

		this.feedImages = [];

		// Automatically update feed if it's the active context
		api.addEventListener("executed", async ({ detail }) => {
			const outImages = detail?.output?.images;
			if (outImages) {
				for (const src of outImages) {
					// Always add feed images to the record, but only add thumbs to the imageList if
					// we're currently in feed mode. Otherwise they'll be added when switching to feed.
					src.file_age = Date.now(); // Get time of creation since the last epoch, in milliseconds. For sorting.
					this.feedImages.push(src);
				}

				if (getCurrentContextName() == this.name) {
					await this.addNewUncachedFeedImages();
				}
			}
		});
	}

	async addNewUncachedFeedImages() {
		const imageListLength = getImageListChildren().length;
		if (imageListLength < this.feedImages.length) {
			let newImages = [];
			for (let imageIndex = imageListLength; imageIndex < this.feedImages.length; imageIndex++) {
				let src = this.feedImages[imageIndex];
				let element = await ImageElements.createImageElementFromImgSrc(src);
				if (element == undefined) { console.log(`Attempting to add undefined image element in ${this.name}`); }
				await addElementToImageList(element);
				newImages.push(element);
			}

			async function waitForImageCompletion() {
				let bAreAllImagesComplete = false;
				while (!bAreAllImagesComplete) {
					bAreAllImagesComplete = checkIfAllImagesAreComplete(newImages);
					if (!bAreAllImagesComplete) {
						await sleep(1); // Introduce a 1ms delay using asynchronous sleep
					}
				}
			}

			await waitForImageCompletion();
			Sorting.sortWithCurrentType();

		}
	}

	async switchToContext() {
		if (!await super.switchToContext()) {
			clearImageListChildren();
		}

		await this.addNewUncachedFeedImages();
	}

	async onClearClicked() {
		clearImageListChildren();
		this.feedImages = [];
	}

	getDefaultSortType() {
		return { type: Sorting.SortTypeDate, bIsAscending: false };
	}
}

export class ContextTemp extends ContextRefreshable {
	constructor() {
		super("Temp / History", "The generations you've created since the last comfyUI server restart");
	}

	async loadHistory() {
		clearImageListChildren();
		await addElementToImageList($el("label", { textContent: "Loading history..." }));
		const allHistory = await api.getHistory(100000)
		clearImageListChildren(); // Remove loading indicator
		for (const history of allHistory.History) {
			if (!history.outputs) { continue; }

			const keys = Object.keys(history.outputs);
			if (keys.length > 0) {
				for (const key of keys) {
					//							console.debug(key)
					if (!history.outputs[key].images) { continue; }
					for (const src of history.outputs[key].images) {
						//									console.debug(im)
						let element = await ImageElements.createImageElementFromImgSrc(src);
						if (element == undefined) { console.log(`Attempting to add undefined image element in ${this.name}`); }
						await addElementToImageList(element);
					}
				}
			}
		}
	}

	async switchToContext() {
		if (!await super.switchToContext()) {
			await this.loadHistory();
		}
	}

	async onRefreshClicked() {
		await this.loadHistory();
		super.onRefreshClicked();
	}

	getDefaultSortType() {
		return { type: Sorting.SortTypeDate, bIsAscending: false };
	}
}

export class ContextInput extends ContextSubFolderExplorer {
	constructor() {
		super("Input", "Images and videos found in your input folder", "input");
	}
}

export class ContextOutput extends ContextSubFolderExplorer {
	constructor() {
		super("Output", "Images and videos found in your output folder", "output");
	}
}

export class ContextLora extends ContextModel {
	constructor() {
		super("Lora / Lycoris", "Lora and Lycoris models found in your Lora directory", "loras");
	}

	async getModels(bForceRefresh = false) {
		return await ExtraNetworks.getLoras(bForceRefresh);
	}
}

export class ContextEmbeddings extends ContextModel {
	constructor() {
		super("Embeddings / Textual Inversions", "Embedding/textual inversion models found in your embeddings directory", "embeddings");
	}

	async getModels(bForceRefresh = false) {
		return await ExtraNetworks.getEmbeddings(bForceRefresh);
	}
}

export class ContextSavedPrompts extends ContextSubFolderExplorer {
	constructor() {
		super(
			"Saved Prompts",
			"Images and videos found in the JNodes/saved_prompts folder and its subfolders. Title comes from filename",
			"JNodes/saved_prompts");
	}
}

export class ContextMetadataReader extends ImageDrawerContext {
	constructor() {
		super("Metadata Reader", "Read and display metadata from a generation");
	}

	getSupportedSortNames() {
		return [];
	}
}

export class ContextCompare extends ContextClearable {
	constructor() {
		super("Compare", "Compare generations sent to this context via menu. Does not persist on refresh.");
	}

	async switchToContext() {
		if (!await super.switchToContext()) {
			clearImageListChildren();
		}

		//await this.addNewUncachedFeedImages();
	}

	async onClearClicked() {
	}

	getSupportedSortNames() {
		return [];
	}
}
