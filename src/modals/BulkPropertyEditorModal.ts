import { App, Modal, Notice, TFile } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import { PropertyManagerModal } from './PropertyManagerModal';
import { PROPERTY_TYPES } from '../models/constants';
import { formatInputValue, formatValuePreview } from '../utils/helpers';

export class BulkPropertyEditorModal extends Modal {
    plugin: YAMLPropertyManagerPlugin;
    files: TFile[];
    propertiesToModify: Record<string, any> = {};
    propertiesToDelete: string[] = [];
    preserveExisting: boolean = true;
    existingProperties: Map<string, { count: number, examples: any[] }> = new Map();
    totalFileCount: number = 0;
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
        
        // Apply window-specific class
        contentEl.addClass('yaml-window');
        contentEl.addClass('yaml-window__bulk-editor');
        
        // Add header with back button
        const headerContainer = contentEl.createDiv({ cls: 'yaml-header' });
        
        const backButton = headerContainer.createEl('button', { 
            text: '← Back',
            cls: 'yaml-button yaml-header__back-button'
        });
        
        backButton.addEventListener('click', () => {
            // Open a new PropertyManagerModal
            const mainModal = new PropertyManagerModal(this.app, this.plugin);
            this.close();
            mainModal.open();
        });
        
        headerContainer.createEl('h2', { text: 'Bulk Edit Properties', cls: 'yaml-header__title' });
        
        // Show number of files affected
        contentEl.createEl('p', { 
            text: `Editing properties across ${this.files.length} file${this.files.length !== 1 ? 's' : ''}` 
        });
        
        // Show loading spinner while scanning files
        const loadingEl = contentEl.createDiv({ cls: 'yaml-loading' });
        loadingEl.createEl('p', { text: 'Scanning files for existing properties...' });
        loadingEl.createEl('div', { cls: 'yaml-spinner' });
        
        // Scan selected files for existing properties
        await this.scanExistingProperties();
        
        // Check if property reordering is possible
        await this.checkReorderingPossibility();
        
        // Remove loading element
        loadingEl.remove();
        
        // Container for property editing
        const propertyContainer = contentEl.createDiv({ cls: 'yaml-bulk-container' });
        
        // New section - Existing Properties
        const existingPropertiesSection = propertyContainer.createDiv({ cls: 'yaml-section' });
        existingPropertiesSection.createEl('h3', { text: 'Existing Properties' });
        
        const existingPropertiesList = existingPropertiesSection.createDiv({ cls: 'yaml-section__content' });
        this.renderExistingProperties(existingPropertiesList);
        
        // New section - Property Reordering (only if possible)
        const reorderSection = propertyContainer.createDiv({ cls: 'yaml-section' });
        reorderSection.createEl('h3', { text: 'Reorder Properties' });
        this.renderPropertyReordering(reorderSection);
        
        // Property list section
        const propertyListSection = propertyContainer.createDiv({ cls: 'yaml-section' });
        propertyListSection.createEl('h3', { text: 'Properties to Add/Modify' });
        
        const propertyList = propertyListSection.createDiv({ cls: 'yaml-property-list' });
        this.renderPropertyList(propertyList);
        
        // Add property button
        const addButtonContainer = propertyListSection.createDiv();
        const addPropertyButton = addButtonContainer.createEl('button', { 
            text: 'Add Property',
            cls: 'yaml-button yaml-button--add-property'
        });
        
        addPropertyButton.addEventListener('click', () => {
            this.addNewPropertyRow(propertyList);
        });
        
        // Properties to delete section
        const deleteSection = propertyContainer.createDiv({ cls: 'yaml-section' });
        deleteSection.createEl('h3', { text: 'Properties to Delete' });
        
        const deleteList = deleteSection.createDiv({ cls: 'yaml-delete-list__container' });
        this.renderDeleteList(deleteList);
        
        // Add property to delete button
        const addDeleteButtonContainer = deleteSection.createDiv();
        const addDeleteButton = addDeleteButtonContainer.createEl('button', { 
            text: 'Add Property to Delete',
            cls: 'yaml-button yaml-button--add-delete-property'
        });
        
