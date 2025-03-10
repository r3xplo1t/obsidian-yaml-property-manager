import { App, Modal, TFile, TFolder } from 'obsidian';

export class FileSelectorModal extends Modal {
    onSelect: (file: TFile | null) => void;
    
    constructor(app: App, onSelect: (file: TFile | null) => void) {
        super(app);
        this.onSelect = onSelect;
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Apply window-specific class
        contentEl.addClass('yaml-window');
        contentEl.addClass('yaml-window__file-selector');
        
        contentEl.createEl('h2', { text: 'Select a Template File', cls: 'yaml-header__title' });
        
        // Create file tree with CSS class
        const fileTree = contentEl.createDiv({ cls: 'yaml-file-tree' });
        
        // Recursively add files/folders
        const rootFolder = this.app.vault.getRoot();
        this.addFolderToTree(fileTree, rootFolder);
        
        // Buttons container
        const buttonContainer = contentEl.createDiv({ cls: 'yaml-button-container yaml-button-container--sticky' });
        
        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel',
            cls: 'yaml-button yaml-button--cancel'
        });
        
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
                cls: isFolder ? 'yaml-folder-item' : 'yaml-file-item'
            });
            
            // Use CSS padding with inline style only for indentation
            itemEl.style.paddingLeft = `${level * 20}px`;
            
            // Icon
            itemEl.createEl('span', { 
                text: isFolder ? '📁 ' : '📄 ',
                cls: isFolder ? 'yaml-folder-icon' : 'yaml-file-icon'
            });
            
            // Name
            itemEl.createEl('span', { 
                text: child.name, 
                cls: isFolder ? 'yaml-folder-name' : 'yaml-file-name' 
            });
            
            if (isFolder) {
                // Folder can be expanded
                const childrenContainer = parentEl.createDiv({ 
                    cls: 'yaml-folder-children yaml-folder-children--collapsed'
                });
                
                // Toggle expansion
                itemEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    
                    const isCollapsed = childrenContainer.hasClass('yaml-folder-children--collapsed');
                    childrenContainer.toggleClass('yaml-folder-children--collapsed', !isCollapsed);
                    
                    // Load children if not yet loaded
                    if (!childrenContainer.hasClass('yaml-folder-children--collapsed') && childrenContainer.childElementCount === 0) {
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