// main.ts
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } from 'obsidian';

interface YAMLPropertyManagerSettings {
	templatePaths: TemplatePath[]; // Replace defaultTemplateFilePath
	recentTemplates: string[];
	maxRecentTemplates: number;
}

// New interface for template paths
interface TemplatePath {
	type: 'file' | 'directory';
	path: string;
	includeSubdirectories: boolean; // Only relevant for directories
}

// Interface to represent the template hierarchy
interface TemplateNode {
    type: 'folder' | 'file';
    name: string;
    path: string;
    children: TemplateNode[];
    file?: TFile; // Only present for files
}


// Property types available in Obsidian
const PROPERTY_TYPES = [
    { value: 'text', label: 'Text' },
    { value: 'list', label: 'List' },
    { value: 'number', label: 'Number' },
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'date', label: 'Date' },
    { value: 'datetime', label: 'Date & Time' }
];

	const DEFAULT_SETTINGS: YAMLPropertyManagerSettings = {
	templatePaths: [], // Replace defaultTemplateFilePath with empty array
	recentTemplates: [],
	maxRecentTemplates: 5
}

export default class YAMLPropertyManagerPlugin extends Plugin {
	settings: YAMLPropertyManagerSettings;
	selectedFiles: TFile[] = []; // Added central file selection storage

