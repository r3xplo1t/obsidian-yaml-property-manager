/**
 * Detect property type following Obsidian's property type detection logic
 */
export function detectPropertyType(propertyValue: any): string {
    // Null/undefined values are treated as text in Obsidian
    if (propertyValue === null || propertyValue === undefined) {
        return "text";
    }
    
    // Arrays become list type properties in Obsidian
    if (Array.isArray(propertyValue)) {
        return "list";
    }
    
    // Boolean values become checkbox properties
    if (typeof propertyValue === "boolean") {
        return "checkbox";
    }
    
    // Numbers become number properties
    if (typeof propertyValue === "number") {
        return "number";
    }
    
    // String values require more specific checking
    if (typeof propertyValue === "string") {
        // Check for number strings
        if (/^-?\d+(\.\d+)?$/.test(propertyValue)) {
            return "number";
        }
        
        // Full ISO date with time (Date & Time)
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(propertyValue)) {
            return "datetime";
        }
        
        // YYYY-MM-DD format (Date)
        if (/^\d{4}-\d{2}-\d{2}$/.test(propertyValue)) {
            return "date";
        }
        
        // All other strings are text
        return "text";
    }
    
    // Objects and other types default to text
    return "text";
}

/**
 * Get display-friendly name for property type
 */
export function getPropertyTypeDisplayName(type: string): string {
    switch (type.toLowerCase()) {
        case "text": return "Text";
        case "list": return "List";
        case "number": return "Number";
        case "checkbox": return "Checkbox";
        case "date": return "Date";
        case "datetime": return "Date & Time";
        default: return "Text";
    }
}