import { App, Modal, Notice, TFile } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import { PROPERTY_TYPES } from '../models/constants';
import { formatInputValue } from '../utils/helpers';

export class SingleFilePropertyModal extends Modal {
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
        
        // Apply window-specific class
        contentEl.addClass('yaml-window');
        contentEl.addClass('yaml-window__single-file');
        
        // Add header with back button
        const headerContainer = contentEl.createDiv({ cls: 'yaml-header' });
        
        const backButton = headerContainer.createEl('button', { 
            text: '← Back',
            cls: 'yaml-button yaml-header__back-button'
        });
        
        backButton.addEventListener('click', () => {
            this.plugin.navigateToModal(this, 'main');
        });
        
        headerContainer.createEl('h2', { text: `Edit Properties: ${this.file.name}`, cls: 'yaml-header__title' });
        
        // Load existing properties
        this.properties = await this.plugin.parseFileProperties(this.file);
        
        // Create property editor container
        const propertyContainer = contentEl.createDiv({ cls: 'yaml-property-container' });
        
        // Display existing properties
        this.renderPropertyEditor(propertyContainer);
        
        // Add buttons container
        const buttonContainer = contentEl.createDiv({ cls: 'yaml-button-container yaml-button-container--sticky' });
        
        // Add property button
        const addPropertyButton = buttonContainer.createEl('button', { 
            text: 'Add Property',
            cls: 'yaml-button yaml-button--add-property'
        });
        
        addPropertyButton.addEventListener('click', () => {
            // Show input for new property name
            const newPropertyContainer = propertyContainer.createDiv({ cls: 'yaml-new-property' });
            
            const nameInput = newPropertyContainer.createEl('input', { 
                attr: { placeholder: 'Property name' },
                cls: 'yaml-new-property__name'
            });
            
            // Property type selector
            const typeSelect = newPropertyContainer.createEl('select', { cls: 'yaml-new-property__type' });
            
            PROPERTY_TYPES.forEach(type => {
                typeSelect.createEl('option', {
                    text: type.label,
                    value: type.value
                });
            });
            
            const valueInput = newPropertyContainer.createEl('input', { 
                attr: { placeholder: 'Property value' }, 
                cls: 'yaml-new-property__value'
            });
            
            const buttonsDiv = newPropertyContainer.createEl('div', { cls: 'yaml-new-property__buttons' });
            
            const confirmButton = buttonsDiv.createEl('button', { 
                text: 'Add',
                cls: 'yaml-button yaml-button--add'
            });
            
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
            
            const cancelButton = buttonsDiv.createEl('button', { 
                text: 'Cancel',
                cls: 'yaml-button yaml-button--cancel'
            });
            
            cancelButton.addEventListener('click', () => {
                newPropertyContainer.remove();
            });
            
            nameInput.focus();
        });
        
        // Save button
        const saveButton = buttonContainer.createEl('button', { 
            text: 'Save Changes',
            cls: 'yaml-button yaml-button--save'
        });
        
        saveButton.addEventListener('click', async () => {
            const success = await this.plugin.applyProperties(this.file, this.properties, false);
            if (success) {
                new Notice('Properties saved successfully');
                this.plugin.navigateToModal(this, 'main');
            }
        });
        
        // Cancel button
        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel',
            cls: 'yaml-button yaml-button--cancel'
        });
        
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
        
        // Create list of properties with new class
        const propertyList = container.createEl('div', { cls: 'yaml-property-list' });
        
        // Headings as flex container with BEM-style classes
        const headerRow = propertyList.createEl('div', { cls: 'yaml-property-item yaml-property-item--header' });
        
        headerRow.createEl('div', { text: 'Name', cls: 'yaml-property-item__name' });
        headerRow.createEl('div', { text: 'Type', cls: 'yaml-property-item__type' });
        headerRow.createEl('div', { text: 'Value', cls: 'yaml-property-item__value' });
        headerRow.createEl('div', { text: 'Actions', cls: 'yaml-property-item__actions' });
        
        // Property items
        for (const [key, value] of Object.entries(this.properties)) {
            // Create item with BEM-style class
            const item = propertyList.createEl('div', { cls: 'yaml-property-item' });
            
            this.propertyOrderItems.push(item);
            
            // Property name
            const nameCell = item.createEl('div', { text: key, cls: 'yaml-property-item__name' });
            
            // Property type with fixed width
            const typeContainer = item.createEl('div', { cls: 'yaml-property-item__type' });
            
            const typeSelect = typeContainer.createEl('select', { cls: 'property-type-select' });
            
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
            const valueContainer = item.createEl('div', { cls: 'yaml-property-item__value' });
            
            const valueInput = valueContainer.createEl('input', { 
                value: formatInputValue(value),
                cls: 'property-value-input'
            });
            
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
            const actionsContainer = item.createEl('div', { cls: 'yaml-property-item__actions' });
            
            // Move up button
            const moveUpButton = actionsContainer.createEl('button', { 
                text: '↑',
                cls: 'yaml-button yaml-button--move-up'
            });
            
            moveUpButton.addEventListener('click', () => {
                new Notice('Reordering properties will be available in a future update');
            });
            
            // Move down button
            const moveDownButton = actionsContainer.createEl('button', { 
                text: '↓',
                cls: 'yaml-button yaml-button--move-down'
            });
            
            moveDownButton.addEventListener('click', () => {
                new Notice('Reordering properties will be available in a future update');
            });
            
            // Delete button
            const deleteButton = actionsContainer.createEl('button', { 
                text: '🗑️',
                cls: 'yaml-button yaml-button--delete-item'
            });
            
            deleteButton.addEventListener('click', () => {
                delete this.properties[key];
                this.renderPropertyEditor(container);
            });
        }
    }
}