	async onload() {
		await this.loadSettings();

		// Add command to open the property manager
		this.addCommand({
			id: 'open-property-manager',
			name: 'Open Property Manager',
			callback: () => {
				new PropertyManagerModal(this.app, this).open();
			}
		});

		// Add command to manage properties of current file
		this.addCommand({
			id: 'manage-current-file-properties',
			name: 'Manage Current File Properties',
			checkCallback: (checking: boolean) => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					if (!checking) {
						new SingleFilePropertyModal(this.app, this, activeView.file).open();
					}
					return true;
				}
				return false;
			}
		});

		// Add command to apply template to current file
		this.addCommand({
			id: 'apply-template-to-current-file',
			name: 'Apply Template to Current File',
			checkCallback: (checking: boolean) => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					if (!checking) {
						new TemplateSelectionModal(this.app, this, [activeView.file]).open();
					}
					return true;
				}
				return false;
			}
		});

		// Add settings tab
		this.addSettingTab(new YAMLPropertyManagerSettingTab(this.app, this));
	}

	onunload() {
		// Clean up plugin resources
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
		
		// Migrate from old format if needed
		if (loadedData && 'defaultTemplateFilePath' in loadedData && 
			loadedData.defaultTemplateFilePath && 
			!('templatePaths' in loadedData)) {
			
			this.settings.templatePaths = [{
				type: 'file',
				path: loadedData.defaultTemplateFilePath,
				includeSubdirectories: false
			}];
			
			// Remove old property
			delete (this.settings as any).defaultTemplateFilePath;
			
			// Save migrated settings
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Add template to recent templates list
	addToRecentTemplates(templatePath: string) {
		// Remove if already exists
		this.settings.recentTemplates = this.settings.recentTemplates.filter(path => path !== templatePath);
		
		// Add to the beginning
		this.settings.recentTemplates.unshift(templatePath);
		
		// Trim to max size
		if (this.settings.recentTemplates.length > this.settings.maxRecentTemplates) {
			this.settings.recentTemplates = this.settings.recentTemplates.slice(0, this.settings.maxRecentTemplates);
		}
		
		this.saveSettings();
	}

	// Get all template files based on configuration
	async getAllTemplateFiles(): Promise<TFile[]> {
		const templates: TFile[] = [];
		const processedPaths = new Set<string>(); // To avoid duplicates
		
		for (const templatePath of this.settings.templatePaths) {
			if (templatePath.type === 'file') {
				// Handle individual file
				const file = this.app.vault.getAbstractFileByPath(templatePath.path);
				if (file instanceof TFile && file.extension === 'md' && !processedPaths.has(file.path)) {
					templates.push(file);
					processedPaths.add(file.path);
				}
			} else {
				// Handle directory
				const folder = this.app.vault.getAbstractFileByPath(templatePath.path);
				if (folder && folder instanceof TFolder) {
					const filesInFolder = await this.getTemplateFilesFromFolder(
						folder, 
						templatePath.includeSubdirectories, // Fix indentation here
						processedPaths
					); // Fix closing parenthesis here
					templates.push(...filesInFolder);
				}
		}
	}
	
	return templates;
}

// Recursively get template files from a folder
async getTemplateFilesFromFolder(
	folder: TFolder, 
	includeSubfolders: boolean, 
	processedPaths: Set<string>
): Promise<TFile[]> {
	const templates: TFile[] = [];
	
	for (const child of folder.children) {
		if (child instanceof TFile && child.extension === 'md' && !processedPaths.has(child.path)) {
			templates.push(child);
			processedPaths.add(child.path);
		} else if (includeSubfolders && child instanceof TFolder) {
			const subfolderTemplates = await this.getTemplateFilesFromFolder(
				child, 
				includeSubfolders,
				processedPaths
			);
			templates.push(...subfolderTemplates);
		}
	}
	
	return templates;
}

	// Property utility functions
	
	// Parse YAML frontmatter from a file
	async parseFileProperties(file: TFile): Promise<Record<string, any>> {
		const content = await this.app.vault.read(file);
		const properties = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
		return properties;
	}

	// Apply properties to a file
	async applyProperties(file: TFile, properties: Record<string, any>, preserveExisting: boolean = false) {
		try {
			// Read the file content
			const content = await this.app.vault.read(file);
			
			// Check if file already has frontmatter
			const hasFrontMatter = content.startsWith('---\n');
			
			let newContent = '';
			let fileContent = content;
			
			// If preserving existing properties, merge with existing ones
			if (preserveExisting && hasFrontMatter) {
				const existingProperties = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
				properties = { ...existingProperties, ...properties };
			}
			
			// Format properties as YAML
			const yamlProperties = Object.entries(properties)
				.map(([key, value]) => `${key}: ${formatYamlValue(value)}`)
				.join('\n');
			
			// Generate new content with properties
			if (hasFrontMatter) {
				// Replace existing frontmatter
				const endOfFrontMatter = content.indexOf('---\n', 4) + 4;
				fileContent = content.substring(endOfFrontMatter);
				newContent = `---\n${yamlProperties}\n---\n${fileContent}`;
			} else {
				// Add new frontmatter
				newContent = `---\n${yamlProperties}\n---\n\n${content}`;
			}
			
			// Write the new content
			await this.app.vault.modify(file, newContent);
			
			return true;
		} catch (error) {
			console.error('Error applying properties:', error);
			new Notice(`Error applying properties to ${file.name}: ${error.message}`);
			return false;
		}
	}

	// Apply template properties to multiple files
	async applyTemplateToFiles(templateFile: TFile, targetFiles: TFile[], 
		propertiesToApply: string[], consistentProperties: string[]) {
		
		try {
			// Get template properties
			const templateProperties = await this.parseFileProperties(templateFile);
			
			// Filter to only include specified properties
			const filteredProperties: Record<string, any> = {};
			for (const key of propertiesToApply) {
				if (key in templateProperties) {
					filteredProperties[key] = templateProperties[key];
				}
			}
			
			// Apply to each target file
			let successCount = 0;
			for (const file of targetFiles) {
				// Skip the template file itself if it's in the target list
				if (file.path === templateFile.path) continue;
				
				// Create a copy of filtered properties
				const propertiesToApplyToFile = { ...filteredProperties };
				
				// For non-consistent properties, don't override existing values
				if (consistentProperties.length < propertiesToApply.length) {
					const nonConsistentProps = propertiesToApply.filter(p => !consistentProperties.includes(p));
					const existingProperties = await this.parseFileProperties(file);
					
					for (const prop of nonConsistentProps) {
						if (prop in existingProperties) {
							propertiesToApplyToFile[prop] = existingProperties[prop];
						}
					}
				}
				
				// Apply the properties
				const success = await this.applyProperties(file, propertiesToApplyToFile, false);
				if (success) successCount++;
			}
			
			new Notice(`Applied template to ${successCount} of ${targetFiles.length} files`);
			return successCount;
		} catch (error) {
			console.error('Error applying template:', error);
			new Notice(`Error applying template: ${error.message}`);
			return 0;
		}
	}
	
	// Debug logging helper
	public debug(message: string, ...data: any[]) {
		console.log(`[YAML Property Manager] ${message}`, ...data);
	}
	
	// Navigation method to move between modals - UPDATED VERSION
	navigateToModal(currentModal: Modal, targetModalType: string, ...args: any[]) {
		// Close current modal
		currentModal.close();
		
		// Handle special case for file selection
		if (targetModalType === 'bulkEdit') {
			// If files are explicitly provided, use them
			if (Array.isArray(args[0]) && args[0].length > 0) {
				this.debug(`Navigating to bulk edit with ${args[0].length} explicitly provided files`);
				this.selectedFiles = args[0];
			}
			
			// Check if we have files selected
			if (this.selectedFiles.length === 0) {
				this.debug('No files selected for bulk edit');
				new Notice('Please select files first');
				new PropertyManagerModal(this.app, this).open();
				return;
			}
			
			this.debug(`Opening bulk edit with ${this.selectedFiles.length} files`);
			new BulkPropertyEditorModal(this.app, this, [...this.selectedFiles]).open();
			return;
		}
		
		// Handle other modal types
		switch (targetModalType) {
			case 'main':
				new PropertyManagerModal(this.app, this).open();
				break;
			case 'singleFile':
				if (args[0] instanceof TFile) {
					new SingleFilePropertyModal(this.app, this, args[0]).open();
				}
				break;
			case 'template':
				if (this.selectedFiles.length === 0 && Array.isArray(args[0]) && args[0].length > 0) {
					this.selectedFiles = args[0];
				}
				
				if (this.selectedFiles.length > 0) {
					new TemplateSelectionModal(this.app, this, [...this.selectedFiles]).open();
				} else {
					new Notice('Please select files first');
					new PropertyManagerModal(this.app, this).open();
				}
				break;
			case 'batchSelect':
				if (typeof args[0] === 'function') {
					new BatchFileSelectorModal(this.app, (files: TFile[]) => {
						if (files && files.length > 0) {
							this.debug(`Batch selection returned ${files.length} files`);
							this.selectedFiles = [...files];
							args[0](files);
						}
					}).open();
				}
				break;
		}
	}
}

// Helper function to format values for YAML
function formatYamlValue(value: any): string {
	if (value === null || value === undefined) {
		return 'null';
	}
	
	if (typeof value === 'string') {
		// Check if string needs quotes (contains special characters)
		if (value.includes('\n') || value.includes('"') || value.includes("'") || 
			value.includes(':') || value.includes('#') || value.trim() !== value) {
			// Use multi-line format for multi-line strings
			if (value.includes('\n')) {
				return `|\n  ${value.replace(/\n/g, '\n  ')}`;
			}
			// Use quotes for other special strings
			return `"${value.replace(/"/g, '\\"')}"`;
		}
		return value;
	}
	
	if (Array.isArray(value)) {
		// Format as YAML array
		return `[${value.map(item => formatYamlValue(item)).join(', ')}]`;
	}
	
	if (typeof value === 'object') {
		// Convert to nested YAML format
		return `\n  ${Object.entries(value)
			.map(([k, v]) => `${k}: ${formatYamlValue(v).replace(/\n/g, '\n  ')}`)
			.join('\n  ')}`;
	}
	
	// For booleans, numbers, etc.
	return String(value);
}

// Modal for managing properties of a single file
class SingleFilePropertyModal extends Modal {
	plugin: YAMLPropertyManagerPlugin;
	file: TFile;
	properties: Record<string, any> = {};
	propertyOrderItems: HTMLElement[] = [];

	constructor(app: App, plugin: YAMLPropertyManagerPlugin, file: TFile) {
		super(app);
		this.plugin = plugin;
		this.file = file;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('yaml-property-manager-modal');
		contentEl.addClass('single-file-property-modal');
		
		// Set proper scrolling and width
		this.modalEl.style.width = '95%';
		this.modalEl.style.maxWidth = '900px';
		this.modalEl.style.maxHeight = '85vh'; 
		this.modalEl.style.overflowY = 'auto';
		
		// Add header with back button
		const headerContainer = contentEl.createDiv({ cls: 'modal-header' });
		headerContainer.style.display = 'flex';
		headerContainer.style.alignItems = 'center';
		headerContainer.style.marginBottom = '15px';
		
		const backButton = headerContainer.createEl('button', { text: '← Back' });
		backButton.style.marginRight = '10px';
		backButton.addEventListener('click', () => {
			this.plugin.navigateToModal(this, 'main');
		});
		
		headerContainer.createEl('h2', { text: `Edit Properties: ${this.file.name}` });
		
		// Load existing properties
		this.properties = await this.plugin.parseFileProperties(this.file);
		
		// Create property editor with width control
		const propertyContainer = contentEl.createDiv({ cls: 'property-container' });
		propertyContainer.style.width = '100%';
		propertyContainer.style.maxHeight = 'none'; // Allow full height
		propertyContainer.style.overflow = 'visible'; // No internal scrolling
		
		// Display existing properties
		this.renderPropertyEditor(propertyContainer);
		
		// Add buttons - make sticky
		const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
		buttonContainer.style.position = 'sticky';
		buttonContainer.style.bottom = '0';
		buttonContainer.style.backgroundColor = 'var(--background-primary)';
		buttonContainer.style.padding = '10px 0';
		buttonContainer.style.zIndex = '10';
		
		// Add property button
		const addPropertyButton = buttonContainer.createEl('button', { text: 'Add Property' });
		addPropertyButton.style.width = 'auto';
		addPropertyButton.style.boxSizing = 'border-box';
		
		addPropertyButton.addEventListener('click', () => {
			// Show input for new property name
			const newPropertyContainer = propertyContainer.createDiv({ cls: 'new-property-container' });
			newPropertyContainer.style.display = 'flex';
			newPropertyContainer.style.flexWrap = 'wrap';
			newPropertyContainer.style.gap = '10px';
			newPropertyContainer.style.width = '100%';
			
			const nameInput = newPropertyContainer.createEl('input', { 
				attr: { placeholder: 'Property name' } 
			});
			nameInput.style.flex = '1';
			nameInput.style.minWidth = '100px';
			
			// Property type selector
			const typeSelect = newPropertyContainer.createEl('select');
			typeSelect.style.width = '120px';
			PROPERTY_TYPES.forEach(type => {
				typeSelect.createEl('option', {
					text: type.label,
					value: type.value
				});
			});
			
			const valueInput = newPropertyContainer.createEl('input', { 
				attr: { placeholder: 'Property value' } 
			});
			valueInput.style.flex = '2';
			valueInput.style.minWidth = '150px';
			
			const buttonsDiv = newPropertyContainer.createEl('div');
			buttonsDiv.style.display = 'flex';
			buttonsDiv.style.gap = '5px';
			
			const confirmButton = buttonsDiv.createEl('button', { text: 'Add' });
			confirmButton.addEventListener('click', () => {
				const name = nameInput.value.trim();
				let value: any = valueInput.value.trim();
				const type = typeSelect.value;
				
				// Convert value based on selected type
				switch (type) {
					case 'number':
						value = Number(value) || 0;
						break;
					case 'checkbox':
						value = value.toLowerCase() === 'true';
						break;
					case 'list':
						try {
							const parsed = JSON.parse(value);
							if (Array.isArray(parsed)) {
								value = parsed;
							} else {
								value = [value];
							}
						} catch {
							value = [value];
						}
						break;
				}
				
				if (name) {
					this.properties[name] = value;
					newPropertyContainer.remove();
					this.renderPropertyEditor(propertyContainer);
				}
			});
			
			const cancelButton = buttonsDiv.createEl('button', { text: 'Cancel' });
			cancelButton.addEventListener('click', () => {
				newPropertyContainer.remove();
			});
			
			nameInput.focus();
		});
		
		// Save button
		const saveButton = buttonContainer.createEl('button', { text: 'Save Changes' });
		saveButton.style.width = 'auto';
		saveButton.style.boxSizing = 'border-box';
		saveButton.addEventListener('click', async () => {
			const success = await this.plugin.applyProperties(this.file, this.properties, false);
			if (success) {
				new Notice('Properties saved successfully');
				this.plugin.navigateToModal(this, 'main');
			}
		});
		
		// Cancel button
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.style.width = 'auto';
		cancelButton.style.boxSizing = 'border-box';
		cancelButton.addEventListener('click', () => {
			this.plugin.navigateToModal(this, 'main');
		});
	}
	
	renderPropertyEditor(container: HTMLElement) {
		container.empty();
		this.propertyOrderItems = [];
		
		if (Object.keys(this.properties).length === 0) {
			container.createEl('p', { text: 'No properties found. Add a property to get started.' });
			return;
		}
		
		// Create list of properties with width control
		const propertyList = container.createEl('div', { cls: 'property-list' });
		propertyList.style.width = '100%';
		propertyList.style.display = 'block'; // Change from table to block
		
		// Headings as flex container
		const headerRow = propertyList.createEl('div', { cls: 'property-item header' });
		headerRow.style.display = 'flex';
		headerRow.style.width = '100%';
		headerRow.style.flexWrap = 'nowrap';
		
		const nameHeader = headerRow.createEl('div', { text: 'Name', cls: 'property-name' });
		nameHeader.style.flex = '1';
		nameHeader.style.minWidth = '100px';
		nameHeader.style.maxWidth = '200px';
		
		const typeHeader = headerRow.createEl('div', { text: 'Type', cls: 'property-type' });
		typeHeader.style.width = '120px';
		typeHeader.style.flexShrink = '0';
		
		const valueHeader = headerRow.createEl('div', { text: 'Value', cls: 'property-value' });
		valueHeader.style.flex = '2';
		valueHeader.style.minWidth = '150px';
		
		const actionsHeader = headerRow.createEl('div', { text: 'Actions', cls: 'property-actions' });
		actionsHeader.style.width = '100px';
		actionsHeader.style.flexShrink = '0';
		actionsHeader.style.textAlign = 'center';
		
		// Property items
		for (const [key, value] of Object.entries(this.properties)) {
			// Create item as flex container
			const item = propertyList.createEl('div', { cls: 'property-item' });
			item.style.display = 'flex';
			item.style.width = '100%';
			item.style.flexWrap = 'nowrap';
			item.style.alignItems = 'center';
			item.style.marginBottom = '5px';
			
			this.propertyOrderItems.push(item);
			
			// Property name
			const nameCell = item.createEl('div', { text: key, cls: 'property-name' });
			nameCell.style.flex = '1';
			nameCell.style.minWidth = '100px';
			nameCell.style.maxWidth = '200px';
			nameCell.style.overflow = 'hidden';
			nameCell.style.textOverflow = 'ellipsis';
			
			// Property type with fixed width
			const typeContainer = item.createEl('div', { cls: 'property-type' });
			typeContainer.style.width = '120px';
			typeContainer.style.flexShrink = '0';
			
			const typeSelect = typeContainer.createEl('select', { cls: 'property-type-select' });
			typeSelect.style.width = '100%';
			
			// Determine current type
			let currentType = 'text'; // Default
			if (typeof value === 'number') currentType = 'number';
			else if (typeof value === 'boolean') currentType = 'checkbox';
			else if (value instanceof Date) currentType = 'date';
			else if (Array.isArray(value)) currentType = 'list';
			
			// Add options for type
			PROPERTY_TYPES.forEach(type => {
				const option = typeSelect.createEl('option', {
					text: type.label,
					value: type.value
				});
				if (type.value === currentType) {
					option.selected = true;
				}
			});
			
			// Handle type change
			typeSelect.addEventListener('change', () => {
				const newType = typeSelect.value;
				let newValue = value;
				
				// Convert value based on type
				switch (newType) {
					case 'number':
						newValue = Number(value) || 0;
						break;
					case 'checkbox':
						newValue = Boolean(value);
						break;
					case 'date':
					case 'datetime':
						try {
							newValue = new Date(value).toISOString();
						} catch {
							newValue = new Date().toISOString();
						}
						break;
					case 'list':
						if (!Array.isArray(value)) {
							newValue = [String(value)];
						}
						break;
					default: // text
						newValue = String(value);
				}
				
				this.properties[key] = newValue;
				
				// Update the value input field to reflect the new type
				const valueInput = item.querySelector('.property-value-input') as HTMLInputElement;
				if (valueInput) {
					valueInput.value = formatInputValue(newValue);
				}
			});
			
			// Property value with flex growth
			const valueContainer = item.createEl('div', { cls: 'property-value' });
			valueContainer.style.flex = '2';
			valueContainer.style.minWidth = '150px';
			valueContainer.style.overflow = 'hidden';
			
			const valueInput = valueContainer.createEl('input', { 
				value: formatInputValue(value),
				cls: 'property-value-input'
			});
			valueInput.style.width = '100%';
			
			valueInput.addEventListener('change', () => {
				// Convert the input value according to the current type
				const selectedType = typeSelect.value;
				let parsedValue: any = valueInput.value;
				
				switch (selectedType) {
					case 'number':
						parsedValue = Number(valueInput.value) || 0;
						break;
					case 'checkbox':
						parsedValue = valueInput.value.toLowerCase() === 'true';
						break;
					case 'list':
						try {
							parsedValue = JSON.parse(valueInput.value);
							if (!Array.isArray(parsedValue)) {
								parsedValue = [valueInput.value];
							}
						} catch {
							parsedValue = [valueInput.value];
						}
						break;
				}
				
				this.properties[key] = parsedValue;
			});
			
			// Actions with fixed width
			const actionsContainer = item.createEl('div', { cls: 'property-actions' });
			actionsContainer.style.width = '100px';
			actionsContainer.style.flexShrink = '0';
			actionsContainer.style.textAlign = 'center';
			
			// Move up button
			const moveUpButton = actionsContainer.createEl('button', { text: '↑' });
			moveUpButton.addEventListener('click', () => {
				new Notice('Reordering properties will be available in a future update');
			});
			
			// Move down button
			const moveDownButton = actionsContainer.createEl('button', { text: '↓' });
			moveDownButton.addEventListener('click', () => {
				new Notice('Reordering properties will be available in a future update');
			});
			
			// Delete button
			const deleteButton = actionsContainer.createEl('button', { text: '🗑️' });
			deleteButton.addEventListener('click', () => {
				delete this.properties[key];
				this.renderPropertyEditor(container);
			});
		}
	}
}

// Updated Template Selection Modal

// Enhanced template selection modal with simplified hierarchical browsing
class TemplateSelectionModal extends Modal {
    plugin: YAMLPropertyManagerPlugin;
    targetFiles: TFile[];
    selectedTemplate: TFile | null = null;
    selectedProperties: string[] = [];
    consistentProperties: string[] = [];
    templateTree: TemplateNode = { type: 'folder', name: 'Root', path: '', children: [] };

    constructor(app: App, plugin: YAMLPropertyManagerPlugin, targetFiles: TFile[]) {
        super(app);
        this.plugin = plugin;
        this.targetFiles = targetFiles;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('yaml-property-manager-modal');
        contentEl.addClass('template-selection-modal');
        
        this.modalEl.style.width = '95%';
        this.modalEl.style.maxWidth = '900px';
        this.modalEl.style.maxHeight = '85vh';
        this.modalEl.style.overflowY = 'auto';
        
        // Add header with back button
        const headerContainer = contentEl.createDiv({ cls: 'modal-header' });
        headerContainer.style.display = 'flex';
        headerContainer.style.alignItems = 'center';
        headerContainer.style.marginBottom = '15px';
        
        const backButton = headerContainer.createEl('button', { text: '← Back' });
        backButton.style.marginRight = '10px';
        backButton.addEventListener('click', () => {
            // Open a new PropertyManagerModal
            const mainModal = new PropertyManagerModal(this.app, this.plugin);
            this.close();
            mainModal.open();
        });
        
        headerContainer.createEl('h2', { text: 'Select Template File' });
        
        // Loading templates indicator
        const loadingEl = contentEl.createDiv({ cls: 'templates-loading' });
        loadingEl.createEl('p', { text: 'Loading templates...' });
        loadingEl.createEl('div', { cls: 'spinner' });
        
        // Load templates asynchronously
        await this.buildTemplateTree();
        
        // Remove loading indicator
        loadingEl.remove();
        
        // Template container
        const templateContainer = contentEl.createDiv({ cls: 'template-container' });
        templateContainer.style.width = '100%';
        templateContainer.style.boxSizing = 'border-box';
        
        // If no templates found
        if (this.templateTree.children.length === 0) {
            templateContainer.createEl('p', { 
                text: 'No template files found. Configure template files or directories in settings.',
                cls: 'no-templates-message'
            });
        } else {
            // Recent templates section
            if (this.plugin.settings.recentTemplates.length > 0) {
                templateContainer.createEl('h3', { text: 'Recent Templates' });
                
                const recentTemplatesContainer = templateContainer.createDiv({ cls: 'recent-templates' });
                recentTemplatesContainer.style.marginBottom = '20px';
                
                // Create elements for recent templates
                this.renderRecentTemplates(recentTemplatesContainer);
            }
            
            // All templates section
            templateContainer.createEl('h3', { text: 'All Templates' });
            
            // Create template tree browser
            const templateTreeContainer = templateContainer.createDiv({ cls: 'template-tree-container' });
            templateTreeContainer.style.maxHeight = '300px';
            templateTreeContainer.style.overflow = 'auto';
            templateTreeContainer.style.border = '1px solid var(--background-modifier-border)';
            templateTreeContainer.style.borderRadius = '4px';
            templateTreeContainer.style.padding = '8px';
            
            // Render the template tree
            this.renderTemplateTree(templateTreeContainer, this.templateTree, true);
        }
        
        // Property selection container (initially empty, populated after template selection)
        const propertyContainer = contentEl.createDiv({ cls: 'property-container' });
        propertyContainer.style.width = '100%';
        propertyContainer.style.boxSizing = 'border-box';
        propertyContainer.style.marginTop = '20px';
        propertyContainer.createEl('p', { 
            text: 'Select a template file to view and choose properties' 
        });
        
        // Buttons - make sticky
        const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
        buttonContainer.style.position = 'sticky';
        buttonContainer.style.bottom = '0';
        buttonContainer.style.backgroundColor = 'var(--background-primary)';
        buttonContainer.style.padding = '10px 0';
        buttonContainer.style.zIndex = '10';

        const applyButton = buttonContainer.createEl('button', { 
            text: 'Apply Template', 
            cls: 'primary-button',
            attr: { disabled: true }
        });
        applyButton.style.width = 'auto';
        applyButton.style.boxSizing = 'border-box';
        applyButton.addEventListener('click', async () => {
            if (this.selectedTemplate && this.selectedProperties.length > 0) {
                // Apply template
                await this.plugin.applyTemplateToFiles(
                    this.selectedTemplate,
                    this.targetFiles,
                    this.selectedProperties,
                    this.consistentProperties
                );
                
                // Add to recent templates
                this.plugin.addToRecentTemplates(this.selectedTemplate.path);
                
                this.plugin.navigateToModal(this, 'main');
            } else {
                new Notice('Please select a template and at least one property');
            }
        });
        
        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.style.width = 'auto';
        cancelButton.style.boxSizing = 'border-box';
        cancelButton.addEventListener('click', () => {
            this.plugin.navigateToModal(this, 'main');
        });
    }
    
    // Build the template tree hierarchy from the list of template files
    async buildTemplateTree() {
        // Reset the tree
        this.templateTree = { type: 'folder', name: 'Root', path: '', children: [] };
        
        // Get all templates
        const templates = await this.plugin.getAllTemplateFiles();
        
        // Add each template to the tree
        for (const template of templates) {
            this.addTemplateToTree(template);
        }
        
        // Sort the tree recursively
        this.sortTree(this.templateTree);
    }
    
    // Add a template file to the tree structure
    addTemplateToTree(template: TFile) {
        // Get the path components
        const pathParts = template.path.split('/');
        const fileName = pathParts.pop() || '';
        
        // Start at the root node
        let currentNode = this.templateTree;
        let currentPath = '';
        
        // Build/traverse the folder structure
        for (const folderName of pathParts) {
            currentPath += folderName + '/';
            
            // Find if this folder already exists in the current node's children
            let folderNode = currentNode.children.find(
                child => child.type === 'folder' && child.name === folderName
            );
            
            // If not, create it
            if (!folderNode) {
                folderNode = {
                    type: 'folder',
                    name: folderName,
                    path: currentPath.slice(0, -1), // Remove trailing slash
                    children: []
                };
                currentNode.children.push(folderNode);
            }
            
            // Move down to this folder
            currentNode = folderNode;
        }
        
        // Add the file node to the current folder
        currentNode.children.push({
            type: 'file',
            name: fileName,
            path: template.path,
            children: [],
            file: template
        });
    }
    
    // Sort the tree recursively
    sortTree(node: TemplateNode) {
        // Sort children by type then name (folders first, then files)
        node.children.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'folder' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        
        // Recursively sort children
        for (const child of node.children) {
            if (child.type === 'folder') {
                this.sortTree(child);
            }
        }
    }
    
    // Render the template tree recursively
    renderTemplateTree(container: HTMLElement, node: TemplateNode, expanded: boolean = false, level: number = 0) {
        // For the root node, we only process its children
        if (node.type === 'folder' && node.path === '') {
            for (const child of node.children) {
                this.renderTemplateTree(container, child, expanded, level);
            }
            return;
        }
        
        // Create node element
        const nodeEl = container.createDiv({ cls: `template-tree-item template-${node.type}` });
        
        // Create header (the clickable part with name)
        const header = nodeEl.createDiv({ cls: 'template-tree-header' });
        header.style.paddingLeft = (level * 20) + 'px';
        
        if (node.type === 'folder') {
            // Folder icon
            const folderIcon = header.createSpan({ cls: 'folder-icon' });
            folderIcon.textContent = expanded ? '📂 ' : '📁 ';
            
            // Folder name
            header.createSpan({ text: node.name, cls: 'folder-name' });
            
            // Container for children
            const childrenContainer = nodeEl.createDiv({ cls: 'template-tree-children' });
            childrenContainer.style.display = expanded ? 'block' : 'none';
            
            // Add children
            for (const child of node.children) {
                this.renderTemplateTree(childrenContainer, child, false, level + 1);
            }
            
            // Toggle expansion when clicking the folder
            header.addEventListener('click', () => {
                const isExpanded = childrenContainer.style.display !== 'none';
                childrenContainer.style.display = isExpanded ? 'none' : 'block';
                folderIcon.textContent = isExpanded ? '📁 ' : '📂 ';
            });
        } else {
            // For files, add radio button for selection
            const radioContainer = header.createDiv({ cls: 'template-radio-container' });
            radioContainer.style.marginRight = '5px';
            
            const radio = radioContainer.createEl('input', {
                type: 'radio',
                attr: {
                    name: 'template',
                    value: node.path,
                    id: `template-${node.path}`
                }
            });
            
            // File icon
            const fileIcon = header.createSpan({ cls: 'file-icon' });
            fileIcon.textContent = '📄 ';
            
            // File name as label
            const label = header.createEl('label', {
                text: node.name,
                attr: { for: `template-${node.path}` }
            });
            label.classList.add('file-name');
            
            // Selection logic
            radio.addEventListener('change', () => {
                if (radio.checked && node.file) {
                    this.selectedTemplate = node.file;
                    this.loadTemplateProperties();
                }
            });
            
            // Make the whole header clickable to select the template
            header.addEventListener('click', (e) => {
                // Don't handle if clicking directly on the radio button
                if (e.target !== radio) {
                    radio.checked = true;
                    if (node.file) {
                        this.selectedTemplate = node.file;
                        this.loadTemplateProperties();
                    }
                }
            });
        }
    }
    
    // Render recent templates section
    renderRecentTemplates(container: HTMLElement) {
        // Filter to only include templates that still exist
        const existingRecentTemplates: TFile[] = [];
        
        for (const path of this.plugin.settings.recentTemplates) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                existingRecentTemplates.push(file);
            }
        }
        
        if (existingRecentTemplates.length === 0) {
            container.createEl('p', { text: 'No recent templates found' });
            return;
        }
        
        // Create element for each recent template
        for (const file of existingRecentTemplates) {
            const recentOption = container.createDiv({ cls: 'template-option' });
            recentOption.style.display = 'flex';
            recentOption.style.alignItems = 'center';
            recentOption.style.marginBottom = '5px';
            recentOption.style.padding = '5px';
            recentOption.style.borderRadius = '4px';
            recentOption.style.cursor = 'pointer';
            recentOption.style.transition = 'background-color 0.1s ease';
            
            // Add hover effect
            recentOption.addEventListener('mouseenter', () => {
                recentOption.style.backgroundColor = 'var(--background-modifier-hover)';
            });
            
            recentOption.addEventListener('mouseleave', () => {
                recentOption.style.backgroundColor = '';
            });
            
            const radioBtn = recentOption.createEl('input', {
                type: 'radio',
                attr: {
                    name: 'template',
                    value: file.path,
                    id: `recent-template-${file.path}`
                }
            });
            radioBtn.style.marginRight = '8px';
            
            // File icon
            const fileIcon = recentOption.createSpan({ cls: 'file-icon' });
            fileIcon.textContent = '📄 ';
            fileIcon.style.marginRight = '5px';
            
            // Get relative path for display
            let displayPath = file.path;
            if (file.parent && file.parent.path) {
                displayPath = file.parent.path + '/' + file.name;
            }
            
            recentOption.createEl('label', {
                text: displayPath,
                attr: { for: `recent-template-${file.path}` }
            });
            
            // Handle selection
            radioBtn.addEventListener('change', () => {
                if (radioBtn.checked) {
                    this.selectedTemplate = file;
                    this.loadTemplateProperties();
                }
            });
            
            // Make whole option clickable
            recentOption.addEventListener('click', (e) => {
                if (e.target !== radioBtn) {
                    radioBtn.checked = true;
                    this.selectedTemplate = file;
                    this.loadTemplateProperties();
                }
            });
        }
    }
    
    // Load and display properties from the selected template
    async loadTemplateProperties() {
        if (!this.selectedTemplate) return;
        
        const { contentEl } = this;
        const propertyContainer = contentEl.querySelector('.property-container');
        if (!propertyContainer) return;
        
        propertyContainer.empty();
        
        // Load properties from template
        const properties = await this.plugin.parseFileProperties(this.selectedTemplate);
        const propertyKeys = Object.keys(properties);
        
        if (propertyKeys.length === 0) {
            propertyContainer.createEl('p', { 
                text: 'The selected template file does not have any properties.' 
            });
            return;
        }
        
        // Display the selected template
        const selectedTemplateInfo = propertyContainer.createDiv({ cls: 'selected-template-info' });
        selectedTemplateInfo.style.marginBottom = '15px';
        selectedTemplateInfo.style.padding = '8px';
        selectedTemplateInfo.style.backgroundColor = 'var(--background-secondary)';
        selectedTemplateInfo.style.borderRadius = '4px';
        
        selectedTemplateInfo.createEl('span', { 
            text: `Selected Template: ${this.selectedTemplate.path}`
        });
        
        propertyContainer.createEl('h3', { text: 'Select Properties to Apply' });
        
        // Create toggle for "Select All"
        const selectAllContainer = propertyContainer.createDiv({ cls: 'select-all-container' });
        selectAllContainer.style.display = 'flex';
        selectAllContainer.style.alignItems = 'center';
        selectAllContainer.style.marginBottom = '10px';
        selectAllContainer.style.width = '100%';
        
        const selectAllCheckbox = selectAllContainer.createEl('input', {
            type: 'checkbox',
            attr: { id: 'select-all-properties' }
        });
        selectAllContainer.createEl('label', {
            text: 'Select All Properties',
            attr: { for: 'select-all-properties' }
        });
        
        selectAllCheckbox.addEventListener('change', () => {
            const checked = selectAllCheckbox.checked;
            const checkboxes = propertyContainer.querySelectorAll('.property-checkbox');
            checkboxes.forEach((checkbox: HTMLInputElement) => {
                checkbox.checked = checked;
                const changeEvent = new Event('change');
                checkbox.dispatchEvent(changeEvent);
            });
        });
        
        // Create property selection list with improved layout
        const propertyList = propertyContainer.createDiv({ cls: 'property-list' });
        propertyList.style.width = '100%';
        propertyList.style.display = 'block';
        
        // Add header row with flex layout
        const headerRow = propertyList.createEl('div', { cls: 'property-item header' });
        headerRow.style.display = 'flex';
        headerRow.style.width = '100%';
        headerRow.style.flexWrap = 'nowrap';
        headerRow.style.marginBottom = '10px';
        
        const includeHeader = headerRow.createEl('div', { text: 'Include', cls: 'property-include' });
        includeHeader.style.width = '70px';
        includeHeader.style.flexShrink = '0';
        includeHeader.style.textAlign = 'center';
        
        const nameHeader = headerRow.createEl('div', { text: 'Property', cls: 'property-name' });
        nameHeader.style.flex = '1';
        nameHeader.style.minWidth = '120px';
        
        const valueHeader = headerRow.createEl('div', { text: 'Value', cls: 'property-value' });
        valueHeader.style.flex = '2';
        valueHeader.style.minWidth = '150px';
        
        const consistentHeader = headerRow.createEl('div', { text: 'Keep Consistent', cls: 'property-consistent' });
        consistentHeader.style.width = '120px';
        consistentHeader.style.flexShrink = '0';
        consistentHeader.style.textAlign = 'center';
        
        for (const key of propertyKeys) {
            const value = properties[key];
            const propertyItem = propertyList.createEl('div', { cls: 'property-item' });
            propertyItem.style.display = 'flex';
            propertyItem.style.width = '100%';
            propertyItem.style.flexWrap = 'nowrap';
            propertyItem.style.alignItems = 'center';
            propertyItem.style.marginBottom = '5px';
            
            // Include checkbox with fixed width
            const includeContainer = propertyItem.createEl('div', { cls: 'property-include' });
            includeContainer.style.width = '70px';
            includeContainer.style.flexShrink = '0';
            includeContainer.style.textAlign = 'center';
            
            const includeCheckbox = includeContainer.createEl('input', {
                type: 'checkbox',
                cls: 'property-checkbox',
                attr: { id: `include-${key}` }
            });
            
            // Property name with flex
            const nameCell = propertyItem.createEl('div', { text: key, cls: 'property-name' });
            nameCell.style.flex = '1';
            nameCell.style.minWidth = '120px';
            nameCell.style.overflow = 'hidden';
            nameCell.style.textOverflow = 'ellipsis';
            
            // Property value with flex
            const valueCell = propertyItem.createEl('div', { 
                text: formatValuePreview(value), 
                cls: 'property-value' 
            });
            valueCell.style.flex = '2';
            valueCell.style.minWidth = '150px';
            valueCell.style.overflow = 'hidden';
            valueCell.style.textOverflow = 'ellipsis';
            
            // Consistent value checkbox with fixed width
            const consistentContainer = propertyItem.createEl('div', { cls: 'property-consistent' });
            consistentContainer.style.width = '120px';
            consistentContainer.style.flexShrink = '0';
            consistentContainer.style.textAlign = 'center';
            
            const consistentCheckbox = consistentContainer.createEl('input', {
                type: 'checkbox',
                cls: 'consistent-checkbox',
                attr: { 
                    id: `consistent-${key}`,
                    disabled: !includeCheckbox.checked
                }
            });
            consistentContainer.createEl('label', {
                text: 'Keep Consistent',
                attr: { for: `consistent-${key}` }
            }).style.display = 'none'; // Hide label to save space, rely on header
            
            // Event handlers
            includeCheckbox.addEventListener('change', () => {
                if (includeCheckbox.checked) {
                    // Add to selected properties
                    if (!this.selectedProperties.includes(key)) {
                        this.selectedProperties.push(key);
                    }
                    // Enable consistent checkbox
                    consistentCheckbox.disabled = false;
                } else {
                    // Remove from selected properties
                    this.selectedProperties = this.selectedProperties.filter(p => p !== key);
                    // Remove from consistent properties and disable checkbox
                    this.consistentProperties = this.consistentProperties.filter(p => p !== key);
                    consistentCheckbox.checked = false;
                    consistentCheckbox.disabled = true;
                }
                
                // Update apply button state
                const applyButton = this.contentEl.querySelector('.primary-button') as HTMLButtonElement;
                if (applyButton) {
                    applyButton.disabled = this.selectedProperties.length === 0;
                }
            });
            
            consistentCheckbox.addEventListener('change', () => {
                if (consistentCheckbox.checked) {
                    // Add to consistent properties
                    if (!this.consistentProperties.includes(key)) {
                        this.consistentProperties.push(key);
                    }
                } else {
                    // Remove from consistent properties
                    this.consistentProperties = this.consistentProperties.filter(p => p !== key);
                }
            });
        }
        
        // Enable apply button
        const applyButton = this.contentEl.querySelector('.primary-button') as HTMLButtonElement;
        if (applyButton) {
            applyButton.disabled = false;
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Helper for file selection
class FileSelectorModal extends Modal {
	onSelect: (file: TFile | null) => void;
	
	constructor(app: App, onSelect: (file: TFile | null) => void) {
		super(app);
		this.onSelect = onSelect;
	}
	
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('file-selector-modal');
		
		// Ensure modal has scrolling when needed
		this.modalEl.style.maxHeight = '85vh';
		this.modalEl.style.overflow = 'auto';
		
		contentEl.createEl('h2', { text: 'Select a Template File' });
		
		// Create file tree with fixed height and scrolling
		const fileTree = contentEl.createDiv({ cls: 'file-tree-container' });
		fileTree.style.maxHeight = '400px';
		fileTree.style.overflowY = 'auto';
		
		// Recursively add files/folders
		const rootFolder = this.app.vault.getRoot();
		this.addFolderToTree(fileTree, rootFolder);
		
		// Buttons - make sure they're outside scrollable area
		const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
		buttonContainer.style.position = 'sticky';
		buttonContainer.style.bottom = '0';
		buttonContainer.style.backgroundColor = 'var(--background-primary)';
		buttonContainer.style.padding = '10px 0';
		buttonContainer.style.zIndex = '10';
		
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => {
			this.onSelect(null);
			this.close();
		});
	}
	
	addFolderToTree(parentEl: HTMLElement, folder: any, level: number = 0) {
		const children = folder.children;
		if (!children) return;
		
		// Sort: folders first, then files
		const sorted = [...children].sort((a, b) => {
			const aIsFolder = a.children !== undefined;
			const bIsFolder = b.children !== undefined;
			
			if (aIsFolder && !bIsFolder) return -1;
			if (!aIsFolder && bIsFolder) return 1;
			return a.name.localeCompare(b.name);
		});
		
		for (const child of sorted) {
			const isFolder = child.children !== undefined;
			
			const itemEl = parentEl.createDiv({
				cls: `file-item ${isFolder ? 'folder' : 'file'}`,
				attr: { style: `padding-left: ${level * 20}px` }
			});
			
			// Icon
			itemEl.createEl('span', { 
				text: isFolder ? '📁 ' : '📄 ',
				cls: 'file-icon'
			});
			
			// Name
			itemEl.createEl('span', { text: child.name, cls: 'file-name' });
			
			if (isFolder) {
				// Folder can be expanded
				const childrenContainer = parentEl.createDiv({ 
					cls: 'folder-children',
					attr: { style: 'display: none' }
				});
				
				// Toggle expansion
				itemEl.addEventListener('click', (e) => {
					e.stopPropagation();
					const isVisible = childrenContainer.style.display !== 'none';
					childrenContainer.style.display = isVisible ? 'none' : 'block';
					
					// Load children if not yet loaded
					if (!isVisible && childrenContainer.childElementCount === 0) {
						this.addFolderToTree(childrenContainer, child, level + 1);
					}
				});
			} else if (child instanceof TFile && child.extension === 'md') {
				// File can be selected
				itemEl.addEventListener('click', () => {
					this.onSelect(child);
					this.close();
				});
			}
		}
	}
	
	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Main modal for property manager
class PropertyManagerModal extends Modal {
	plugin: YAMLPropertyManagerPlugin;
	selectedFiles: TFile[] = [];
	
	constructor(app: App, plugin: YAMLPropertyManagerPlugin) {
		super(app);
		this.plugin = plugin;
	}
	
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('property-manager-modal');
		
		// Remove fixed dimensions and let the window size to content
		this.modalEl.style.width = 'auto';
		this.modalEl.style.height = 'auto'; // Allow height to fit content
		this.modalEl.style.maxWidth = '600px';
		this.modalEl.style.overflow = 'visible';
		this.modalEl.style.maxHeight = 'none';
		
		contentEl.createEl('h2', { text: 'YAML Property Manager' });
		
		// Actions container
		const actionsContainer = contentEl.createDiv({ cls: 'actions-container' });
		actionsContainer.style.display = 'flex';
		actionsContainer.style.flexDirection = 'column';
		actionsContainer.style.gap = '20px';
		actionsContainer.style.width = '100%';
		
		// Only create the batch container
		const batchContainer = actionsContainer.createDiv({ cls: 'action-section' });
		batchContainer.createEl('h3', { text: 'Batch Operations' });
		
		// File selection
		batchContainer.createEl('p', { text: 'Select files to process:' });
		
		const fileSelectionContainer = batchContainer.createDiv({ cls: 'file-selection' });
		
		const currentFolderButton = fileSelectionContainer.createEl('button', { 
			text: 'Select All in Current Folder' 
		});
		currentFolderButton.style.width = '100%';
		currentFolderButton.style.boxSizing = 'border-box';
		currentFolderButton.addEventListener('click', () => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.file) {
				const currentFolder = activeView.file.parent;
				if (currentFolder) {
					// Store files in the plugin's central storage
					this.plugin.selectedFiles = this.app.vault.getMarkdownFiles()
						.filter(file => file.parent === currentFolder);
					
					this.plugin.debug(`Selected ${this.plugin.selectedFiles.length} files from current folder`);
					this.updateSelectedFilesCount(fileSelectionContainer);
				}
			} else {
				new Notice('No file is currently active');
			}
		});
		
		const browseButton = fileSelectionContainer.createEl('button', { 
			text: 'Browse and Select Files' 
		});
		browseButton.style.width = '100%';
		browseButton.style.boxSizing = 'border-box';
		browseButton.addEventListener('click', () => {
			this.browseFiles();
		});
		
		// Selected files count
		const selectedFilesCountEl = fileSelectionContainer.createEl('div', {
			cls: 'selected-files-count',
			text: this.plugin.selectedFiles.length > 0 
				? `${this.plugin.selectedFiles.length} files selected` 
				: 'No files selected'
		});
		
		// Apply template button
		const applyTemplateButton = batchContainer.createEl('button', {
			text: 'Apply Template to Selected Files',
			cls: 'primary-button',
			attr: { disabled: this.plugin.selectedFiles.length === 0 }
		});
		applyTemplateButton.style.width = '100%';
		applyTemplateButton.style.boxSizing = 'border-box';
		applyTemplateButton.addEventListener('click', () => {
			if (this.plugin.selectedFiles.length > 0) {
				this.plugin.navigateToModal(this, 'template');
			} else {
				new Notice('Please select files first');
			}
		});
	
		// Bulk edit button
		const bulkEditButton = batchContainer.createEl('button', {
			text: 'Bulk Edit Properties',
			cls: 'primary-button',
			attr: { disabled: this.plugin.selectedFiles.length === 0 }
		});
		bulkEditButton.style.width = '100%';
		bulkEditButton.style.boxSizing = 'border-box';
		bulkEditButton.addEventListener('click', () => {
			this.plugin.debug(`Bulk edit clicked with ${this.plugin.selectedFiles.length} files selected`);
			
			if (this.plugin.selectedFiles.length > 0) {
				this.plugin.navigateToModal(this, 'bulkEdit');
			} else {
				new Notice('Please select files first');
			}
		});
		
		// Add divider line
		const divider = batchContainer.createEl('hr');
		divider.style.margin = '20px 0';
		divider.style.borderTop = '1px solid var(--background-modifier-border)';
		
		// Add Single File Operations header and button
		batchContainer.createEl('h3', { text: 'Single File Operations' });
		
		const currentFileButton = batchContainer.createEl('button', { 
			text: 'Manage Current File Properties' 
		});
		currentFileButton.style.width = '100%';
		currentFileButton.style.boxSizing = 'border-box';
		currentFileButton.addEventListener('click', () => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.file) {
				this.plugin.navigateToModal(this, 'singleFile', activeView.file);
			} else {
				new Notice('No file is currently active');
			}
		});
		
		// Close button container
		const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
		buttonContainer.style.marginTop = '15px';
		
		// Close button
		const closeButton = buttonContainer.createEl('button', { text: 'Close' });
		closeButton.style.width = 'auto';
		closeButton.style.boxSizing = 'border-box';
		closeButton.addEventListener('click', () => {
			this.close();
		});
		
		// Make sure we update button states
		this.updateButtonState();
	}
	
	updateSelectedFilesCount(container: HTMLElement) {
		const countEl = container.querySelector('.selected-files-count');
		if (countEl) {
			countEl.textContent = this.plugin.selectedFiles.length === 0 
				? 'No files selected' 
				: `${this.plugin.selectedFiles.length} files selected`;
		}
		
		// Enable/disable buttons
		this.updateButtonState();
	}

	updateButtonState() {
		// Enable/disable buttons
		const buttons = this.contentEl.querySelectorAll('.primary-button') as NodeListOf<HTMLButtonElement>;
		buttons.forEach(button => {
			button.disabled = this.plugin.selectedFiles.length === 0;
		});
	}

	browseFiles() {
		const batchSelector = new BatchFileSelectorModal(this.app, (files: TFile[]) => {
			if (files && files.length > 0) {
				this.plugin.debug(`Received ${files.length} files from batch selection`);
				
				// Store files in the plugin's storage
				this.plugin.selectedFiles = [...files];
				
				// Reopen main modal to show updated selection
				this.plugin.navigateToModal(this, 'main');
			}
		});
		batchSelector.open();
	}
	
	updateButtonsState() {
		// Enable/disable buttons
		const buttons = this.contentEl.querySelectorAll('.primary-button') as NodeListOf<HTMLButtonElement>;
		buttons.forEach(button => {
			button.disabled = this.plugin.selectedFiles.length === 0;
		});
	}
}

