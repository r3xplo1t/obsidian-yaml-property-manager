import { App, Modal, TFile } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';

export class BulkPropertyEditorModal extends Modal {
    plugin: YAMLPropertyManagerPlugin;
    files: TFile[];

    constructor(app: App, plugin: YAMLPropertyManagerPlugin, files: TFile[]) {
        super(app);
        this.plugin = plugin;
        this.files = files;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Empty modal with no content
        
        // Simple close button
        const closeButton = contentEl.createEl('button', { 
            text: 'Close'
        });
        
        closeButton.addEventListener('click', () => {
            this.close();
        });
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}