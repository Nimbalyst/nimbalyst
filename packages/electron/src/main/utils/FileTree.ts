import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { FileTreeItem } from '../types';
import { shouldExcludeDir } from './fileFilters';

// Natural sort collator for handling numbers in filenames
const naturalCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base'
});

// Performance limits to prevent freezing on huge directories
const MAX_DEPTH = 8;
const MAX_FILES_PER_DIR = 1000;
const MAX_TOTAL_ITEMS = 5000;

let totalItemCount = 0;

// Special directories that should always appear first
const SPECIAL_DIRECTORIES = ['nimbalyst-local'];

function isSpecialDirectory(name: string): boolean {
    return SPECIAL_DIRECTORIES.includes(name);
}

export function getFolderContents(dirPath: string, depth: number = 0): FileTreeItem[] {
    const result: FileTreeItem[] = [];

    // Reset counter on top-level call
    if (depth === 0) {
        totalItemCount = 0;
    }

    // Stop if we've hit limits
    if (depth > MAX_DEPTH) {
        // console.warn(`[FileTree] Stopped scanning at depth ${depth} for: ${dirPath}`);
        return result;
    }

    if (totalItemCount > MAX_TOTAL_ITEMS) {
        console.warn(`[FileTree] Stopped scanning after ${totalItemCount} items`);
        return result;
    }

    try {
        const items = readdirSync(dirPath);

        // Limit items per directory
        const limitedItems = items.slice(0, MAX_FILES_PER_DIR);
        if (items.length > MAX_FILES_PER_DIR) {
            console.warn(`[FileTree] Directory has ${items.length} items, only showing first ${MAX_FILES_PER_DIR}: ${dirPath}`);
        }

        for (const item of limitedItems) {
            // Check global limit
            if (totalItemCount > MAX_TOTAL_ITEMS) {
                break;
            }

            // Skip system files and excluded directories
            if (item === '.DS_Store' || shouldExcludeDir(item)) {
                continue;
            }

            // Skip hidden files except special ones
            if (item.startsWith('.') && item !== '.nimbalyst' && item !== '.claude') {
                continue;
            }

            const fullPath = join(dirPath, item);

            try {
                const stats = statSync(fullPath);

                if (stats.isDirectory()) {
                    totalItemCount++;
                    result.push({
                        name: item,
                        type: 'directory',
                        path: fullPath,
                        children: getFolderContents(fullPath, depth + 1)
                    });
                } else if (stats.isFile()) {
                    totalItemCount++;
                    // Include all files - filtering happens in the UI
                    result.push({
                        name: item,
                        type: 'file',
                        path: fullPath
                    });
                }
            } catch (error) {
                // Skip files/dirs we can't stat (permissions, broken symlinks)
            }
        }

        // Sort: special directories first, then regular directories, then files
        result.sort((a, b) => {
            const aIsSpecial = a.type === 'directory' && isSpecialDirectory(a.name);
            const bIsSpecial = b.type === 'directory' && isSpecialDirectory(b.name);

            // Special directories always come first
            if (aIsSpecial && !bIsSpecial) return -1;
            if (!aIsSpecial && bIsSpecial) return 1;

            // If both are special, maintain their defined order
            if (aIsSpecial && bIsSpecial) {
                return SPECIAL_DIRECTORIES.indexOf(a.name) - SPECIAL_DIRECTORIES.indexOf(b.name);
            }

            // Regular directories before files
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }

            // Natural sort within same type
            return naturalCollator.compare(a.name, b.name);
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
