import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { FileTreeItem } from '../types';

export function getFolderContents(dirPath: string): FileTreeItem[] {
    const result: FileTreeItem[] = [];
    
    try {
        const items = readdirSync(dirPath);
        
        for (const item of items) {
            // Skip hidden files and node_modules
            if (item.startsWith('.') || item === 'node_modules') {
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
            } else if (stats.isFile() && (item.endsWith('.md') || item.endsWith('.markdown'))) {
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
    } catch (error) {
        console.error('Error reading folder contents:', error);
    }
    
    return result;
}