// Modal for selecting multiple files
class BatchFileSelectorModal extends Modal {
	onSelect: (files: TFile[]) => void;
	selectedFiles: TFile[] = [];
	
	constructor(app: App, onSelect: (files: TFile[]) => void) {
		super(app);
		this.onSelect = onSelect;
	}
	
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('batch-file-selector-modal');
		
		// Add these lines for width control
		this.modalEl.style.width = '95%';
		this.modalEl.style.maxWidth = '900px';
		this.modalEl.style.maxHeight = '85vh';
		this.modalEl.style.overflowY = 'auto';
		
		// Add header with back button
		const headerContainer = contentEl.createDiv({ cls: 'modal-header' });
		headerContainer.style.display = 'flex';
		headerContainer.style.alignItems = 'center';
		headerContainer.style.marginBottom = '15px';

		const backButton = headerContainer.createEl('button', { text: '← Back' });
		backButton.style.marginRight = '10px';
		backButton.addEventListener('click', () => {
			// We need special handling for this modal since it uses a callback
			backButton.disabled = true; // Prevent multiple clicks
			this.close();
			
			// Get the plugin instance properly
			const plugin = (this.app as any).plugins.plugins["yaml-property-manager"];
			if (plugin) {
				plugin.navigateToModal(this, 'main');
			}
		});
		
