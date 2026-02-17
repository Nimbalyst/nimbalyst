import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { FileTreeItem } from '../types';
import { shouldExcludeDir } from './fileFilters';

// Natural sort collator for handling numbers in filenames
const naturalCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base'
});

// Performance limits -- all per-directory, no global cap.
// A single large directory can never prevent the rest of the tree from loading.
//
// MAX_DEPTH: deepest we'll recurse from workspace root. Prevents infinite loops
//   in circular symlinks and limits scan cost on deeply nested trees.
// MAX_ITEMS_PER_DIR: max immediate children shown in a single directory.
//   If a directory has more than this many entries, only the first N are shown.
//   This handles flat-huge directories (e.g., a folder with 50,000 images).
const MAX_DEPTH = 8;
const MAX_ITEMS_PER_DIR = 200;

// Special directories that should always appear first
const SPECIAL_DIRECTORIES = ['nimbalyst-local'];

function isSpecialDirectory(name: string): boolean {
    return SPECIAL_DIRECTORIES.includes(name);
}

function sortItems(items: FileTreeItem[]): void {
    items.sort((a, b) => {
        const aIsSpecial = a.type === 'directory' && isSpecialDirectory(a.name);
        const bIsSpecial = b.type === 'directory' && isSpecialDirectory(b.name);

        if (aIsSpecial && !bIsSpecial) return -1;
        if (!aIsSpecial && bIsSpecial) return 1;
        if (aIsSpecial && bIsSpecial) {
            return SPECIAL_DIRECTORIES.indexOf(a.name) - SPECIAL_DIRECTORIES.indexOf(b.name);
        }
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
        }
        return naturalCollator.compare(a.name, b.name);
    });
}

export function getFolderContents(dirPath: string, depth: number = 0): FileTreeItem[] {
    const result: FileTreeItem[] = [];
    const directoriesToPopulate: FileTreeItem[] = [];

    if (depth > MAX_DEPTH) {
        return result;
    }

    try {
        const entries = readdirSync(dirPath);
        let visibleCount = 0;

        for (const entry of entries) {
            if (entry === '.DS_Store' || shouldExcludeDir(entry)) continue;
            if (visibleCount >= MAX_ITEMS_PER_DIR) continue;

            const fullPath = join(dirPath, entry);

            try {
                const stats = statSync(fullPath);

                if (stats.isDirectory()) {
                    const dirItem: FileTreeItem = {
                        name: entry,
                        type: 'directory',
                        path: fullPath,
                        children: []
                    };
                    directoriesToPopulate.push(dirItem);
                    result.push(dirItem);
                    visibleCount++;
                } else if (stats.isFile()) {
                    result.push({ name: entry, type: 'file', path: fullPath });
                    visibleCount++;
                }
            } catch {
                // Skip files/dirs we can't stat (permissions, broken symlinks)
            }
        }

        sortItems(result);

        // Recurse into each child directory.
        // MAX_DEPTH + MAX_ITEMS_PER_DIR bound the total work per branch:
        //   worst case is 200^8 but in practice it's far less because most
        //   entries are files (not directories) and excluded dirs are pruned.
        for (const directory of directoriesToPopulate) {
            directory.children = getFolderContents(directory.path, depth + 1);
        }
    } catch (error: any) {
        if (error.code !== 'ENOENT') {
            console.error('Error reading folder contents:', error);
        }
    }

    return result;
}
