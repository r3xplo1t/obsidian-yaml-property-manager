import { App, Modal, TFile, TFolder } from 'obsidian';

export class TemplateFileSelectorModal extends Modal {
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
        
        // Apply window-specific class
        contentEl.addClass('yaml-window');
        contentEl.addClass('yaml-window__file-selector');
        
        // Add header with title
        const headerContainer = contentEl.createDiv({ cls: 'yaml-header' });
        
        headerContainer.createEl('h2', { text: 'Select Template Files and Directories', cls: 'yaml-header__title' });
        
        // Instructions
        contentEl.createEl('p', { 
            text: 'Select files to use as templates, or select entire directories. Check the box to include a file or folder.'
        });
        
        // File tree container
        const fileTreeContainer = contentEl.createDiv({ cls: 'yaml-file-tree' });
        
        // Selection counter
        const selectionCountEl = contentEl.createDiv({ cls: 'yaml-selected-count' });
        selectionCountEl.textContent = 'Nothing selected';
        
        // File tree
        const fileTree = fileTreeContainer.createDiv({ cls: 'yaml-file-tree__container' });
        
        // Add root folder
        this.addFolderToTree(fileTree, this.app.vault.getRoot(), selectionCountEl);
        
        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'yaml-button-container yaml-button-container--sticky' });
        
        const confirmButton = buttonContainer.createEl('button', {
            text: 'Add Selected Files & Folders',
            cls: 'yaml-button yaml-button--confirm yaml-button--disabled'
        });
        
        confirmButton.disabled = true;
        
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
        
        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel',
            cls: 'yaml-button yaml-button--cancel'
        });
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
        
        // Regular handling for non-root folders
        // Don't add hidden folders
        if (!folder.path.startsWith('.')) {
            // Create folder item with new class
            const folderItem = parentEl.createDiv({ cls: 'yaml-folder-item' });
            
            // Header row with checkbox
            const headerRow = folderItem.createDiv({ cls: 'yaml-file-tree-header' });
            
            // Use inline style only for indentation level
            headerRow.style.paddingLeft = (level * 20) + 'px';
            
            // Checkbox for folder selection
            const checkbox = headerRow.createEl('input', {
                type: 'checkbox',
                cls: 'yaml-folder-checkbox'
            });
            
            // Set initial checked state based on selection
            checkbox.checked = !!this.selectedFolders.find(f => f.path === folder.path);
            
            // Folder icon
            const folderIcon = headerRow.createSpan({ cls: 'yaml-folder-icon' });
            folderIcon.textContent = '📁 ';
            
            // Folder name
            headerRow.createSpan({ text: folder.name, cls: 'yaml-folder-name' });
            
            // Always set to include subdirectories without showing the option
            this.folderSubdirectoryOptions.set(folder.path, true);
            
            // Children container - will hold files and subfolders
            const childrenContainer = folderItem.createDiv({ cls: 'yaml-folder-children yaml-folder-children--collapsed' });
            
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
                    const isCollapsed = childrenContainer.hasClass('yaml-folder-children--collapsed');
                    childrenContainer.toggleClass('yaml-folder-children--collapsed', !isCollapsed);
                    folderIcon.textContent = childrenContainer.hasClass('yaml-folder-children--collapsed') ? '📁 ' : '📂 ';
                }
            });
        }
    }

    addFileToTree(parentEl: HTMLElement, file: TFile, selectionCountEl: HTMLElement, level: number = 0) {
        // Create file item with new class
        const fileItem = parentEl.createDiv({ cls: 'yaml-file-item' });
        
        // Header with checkbox
        const headerRow = fileItem.createDiv({ cls: 'yaml-file-tree-header' });
        
        // Use inline style only for indentation level
        headerRow.style.paddingLeft = (level * 20) + 'px';
        
        // Checkbox for file selection
        const checkbox = headerRow.createEl('input', {
            type: 'checkbox',
            cls: 'yaml-file-checkbox'
        });
        
        // Set initial checked state based on selection
        checkbox.checked = !!this.selectedFiles.find(f => f.path === file.path);
        
        // File icon
        const fileIcon = headerRow.createSpan({ cls: 'yaml-file-icon' });
        fileIcon.textContent = '📄 ';
        
        // File name
        headerRow.createSpan({ text: file.name, cls: 'yaml-file-name' });
        
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
        const confirmButton = this.contentEl.querySelector('.yaml-button--confirm') as HTMLButtonElement;
        if (confirmButton) {
            confirmButton.disabled = totalCount === 0;
            
            if (totalCount === 0) {
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