		headerContainer.createEl('h2', { text: 'Select Files' });
		
		// Instructions
		contentEl.createEl('p', { 
			text: 'Select files to apply properties to. Use checkboxes to select individual files or entire folders.'
		});
		
		// File tree container
		const fileTreeContainer = contentEl.createDiv({ cls: 'file-tree-container' });
		
		// Selected files count
		const selectedCountEl = contentEl.createEl('div', {
			cls: 'selected-count',
			text: 'No files selected'
		});
		
		// File tree
		const fileTree = fileTreeContainer.createDiv({ cls: 'file-tree' });
		
		// Add root folder
		this.addFolderToTree(fileTree, this.app.vault.getRoot(), selectedCountEl);
		
		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
		buttonContainer.style.position = 'sticky';
		buttonContainer.style.bottom = '0';
		buttonContainer.style.backgroundColor = 'var(--background-primary)';
		buttonContainer.style.padding = '10px 0';
		buttonContainer.style.zIndex = '10';
		
		const confirmButton = buttonContainer.createEl('button', {
			text: 'Apply to Selected Files',
			cls: 'primary-button',
			attr: { disabled: true }
		});
		confirmButton.addEventListener('click', () => {
			// Make a copy of the selected files
			const selectedFilesCopy = [...this.selectedFiles];
			
			const plugin = (this.app as any).plugins.plugins["yaml-property-manager"];
			if (plugin) {
				plugin.debug(`Batch selector confirming ${selectedFilesCopy.length} files`);
			}
			
			// Call the onSelect callback with the selected files
			this.onSelect(selectedFilesCopy);
			
			// Close this modal
			this.close();
		});
		
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => {
			this.close();
		});
	}
	
	addFolderToTree(parentEl: HTMLElement, folder: any, selectedCountEl: HTMLElement, level: number = 0) {
		const children = folder.children;
		if (!children) return;
		
		// Sort: folders first, then files
		const sorted = [...children].sort((a, b) => {
			const aIsFolder = a.children !== undefined;
			const bIsFolder = b.children !== undefined;
			
			if (aIsFolder && !bIsFolder) return -1;
			if (!aIsFolder && bIsFolder) return 1;
			return a.name.localeCompare(b.name);
		});
		
		for (const child of sorted) {
			const isFolder = child.children !== undefined;
			
			const itemEl = parentEl.createDiv({
				cls: `file-item ${isFolder ? 'folder' : 'file'}`,
				attr: { style: `padding-left: ${level * 20}px` }
			});
			
			// Checkbox
			const checkbox = itemEl.createEl('input', {
				type: 'checkbox',
				cls: 'file-checkbox'
			});
			
			// Icon
			itemEl.createEl('span', { 
				text: isFolder ? '📁 ' : '📄 ',
				cls: 'file-icon'
			});
			
			// Name
			itemEl.createEl('span', { text: child.name, cls: 'file-name' });
			
			if (isFolder) {
				// Create container for children
				const childrenContainer = parentEl.createDiv({ 
					cls: 'folder-children',
					attr: { style: 'display: none' }
				});
				
				// Toggle expand/collapse
				itemEl.addEventListener('click', (e) => {
					if (e.target === checkbox) return;
					e.stopPropagation();
					
					const isVisible = childrenContainer.style.display !== 'none';
					childrenContainer.style.display = isVisible ? 'none' : 'block';
					
					// Load children if not yet loaded
					if (!isVisible && childrenContainer.childElementCount === 0) {
						this.addFolderToTree(childrenContainer, child, selectedCountEl, level + 1);
					}
				});
				
				// Handle checkbox for folders
				checkbox.addEventListener('change', () => {
					const isChecked = checkbox.checked;
					
					// If folder is checked, recursively select all markdown files in it
					if (isChecked) {
						const markdownFiles = this.getMarkdownFilesInFolder(child);
						for (const file of markdownFiles) {
							if (!this.selectedFiles.includes(file)) {
								this.selectedFiles.push(file);
							}
						}
					} else {
						// If unchecked, remove all files from this folder
						const folderPath = child.path;
						this.selectedFiles = this.selectedFiles.filter(file => {
							return !file.path.startsWith(folderPath + '/');
						});
					}
					
					// Update checkboxes in the expanded view if visible
					if (childrenContainer.style.display !== 'none') {
						const checkboxes = childrenContainer.querySelectorAll('.file-checkbox');
						checkboxes.forEach((cb: HTMLInputElement) => {
							cb.checked = isChecked;
						});
					}
					
					// Update count and button
					this.updateSelectedCount(selectedCountEl);
				});
			} else if (child instanceof TFile && child.extension === 'md') {
				// Handle checkbox for individual files
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) {
						if (!this.selectedFiles.includes(child)) {
							this.selectedFiles.push(child);
						}
					} else {
						this.selectedFiles = this.selectedFiles.filter(f => f !== child);
					}
					
					// Update count and button
					this.updateSelectedCount(selectedCountEl);
				});
			} else {
				// Non-markdown files are disabled
				checkbox.disabled = true;
				itemEl.addClass('disabled');
			}
		}
	}
	
	getMarkdownFilesInFolder(folder: any): TFile[] {
		const files: TFile[] = [];
		
		const processFolder = (f: any) => {
			if (!f.children) return;
			
			for (const child of f.children) {
				if (child instanceof TFile && child.extension === 'md') {
					files.push(child);
				} else if (child.children) {
					processFolder(child);
				}
			}
		};
		
		processFolder(folder);
		return files;
	}
	
	updateSelectedCount(countEl: HTMLElement) {
		const count = this.selectedFiles.length;
		countEl.textContent = count === 0 
			? 'No files selected' 
			: `${count} file${count === 1 ? '' : 's'} selected`;
		
		// Enable/disable confirm button
		const confirmButton = this.contentEl.querySelector('.primary-button') as HTMLButtonElement;
		if (confirmButton) {
			confirmButton.disabled = count === 0;
		}
	}
	
	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Complete BulkPropertyEditorModal class with property reordering feature
