import { App, Modal, Notice, TFile, TextComponent } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import { TemplateNode } from '../models/interfaces';
import { formatValuePreview } from '../utils/helpers';

export class TemplateSelectionModal extends Modal {
    plugin: YAMLPropertyManagerPlugin;
    targetFiles: TFile[];
    selectedTemplate: TFile | null = null;
    selectedProperties: string[] = [];
    preservePropertyValues: string[] = []; // Track which property values to preserve
    preserveAllValues: boolean = false; // Track the state of the "preserve all" toggle
    overrideAllValues: boolean = false; // Track the state of the "override all" toggle
    templateTree: TemplateNode = { type: 'folder', name: 'Root', path: '', children: [] };
    allTemplates: TFile[] = [];
    searchResults: TFile[] = [];

    constructor(app: App, plugin: YAMLPropertyManagerPlugin, targetFiles: TFile[]) {
        super(app);
        this.plugin = plugin;
        this.targetFiles = targetFiles;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Apply window-specific class
        contentEl.addClass('yaml-window');
        contentEl.addClass('yaml-window__template-selection');
        
        // Main header (left-aligned per requirements)
        contentEl.createEl('h2', { text: 'Select Template File' });
        
        // Loading templates indicator
        const loadingEl = contentEl.createDiv({ cls: 'yaml-templates-loading' });
        loadingEl.createEl('p', { text: 'Loading templates...' });
        loadingEl.createEl('div', { cls: 'yaml-spinner' });
        
        // Load templates asynchronously
        await this.loadAllTemplates();
        
        // Remove loading indicator
        loadingEl.remove();
        
        // Add search bar with proper Obsidian styling
        const searchContainer = contentEl.createDiv({ cls: 'yaml-search-container' });
        
        // Create the input element directly rather than using TextComponent
        const searchInput = searchContainer.createEl('input', {
            type: 'text',
            cls: 'search-input',
            attr: {
                placeholder: 'Search templates...'
            }
        });
        
        // Handle input changes
        searchInput.addEventListener('input', (event) => {
            const target = event.target as HTMLInputElement;
            const value = target.value;
            this.filterTemplates(value);
        });
        
        // Add clear functionality with a click handler outside the input
        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                searchInput.value = '';
                this.filterTemplates('');
            }
        });
        
        // Add hint text below search box
        const hintText = searchContainer.createEl('p', { 
            text: 'Select a template file to view and choose properties. Use spaces for AND search (e.g., "dog cat" finds files containing both terms)',
            cls: 'yaml-hint-text'
        });
        
        // Template results container
        const templateResultsContainer = contentEl.createDiv({ cls: 'yaml-template-results' });
        
        // If no templates found
        if (this.allTemplates.length === 0) {
            templateResultsContainer.createEl('p', { 
                text: 'No template files found. Configure template files or directories in settings.',
                cls: 'yaml-message--no-templates'
            });
        } else {
            // Initialize search results with all templates
            this.searchResults = [...this.allTemplates];
            this.renderSearchResults(templateResultsContainer);
        }

        const validationMessage = contentEl.createDiv({ 
            cls: 'yaml-validation-message',
            attr: { id: 'validation-message' }
        });
        
        const validationIcon = validationMessage.createSpan({ cls: 'yaml-validation-icon' });
        validationIcon.textContent = '⚠️'; // Warning icon
        
        validationMessage.createSpan({ 
            text: 'Select template to apply properties.',
            cls: 'yaml-validation-text'
        });

        // 1. Create the properties section header (initially hidden)
        const propertiesSectionHeader = contentEl.createEl('h2', { 
            text: 'Select Properties to Apply',
            cls: 'yaml-properties-section-header yaml-element--hidden'
        });
        // 2. Create selected template info container (initially hidden)
        const selectedTemplateInfo = contentEl.createDiv({ 
            cls: 'yaml-selected-template yaml-element--hidden',
            attr: { id: 'template-info-container' }
        });
        // 3. Create "Select All Properties" checkbox container (initially hidden)
        const selectAllContainer = contentEl.createDiv({ 
            cls: 'yaml-select-all yaml-element--hidden',
            attr: { id: 'select-all-container' }
        });
        const selectAllCheckbox = selectAllContainer.createEl('input', {
            type: 'checkbox',
            attr: { id: 'select-all-properties' },
            cls: 'yaml-select-all__checkbox'
        });

        selectAllContainer.createEl('label', {
            text: 'Select All Properties',
            attr: { for: 'select-all-properties' }
        });

        // 4. Create "Preserve All Property Values" checkbox container (initially hidden)
        const preserveAllContainer = contentEl.createDiv({ 
            cls: 'yaml-select-all yaml-element--hidden',
            attr: { id: 'preserve-all-container' }
        });
        const preserveAllCheckbox = preserveAllContainer.createEl('input', {
            type: 'checkbox',
            attr: { id: 'preserve-all-values' },
            cls: 'yaml-select-all__checkbox'
        });

        preserveAllContainer.createEl('label', {
            text: 'Preserve All Property Values (use existing values when present)',
            attr: { for: 'preserve-all-values' }
        });

        // 5. Create "Override All Property Values" checkbox container (initially hidden)
        const overrideAllContainer = contentEl.createDiv({ 
            cls: 'yaml-select-all yaml-element--hidden',
            attr: { id: 'override-all-container' }
        });
        const overrideAllCheckbox = overrideAllContainer.createEl('input', {
            type: 'checkbox',
            attr: { id: 'override-all-values' },
            cls: 'yaml-select-all__checkbox'
        });

        overrideAllContainer.createEl('label', {
            text: 'Override All Property Values (existing values will be replaced)',
            attr: { for: 'override-all-values' }
        });

        // Property selection container (initially hidden, shown after template selection)
        const propertyContainer = contentEl.createDiv({ cls: 'yaml-property-container yaml-element--hidden' });
        // Set up event handlers for checkboxes
        selectAllCheckbox.addEventListener('change', () => {
            const checked = selectAllCheckbox.checked;
            const checkboxes = propertyContainer.querySelectorAll('.yaml-property-item__include input');
            checkboxes.forEach((checkbox: HTMLInputElement) => {
                checkbox.checked = checked;
                const changeEvent = new Event('change');
                checkbox.dispatchEvent(changeEvent);
            });
        });

        preserveAllCheckbox.addEventListener('change', () => {
            this.preserveAllValues = preserveAllCheckbox.checked;
            
            // Only update individual checkboxes if options are not conflicting
            if (preserveAllCheckbox.checked && overrideAllCheckbox.checked) {
                // Both options are checked, do nothing for now
                return;
            }
            
            // Update all preserve checkboxes to match
            const preserveCheckboxes = propertyContainer.querySelectorAll('.yaml-property-item__preserve input');
            preserveCheckboxes.forEach((checkbox: HTMLInputElement) => {
                checkbox.checked = this.preserveAllValues;
                const changeEvent = new Event('change');
                checkbox.dispatchEvent(changeEvent);
            });
        });
        
        overrideAllCheckbox.addEventListener('change', () => {
            this.overrideAllValues = overrideAllCheckbox.checked;
            
            // Only update individual checkboxes if options are not conflicting
            if (preserveAllCheckbox.checked && overrideAllCheckbox.checked) {
                // Both options are checked, do nothing for now
                return;
            }
            
            // If this is checked, uncheck all preserve options
            if (this.overrideAllValues) {
                const preserveCheckboxes = propertyContainer.querySelectorAll('.yaml-property-item__preserve input');
                preserveCheckboxes.forEach((checkbox: HTMLInputElement) => {
                    checkbox.checked = false;
                    const changeEvent = new Event('change');
                    checkbox.dispatchEvent(changeEvent);
                });
            }
        });
        
        // Buttons container
        const buttonContainer = contentEl.createDiv({ cls: 'yaml-button-container' });

        const applyButton = buttonContainer.createEl('button', { 
            text: 'Apply Template', 
            cls: 'yaml-button yaml-button--apply'
        });
        
        applyButton.disabled = true;
        applyButton.addClass('yaml-button--disabled');
        
        applyButton.addEventListener('click', async () => {
            if (this.selectedTemplate && this.selectedProperties.length > 0) {
                // Apply template with preservation information
                await this.applyTemplateToFilesWithPreservation(
                    this.selectedTemplate,
                    this.targetFiles,
                    this.selectedProperties,
                    this.preservePropertyValues,
                    this.preserveAllValues,
                    this.overrideAllValues
                );
                
                // Add to recent templates
                this.plugin.addToRecentTemplates(this.selectedTemplate.path);
                
                this.close();
            } else {
                // Show custom validation message with updated text based on what's missing
                const validationMessage = document.getElementById('validation-message');
                if (validationMessage) {
                    // Update message text based on what's missing
                    const validationText = validationMessage.querySelector('.yaml-validation-text');
                    if (validationText) {
                        if (!this.selectedTemplate) {
                            validationText.textContent = 'select a template file.';
                        } else if (this.selectedProperties.length === 0) {
                            validationText.textContent = 'Select at least one property to apply.';
                        } else {
                            validationText.textContent = 'Select template to apply properties.';
                        }
                    }
                    
                    // Show the message
                    validationMessage.removeClass('yaml-validation-message--hidden');
                    
                    // Make sure it's visible in the viewport
                    validationMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });
        
        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel',
            cls: 'yaml-button yaml-button--cancel'
        });
        
        cancelButton.addEventListener('click', () => {
            this.close();
        });
    }

    // Load all template files
    async loadAllTemplates() {
        this.allTemplates = await this.plugin.getAllTemplateFiles();
        
        // Sort templates by name for better usability
        this.allTemplates.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    // Filter templates based on search query
    filterTemplates(query: string) {
        if (!query || query.trim() === '') {
            this.searchResults = [...this.allTemplates];
        } else {
            // Split the search query by spaces to implement AND operator
            const searchTerms = query.toLowerCase().trim().split(/\s+/);
            
            // Filter templates - only include those that match ALL terms (AND operator)
            this.searchResults = this.allTemplates.filter(file => {
                const fileName = file.name.toLowerCase();
                const filePath = file.path.toLowerCase();
                
                // Check if ALL search terms are found in either the name or path
                return searchTerms.every(term => 
                    fileName.includes(term) || filePath.includes(term)
                );
            });
        }
        
        // Re-render search results
        const resultsContainer = this.contentEl.querySelector('.yaml-template-results') as HTMLElement;
        if (resultsContainer) {
            this.renderSearchResults(resultsContainer);
        }
    }
    
    // Render search results
    renderSearchResults(container: HTMLElement) {
        // Clear existing results
        container.empty();
        
        if (this.searchResults.length === 0) {
            container.createEl('p', { 
                text: 'No matching templates found', 
                cls: 'yaml-message--no-templates' 
            });
            return;
        }
        
        // Create results list
        const resultsList = container.createDiv({ cls: 'yaml-template-list' });
        
        // Create element for each template in search results
        for (const file of this.searchResults) {
            // Create a template item container
            const templateItem = resultsList.createDiv({ cls: 'yaml-template-item' });
            
            // Create radio button
            const radioBtn = templateItem.createEl('input', {
                type: 'radio',
                attr: {
                    name: 'template',
                    value: file.path,
                    id: `template-${file.path.replace(/\//g, '-')}`
                },
                cls: 'yaml-template-radio'
            });
            
            // Add file icon
            const fileIcon = templateItem.createSpan({ cls: 'yaml-template-icon' });
            fileIcon.textContent = '📄 ';
            
            // Add template info container
            const templateInfo = templateItem.createDiv({ cls: 'yaml-template-info' });
            
            // Add template name with normal font weight
            templateInfo.createEl('div', {
                text: file.name,
                cls: 'yaml-template-name'
            });
            
            // Add file path underneath
            if (file.parent && file.parent.path) {
                templateInfo.createEl('div', {
                    text: file.parent.path,
                    cls: 'yaml-template-path'
                });
            }
            
            // Handle selection
            radioBtn.addEventListener('change', () => {
                if (radioBtn.checked) {
                    this.selectedTemplate = file;
                    
                    // Hide the validation message when a template is selected
                    const validationMessage = document.getElementById('validation-message');
                    if (validationMessage) {
                        validationMessage.addClass('yaml-validation-message--hidden');
                    }
                    
                    this.loadTemplateProperties();
                }
            });
            
            // Make whole item clickable
            templateItem.addEventListener('click', (e) => {
                if (e.target !== radioBtn) {
                    radioBtn.checked = true;
                    this.selectedTemplate = file;
                    
                    // Hide the validation message when a template is selected
                    const validationMessage = document.getElementById('validation-message');
                    if (validationMessage) {
                        validationMessage.addClass('yaml-validation-message--hidden');
                    }
                    
                    this.loadTemplateProperties();
                }
            });
        }
    }
    
    // Load and display properties from the selected template
    async loadTemplateProperties() {
        if (!this.selectedTemplate) {
            return;
        }
        
        const { contentEl } = this;
        
        // Show properties section header
        const propertiesSectionHeader = contentEl.querySelector('.yaml-properties-section-header') as HTMLElement;
        if (propertiesSectionHeader) {
            propertiesSectionHeader.removeClass('yaml-element--hidden');
        }
        
        // Update and show template info
        const selectedTemplateInfo = document.getElementById('template-info-container');
        if (selectedTemplateInfo) {
            selectedTemplateInfo.innerHTML = '';
            selectedTemplateInfo.createEl('span', { 
                text: `Selected Template: ${this.selectedTemplate.path}`
            });
            selectedTemplateInfo.removeClass('yaml-element--hidden');
        }
        
        // Show option containers
        const selectAllContainer = document.getElementById('select-all-container');
        const preserveAllContainer = document.getElementById('preserve-all-container');
        const overrideAllContainer = document.getElementById('override-all-container');
        
        if (selectAllContainer) {
            selectAllContainer.removeClass('yaml-element--hidden');
        }
        
        if (preserveAllContainer) {
            preserveAllContainer.removeClass('yaml-element--hidden');
        }
        
        if (overrideAllContainer) {
            overrideAllContainer.removeClass('yaml-element--hidden');
        }
        
        // Get and show the property container
        const propertyContainer = contentEl.querySelector('.yaml-property-container');
        if (!propertyContainer) {
            return;
        }
        
        propertyContainer.removeClass('yaml-element--hidden');
        
        // Load properties from template
        const properties = await this.plugin.parseFileProperties(this.selectedTemplate);
        const propertyKeys = Object.keys(properties);
        
        if (propertyKeys.length === 0) {
            propertyContainer.createEl('p', { 
                text: 'The selected template file does not have any properties.',
                cls: 'yaml-hint-text'
            });
            return;
        }
        
        // Create property selection list with improved layout
        const propertyList = propertyContainer.createDiv({ cls: 'yaml-property-list' });
        
        // Add header row
        const headerRow = propertyList.createEl('div', { cls: 'yaml-property-item yaml-property-item--header' });
        
        headerRow.createEl('div', { text: 'Include', cls: 'yaml-property-item__include' });
        headerRow.createEl('div', { text: 'Property', cls: 'yaml-property-item__name' });
        headerRow.createEl('div', { text: 'Value', cls: 'yaml-property-item__value' });
        headerRow.createEl('div', { text: 'Type', cls: 'yaml-property-item__type' });
        headerRow.createEl('div', { text: 'Preserve Value', cls: 'yaml-property-item__preserve' });
        
        for (const key of propertyKeys) {
            const value = properties[key];
            const propertyItem = propertyList.createEl('div', { cls: 'yaml-property-item' });
            
            // Include checkbox
            const includeContainer = propertyItem.createEl('div', { cls: 'yaml-property-item__include' });
            
            const includeCheckbox = includeContainer.createEl('input', {
                type: 'checkbox',
                attr: { id: `include-${key}` }
            });
            
            // Property name
            const nameCell = propertyItem.createEl('div', { text: key, cls: 'yaml-property-item__name' });
            
            // Property value
            const valueCell = propertyItem.createEl('div', { 
                text: formatValuePreview(value), 
                cls: 'yaml-property-item__value' 
            });
            
            // Property type display
            const typeCell = propertyItem.createEl('div', { cls: 'yaml-property-item__type' });

            // Determine type
            let valueType = 'Text';
            if (typeof value === 'number') valueType = 'Number';
            else if (typeof value === 'boolean') valueType = 'Checkbox';
            else if (value instanceof Date) valueType = 'Date';
            else if (Array.isArray(value)) valueType = 'List';
            typeCell.textContent = valueType;
            
            // Preserve value checkbox
            const preserveValueContainer = propertyItem.createEl('div', { cls: 'yaml-property-item__preserve' });

            const preserveValueCheckbox = preserveValueContainer.createEl('input', {
                type: 'checkbox',
                attr: { 
                    id: `preserve-value-${key}`,
                    disabled: !includeCheckbox.checked
                }
            });

            // Set initial state based on global preserve/override toggles
            preserveValueCheckbox.checked = this.preserveAllValues;

            preserveValueContainer.createEl('label', {
                text: 'Preserve Existing',
                attr: { for: `preserve-value-${key}` },
                cls: 'preserve-value-label'
            });
            
            // Event handlers
            includeCheckbox.addEventListener('change', () => {
                if (includeCheckbox.checked) {
                    // Add to selected properties
                    if (!this.selectedProperties.includes(key)) {
                        this.selectedProperties.push(key);
                    }
                    // Enable preserve value checkbox
                    preserveValueCheckbox.disabled = false;
                    
                    // Apply global settings
                    if (this.preserveAllValues && !this.overrideAllValues) {
                        preserveValueCheckbox.checked = true;
                    } else if (this.overrideAllValues && !this.preserveAllValues) {
                        preserveValueCheckbox.checked = false;
                    }
                } else {
                    // Remove from selected properties
                    this.selectedProperties = this.selectedProperties.filter(p => p !== key);
                    // Remove from preserve values and disable checkbox
                    this.preservePropertyValues = this.preservePropertyValues.filter(p => p !== key);
                    preserveValueCheckbox.checked = false;
                    preserveValueCheckbox.disabled = true;
                }
                
                // Update apply button state
                // Update apply button state
                const applyButton = this.contentEl.querySelector('.yaml-button--apply') as HTMLButtonElement;
                const validationMessage = document.getElementById('validation-message');

                if (applyButton) {
                    const hasSelectedProperties = this.selectedProperties.length > 0;
                    applyButton.disabled = !hasSelectedProperties;
                    
                    if (hasSelectedProperties) {
                        applyButton.removeClass('yaml-button--disabled');
                        
                        // Hide validation message if we have properties selected
                        if (validationMessage) {
                            validationMessage.addClass('yaml-validation-message--hidden');
                        }
                    } else {
                        applyButton.addClass('yaml-button--disabled');
                        
                        // Show validation message if we have no properties selected
                        if (validationMessage) {
                            const validationText = validationMessage.querySelector('.yaml-validation-text');
                            if (validationText) {
                                validationText.textContent = 'Please select at least one property.';
                            }
                            validationMessage.removeClass('yaml-validation-message--hidden');
                        }
                    }
                }
            });
            
            // Add event handler for the preserve value checkbox
            preserveValueCheckbox.addEventListener('change', () => {
                if (preserveValueCheckbox.checked) {
                    // Add to preserve values properties
                    if (!this.preservePropertyValues.includes(key)) {
                        this.preservePropertyValues.push(key);
                    }
                } else {
                    // Remove from preserve values properties
                    this.preservePropertyValues = this.preservePropertyValues.filter(p => p !== key);
                }
            });
        }
        
        // Enable apply button
        const applyButton = this.contentEl.querySelector('.yaml-button--apply') as HTMLButtonElement;
        if (applyButton) {
            applyButton.disabled = false;
            applyButton.removeClass('yaml-button--disabled');
        }
    }
    
    // Apply template to files while preserving specified properties
    async applyTemplateToFilesWithPreservation(
        templateFile: TFile, 
        targetFiles: TFile[],
        propertiesToApply: string[], 
        preserveValueProperties: string[],
        preserveAllValues: boolean,
        overrideAllValues: boolean
    ) {
        try {
            // Get template properties
            const templateProperties = await this.plugin.parseFileProperties(templateFile);
            
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
                
                // Get existing properties for preservation
                const existingProperties = await this.plugin.parseFileProperties(file);
                
                // Handle properties to preserve
                for (const prop of propertiesToApply) {
                    // If both options are checked or neither is checked, use individual settings
                    const useIndividualSettings = (preserveAllValues && overrideAllValues) || 
                                               (!preserveAllValues && !overrideAllValues);
                    
                    // If this property should preserve its value and it exists in the target file
                    if (
                        (preserveAllValues && !overrideAllValues) || // Preserve All is checked alone 
                        (useIndividualSettings && preserveValueProperties.includes(prop)) // Use individual checkbox
                    ) {
                        if (prop in existingProperties) {
                            propertiesToApplyToFile[prop] = existingProperties[prop];
                        }
                    }
                }
                
                // Apply the properties
                const success = await this.plugin.applyProperties(file, propertiesToApplyToFile, false);
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

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}