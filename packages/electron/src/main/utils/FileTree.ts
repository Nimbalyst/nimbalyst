import { readdir, stat } from 'fs/promises';
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

export async function getFolderContents(dirPath: string, depth: number = 0): Promise<FileTreeItem[]> {
    const result: FileTreeItem[] = [];
    const directoriesToPopulate: FileTreeItem[] = [];

    if (depth > MAX_DEPTH) {
        return result;
    }

    try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        let visibleCount = 0;

        for (const entry of entries) {
            if (entry.name === '.DS_Store' || shouldExcludeDir(entry.name)) continue;
            if (visibleCount >= MAX_ITEMS_PER_DIR) continue;

            const fullPath = join(dirPath, entry.name);

            // Resolve symlinks to their target type
            let isDir = entry.isDirectory();
            let isFile = entry.isFile();
            if (entry.isSymbolicLink()) {
                try {
                    const targetStats = await stat(fullPath);
                    isDir = targetStats.isDirectory();
                    isFile = targetStats.isFile();
                } catch {
                    // Broken symlink — skip
                    continue;
                }
            }

            if (isDir) {
                const dirItem: FileTreeItem = {
                    name: entry.name,
                    type: 'directory',
                    path: fullPath,
                    children: []
                };
                directoriesToPopulate.push(dirItem);
                result.push(dirItem);
                visibleCount++;
            } else if (isFile) {
                result.push({ name: entry.name, type: 'file', path: fullPath });
                visibleCount++;
            }
        }

        sortItems(result);

        // Recurse into each child directory.
        // MAX_DEPTH + MAX_ITEMS_PER_DIR bound the total work per branch:
        //   worst case is 200^8 but in practice it's far less because most
        //   entries are files (not directories) and excluded dirs are pruned.
        await Promise.all(
            directoriesToPopulate.map(async (directory) => {
                directory.children = await getFolderContents(directory.path, depth + 1);
            })
        );
    } catch (error: any) {
        if (error.code !== 'ENOENT') {
            console.error('Error reading folder contents:', error);
        }
    }

    return result;
}