class BulkPropertyEditorModal extends Modal {
	plugin: YAMLPropertyManagerPlugin;
	files: TFile[];
	propertiesToModify: Record<string, any> = {};
	propertiesToDelete: string[] = [];
	preserveExisting: boolean = true;
	
	// New properties to track existing properties across files
	existingProperties: Map<string, { count: number, examples: any[] }> = new Map();
	totalFileCount: number = 0;
	
	// New properties for reordering feature
	canReorderProperties: boolean = false;
	propertyOrder: string[] = [];

	constructor(app: App, plugin: YAMLPropertyManagerPlugin, files: TFile[]) {
		super(app);
		this.plugin = plugin;
		this.files = files;
		this.totalFileCount = files.length;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('yaml-property-manager-modal');
		contentEl.addClass('bulk-property-editor-modal');
		
		// Increase width to accommodate properties
		this.modalEl.style.width = '95%';
		this.modalEl.style.maxWidth = '1000px'; // Wider to fit content
		this.modalEl.style.maxHeight = '85vh';
		this.modalEl.style.overflowY = 'auto';
		this.modalEl.style.overflowX = 'visible'; // Prevent horizontal scrolling
		
		// Add header with back button
		const headerContainer = contentEl.createDiv({ cls: 'modal-header' });
		headerContainer.style.display = 'flex';
		headerContainer.style.alignItems = 'center';
		headerContainer.style.marginBottom = '15px';
		
		const backButton = headerContainer.createEl('button', { text: '← Back' });
		backButton.style.marginRight = '10px';
		backButton.addEventListener('click', () => {
			// Open a new PropertyManagerModal
			const mainModal = new PropertyManagerModal(this.app, this.plugin);
			this.close();
			mainModal.open();
		});
		
		headerContainer.createEl('h2', { text: 'Bulk Edit Properties' });
		
		// Show number of files affected
		contentEl.createEl('p', { 
			text: `Editing properties across ${this.files.length} file${this.files.length !== 1 ? 's' : ''}` 
		});
		
		// Show loading spinner while scanning files
		const loadingEl = contentEl.createDiv({ cls: 'property-scan-loading' });
		loadingEl.createEl('p', { text: 'Scanning files for existing properties...' });
		loadingEl.createEl('div', { cls: 'spinner' });
		
		// Scan selected files for existing properties
		await this.scanExistingProperties();
		
		// Check if property reordering is possible
		await this.checkReorderingPossibility();
		
		// Remove loading element
		loadingEl.remove();
		
		// Container for property editing - ensure it doesn't restrict width
		const propertyContainer = contentEl.createDiv({ cls: 'bulk-property-container' });
		propertyContainer.style.width = '100%';
		propertyContainer.style.overflowX = 'visible';
		
		// New section - Existing Properties
		const existingPropertiesSection = propertyContainer.createDiv({ cls: 'existing-properties-section' });
		existingPropertiesSection.style.width = '100%';
		existingPropertiesSection.style.overflowX = 'visible';
		existingPropertiesSection.createEl('h3', { text: 'Existing Properties' });
		
		const existingPropertiesList = existingPropertiesSection.createDiv({ cls: 'existing-properties-list' });
		existingPropertiesList.style.width = '100%';
		existingPropertiesList.style.overflowX = 'visible';
		this.renderExistingProperties(existingPropertiesList);
		
		// New section - Property Reordering (only if possible)
		const reorderSection = propertyContainer.createDiv({ cls: 'property-reorder-section' });
		reorderSection.style.width = '100%';
		reorderSection.style.overflowX = 'visible';
		reorderSection.createEl('h3', { text: 'Reorder Properties' });
		this.renderPropertyReordering(reorderSection);
		
		// Property list section
		const propertyListSection = propertyContainer.createDiv({ cls: 'property-list-section' });
		propertyListSection.style.width = '100%';
		propertyListSection.style.overflowX = 'visible';
		propertyListSection.createEl('h3', { text: 'Properties to Add/Modify' });
		
		const propertyList = propertyListSection.createDiv({ cls: 'property-list' });
		propertyList.style.width = '100%';
		propertyList.style.minWidth = '700px';
		propertyList.style.overflowX = 'visible';
		this.renderPropertyList(propertyList);
		
		// Add property button
		const addButtonContainer = propertyListSection.createDiv();
		addButtonContainer.style.width = '100%';
		const addPropertyButton = addButtonContainer.createEl('button', { text: 'Add Property' });
		addPropertyButton.addEventListener('click', () => {
			this.addNewPropertyRow(propertyList);
		});
		
		// Properties to delete section
		const deleteSection = propertyContainer.createDiv({ cls: 'property-delete-section' });
		deleteSection.style.width = '100%';
		deleteSection.style.overflowX = 'visible';
		deleteSection.createEl('h3', { text: 'Properties to Delete' });
		
		const deleteList = deleteSection.createDiv({ cls: 'delete-property-list' });
		deleteList.style.width = '100%';
		deleteList.style.minWidth = '700px';
		deleteList.style.overflowX = 'visible';
		this.renderDeleteList(deleteList);
		
		// Add property to delete button
		const addDeleteButtonContainer = deleteSection.createDiv();
		addDeleteButtonContainer.style.width = '100%';
		const addDeleteButton = addDeleteButtonContainer.createEl('button', { text: 'Add Property to Delete' });
		addDeleteButton.addEventListener('click', () => {
			this.addNewDeleteRow(deleteList);
		});
		
		// Options section
		const optionsSection = propertyContainer.createDiv({ cls: 'options-section' });
		optionsSection.style.width = '100%';
		optionsSection.style.overflowX = 'visible';
		optionsSection.createEl('h3', { text: 'Options' });
		
		// Preserve existing option
		const preserveOption = optionsSection.createDiv({ cls: 'option-item' });
		const preserveCheckbox = preserveOption.createEl('input', {
			type: 'checkbox',
			attr: { type: 'checkbox' }
		});
		// Set checked state after creation
		preserveCheckbox.checked = this.preserveExisting;
	
		preserveOption.createEl('label', { 
			text: 'Preserve existing values (only add properties that don\'t exist in the files)' 
		});
		
		preserveCheckbox.addEventListener('change', () => {
			this.preserveExisting = preserveCheckbox.checked;
		});
		
		// Buttons - make sticky with full width
		const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
		buttonContainer.style.position = 'sticky';
		buttonContainer.style.bottom = '0';
		buttonContainer.style.backgroundColor = 'var(--background-primary)';
		buttonContainer.style.padding = '10px 0';
		buttonContainer.style.zIndex = '10';
		buttonContainer.style.width = '100%';
		
		const applyButton = buttonContainer.createEl('button', { 
			text: 'Apply Changes', 
			cls: 'primary-button'
		});
		applyButton.addEventListener('click', async () => {
			await this.applyChanges();
		});
		
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => {
			this.plugin.navigateToModal(this, 'main');
		});
	}
	
	// New method to scan all selected files for existing properties
	async scanExistingProperties() {
		this.existingProperties.clear();
		
		for (const file of this.files) {
			try {
				const fileProperties = await this.plugin.parseFileProperties(file);
				
				// Add each property to our tracking map
				for (const [key, value] of Object.entries(fileProperties)) {
					if (!this.existingProperties.has(key)) {
						this.existingProperties.set(key, { 
							count: 1, 
							examples: [value] 
						});
					} else {
						const propInfo = this.existingProperties.get(key);
						if (propInfo) {
							propInfo.count++;
							// Keep up to 3 examples of values
							if (propInfo.examples.length < 3 && 
								!propInfo.examples.some(ex => JSON.stringify(ex) === JSON.stringify(value))) {
								propInfo.examples.push(value);
							}
						}
					}
				}
			} catch (error) {
				console.error(`Error scanning properties in file ${file.path}:`, error);
			}
		}
	}
	
	// New method to check if reordering is possible
	async checkReorderingPossibility() {
		// If no files are selected, reordering is not possible
		if (this.files.length === 0) {
			this.canReorderProperties = false;
			this.propertyOrder = [];
			return;
		}
		
		// Collect all unique properties across all files
		const allUniqueProps = new Set<string>();
		
		// Properties that exist in all files
		let commonProps: Set<string> | null = null;
		
		// Process each file
		for (let i = 0; i < this.files.length; i++) {
			const fileProps = await this.plugin.parseFileProperties(this.files[i]);
			const filePropsSet = new Set(Object.keys(fileProps));
			
			// Add to unique properties
			for (const prop of filePropsSet) {
				allUniqueProps.add(prop);
			}
			
			// For first file, initialize common properties
			if (i === 0) {
				commonProps = new Set(filePropsSet);
			} else if (commonProps) {
				// For subsequent files, keep only properties that exist in all files
				for (const prop of commonProps) {
					if (!filePropsSet.has(prop)) {
						commonProps.delete(prop);
					}
				}
				
				// Check if any new properties exist in this file but not in previous files
				for (const prop of filePropsSet) {
					if (!commonProps.has(prop)) {
						// This property doesn't exist in all files
						this.canReorderProperties = false;
					}
				}
			}
		}
		
		// If we've processed files and all properties are common, reordering is possible
		this.canReorderProperties = commonProps !== null && 
								commonProps.size === allUniqueProps.size && 
								commonProps.size > 0;
		
		// Set property order (all unique properties)
		this.propertyOrder = Array.from(allUniqueProps);
	}
	
	// New method to render the property reordering section
	// Fixed renderPropertyReordering method (to remove duplicate text)
	renderPropertyReordering(container: HTMLElement) {
		container.empty();
		container.style.width = '100%';
		container.style.minWidth = '700px';
		container.style.overflowX = 'visible';
		
		if (this.propertyOrder.length === 0) {
			container.createEl('p', { 
				text: 'No properties found in the selected files.'
			});
			return;
		}
		
		if (!this.canReorderProperties) {
			container.createEl('p', { 
				text: 'All selected files don\'t have identical properties. You cannot reorder them.',
				cls: 'property-reorder-warning'
			});
			
			// Still show properties, but in a disabled state
			const listContainer = container.createEl('div', { cls: 'property-reorder-list disabled' });
			listContainer.style.width = '100%';
			listContainer.style.minWidth = '700px';
			listContainer.style.overflowX = 'visible';
			
			for (const prop of this.propertyOrder) {
				const item = listContainer.createEl('div', { 
					cls: 'property-reorder-item disabled',
					attr: { 'data-property': prop }
				});
				item.style.width = '100%';
				item.style.minWidth = '650px';
				
				// Add property name
				const dragHandle = item.createEl('div', { cls: 'property-drag-handle disabled' });
				dragHandle.createEl('span', { text: '≡' });
				
				item.createEl('div', { text: prop, cls: 'property-reorder-name' });
				
				// Show usage information from existingProperties
				const propInfo = this.existingProperties.get(prop);
				if (propInfo) {
					const percentage = Math.round((propInfo.count / this.totalFileCount) * 100);
					const usageInfo = item.createEl('div', { 
						text: `${propInfo.count}/${this.totalFileCount} (${percentage}%)`, 
						cls: 'property-reorder-usage' 
					});
				}
			}
			
			return;
		}
		
		// If reordering is possible, show the normal interface
		container.createEl('p', { 
			text: 'All selected files have identical properties. You can reorder them below.'
		});
		
		// Create the sortable list
		const listContainer = container.createEl('div', { cls: 'property-reorder-list' });
		listContainer.style.width = '100%';
		listContainer.style.minWidth = '700px';
		listContainer.style.overflowX = 'visible';
		
		for (let i = 0; i < this.propertyOrder.length; i++) {
			const prop = this.propertyOrder[i];
			const item = listContainer.createEl('div', { 
				cls: 'property-reorder-item',
				attr: { 'data-property': prop }
			});
			item.style.width = '100%';
			item.style.minWidth = '650px';
			
			// Add drag handle
			const dragHandle = item.createEl('div', { cls: 'property-drag-handle' });
			dragHandle.createEl('span', { text: '≡' });
			
			// Add property name
			item.createEl('div', { text: prop, cls: 'property-reorder-name' });
			
			// Add up/down buttons
			const buttonsContainer = item.createEl('div', { cls: 'property-reorder-buttons' });
			
			if (i > 0) {
				const upButton = buttonsContainer.createEl('button', { text: '↑' });
				upButton.addEventListener('click', () => {
					this.moveProperty(i, i - 1);
					this.renderPropertyReordering(container);
				});
			}
			
			if (i < this.propertyOrder.length - 1) {
				const downButton = buttonsContainer.createEl('button', { text: '↓' });
				downButton.addEventListener('click', () => {
					this.moveProperty(i, i + 1);
					this.renderPropertyReordering(container);
				});
			}
		}
		
		// Add button to apply the new order
		const applyButton = container.createEl('button', { 
			text: 'Apply This Order to All Selected Files',
			cls: 'property-reorder-apply'
		});
		
		applyButton.addEventListener('click', async () => {
			await this.applyPropertyOrder();
		});
		
		// Set up drag-and-drop functionality
		this.setupDragAndDrop(listContainer);
	}
	
	// Helper to move a property in the order array
	moveProperty(fromIndex: number, toIndex: number) {
		if (fromIndex < 0 || fromIndex >= this.propertyOrder.length || 
			toIndex < 0 || toIndex >= this.propertyOrder.length) {
			return;
		}
		
		const item = this.propertyOrder[fromIndex];
		this.propertyOrder.splice(fromIndex, 1);
		this.propertyOrder.splice(toIndex, 0, item);
	}
	
	// Set up drag and drop for reordering
	// Updated setupDragAndDrop method with safety checks
	setupDragAndDrop(container: HTMLElement) {
		// Don't enable drag and drop for disabled items
		if (container.hasClass('disabled')) {
			return;
		}
		
		const items = container.querySelectorAll('.property-reorder-item');
		
		items.forEach(item => {
			// Skip disabled items
			if (item.hasClass('disabled')) {
				return;
			}
			
			item.setAttribute('draggable', 'true');
			
			item.addEventListener('dragstart', (e) => {
				if (!(e instanceof DragEvent) || !e.dataTransfer) return;
				
				e.dataTransfer.effectAllowed = 'move';
				e.dataTransfer.setData('text/plain', item.getAttribute('data-property') || '');
				
				// Add dragging class
				item.addClass('dragging');
			});
			
			item.addEventListener('dragend', () => {
				// Remove dragging class
				item.removeClass('dragging');
			});
			
			item.addEventListener('dragover', (e) => {
				if (!(e instanceof DragEvent)) return;
				
				e.preventDefault();
				e.stopPropagation();
				e.dataTransfer.dropEffect = 'move';
				
				// Add a class to show where the item will be dropped
				item.addClass('dragover');
			});
			
			item.addEventListener('dragleave', () => {
				// Remove dragover class
				item.removeClass('dragover');
			});
			
			item.addEventListener('drop', (e) => {
				if (!(e instanceof DragEvent) || !e.dataTransfer) return;
				
				e.preventDefault();
				e.stopPropagation();
				
				const draggedProp = e.dataTransfer.getData('text/plain');
				const targetProp = item.getAttribute('data-property') || '';
				
				// Find indices
				const fromIndex = this.propertyOrder.indexOf(draggedProp);
				const toIndex = this.propertyOrder.indexOf(targetProp);
				
				if (fromIndex !== -1 && toIndex !== -1) {
					this.moveProperty(fromIndex, toIndex);
					this.renderPropertyReordering(container);
				}
				
				// Remove dragover class
				item.removeClass('dragover');
			});
		});
	}
	
	// Apply the new property order to all files
	async applyPropertyOrder() {
		let successCount = 0;
		let errorCount = 0;
		
		for (const file of this.files) {
			try {
				// Get existing properties
				const fileProps = await this.plugin.parseFileProperties(file);
				
				// Create a new object with properties in the specified order
				const orderedProps: Record<string, any> = {};
				for (const prop of this.propertyOrder) {
					if (prop in fileProps) {
						orderedProps[prop] = fileProps[prop];
					}
				}
				
				// Apply the ordered properties
				const success = await this.plugin.applyProperties(file, orderedProps, false);
				if (success) {
					successCount++;
				} else {
					errorCount++;
				}
			} catch (error) {
				console.error(`Error reordering properties in file ${file.path}:`, error);
				errorCount++;
			}
		}
		
		// Show results
		new Notice(`Reordered properties in ${successCount} files successfully. ${errorCount} errors.`);
	}
	
	// New method to render the existing properties section
	renderExistingProperties(container: HTMLElement) {
		container.empty();
		container.style.width = '100%';
		container.style.minWidth = '700px';
		container.style.overflowX = 'visible';
		
		if (this.existingProperties.size === 0) {
			container.createEl('p', { text: 'No properties found in the selected files.' });
			return;
		}
		
		// Create header row
		const headerRow = container.createEl('div', { cls: 'property-item header' });
		headerRow.style.display = 'flex';
		headerRow.style.width = '100%';
		headerRow.style.flexWrap = 'nowrap';
		headerRow.style.minWidth = '700px';
		
		const nameHeader = headerRow.createEl('div', { text: 'Property Name', cls: 'property-name' });
		nameHeader.style.flex = '1';
		nameHeader.style.minWidth = '120px';
		
		const typeHeader = headerRow.createEl('div', { text: 'Most Common Type', cls: 'property-type' });
		typeHeader.style.width = '120px';
		typeHeader.style.flexShrink = '0';
		
		const usageHeader = headerRow.createEl('div', { text: 'Usage', cls: 'property-usage' });
		usageHeader.style.width = '120px';
		usageHeader.style.flexShrink = '0';
		
		const examplesHeader = headerRow.createEl('div', { text: 'Sample Values', cls: 'property-examples' });
		examplesHeader.style.flex = '2';
		examplesHeader.style.minWidth = '150px';
		
		const actionsHeader = headerRow.createEl('div', { text: 'Actions', cls: 'property-actions' });
		actionsHeader.style.width = '120px';
		actionsHeader.style.flexShrink = '0';
		actionsHeader.style.textAlign = 'center';
		
		// Sort properties by usage (most used first)
		const sortedProps = Array.from(this.existingProperties.entries())
			.sort((a, b) => b[1].count - a[1].count);
		
		// Add each existing property
		for (const [propName, propInfo] of sortedProps) {
			const row = container.createEl('div', { cls: 'property-item' });
			row.style.display = 'flex';
			row.style.width = '100%';
			row.style.flexWrap = 'nowrap';
			row.style.alignItems = 'center';
			row.style.marginBottom = '5px';
			row.style.minWidth = '700px';
			
			// Property name
			const nameCell = row.createEl('div', { text: propName, cls: 'property-name' });
			nameCell.style.flex = '1';
			nameCell.style.minWidth = '120px';
			
			// Property type (inferred from examples)
			const mostLikelyType = this.inferPropertyType(propInfo.examples);
			const typeCell = row.createEl('div', { text: mostLikelyType, cls: 'property-type' });
			typeCell.style.width = '120px';
			typeCell.style.flexShrink = '0';
			
			// Usage statistics
			const percentage = Math.round((propInfo.count / this.totalFileCount) * 100);
			const usageCell = row.createEl('div', { 
				text: `${propInfo.count}/${this.totalFileCount} (${percentage}%)`, 
				cls: 'property-usage' 
			});
			usageCell.style.width = '120px';
			usageCell.style.flexShrink = '0';
			
			// Sample values
			const examplesCell = row.createEl('div', { cls: 'property-examples' });
			examplesCell.style.flex = '2';
			examplesCell.style.minWidth = '150px';
			examplesCell.style.overflow = 'hidden';
			examplesCell.style.textOverflow = 'ellipsis';
			
			// Format example values
			const exampleValues = propInfo.examples
				.map(val => formatValuePreview(val))
				.join(', ');
			examplesCell.setText(exampleValues);
			
			// Actions
			const actionsCell = row.createEl('div', { cls: 'property-actions' });
			actionsCell.style.width = '120px';
			actionsCell.style.flexShrink = '0';
			actionsCell.style.display = 'flex';
			actionsCell.style.justifyContent = 'center';
			actionsCell.style.gap = '5px';
			
			// Add "Edit" button
			const editButton = actionsCell.createEl('button', { text: 'Edit' });
			editButton.addEventListener('click', () => {
				// Add to properties to modify if not already there
				if (!(propName in this.propertiesToModify)) {
					// Use the first example as the default value
					this.propertiesToModify[propName] = propInfo.examples[0];
					// Refresh the property list
					const propertyList = this.contentEl.querySelector('.property-list') as HTMLElement;
					if (propertyList) {
						this.renderPropertyList(propertyList);
					}
				}
				
				// Scroll to the property list section
				const propertyListSection = this.contentEl.querySelector('.property-list-section');
				if (propertyListSection) {
					propertyListSection.scrollIntoView({ behavior: 'smooth' });
				}
			});
			
			// Add "Delete" button
			const deleteButton = actionsCell.createEl('button', { text: 'Delete' });
			deleteButton.addEventListener('click', () => {
				// Add to properties to delete if not already there
				if (!this.propertiesToDelete.includes(propName)) {
					this.propertiesToDelete.push(propName);
					// Refresh the delete list
					const deleteList = this.contentEl.querySelector('.delete-property-list') as HTMLElement;
					if (deleteList) {
						this.renderDeleteList(deleteList);
					}
				}
				
				// Scroll to the delete section
				const deleteSection = this.contentEl.querySelector('.property-delete-section');
				if (deleteSection) {
					deleteSection.scrollIntoView({ behavior: 'smooth' });
				}
			});
		}
	}
	
	// Helper method to infer property type from examples
	inferPropertyType(examples: any[]): string {
		if (examples.length === 0) return 'Unknown';
		
		// Check first example
		const firstExample = examples[0];
		
		if (typeof firstExample === 'number') return 'Number';
		if (typeof firstExample === 'boolean') return 'Checkbox';
		if (firstExample instanceof Date) return 'Date';
		if (Array.isArray(firstExample)) return 'List';
		
		// Check if it looks like a date string
		if (typeof firstExample === 'string') {
			// Try to detect date strings like YYYY-MM-DD
			const datePattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/;
			if (datePattern.test(firstExample)) {
				return 'Date';
			}
		}
		
		return 'Text';
	}
	
	renderPropertyList(container: HTMLElement) {
		container.empty();
		
		// Set container to full width with minimum
		container.style.width = '100%';
		container.style.minWidth = '700px';
		container.style.overflowX = 'visible';
		
		// Create heading row
		const headerRow = container.createEl('div', { cls: 'property-item header' });
		headerRow.style.display = 'flex';
		headerRow.style.width = '100%';
		headerRow.style.flexWrap = 'nowrap';
		headerRow.style.minWidth = '700px';
		
		const nameHeader = headerRow.createEl('div', { text: 'Property Name', cls: 'property-name' });
		nameHeader.style.flex = '1';
		nameHeader.style.minWidth = '100px';
		nameHeader.style.maxWidth = '200px';
		
		const typeHeader = headerRow.createEl('div', { text: 'Type', cls: 'property-type' });
		typeHeader.style.width = '120px';
		typeHeader.style.flexShrink = '0';
		
		const valueHeader = headerRow.createEl('div', { text: 'Value', cls: 'property-value' });
		valueHeader.style.flex = '2';
		valueHeader.style.minWidth = '150px';
		
		const actionsHeader = headerRow.createEl('div', { text: 'Actions', cls: 'property-actions' });
		actionsHeader.style.width = '60px';
		actionsHeader.style.flexShrink = '0';
		actionsHeader.style.textAlign = 'center';
		
		// Add existing properties
		for (const [key, value] of Object.entries(this.propertiesToModify)) {
			this.addPropertyRow(container, key, value);
		}
		
		// Add one empty row if no properties
		if (Object.keys(this.propertiesToModify).length === 0) {
			this.addNewPropertyRow(container);
		}
	}
	
	addPropertyRow(container: HTMLElement, key: string, value: any) {
		const row = container.createEl('div', { cls: 'property-item' });
		row.style.display = 'flex';
		row.style.width = '100%';
		row.style.flexWrap = 'nowrap';
		row.style.alignItems = 'center';
		row.style.marginBottom = '5px';
		
		// Property name
		const nameCell = row.createEl('div', { cls: 'property-name' });
		nameCell.style.flex = '1';
		nameCell.style.minWidth = '100px';
		nameCell.style.maxWidth = '200px';
		
		const nameInput = nameCell.createEl('input', {
			value: key,
			attr: { placeholder: 'Property name' }
		});
		nameInput.style.width = '100%';
		
		// Property type
		const typeCell = row.createEl('div', { cls: 'property-type' });
		typeCell.style.width = '120px';
		typeCell.style.flexShrink = '0';
		
		const typeSelect = typeCell.createEl('select', { cls: 'property-type-select' });
		typeSelect.style.width = '100%';
		
		// Determine current type
		let currentType = 'text'; // Default
		if (typeof value === 'number') currentType = 'number';
		else if (typeof value === 'boolean') currentType = 'checkbox';
		else if (value instanceof Date) currentType = 'date';
		else if (Array.isArray(value)) currentType = 'list';
		
		// Add options for type
		PROPERTY_TYPES.forEach(type => {
			const option = typeSelect.createEl('option', {
				text: type.label,
				value: type.value
			});
			if (type.value === currentType) {
				option.selected = true;
			}
		});
		
		// Property value
		const valueCell = row.createEl('div', { cls: 'property-value' });
		valueCell.style.flex = '2';
		valueCell.style.minWidth = '150px';
		
		const valueInput = valueCell.createEl('input', {
			value: formatInputValue(value),
			attr: { placeholder: 'Property value' }
		});
		valueInput.style.width = '100%';
		
		// Actions
		const actionsCell = row.createEl('div', { cls: 'property-actions' });
		actionsCell.style.width = '60px';
		actionsCell.style.flexShrink = '0';
		actionsCell.style.textAlign = 'center';
		
		const deleteButton = actionsCell.createEl('button', { text: '🗑️' });
		
		// Event handling for name
		nameInput.addEventListener('change', () => {
			const oldKey = key;
			const newKey = nameInput.value.trim();
			
			if (newKey && oldKey !== newKey) {
				// Remove old key and add new one
				const oldValue = this.propertiesToModify[oldKey];
				delete this.propertiesToModify[oldKey];
				this.propertiesToModify[newKey] = oldValue;
				key = newKey; // Update local reference
			}
		});
		
		// Event handling for type
		typeSelect.addEventListener('change', () => {
			const newType = typeSelect.value;
			let newValue = value;
			
			// Convert value based on type
			switch (newType) {
				case 'number':
					newValue = Number(value) || 0;
					break;
				case 'checkbox':
					newValue = Boolean(value);
					break;
				case 'date':
				case 'datetime':
					try {
						newValue = new Date(value).toISOString();
					} catch {
						newValue = new Date().toISOString();
					}
					break;
				case 'list':
					if (!Array.isArray(value)) {
						newValue = [String(value)];
					}
					break;
				default: // text
					newValue = String(value);
			}
			
			// Update the stored value and input field
			const currentKey = nameInput.value.trim();
			if (currentKey) {
				this.propertiesToModify[currentKey] = newValue;
				valueInput.value = formatInputValue(newValue);
			}
		});
		
		// Event handling for value
		valueInput.addEventListener('change', () => {
			const currentKey = nameInput.value.trim();
			if (currentKey) {
				// Convert the input value according to the current type
				const selectedType = typeSelect.value;
				let parsedValue: any = valueInput.value;
				
				switch (selectedType) {
					case 'number':
						parsedValue = Number(valueInput.value) || 0;
						break;
					case 'checkbox':
						parsedValue = valueInput.value.toLowerCase() === 'true';
						break;
					case 'list':
						try {
							parsedValue = JSON.parse(valueInput.value);
							if (!Array.isArray(parsedValue)) {
								parsedValue = [valueInput.value];
							}
						} catch {
							parsedValue = [valueInput.value];
						}
						break;
				}
				
				this.propertiesToModify[currentKey] = parsedValue;
			}
		});
		
		// Event handling for delete button
		deleteButton.addEventListener('click', () => {
			const currentKey = nameInput.value.trim();
			if (currentKey && this.propertiesToModify[currentKey]) {
				delete this.propertiesToModify[currentKey];
			}
			row.remove();
		});
	}
	
	addNewPropertyRow(container: HTMLElement) {
		const newKey = '';
		const newValue = '';
		this.addPropertyRow(container, newKey, newValue);
	}
	
	renderDeleteList(container: HTMLElement) {
		container.empty();
		container.style.width = '100%';
		container.style.minWidth = '700px';
		container.style.overflowX = 'visible';
		
		// Create heading row
		const headerRow = container.createEl('div', { cls: 'property-item header' });
		headerRow.style.display = 'flex';
		headerRow.style.width = '100%';
		headerRow.style.flexWrap = 'nowrap';
		headerRow.style.minWidth = '700px';
		
		const nameHeader = headerRow.createEl('div', { text: 'Property Name', cls: 'property-name' });
		nameHeader.style.flex = '1';
		
		const actionsHeader = headerRow.createEl('div', { text: 'Actions', cls: 'property-actions' });
		actionsHeader.style.width = '50px';
		actionsHeader.style.flexShrink = '0';
		actionsHeader.style.textAlign = 'center';
		
		// Add existing properties to delete
		for (const key of this.propertiesToDelete) {
			this.addDeleteRow(container, key);
		}
		
		// Add one empty row if no properties
		if (this.propertiesToDelete.length === 0) {
			this.addNewDeleteRow(container);
		}
	}
	
	addDeleteRow(container: HTMLElement, key: string) {
		const row = container.createEl('div', { cls: 'property-item' });
		row.style.display = 'flex';
		row.style.width = '100%';
		row.style.flexWrap = 'nowrap';
		row.style.alignItems = 'center';
		row.style.marginBottom = '5px';
		
		// Property name
		const nameCell = row.createEl('div', { cls: 'property-name' });
		nameCell.style.flex = '1';
		
		const nameInput = nameCell.createEl('input', {
			value: key,
			attr: { placeholder: 'Property name to delete' }
		});
		nameInput.style.width = '100%';
		
		// Actions
		const actionsCell = row.createEl('div', { cls: 'property-actions' });
		actionsCell.style.width = '50px';
		actionsCell.style.flexShrink = '0';
		actionsCell.style.textAlign = 'center';
		
		const deleteButton = actionsCell.createEl('button', { text: '🗑️' });
		
		// Event handling
		nameInput.addEventListener('change', () => {
			const oldKey = key;
			const newKey = nameInput.value.trim();
			
			if (oldKey && this.propertiesToDelete.includes(oldKey)) {
				// Remove old key
				this.propertiesToDelete = this.propertiesToDelete.filter(k => k !== oldKey);
			}
			
			if (newKey && !this.propertiesToDelete.includes(newKey)) {
				// Add new key
				this.propertiesToDelete.push(newKey);
				key = newKey; // Update local reference
			}
		});
		
		deleteButton.addEventListener('click', () => {
			const currentKey = nameInput.value.trim();
			if (currentKey) {
				this.propertiesToDelete = this.propertiesToDelete.filter(k => k !== currentKey);
			}
			row.remove();
		});
	}
	
	addNewDeleteRow(container: HTMLElement) {
		this.addDeleteRow(container, '');
	}
	
	async applyChanges() {
		let successCount = 0;
		let errorCount = 0;
		
		// Process each file
		for (const file of this.files) {
			try {
				// Get existing properties if we're preserving them
				let fileProperties: Record<string, any> = {};
				
				if (this.preserveExisting) {
					fileProperties = await this.plugin.parseFileProperties(file);
				}
				
				// Delete specified properties
				for (const propToDelete of this.propertiesToDelete) {
					if (propToDelete in fileProperties) {
						delete fileProperties[propToDelete];
					}
				}
				
				// Add/update properties
				// Filter out empty property names
				const validPropertiesToModify: Record<string, any> = {};
				Object.entries(this.propertiesToModify)
					.filter(([key, _]) => key.trim() !== '')
					.forEach(([key, value]) => {
						validPropertiesToModify[key] = value;
					});
				
				// Apply the properties
				const mergedProperties = {
					...fileProperties,
					...validPropertiesToModify
				};
				
				const success = await this.plugin.applyProperties(file, mergedProperties, false);
				if (success) {
					successCount++;
				} else {
					errorCount++;
				}
			} catch (error) {
				console.error(`Error processing file ${file.path}:`, error);
				errorCount++;
			}
		}
		
		// Show results
		new Notice(`Modified ${successCount} files successfully. ${errorCount} errors.`);
		this.plugin.navigateToModal(this, 'main');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Helper function to format values for input fields
function formatInputValue(value: any): string {
    if (value === null || value === undefined) {
        return '';
    }
    
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    
    if (Array.isArray(value)) {
        return JSON.stringify(value);
    }
    
    return String(value);
}

// Helper function to format value previews
function formatValuePreview(value: any): string {
	if (value === null || value === undefined) {
		return 'null';
	}
	
	if (typeof value === 'string') {
		// Truncate long strings
		if (value.length > 30) {
			return `"${value.substring(0, 27)}..."`;
		}
		return `"${value}"`;
	}
	
	if (Array.isArray(value)) {
		if (value.length === 0) return '[]';
		return `[Array: ${value.length} items]`;
	}
	
	if (typeof value === 'object') {
		return '{Object}';
	}
	
	// For booleans, numbers, etc.
	return String(value);
}

// Settings tab with hierarchical template display - fixed type casting
class YAMLPropertyManagerSettingTab extends PluginSettingTab {
	plugin: YAMLPropertyManagerPlugin;

	constructor(app: App, plugin: YAMLPropertyManagerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'YAML Property Manager Settings' });

		// Template Paths Section
		containerEl.createEl('h3', { text: 'Template Paths' });
		
		const templatePathsContainer = containerEl.createDiv('template-paths-container');
		templatePathsContainer.style.marginBottom = '20px';
		templatePathsContainer.style.border = '1px solid var(--background-modifier-border)';
		templatePathsContainer.style.borderRadius = '4px';
		templatePathsContainer.style.padding = '10px';
		templatePathsContainer.style.maxHeight = '300px';
		templatePathsContainer.style.overflowY = 'auto';
		
		// Display existing template paths in a hierarchical structure
		if (this.plugin.settings.templatePaths.length === 0) {
			templatePathsContainer.createEl('p', {
				text: 'No template paths configured. Add template files or directories below.',
				cls: 'setting-item-description'
			});
		} else {
			// Generate a tree structure of the templates
			this.renderTemplatePathsHierarchy(templatePathsContainer);
		}
		
		// Single button to add templates
		const addTemplatesButton = containerEl.createEl('button', { 
			text: 'Browse and Select Templates',
			cls: 'mod-cta'
		});
		addTemplatesButton.style.marginBottom = '20px';
		addTemplatesButton.style.marginTop = '10px';
		
		addTemplatesButton.addEventListener('click', () => {
			new TemplateFileSelectorModal(this.app, async (result) => {
				// Process selected files and folders
				let countAdded = 0;
				
				// Add individual files
				for (const file of result.files) {
					// Check if already exists
					const alreadyExists = this.plugin.settings.templatePaths.some(
						tp => tp.type === 'file' && tp.path === file.path
					);
					
					if (!alreadyExists) {
						this.plugin.settings.templatePaths.push({
							type: 'file',
							path: file.path,
							includeSubdirectories: true // Always include subdirectories
						});
						countAdded++;
					}
				}
				
				// Add folders
				for (const folder of result.folders) {
					// Check if already exists
					const alreadyExists = this.plugin.settings.templatePaths.some(
						tp => tp.type === 'directory' && tp.path === folder.path
					);
					
					if (!alreadyExists) {
						this.plugin.settings.templatePaths.push({
							type: 'directory',
							path: folder.path,
							includeSubdirectories: true // Always include subdirectories
						});
						countAdded++;
					}
				}
				
				// Save settings and refresh
				if (countAdded > 0) {
					await this.plugin.saveSettings();
					new Notice(`Added ${countAdded} template source${countAdded !== 1 ? 's' : ''}`);
					this.display(); // Refresh view
				} else if (result.files.length > 0 || result.folders.length > 0) {
					new Notice('All selected templates were already in your list');
				}
			}).open();
		});
		
		// Max recent templates
		new Setting(containerEl)
			.setName('Max Recent Templates')
			.setDesc('Maximum number of recent templates to remember')
			.addSlider(slider => slider
				.setLimits(1, 10, 1)
				.setValue(this.plugin.settings.maxRecentTemplates)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxRecentTemplates = value;
					// Trim the list if needed
					if (this.plugin.settings.recentTemplates.length > value) {
						this.plugin.settings.recentTemplates = 
							this.plugin.settings.recentTemplates.slice(0, value);
					}
					await this.plugin.saveSettings();
				}));
		
		// Clear recent templates
		new Setting(containerEl)
			.setName('Recent Templates')
			.setDesc('Clear the list of recently used templates')
			.addButton(button => button
				.setButtonText('Clear Recent Templates')
				.onClick(async () => {
					this.plugin.settings.recentTemplates = [];
					await this.plugin.saveSettings();
					new Notice('Recent templates cleared');
				}));
	}
	
	// Render template paths as a hierarchy
	// Render template paths as a hierarchy
