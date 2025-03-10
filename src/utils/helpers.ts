// Helper function to format values for YAML
export function formatYamlValue(value: any): string {
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

// Helper function to format values for input fields
export function formatInputValue(value: any): string {
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
export function formatValuePreview(value: any): string {
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