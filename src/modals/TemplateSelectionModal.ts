import { App, Modal, Notice, TFile } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import { TemplateNode } from '../models/interfaces';
import { formatValuePreview } from '../utils/helpers';

export class TemplateSelectionModal extends Modal {
    plugin: YAMLPropertyManagerPlugin;
    targetFiles: TFile[];
    selectedTemplate: TFile | null = null;
    selectedProperties: string[] = [];
    consistentProperties: string[] = [];
    preservePropertyValues: string[] = []; // New array to track which property values to preserve
    preserveAllValues: boolean = false; // Track the state of the "preserve all" toggle
    templateTree: TemplateNode = { type: 'folder', name: 'Root', path: '', children: [] };

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
        
        // Add header with back button
        const headerContainer = contentEl.createDiv({ cls: 'yaml-header' });
        
        const backButton = headerContainer.createEl('button', { 
            text: '← Back',
            cls: 'yaml-button yaml-header__back-button'
        });
        
        backButton.addEventListener('click', () => {
            this.plugin.navigateToModal(this, 'main');
        });
        
        headerContainer.createEl('h2', { text: 'Select Template File', cls: 'yaml-header__title' });
        
        // Create a wrapper for the scrollable content
        const contentWrapper = contentEl.createDiv({ cls: 'yaml-content' });
        
        // Loading templates indicator
        const loadingEl = contentWrapper.createDiv({ cls: 'yaml-templates-loading' });
        loadingEl.createEl('p', { text: 'Loading templates...' });
        loadingEl.createEl('div', { cls: 'yaml-spinner' });
        
        // Load templates asynchronously
        await this.buildTemplateTree();
        
        // Remove loading indicator
        loadingEl.remove();
        
        // Template container
        const templateContainer = contentWrapper.createDiv({ cls: 'yaml-template-container' });
        
        // If no templates found
        if (this.templateTree.children.length === 0) {
            templateContainer.createEl('p', { 
                text: 'No template files found. Configure template files or directories in settings.',
                cls: 'yaml-message--no-templates'
            });
        } else {
            // Recent templates section
            if (this.plugin.settings.recentTemplates.length > 0) {
                templateContainer.createEl('h3', { text: 'Recent Templates' });
                
                const recentTemplatesContainer = templateContainer.createDiv({ cls: 'yaml-recent-templates' });
                
                // Create elements for recent templates
                this.renderRecentTemplates(recentTemplatesContainer);
            }
            
            // All templates section
            templateContainer.createEl('h3', { text: 'All Templates' });
            
            // Create template tree browser
            const templateTreeContainer = templateContainer.createDiv({ cls: 'yaml-template-tree' });
            
            // Render the template tree
            this.renderTemplateTree(templateTreeContainer, this.templateTree, true);
        }
        
        // Property selection container (initially empty, populated after template selection)
        const propertyContainer = contentWrapper.createDiv({ cls: 'yaml-property-container' });
        propertyContainer.createEl('p', { 
            text: 'Select a template file to view and choose properties' 
        });
        