// Render template paths as a hierarchy
// Render template paths as a hierarchy
// Render template paths as a hierarchy
renderTemplatePathsHierarchy(container: HTMLElement) {
    // Clear the container first
    container.empty();
    
    // First, build a hierarchical tree structure
    interface TreeNode {
        name: string;
        path: string;
        isDirectory: boolean;
        children: TreeNode[];
        templatePathIndex?: number; // Reference to the original index in settings
    }
    
    const rootNode: TreeNode = {
        name: this.app.vault.getName(),
        path: '',
        isDirectory: true,
        children: []
    };
    
    // Helper to find or create a node for a path
    const getNodeForPath = (path: string, isDirectory: boolean): TreeNode => {
        if (path === '') return rootNode;
        
        const parts = path.split('/');
        let currentNode = rootNode;
        let currentPath = '';
        
        // Navigate/create the tree structure
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const isLastPart = i === parts.length - 1;
            
            // Look for existing node
            let found = currentNode.children.find(c => c.name === part);
            
            if (!found) {
                // Create a new node
                const newNode: TreeNode = {
                    name: part,
                    path: currentPath,
                    isDirectory: isLastPart ? isDirectory : true, // Intermediate nodes are always directories
                    children: []
                };
                
                currentNode.children.push(newNode);
                found = newNode;
            }
            
            currentNode = found;
        }
        
        return currentNode;
    };
    
    // Add all template paths to the tree
    this.plugin.settings.templatePaths.forEach((tp, index) => {
        const node = getNodeForPath(tp.path, tp.type === 'directory');
        node.templatePathIndex = index; // Store reference to original index
    });
    
    // Sort helper for tree nodes
    const sortTreeNodes = (nodes: TreeNode[]) => {
        // Sort by type first (directories before files), then by name
        nodes.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        
        // Recursively sort children
        for (const node of nodes) {
            if (node.children.length > 0) {
                sortTreeNodes(node.children);
            }
        }
    };
    
    // Sort the tree
    sortTreeNodes(rootNode.children);
    
    // Create a unique ID for each node
    let nodeCounter = 0;
    
    // Simple recursive render function that uses data attributes for connections
    const renderNode = (node: TreeNode, parentEl: HTMLElement, level: number = 0) => {
        if (node === rootNode) {
            // Root node - just render children directly
            for (const child of node.children) {
                if (child.name !== "Obsidian") { // Skip the Obsidian node
                    renderNode(child, parentEl, level);
                }
            }
            return;
        }
        
        // Generate a unique ID for this node
        const nodeId = `template-node-${nodeCounter++}`;
        const childrenId = `children-${nodeId}`;
        
        // Create node container
        const nodeEl = parentEl.createDiv({ 
            cls: 'template-node',
            attr: { 'data-node-id': nodeId }
        });
        
        // Create the header (with click handler for folders)
        const headerEl = nodeEl.createDiv({
            cls: 'template-node-header' + (node.isDirectory ? ' is-folder' : '')
        });
        headerEl.style.paddingLeft = `${level * 20}px`;
        
        // Add folder/file icon
        const iconEl = headerEl.createSpan({ cls: 'template-node-icon' });
        iconEl.textContent = node.isDirectory ? '📁 ' : '📄 ';
        
        // Add name
        const nameEl = headerEl.createSpan({
            text: node.name,
            cls: 'template-node-name'
        });
        
        // Add remove button
        const removeBtn = headerEl.createEl('button', {
            text: 'Remove',
            cls: 'template-node-remove'
        });
        
        // Handle remove button click
        removeBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); // Prevent expanding/collapsing
            
            if (node.templatePathIndex !== undefined) {
                // Direct template path
                this.plugin.settings.templatePaths.splice(node.templatePathIndex, 1);
            } else {
                // Find all child templates
                const pathPrefix = node.path + '/';
                const indicesToRemove: number[] = [];
                
                this.plugin.settings.templatePaths.forEach((tp, index) => {
                    if (tp.path === node.path || tp.path.startsWith(pathPrefix)) {
                        indicesToRemove.push(index);
                    }
                });
                
                // Remove in reverse order
                for (let i = indicesToRemove.length - 1; i >= 0; i--) {
                    this.plugin.settings.templatePaths.splice(indicesToRemove[i], 1);
                }
            }
            
            await this.plugin.saveSettings();
            this.display(); // Refresh the entire display
        });
        
        // If this is a directory node, add children container
        if (node.isDirectory && node.children.length > 0) {
            // Create children container (initially collapsed)
            const childrenEl = nodeEl.createDiv({
                cls: 'template-node-children',
                attr: { 'id': childrenId }
            });
            childrenEl.style.display = 'none'; // Start collapsed
            
            // Add expand/collapse handler to the header
            headerEl.addEventListener('click', (e) => {
                // Only toggle if not clicking the remove button
                if (!(e.target instanceof HTMLButtonElement)) {
                    const isExpanded = childrenEl.style.display !== 'none';
                    
                    // Toggle display
                    childrenEl.style.display = isExpanded ? 'none' : 'block';
                    
                    // Update icon
                    iconEl.textContent = isExpanded ? '📁 ' : '📂 ';
                }
            });
            
            // Render children
            for (const child of node.children) {
                renderNode(child, childrenEl, level + 1);
            }
        }
    };
    
    // Render the entire tree
    renderNode(rootNode, container);
    
    // Add an info message if no templates are configured
    if (rootNode.children.length === 0) {
        container.createEl('p', {
            text: 'No template paths configured. Add template files or directories below.',
            cls: 'setting-item-description'
        });
    }
}
}

