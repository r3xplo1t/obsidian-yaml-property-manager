import { App, Modal, Notice, TFile, TFolder } from 'obsidian';

export class BatchFileSelectorModal extends Modal {
    onSelect: (files: TFile[]) => void;
    selectedFiles: TFile[] = [];
    
    constructor(app: App, onSelect: (files: TFile[]) => void) {
        super(app);
        this.onSelect = onSelect;
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Apply window-specific class
        contentEl.addClass('yaml-window');
        contentEl.addClass('yaml-window__batch-selector');
        
        // Add header with back button
        const headerContainer = contentEl.createDiv({ cls: 'yaml-header' });
        
        const backButton = headerContainer.createEl('button', { 
            text: '← Back',
            cls: 'yaml-button yaml-header__back-button'
        });
        
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
        
        headerContainer.createEl('h2', { text: 'Select Files', cls: 'yaml-header__title' });
        
        // Instructions
        contentEl.createEl('p', { 
            text: 'Select files to apply properties to. Use checkboxes to select individual files or entire folders.'
        });
        
        // File tree container
        const fileTreeContainer = contentEl.createDiv({ cls: 'yaml-file-tree' });
        
        // Selected files count
        const selectedCountEl = contentEl.createEl('div', {
            cls: 'yaml-selected-count',
            text: 'No files selected'
        });
        
        // File tree
        const fileTree = fileTreeContainer.createDiv({ cls: 'yaml-file-tree__container' });
        
        // Add root folder
        this.addFolderToTree(fileTree, this.app.vault.getRoot(), selectedCountEl);
        
        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'yaml-button-container yaml-button-container--sticky' });
        
        const confirmButton = buttonContainer.createEl('button', {
            text: 'Apply to Selected Files',
            cls: 'yaml-button yaml-button--confirm yaml-button--disabled'
        });
        
        confirmButton.disabled = true;
        
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
        
        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel',
            cls: 'yaml-button yaml-button--cancel'
        });
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
            
            if (aIsFolder !== bIsFolder) {
                return aIsFolder ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        
        for (const child of sorted) {
            const isFolder = child.children !== undefined;
            
            const itemEl = parentEl.createDiv({
                cls: isFolder ? 'yaml-folder-item' : 'yaml-file-item'
            });
            
            // Use inline style only for indentation levels
            itemEl.style.paddingLeft = `${level * 20}px`;
            
            // Checkbox
            const checkbox = itemEl.createEl('input', {
                type: 'checkbox',
                cls: isFolder ? 'yaml-folder-checkbox' : 'yaml-file-checkbox'
            });
            
            // Icon
            const folderIcon = itemEl.createEl('span', { 
                text: isFolder ? '📁 ' : '📄 ',
                cls: isFolder ? 'yaml-folder-icon' : 'yaml-file-icon'
            });
            
            // Name
            itemEl.createEl('span', { 
                text: child.name, 
                cls: isFolder ? 'yaml-folder-name' : 'yaml-file-name' 
            });
            
            if (isFolder) {
                // Create container for children
                const childrenContainer = itemEl.createDiv({ 
                    cls: 'yaml-folder-children yaml-folder-children--collapsed'
                });
                
                // Toggle expand/collapse
                itemEl.addEventListener('click', (e) => {
                    if (e.target === checkbox) return;
                    e.stopPropagation();
                    
                    const isCollapsed = childrenContainer.hasClass('yaml-folder-children--collapsed');
                    childrenContainer.toggleClass('yaml-folder-children--collapsed', !isCollapsed);
                    folderIcon.textContent = childrenContainer.hasClass('yaml-folder-children--collapsed') ? '📁 ' : '📂 ';
                    
                    // Load children if not yet loaded
                    if (!childrenContainer.hasClass('yaml-folder-children--collapsed') && childrenContainer.childElementCount === 0) {
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
                    if (!childrenContainer.hasClass('yaml-folder-children--collapsed')) {
                        const checkboxes = childrenContainer.querySelectorAll('input[type="checkbox"]');
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
                itemEl.addClass('yaml-file-item--disabled');
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
        const confirmButton = this.contentEl.querySelector('.yaml-button--confirm') as HTMLButtonElement;
        if (confirmButton) {
            confirmButton.disabled = count === 0;
            
            if (count === 0) {
                confirmButton.addClass('yaml-button--disabled');
            } else {
                confirmButton.removeClass('yaml-button--disabled');
            }
        }
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}