        // Buttons container
        const buttonContainer = contentEl.createDiv({ cls: 'yaml-button-container yaml-button-container--sticky' });

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
                    this.preserveAllValues
                );
                
                // Add to recent templates
                this.plugin.addToRecentTemplates(this.selectedTemplate.path);
                
                this.plugin.navigateToModal(this, 'main');
            } else {
                new Notice('Please select a template and at least one property');
            }
        });
        
        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel',
            cls: 'yaml-button yaml-button--cancel'
        });
        
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
        // Sort children by type first (directories before files), then by name
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
        
        // Create node element with new class
        const nodeEl = container.createDiv({ cls: `yaml-template-tree-item yaml-template-tree-item--${node.type}` });
        
        // Create header (the clickable part with name)
        const header = nodeEl.createDiv({ cls: 'yaml-template-tree-header' });
        
        // Set proper indentation using CSS
        header.style.paddingLeft = (level * 20) + 'px';
        
        if (node.type === 'folder') {
            // Folder icon
            const folderIcon = header.createSpan({ cls: 'yaml-template-tree-icon' });
            folderIcon.textContent = expanded ? '📂 ' : '📁 ';
            
            // Folder name
            header.createSpan({ text: node.name, cls: 'yaml-template-tree-name' });
            
            // Container for children with collapsible class
            const childrenContainer = nodeEl.createDiv({ 
                cls: expanded ? 'yaml-template-tree-children' : 'yaml-template-tree-children yaml-template-tree-children--collapsed'
            });
            
            // Add children
            for (const child of node.children) {
                this.renderTemplateTree(childrenContainer, child, false, level + 1);
            }
            
            // Toggle expansion when clicking the folder
            header.addEventListener('click', () => {
                const isExpanded = !childrenContainer.hasClass('yaml-template-tree-children--collapsed');
                childrenContainer.toggleClass('yaml-template-tree-children--collapsed', isExpanded);
                folderIcon.textContent = isExpanded ? '📁 ' : '📂 ';
            });
        } else {
            // For files, add radio button for selection
            const radioContainer = header.createDiv({ cls: 'yaml-template-radio-container' });
            
            const radio = radioContainer.createEl('input', {
                type: 'radio',
                attr: {
                    name: 'template',
                    value: node.path,
                    id: `template-${node.path}`
                }
            });
            
            // File icon
            const fileIcon = header.createSpan({ cls: 'yaml-template-tree-icon' });
            fileIcon.textContent = '📄 ';
            
            // File name as label
            const label = header.createEl('label', {
                text: node.name,
                attr: { for: `template-${node.path}` },
                cls: 'yaml-template-tree-name'
            });
            
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
            const recentOption = container.createDiv({ cls: 'yaml-template-option' });
            
            const radioBtn = recentOption.createEl('input', {
                type: 'radio',
                attr: {
                    name: 'template',
                    value: file.path,
                    id: `recent-template-${file.path}`
                }
            });
            
            // File icon
            const fileIcon = recentOption.createSpan({ cls: 'yaml-template-tree-icon' });
            fileIcon.textContent = '📄 ';
            
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
        const propertyContainer = contentEl.querySelector('.yaml-property-container');
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
        const selectedTemplateInfo = propertyContainer.createDiv({ cls: 'yaml-selected-template' });
        
        selectedTemplateInfo.createEl('span', { 
            text: `Selected Template: ${this.selectedTemplate.path}`
        });
        
        propertyContainer.createEl('h3', { text: 'Select Properties to Apply' });
        
        // Create toggle for "Select All"
        const selectAllContainer = propertyContainer.createDiv({ cls: 'yaml-select-all' });
        
        const selectAllCheckbox = selectAllContainer.createEl('input', {
            type: 'checkbox',
            attr: { id: 'select-all-properties' },
            cls: 'yaml-select-all__checkbox'
        });
        
        selectAllContainer.createEl('label', {
            text: 'Select All Properties',
            attr: { for: 'select-all-properties' }
        });
        
        selectAllCheckbox.addEventListener('change', () => {
            const checked = selectAllCheckbox.checked;
            const checkboxes = propertyContainer.querySelectorAll('.yaml-property-item__include input');
            checkboxes.forEach((checkbox: HTMLInputElement) => {
                checkbox.checked = checked;
                const changeEvent = new Event('change');
                checkbox.dispatchEvent(changeEvent);
            });
        });

        // Add a new toggle for "Preserve All Values"
        const preserveAllContainer = propertyContainer.createDiv({ cls: 'yaml-select-all' });
        
        const preserveAllCheckbox = preserveAllContainer.createEl('input', {
            type: 'checkbox',
            attr: { id: 'preserve-all-values' },
            cls: 'yaml-select-all__checkbox'
        });
        
        preserveAllContainer.createEl('label', {
            text: 'Preserve All Property Values (use existing values when present)',
            attr: { for: 'preserve-all-values' }
        });

        preserveAllCheckbox.addEventListener('change', () => {
            this.preserveAllValues = preserveAllCheckbox.checked;
            
            // Update all preserve checkboxes to match
            const preserveCheckboxes = propertyContainer.querySelectorAll('.yaml-property-item__preserve input');
            preserveCheckboxes.forEach((checkbox: HTMLInputElement) => {
                checkbox.checked = this.preserveAllValues;
                const changeEvent = new Event('change');
                checkbox.dispatchEvent(changeEvent);
            });
        });
        
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

            // Set initial state based on global preserve toggle
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
                    // Enable preserve value checkbox only
                    preserveValueCheckbox.disabled = false;
                } else {
                    // Remove from selected properties
                    this.selectedProperties = this.selectedProperties.filter(p => p !== key);
                    // Remove from preserve values and disable checkbox
                    this.preservePropertyValues = this.preservePropertyValues.filter(p => p !== key);
                    preserveValueCheckbox.checked = false;
                    preserveValueCheckbox.disabled = true;
                }
                
                // Update apply button state
                const applyButton = this.contentEl.querySelector('.yaml-button--apply') as HTMLButtonElement;
                if (applyButton) {
                    applyButton.disabled = this.selectedProperties.length === 0;
                    
                    if (this.selectedProperties.length > 0) {
                        applyButton.removeClass('yaml-button--disabled');
                    } else {
                        applyButton.addClass('yaml-button--disabled');
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
    
    // Add this method to handle preserving property values
    async applyTemplateToFilesWithPreservation(
        templateFile: TFile, 
        targetFiles: TFile[],
        propertiesToApply: string[], 
        preserveValueProperties: string[],
        preserveAllValues: boolean
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
                    // If this property should preserve its value and it exists in the target file
                    if ((preserveAllValues || preserveValueProperties.includes(prop)) && 
                        prop in existingProperties) {
                        propertiesToApplyToFile[prop] = existingProperties[prop];
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