// Improved Folder selector modal with nested directories
// Simplified Folder selector modal with nested directories
class FolderSelectorModal extends Modal {
    onSelect: (folder: TFolder | null) => void;
    
    constructor(app: App, onSelect: (folder: TFolder | null) => void) {
        super(app);
        this.onSelect = onSelect;
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('folder-selector-modal');
        
        // Ensure modal has scrolling when needed
        this.modalEl.style.maxHeight = '85vh';
        this.modalEl.style.overflow = 'auto';
        
        contentEl.createEl('h2', { text: 'Select a Template Directory' });
        
        // Create folder tree with fixed height and scrolling
        const folderTree = contentEl.createDiv({ cls: 'folder-tree-container' });
        folderTree.style.maxHeight = '400px';
        folderTree.style.overflowY = 'auto';
        
        // Add root folder and its children
        const rootFolder = this.app.vault.getRoot();
        this.addFolder(folderTree, rootFolder, true); // Expand root by default
        
        // Buttons - make sure they're outside scrollable area
        const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
        buttonContainer.style.position = 'sticky';
        buttonContainer.style.bottom = '0';
        buttonContainer.style.backgroundColor = 'var(--background-primary)';
        buttonContainer.style.padding = '10px 0';
        buttonContainer.style.zIndex = '10';
        
        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => {
            this.onSelect(null);
            this.close();
        });
    }
    
    addFolder(parentEl: HTMLElement, folder: TFolder, expanded: boolean = false) {
        // Don't add hidden folders
        if (folder.isRoot() || !folder.path.startsWith('.')) {
            // Create folder item
            const folderItem = parentEl.createDiv({ cls: 'folder-tree-item' });
            
            // Create folder header (the clickable part with the folder name)
            const folderHeader = folderItem.createDiv({ cls: 'folder-tree-header' });
            
            // Add appropriate indentation based on nesting level
            const nestingLevel = folder.path.split('/').length - (folder.isRoot() ? 1 : 0);
            folderHeader.style.paddingLeft = (nestingLevel * 20) + 'px';
            
            // Folder icon - use as the toggle element
            const folderIcon = folderHeader.createSpan({ cls: 'folder-icon' });
            folderIcon.textContent = expanded ? '📂 ' : '📁 ';
            
            // Folder name
            const folderName = folderHeader.createSpan({ cls: 'folder-name' });
            folderName.textContent = folder.isRoot() ? 'Root' : folder.name;
            
            // Check if folder has subfolders
            const hasSubfolders = folder.children.some(child => child instanceof TFolder);
            
            // Create container for child folders
            const childContainer = folderItem.createDiv({ cls: 'folder-children' });
            childContainer.style.display = expanded ? 'block' : 'none';
            
            // Add child folders
            const childFolders = folder.children
                .filter(child => child instanceof TFolder)
                .sort((a, b) => a.name.localeCompare(b.name));
            
            for (const childFolder of childFolders) {
                this.addFolder(childContainer, childFolder as TFolder);
            }
            
            // Make folder selectable (except for root)
            if (!folder.isRoot()) {
                folderHeader.addEventListener('click', (e) => {
                    // Double-click to select a folder
                    if (e.detail === 2) {
                        this.onSelect(folder);
                        this.close();
                        return;
                    }
                    
                    // Single click toggles expansion if there are subfolders
                    if (hasSubfolders) {
                        const isExpanded = childContainer.style.display !== 'none';
                        childContainer.style.display = isExpanded ? 'none' : 'block';
                        folderIcon.textContent = isExpanded ? '📁 ' : '📂 ';
                    }
                });
                
                // Add selectability class for styling
                folderHeader.addClass('selectable');
            } else {
                // Root folder just toggles expansion
                folderHeader.addEventListener('click', () => {
                    if (hasSubfolders) {
                        const isExpanded = childContainer.style.display !== 'none';
                        childContainer.style.display = isExpanded ? 'none' : 'block';
                        folderIcon.textContent = isExpanded ? '📁 ' : '📂 ';
                    }
                });
            }
            
            // If no subfolders and we're showing this expanded, hide the children container
            if (!hasSubfolders && expanded) {
                childContainer.style.display = 'none';
            }
        }
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Modal for selecting multiple template files and/or directories
class TemplateFileSelectorModal extends Modal {
    onSelect: (result: { 
        files: TFile[], 
        folders: TFolder[], 
        folderSettings: Map<string, boolean> 
    }) => void;
    selectedFiles: TFile[] = [];
    selectedFolders: TFolder[] = [];
    folderSubdirectoryOptions: Map<string, boolean> = new Map();
    
    constructor(app: App, onSelect: (result: { 
        files: TFile[], 
        folders: TFolder[], 
        folderSettings: Map<string, boolean> 
    }) => void) {
        super(app);
        this.onSelect = onSelect;
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('template-file-selector-modal');
        
        // Ensure modal has appropriate dimensions
        this.modalEl.style.width = '95%';
        this.modalEl.style.maxWidth = '900px';
        this.modalEl.style.maxHeight = '85vh';
        this.modalEl.style.overflowY = 'auto';
        
        // Add header with title
        const headerContainer = contentEl.createDiv({ cls: 'modal-header' });
        headerContainer.style.display = 'flex';
        headerContainer.style.alignItems = 'center';
        headerContainer.style.marginBottom = '15px';
        
        headerContainer.createEl('h2', { text: 'Select Template Files and Directories' });
        
        // Instructions
        contentEl.createEl('p', { 
            text: 'Select files to use as templates, or select entire directories. Check the box to include a file or folder.'
        });
        
        // File tree container
        const fileTreeContainer = contentEl.createDiv({ cls: 'file-tree-container' });
        fileTreeContainer.style.maxHeight = '400px';
        fileTreeContainer.style.overflowY = 'auto';
        
        // Selection counter
        const selectionCountEl = contentEl.createDiv({ cls: 'selection-count' });
        selectionCountEl.textContent = 'Nothing selected';
        
        // File tree
        const fileTree = fileTreeContainer.createDiv({ cls: 'file-tree' });
        
        // Add root folder
        this.addFolderToTree(fileTree, this.app.vault.getRoot(), selectionCountEl);
        
        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
        buttonContainer.style.position = 'sticky';
        buttonContainer.style.bottom = '0';
        buttonContainer.style.backgroundColor = 'var(--background-primary)';
        buttonContainer.style.padding = '10px 0';
        buttonContainer.style.zIndex = '10';
        
        const confirmButton = buttonContainer.createEl('button', {
            text: 'Add Selected Files & Folders',
            cls: 'primary-button',
            attr: { disabled: true }
        });
        confirmButton.addEventListener('click', () => {
            // Pass along the selected files, folders, and the subdirectory options map
            const result = {
                files: this.selectedFiles,
                folders: this.selectedFolders,
                folderSettings: this.folderSubdirectoryOptions
            };
            
            this.onSelect(result);
            this.close();
        });
        
        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => {
            this.onSelect({ 
                files: [], 
                folders: [], 
                folderSettings: new Map() 
            });
            this.close();
        });
    }
    
    addFolderToTree(parentEl: HTMLElement, folder: TFolder, selectionCountEl: HTMLElement, level: number = 0) {
		// Special handling for root folder - just add its children directly
		if (folder.isRoot()) {
			// Sort all children: folders before files, then alphabetically
			const allChildren = [...folder.children];
			allChildren.sort((a, b) => {
				// First sort by type: folders before files
				const aIsFolder = a instanceof TFolder;
				const bIsFolder = b instanceof TFolder;
				
				if (aIsFolder !== bIsFolder) {
					return aIsFolder ? -1 : 1;
				}
				
				// If same type, sort alphabetically by name
				return a.name.localeCompare(b.name);
			});
			
			// Add all children directly to the parent element
			for (const child of allChildren) {
				if (child instanceof TFolder) {
					// Don't add hidden folders
					if (!child.path.startsWith('.')) {
						// Add subfolder - use the same level since we're skipping root
						this.addFolderToTree(parentEl, child, selectionCountEl, level);
					}
				} else if (child instanceof TFile && child.extension === 'md') {
					// Add file - use the same level since we're skipping root
					this.addFileToTree(parentEl, child, selectionCountEl, level);
				}
			}
			return; // Exit early after processing root
		}
		
		// Regular handling for non-root folders (no change from original code)
		// Don't add hidden folders
		if (!folder.path.startsWith('.')) {
			// Create folder item
			const folderItem = parentEl.createDiv({ cls: 'file-tree-item folder-item' });
			
			// Header row with checkbox
			const headerRow = folderItem.createDiv({ cls: 'file-tree-header' });
			headerRow.style.paddingLeft = (level * 20) + 'px';
			
			// Checkbox for folder selection
			const checkbox = headerRow.createEl('input', {
				type: 'checkbox',
				cls: 'folder-checkbox'
			});
			checkbox.style.marginRight = '8px';
			
			// Set initial checked state based on selection
			checkbox.checked = !!this.selectedFolders.find(f => f.path === folder.path);
			
			// Folder icon
			const folderIcon = headerRow.createSpan({ cls: 'folder-icon' });
			folderIcon.textContent = '📁 ';
			
			// Folder name
			headerRow.createSpan({ text: folder.name, cls: 'folder-name' });
			
			// Always set to include subdirectories without showing the option
			this.folderSubdirectoryOptions.set(folder.path, true);
			
			// Children container - will hold files and subfolders
			const childrenContainer = folderItem.createDiv({ cls: 'folder-children' });
			
			// Sort all children first: folders before files, then alphabetically
			const allChildren = [...folder.children];
			allChildren.sort((a, b) => {
				// First sort by type: folders before files
				const aIsFolder = a instanceof TFolder;
				const bIsFolder = b instanceof TFolder;
				
				if (aIsFolder !== bIsFolder) {
					return aIsFolder ? -1 : 1;
				}
				
				// If same type, sort alphabetically by name
				return a.name.localeCompare(b.name);
			});
			
			// Add all children in the sorted order
			for (const child of allChildren) {
				if (child instanceof TFolder) {
					// Add subfolder
					this.addFolderToTree(childrenContainer, child, selectionCountEl, level + 1);
				} else if (child instanceof TFile && child.extension === 'md') {
					// Add file
					this.addFileToTree(childrenContainer, child, selectionCountEl, level + 1);
				}
			}
			
			// Handle folder selection
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					// Add folder to selection if not already there
					if (!this.selectedFolders.find(f => f.path === folder.path)) {
						this.selectedFolders.push(folder);
					}
					
					// Recursively check all child checkboxes to visually indicate selection
					const childCheckboxes = childrenContainer.querySelectorAll('input[type="checkbox"]');
					childCheckboxes.forEach((cb: HTMLInputElement) => {
						if (!cb.checked) {
							cb.checked = true;
							
							// Manually trigger change event for each checkbox
							const changeEvent = new Event('change');
							cb.dispatchEvent(changeEvent);
						}
					});
				} else {
					// Remove folder from selection
					this.selectedFolders = this.selectedFolders.filter(f => f.path !== folder.path);
					
					// Recursively uncheck all child checkboxes
					const childCheckboxes = childrenContainer.querySelectorAll('input[type="checkbox"]');
					childCheckboxes.forEach((cb: HTMLInputElement) => {
						if (cb.checked) {
							cb.checked = false;
							
							// Manually trigger change event for each checkbox
							const changeEvent = new Event('change');
							cb.dispatchEvent(changeEvent);
						}
					});
				}
				
				this.updateSelectionCount(selectionCountEl);
			});
			
			// Make folder expandable
			headerRow.addEventListener('click', (e) => {
				// Don't toggle if clicking directly on the checkbox
				if (e.target !== checkbox) {
					const isExpanded = childrenContainer.style.display !== 'none';
					childrenContainer.style.display = isExpanded ? 'none' : 'block';
					folderIcon.textContent = isExpanded ? '📁 ' : '📂 ';
				}
			});
			
			// Collapsed by default
			childrenContainer.style.display = 'none';
		}
	}
    
    addFileToTree(parentEl: HTMLElement, file: TFile, selectionCountEl: HTMLElement, level: number = 0) {
        // Create file item
        const fileItem = parentEl.createDiv({ cls: 'file-tree-item file-item' });
        
        // Header with checkbox
        const headerRow = fileItem.createDiv({ cls: 'file-tree-header' });
        headerRow.style.paddingLeft = (level * 20) + 'px';
        
        // Checkbox for file selection
        const checkbox = headerRow.createEl('input', {
            type: 'checkbox',
            cls: 'file-checkbox'
        });
        checkbox.style.marginRight = '8px';
        
        // Set initial checked state based on selection
        checkbox.checked = !!this.selectedFiles.find(f => f.path === file.path);
        
        // File icon
        const fileIcon = headerRow.createSpan({ cls: 'file-icon' });
        fileIcon.textContent = '📄 ';
        
        // File name
        headerRow.createSpan({ text: file.name, cls: 'file-name' });
        
        // Handle file selection
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                // Add file to selection if not already there
                if (!this.selectedFiles.find(f => f.path === file.path)) {
                    this.selectedFiles.push(file);
                }
            } else {
                // Remove file from selection
                this.selectedFiles = this.selectedFiles.filter(f => f.path !== file.path);
            }
            
            this.updateSelectionCount(selectionCountEl);
        });
        
        // Make whole row clickable
        headerRow.addEventListener('click', (e) => {
            // Don't toggle if clicking directly on the checkbox
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
                
                // Trigger the change event
                const changeEvent = new Event('change');
                checkbox.dispatchEvent(changeEvent);
            }
        });
    }
    
    updateSelectionCount(countEl: HTMLElement) {
        const fileCount = this.selectedFiles.length;
        const folderCount = this.selectedFolders.length;
        const totalCount = fileCount + folderCount;
        
        if (totalCount === 0) {
            countEl.textContent = 'Nothing selected';
        } else {
            let text = '';
            if (fileCount > 0) {
                text += `${fileCount} file${fileCount !== 1 ? 's' : ''}`;
            }
            if (folderCount > 0) {
                if (fileCount > 0) text += ' and ';
                text += `${folderCount} folder${folderCount !== 1 ? 's' : ''}`;
            }
            text += ' selected';
            countEl.textContent = text;
        }
        
        // Enable/disable confirm button
        const confirmButton = this.contentEl.querySelector('.primary-button') as HTMLButtonElement;
        if (confirmButton) {
            confirmButton.disabled = totalCount === 0;
        }
    }
    
    // Helper method to get all markdown files from a folder recursively
    getMarkdownFilesInFolder(folder: TFolder): TFile[] {
        const files: TFile[] = [];
        
        const processFolder = (f: TFolder) => {
            for (const child of f.children) {
                if (child instanceof TFile && child.extension === 'md') {
                    files.push(child as TFile);
                } else if (child instanceof TFolder) {
                    processFolder(child as TFolder);
                }
            }
        };
        
        processFolder(folder);
        return files;
    }
    
    // Helper method to get all subfolders from a folder recursively
    getAllSubfolders(folder: TFolder): TFolder[] {
        const subfolders: TFolder[] = [];
        
        const processFolder = (f: TFolder) => {
            for (const child of f.children) {
                if (child instanceof TFolder) {
                    subfolders.push(child as TFolder);
                    processFolder(child as TFolder);
                }
            }
        };
        
        processFolder(folder);
        return subfolders;
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}