        addDeleteButton.addEventListener('click', () => {
            this.addNewDeleteRow(deleteList);
        });
        
        // Options section
        const optionsSection = propertyContainer.createDiv({ cls: 'yaml-section' });
        optionsSection.createEl('h3', { text: 'Options' });
        
        // Preserve existing option
        const preserveOption = optionsSection.createDiv({ cls: 'yaml-option' });
        const preserveCheckbox = preserveOption.createEl('input', {
            type: 'checkbox',
            cls: 'yaml-option__checkbox'
        });
        
        // Set checked state after creation
        preserveCheckbox.checked = this.preserveExisting;
    
        preserveOption.createEl('label', { 
            text: 'Preserve existing values (only add properties that don\'t exist in the files)' 
        });
        
        preserveCheckbox.addEventListener('change', () => {
            this.preserveExisting = preserveCheckbox.checked;
        });
        
        // Buttons container
        const buttonContainer = contentEl.createDiv({ cls: 'yaml-button-container yaml-button-container--sticky' });
        
        const applyButton = buttonContainer.createEl('button', { 
            text: 'Apply Changes', 
            cls: 'yaml-button yaml-button--apply'
        });
        
        applyButton.addEventListener('click', async () => {
            await this.applyChanges();
        });
        
        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel',
            cls: 'yaml-button yaml-button--cancel'
        });
        
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
    renderPropertyReordering(container: HTMLElement) {
        container.empty();
        
        if (this.propertyOrder.length === 0) {
            container.createEl('p', { 
                text: 'No properties found in the selected files.'
            });
            return;
        }
        
        if (!this.canReorderProperties) {
            container.createEl('p', { 
                text: 'All selected files don\'t have identical properties. You cannot reorder them.',
                cls: 'yaml-reorder-warning'
            });
            
            // Still show properties, but in a disabled state
            const listContainer = container.createEl('div', { cls: 'yaml-reorder-list yaml-reorder-list--disabled' });
            
            for (const prop of this.propertyOrder) {
                const item = listContainer.createEl('div', { 
                    cls: 'yaml-reorder-item yaml-reorder-item--disabled',
                    attr: { 'data-property': prop }
                });
                
                // Add property name
                const dragHandle = item.createEl('div', { cls: 'yaml-reorder-handle yaml-reorder-handle--disabled' });
                dragHandle.createEl('span', { text: '≡' });
                
                item.createEl('div', { text: prop, cls: 'yaml-reorder-name' });
                
                // Show usage information from existingProperties
                const propInfo = this.existingProperties.get(prop);
                if (propInfo) {
                    const percentage = Math.round((propInfo.count / this.totalFileCount) * 100);
                    const usageInfo = item.createEl('div', { 
                        text: `${propInfo.count}/${this.totalFileCount} (${percentage}%)`, 
                        cls: 'yaml-reorder-usage' 
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
        const listContainer = container.createEl('div', { cls: 'yaml-reorder-list' });
        
        for (let i = 0; i < this.propertyOrder.length; i++) {
            const prop = this.propertyOrder[i];
            const item = listContainer.createEl('div', { 
                cls: 'yaml-reorder-item',
                attr: { 'data-property': prop }
            });
            
            // Add drag handle
            const dragHandle = item.createEl('div', { cls: 'yaml-reorder-handle' });
            dragHandle.createEl('span', { text: '≡' });
            
            // Add property name
            item.createEl('div', { text: prop, cls: 'yaml-reorder-name' });
            
            // Add up/down buttons
            const buttonsContainer = item.createEl('div', { cls: 'yaml-reorder-buttons' });
            
            if (i > 0) {
                const upButton = buttonsContainer.createEl('button', { 
                    text: '↑',
                    cls: 'yaml-button yaml-button--move-up'
                });
                upButton.addEventListener('click', () => {
                    this.moveProperty(i, i - 1);
                    this.renderPropertyReordering(container);
                });
            }
            
            if (i < this.propertyOrder.length - 1) {
                const downButton = buttonsContainer.createEl('button', { 
                    text: '↓',
                    cls: 'yaml-button yaml-button--move-down'
                });
                downButton.addEventListener('click', () => {
                    this.moveProperty(i, i + 1);
                    this.renderPropertyReordering(container);
                });
            }
        }
        
        // Add button to apply the new order
        const applyButton = container.createEl('button', { 
            text: 'Apply This Order to All Selected Files',
            cls: 'yaml-button yaml-button--reorder-apply'
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
    setupDragAndDrop(container: HTMLElement) {
        // Don't enable drag and drop for disabled items
        if (container.hasClass('yaml-reorder-list--disabled')) {
            return;
        }
        
        const items = container.querySelectorAll('.yaml-reorder-item');
        
        items.forEach(item => {
            // Skip disabled items
            if (item.hasClass('yaml-reorder-item--disabled')) {
                return;
            }
            
            item.setAttribute('draggable', 'true');
            
            item.addEventListener('dragstart', (e) => {
                if (!(e instanceof DragEvent) || !e.dataTransfer) return;
                
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.getAttribute('data-property') || '');
                
                // Add dragging class
                item.addClass('yaml-reorder-item--dragging');
            });
            
            item.addEventListener('dragend', () => {
                // Remove dragging class
                item.removeClass('yaml-reorder-item--dragging');
            });
            
            item.addEventListener('dragover', (e) => {
                if (!(e instanceof DragEvent)) return;
                
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                
                // Add a class to show where the item will be dropped
                item.addClass('yaml-reorder-item--dragover');
            });
            
            item.addEventListener('dragleave', () => {
                // Remove dragover class
                item.removeClass('yaml-reorder-item--dragover');
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
                item.removeClass('yaml-reorder-item--dragover');
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
        
        if (this.existingProperties.size === 0) {
            container.createEl('p', { text: 'No properties found in the selected files.' });
            return;
        }
        
        // Create header row with BEM-style classes
        const headerRow = container.createEl('div', { cls: 'yaml-property-item yaml-property-item--header' });
        
        headerRow.createEl('div', { text: 'Property Name', cls: 'yaml-property-item__name' });
        headerRow.createEl('div', { text: 'Most Common Type', cls: 'yaml-property-item__type' });
        headerRow.createEl('div', { text: 'Usage', cls: 'yaml-property-item__usage' });
        headerRow.createEl('div', { text: 'Sample Values', cls: 'yaml-property-item__examples' });
        headerRow.createEl('div', { text: 'Actions', cls: 'yaml-property-item__actions' });
        
        // Sort properties by usage (most used first)
        const sortedProps = Array.from(this.existingProperties.entries())
            .sort((a, b) => b[1].count - a[1].count);
        
        // Add each existing property
        for (const [propName, propInfo] of sortedProps) {
            const row = container.createEl('div', { cls: 'yaml-property-item' });
            
            // Property name
            const nameCell = row.createEl('div', { text: propName, cls: 'yaml-property-item__name' });
            
            // Property type (inferred from examples)
            const mostLikelyType = this.inferPropertyType(propInfo.examples);
            const typeCell = row.createEl('div', { text: mostLikelyType, cls: 'yaml-property-item__type' });

            // Usage statistics
            const percentage = Math.round((propInfo.count / this.totalFileCount) * 100);
            const usageCell = row.createEl('div', { 
                text: `${propInfo.count}/${this.totalFileCount} (${percentage}%)`, 
                cls: 'yaml-property-item__usage' 
            });
            
            // Sample values
            const examplesCell = row.createEl('div', { cls: 'yaml-property-item__examples' });
            
            // Format example values
            const exampleValues = propInfo.examples
                .map(val => formatValuePreview(val))
                .join(', ');
            examplesCell.setText(exampleValues);
            
            // Actions
            const actionsCell = row.createEl('div', { cls: 'yaml-property-item__actions' });
            
            // Add "Edit" button
            const editButton = actionsCell.createEl('button', { 
                text: 'Edit',
                cls: 'yaml-button yaml-button--edit'
            });
            
            editButton.addEventListener('click', () => {
                // Add to properties to modify if not already there
                if (!(propName in this.propertiesToModify)) {
                    // Use the first example as the default value
                    this.propertiesToModify[propName] = propInfo.examples[0];
                    // Refresh the property list
                    const propertyList = this.contentEl.querySelector('.yaml-property-list') as HTMLElement;
                    if (propertyList) {
                        this.renderPropertyList(propertyList);
                    }
                }
                
                // Scroll to the property list section
                const propertyListSection = this.contentEl.querySelector('.yaml-section:nth-child(3)');
                if (propertyListSection) {
                    propertyListSection.scrollIntoView({ behavior: 'smooth' });
                }
            });
            
            // Add "Delete" button
            const deleteButton = actionsCell.createEl('button', { 
                text: 'Delete',
                cls: 'yaml-button yaml-button--delete'
            });
            
            deleteButton.addEventListener('click', () => {
                // Add to properties to delete if not already there
                if (!this.propertiesToDelete.includes(propName)) {
                    this.propertiesToDelete.push(propName);
                    // Refresh the delete list
                    const deleteList = this.contentEl.querySelector('.yaml-delete-list__container') as HTMLElement;
                    if (deleteList) {
                        this.renderDeleteList(deleteList);
                    }
                }
                
                // Scroll to the delete section
                const deleteSection = this.contentEl.querySelector('.yaml-section:nth-child(4)');
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
        container.addClass('yaml-property-list__container');
        
        // Create heading row
        const headerRow = container.createEl('div', { cls: 'yaml-property-item yaml-property-item--header' });
        
        headerRow.createEl('div', { text: 'Property Name', cls: 'yaml-property-item__name' });
        headerRow.createEl('div', { text: 'Type', cls: 'yaml-property-item__type' });
        headerRow.createEl('div', { text: 'Value', cls: 'yaml-property-item__value' });
        headerRow.createEl('div', { text: 'Actions', cls: 'yaml-property-item__actions' });
        
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
        const row = container.createEl('div', { cls: 'yaml-property-item' });
        
        // Property name
        const nameCell = row.createEl('div', { cls: 'yaml-property-item__name' });
        
        const nameInput = nameCell.createEl('input', {
            value: key,
            attr: { placeholder: 'Property name' },
            cls: 'property-name-input'
        });
        
        // Property type
        const typeCell = row.createEl('div', { cls: 'yaml-property-item__type' });
        
        const typeSelect = typeCell.createEl('select', { cls: 'property-type-select' });
        
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
        const valueCell = row.createEl('div', { cls: 'yaml-property-item__value' });
        
        const valueInput = valueCell.createEl('input', {
            value: formatInputValue(value),
            attr: { placeholder: 'Property value' },
            cls: 'property-value-input'
        });
        
        // Actions
        const actionsCell = row.createEl('div', { cls: 'yaml-property-item__actions' });
        
        const deleteButton = actionsCell.createEl('button', { 
            text: '🗑️',
            cls: 'yaml-button yaml-button--delete-item'
        });
        
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
        container.addClass('yaml-delete-list__container');
        
        // Create heading row
        const headerRow = container.createEl('div', { cls: 'yaml-property-item yaml-property-item--header' });
        
        headerRow.createEl('div', { text: 'Property Name', cls: 'yaml-property-item__name' });
        headerRow.createEl('div', { text: 'Actions', cls: 'yaml-property-item__actions' });
        
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
        const row = container.createEl('div', { cls: 'yaml-property-item' });
        
        // Property name
        const nameCell = row.createEl('div', { cls: 'yaml-property-item__name' });
        
        const nameInput = nameCell.createEl('input', {
            value: key,
            attr: { placeholder: 'Property name to delete' },
            cls: 'property-name-input'
        });
        
        // Actions
        const actionsCell = row.createEl('div', { cls: 'yaml-property-item__actions' });
        
        const deleteButton = actionsCell.createEl('button', { 
            text: '🗑️', 
            cls: 'yaml-button yaml-button--delete-item'
        });
        
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