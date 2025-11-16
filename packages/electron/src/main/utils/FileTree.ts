import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { FileTreeItem } from '../types';

export function getFolderContents(dirPath: string): FileTreeItem[] {
    const result: FileTreeItem[] = [];
    
    try {
        const items = readdirSync(dirPath);
        
        for (const item of items) {
            // Skip system files and node_modules, but allow dot directories like .claude
            if (item === 'node_modules' || item === '.git' || item === '.DS_Store') {
                continue;
            }
            
            const fullPath = join(dirPath, item);
            const stats = statSync(fullPath);
            
            if (stats.isDirectory()) {
                result.push({
                    name: item,
                    type: 'directory',
                    path: fullPath,
                    children: getFolderContents(fullPath)
                });
            } else if (stats.isFile()) {
                // Include all files - filtering happens in the UI
                result.push({
                    name: item,
                    type: 'file',
                    path: fullPath
                });
            }
        }
        
        // Sort: directories first, then files, alphabetically
        result.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });
    } catch (error: any) {
        // Silently handle ENOENT errors (directory doesn't exist)
        // This is expected when scanning directories that may not be created yet
        if (error.code !== 'ENOENT') {
            console.error('Error reading folder contents:', error);
        }
    }
    
    return result;
}