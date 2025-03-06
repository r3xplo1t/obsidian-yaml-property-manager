// main.ts
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

interface YAMLPropertyManagerSettings {
	defaultTemplateFilePath: string;
	recentTemplates: string[];
	maxRecentTemplates: number;
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
	defaultTemplateFilePath: '',
	recentTemplates: [],
	maxRecentTemplates: 5
}

export default class YAMLPropertyManagerPlugin extends Plugin {
	settings: YAMLPropertyManagerSettings;

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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
	
	// Navigation method to move between modals
	navigateToModal(currentModal: Modal, targetModalType: string, ...args: any[]) {
		// Close current modal
		currentModal.close();
		
		// Open new modal based on type
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
				if (Array.isArray(args[0])) {
					new TemplateSelectionModal(this.app, this, args[0]).open();
				}
				break;
			case 'bulkEdit':
				if (Array.isArray(args[0])) {
					new BulkPropertyEditorModal(this.app, this, args[0]).open();
				}
				break;
			case 'batchSelect':
				if (typeof args[0] === 'function') {
					new BatchFileSelectorModal(this.app, args[0]).open();
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
		
		// Add these lines for width control
		this.modalEl.style.width = '95%';
		this.modalEl.style.maxWidth = '900px';
		
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
		propertyContainer.style.overflow = 'hidden';
		
		// Display existing properties
		this.renderPropertyEditor(propertyContainer);
		
		// Add buttons
		const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
		
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

// Modal for selecting a template file
class TemplateSelectionModal extends Modal {
	plugin: YAMLPropertyManagerPlugin;
	targetFiles: TFile[];
	selectedTemplate: TFile | null = null;
	selectedProperties: string[] = [];
	consistentProperties: string[] = [];

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
		
		// Add these lines for width control
		this.modalEl.style.width = '95%';
		this.modalEl.style.maxWidth = '900px';
		
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
		
		headerContainer.createEl('h2', { text: 'Select Template File' });
		
		// Template selection
		const templateContainer = contentEl.createDiv({ cls: 'template-container' });
		templateContainer.style.width = '100%';
		templateContainer.style.boxSizing = 'border-box';
		
		// Default template option if set
		if (this.plugin.settings.defaultTemplateFilePath) {
			const defaultFile = this.app.vault.getAbstractFileByPath(this.plugin.settings.defaultTemplateFilePath);
			if (defaultFile instanceof TFile) {
				const defaultOption = templateContainer.createDiv({ cls: 'template-option' });
				
				const radioBtn = defaultOption.createEl('input', {
					type: 'radio',
					attr: {
						name: 'template',
						value: defaultFile.path,
						id: `template-${defaultFile.path}`
					}
				});
				radioBtn.addEventListener('change', () => {
					if (radioBtn.checked) {
						this.selectedTemplate = defaultFile;
						this.loadTemplateProperties();
					}
				});
				
				defaultOption.createEl('label', {
					text: `Default: ${defaultFile.name}`,
					attr: { for: `template-${defaultFile.path}` }
				});
			}
		}
		
		// Recent templates
		if (this.plugin.settings.recentTemplates.length > 0) {
			templateContainer.createEl('h3', { text: 'Recent Templates' });
			
			for (const path of this.plugin.settings.recentTemplates) {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					const recentOption = templateContainer.createDiv({ cls: 'template-option' });
					
					const radioBtn = recentOption.createEl('input', {
						type: 'radio',
						attr: {
							name: 'template',
							value: file.path,
							id: `template-${file.path}`
						}
					});
					radioBtn.addEventListener('change', () => {
						if (radioBtn.checked) {
							this.selectedTemplate = file;
							this.loadTemplateProperties();
						}
					});
					
					recentOption.createEl('label', {
						text: file.name,
						attr: { for: `template-${file.path}` }
					});
				}
			}
		}
		
		// Browse button
		const browseButton = templateContainer.createEl('button', { text: 'Browse Files' });
		browseButton.style.width = '100%';
		browseButton.style.boxSizing = 'border-box';
		browseButton.addEventListener('click', () => {
			new FileSelectorModal(this.app, (file) => {
				if (file) {
					this.selectedTemplate = file;
					this.loadTemplateProperties();
				}
			}).open();
		});
		
		// Property selection container (initially empty, populated after template selection)
		const propertyContainer = contentEl.createDiv({ cls: 'property-container' });
		propertyContainer.style.width = '100%';
		propertyContainer.style.boxSizing = 'border-box';
		propertyContainer.createEl('p', { 
			text: 'Select a template file to view and choose properties' 
		});
		
		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
		
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
		
		// Add these lines for width control
		this.modalEl.style.width = '95%';
		this.modalEl.style.maxWidth = '900px';
		
		contentEl.createEl('h2', { text: 'Select a Template File' });
		
		// Create file tree
		const fileTree = contentEl.createDiv({ cls: 'file-tree' });
		
		// Recursively add files/folders
		const rootFolder = this.app.vault.getRoot();
		this.addFolderToTree(fileTree, rootFolder);
		
		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
		
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
		
		this.modalEl.style.width = '95%';
		this.modalEl.style.maxWidth = '900px';

		contentEl.createEl('h2', { text: 'YAML Property Manager' });
		
		// Actions section
		const actionsContainer = contentEl.createDiv({ cls: 'actions-container' });
		
		// Single file management
		const singleFileContainer = actionsContainer.createDiv({ cls: 'action-section' });
		singleFileContainer.createEl('h3', { text: 'Single File Operations' });
		
		const currentFileButton = singleFileContainer.createEl('button', { 
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
		
		// Batch operations
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
					this.selectedFiles = this.app.vault.getMarkdownFiles()
						.filter(file => file.parent === currentFolder);
					
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
			this.plugin.navigateToModal(this, 'batchSelect', (files: TFile[]) => {
				if (files && files.length > 0) {
					this.selectedFiles = files;
					// This is a little trick - we need to reopen the main modal with the selected files
					new PropertyManagerModal(this.app, this.plugin).open();
					setTimeout(() => {
						const mainModal = document.querySelector('.property-manager-modal');
						if (mainModal) {
							const fileSelectionContainer = mainModal.querySelector('.file-selection');
							if (fileSelectionContainer) {
								const countEl = fileSelectionContainer.querySelector('.selected-files-count');
								if (countEl) {
									countEl.textContent = `${files.length} files selected`;
								}
								
								// Enable buttons
								const buttons = mainModal.querySelectorAll('.primary-button') as NodeListOf<HTMLButtonElement>;
								buttons.forEach(button => {
									button.disabled = false;
								});
							}
						}
					}, 100);
				}
			});
		});
		
		// Selected files count
		const selectedFilesCountEl = fileSelectionContainer.createEl('div', {
			cls: 'selected-files-count',
			text: 'No files selected'
		});
		
		// Apply template button
		const applyTemplateButton = batchContainer.createEl('button', {
			text: 'Apply Template to Selected Files',
			cls: 'primary-button',
			attr: { disabled: true }
		});
		applyTemplateButton.style.width = '100%';
		applyTemplateButton.style.boxSizing = 'border-box';
		applyTemplateButton.addEventListener('click', () => {
			if (this.selectedFiles.length > 0) {
				this.plugin.navigateToModal(this, 'template', this.selectedFiles);
			} else {
				new Notice('Please select files first');
			}
		});

		// Bulk edit button
		const bulkEditButton = batchContainer.createEl('button', {
			text: 'Bulk Edit Properties',
			cls: 'primary-button',
			attr: { disabled: true }
		});
		bulkEditButton.style.width = '100%';
		bulkEditButton.style.boxSizing = 'border-box';
		bulkEditButton.addEventListener('click', () => {
			if (this.selectedFiles.length > 0) {
				this.plugin.navigateToModal(this, 'bulkEdit', this.selectedFiles);
			} else {
				new Notice('Please select files first');
			}
		});

		// Help section
		const helpContainer = contentEl.createDiv({ cls: 'help-container' });
		helpContainer.createEl('h3', { text: 'Help' });

		helpContainer.createEl('p', { 
			text: 'This plugin helps you manage YAML frontmatter properties in your markdown files.' 
		});
		
		const featureList = helpContainer.createEl('ul');
		featureList.style.width = '100%';
		featureList.style.boxSizing = 'border-box';
		featureList.style.paddingInlineStart = '20px';
        
        featureList.createEl('li', { text: 'Edit properties of individual files' }).style.width = '100%';
		featureList.createEl('li', { text: 'Apply properties from template files to multiple files' }).style.width = '100%';
		featureList.createEl('li', { text: 'Maintain consistent property values across files' }).style.width = '100%';
		featureList.createEl('li', { text: 'Preserve property order from templates' }).style.width = '100%';
		featureList.createEl('li', { text: 'Bulk edit properties across multiple files without templates' }).style.width = '100%';
		featureList.createEl('li', { text: 'Specify property types to match Obsidian\'s property system' }).style.width = '100%';
		
		// Close button
		const closeButton = contentEl.createEl('button', { text: 'Close' });
		closeButton.style.width = 'auto';
		closeButton.style.boxSizing = 'border-box';
		closeButton.addEventListener('click', () => {
			this.close();
		});
	}
	
	updateSelectedFilesCount(container: HTMLElement) {
		const countEl = container.querySelector('.selected-files-count');
		if (countEl) {
			countEl.textContent = `${this.selectedFiles.length} files selected`;
		}
		
		// Enable/disable buttons
		const buttons = this.contentEl.querySelectorAll('.primary-button') as NodeListOf<HTMLButtonElement>;
		buttons.forEach(button => {
			button.disabled = this.selectedFiles.length === 0;
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
			new PropertyManagerModal(this.app, (this.app as any).plugins.plugins["yaml-property-manager"]).open();
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
		
		const confirmButton = buttonContainer.createEl('button', {
			text: 'Apply to Selected Files',
			cls: 'primary-button',
			attr: { disabled: true }
		});
		confirmButton.addEventListener('click', () => {
			this.onSelect(this.selectedFiles);
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

// Modal for bulk editing properties across multiple files
class BulkPropertyEditorModal extends Modal {
	plugin: YAMLPropertyManagerPlugin;
	files: TFile[];
	propertiesToModify: Record<string, any> = {};
	propertiesToDelete: string[] = [];
	preserveExisting: boolean = true;

	constructor(app: App, plugin: YAMLPropertyManagerPlugin, files: TFile[]) {
		super(app);
		this.plugin = plugin;
		this.files = files;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('yaml-property-manager-modal');
		
		// Set explicit size for the modal
		this.modalEl.style.width = '95%';
		this.modalEl.style.maxWidth = '900px';
		
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
		
		headerContainer.createEl('h2', { text: 'Bulk Edit Properties' });
		
		// Show number of files affected
		contentEl.createEl('p', { 
			text: `Editing properties across ${this.files.length} file${this.files.length !== 1 ? 's' : ''}` 
		});
		
		// Container for property editing
		const propertyContainer = contentEl.createDiv({ cls: 'bulk-property-container' });
		
		// Property list section
		const propertyListSection = propertyContainer.createDiv({ cls: 'property-list-section' });
		propertyListSection.createEl('h3', { text: 'Properties to Add/Modify' });
		
		const propertyList = propertyListSection.createDiv({ cls: 'property-list' });
		this.renderPropertyList(propertyList);
		
		// Add property button
		const addButtonContainer = propertyListSection.createDiv();
		const addPropertyButton = addButtonContainer.createEl('button', { text: 'Add Property' });
		addPropertyButton.addEventListener('click', () => {
			this.addNewPropertyRow(propertyList);
		});
		
		// Properties to delete section
		const deleteSection = propertyContainer.createDiv({ cls: 'property-delete-section' });
		deleteSection.createEl('h3', { text: 'Properties to Delete' });
		
		const deleteList = deleteSection.createDiv({ cls: 'delete-property-list' });
		this.renderDeleteList(deleteList);
		
		// Add property to delete button
		const addDeleteButtonContainer = deleteSection.createDiv();
		const addDeleteButton = addDeleteButtonContainer.createEl('button', { text: 'Add Property to Delete' });
		addDeleteButton.addEventListener('click', () => {
			this.addNewDeleteRow(deleteList);
		});
		
		// Options section
		const optionsSection = contentEl.createDiv({ cls: 'options-section' });
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
		
		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
		
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
	
	renderPropertyList(container: HTMLElement) {
		container.empty();
		
		// Create heading row
		const headerRow = container.createEl('div', { cls: 'property-item header' });
		headerRow.style.display = 'flex';
		headerRow.style.width = '100%';
		headerRow.style.flexWrap = 'nowrap';
		
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
		
		// Create heading row
		const headerRow = container.createEl('div', { cls: 'property-item header' });
		headerRow.style.display = 'flex';
		headerRow.style.width = '100%';
		headerRow.style.flexWrap = 'nowrap';
		
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

// Settings tab
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

		// Default template file setting
		new Setting(containerEl)
			.setName('Default Template File')
			.setDesc('Select a default template file to use for applying properties')
			.addText(text => text
				.setPlaceholder('Path to template file')
				.setValue(this.plugin.settings.defaultTemplateFilePath)
				.onChange(async (value) => {
					this.plugin.settings.defaultTemplateFilePath = value;
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText('Browse')
				.onClick(() => {
					new FileSelectorModal(this.app, (file) => {
						if (file) {
							this.plugin.settings.defaultTemplateFilePath = file.path;
							this.plugin.saveSettings();
							this.display(); // Refresh settings
						}
					}).open();
				}));
		
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

		// CSS styles for the plugin
		containerEl.createEl('h3', { text: 'Styling' });
		
		// Add CSS to the plugin
		const customCSSContainer = containerEl.createDiv();
		customCSSContainer.createEl('p', { 
			text: 'The plugin includes custom CSS for a better user experience.' 
		});
	}
}