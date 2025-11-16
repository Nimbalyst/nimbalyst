import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getFolderContents } from '../FileTree';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('FileTree Natural Sorting', () => {
    let tempDir: string;

    beforeEach(() => {
        // Create a temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetree-test-'));
    });

    afterEach(() => {
        // Clean up temporary directory
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should sort files with numbers naturally', () => {
        // Create files with numbers
        const files = [
            'Doc 1.md',
            'Doc 2.md',
            'Doc 9.md',
            'Doc 10.md',
            'Doc 20.md',
            'Doc 100.md'
        ];

        files.forEach(filename => {
            fs.writeFileSync(path.join(tempDir, filename), '');
        });

        const result = getFolderContents(tempDir);
        const fileNames = result.map(item => item.name);

        expect(fileNames).toEqual([
            'Doc 1.md',
            'Doc 2.md',
            'Doc 9.md',
            'Doc 10.md',
            'Doc 20.md',
            'Doc 100.md'
        ]);
    });

    it('should sort files with leading zeros naturally', () => {
        // Create files with leading zeros
        const files = [
            '01 test.md',
            '02 test.md',
            '03 test.md',
            '10 test.md',
            '20 test.md'
        ];

        files.forEach(filename => {
            fs.writeFileSync(path.join(tempDir, filename), '');
        });

        const result = getFolderContents(tempDir);
        const fileNames = result.map(item => item.name);

        expect(fileNames).toEqual([
            '01 test.md',
            '02 test.md',
            '03 test.md',
            '10 test.md',
            '20 test.md'
        ]);
    });

    it('should sort version numbers naturally', () => {
        // Create files with version numbers
        const files = [
            'v1.2.0.md',
            'v1.2.1.md',
            'v1.2.10.md',
            'v1.10.0.md',
            'v2.0.0.md'
        ];

        files.forEach(filename => {
            fs.writeFileSync(path.join(tempDir, filename), '');
        });

        const result = getFolderContents(tempDir);
        const fileNames = result.map(item => item.name);

        expect(fileNames).toEqual([
            'v1.2.0.md',
            'v1.2.1.md',
            'v1.2.10.md',
            'v1.10.0.md',
            'v2.0.0.md'
        ]);
    });

    it('should still sort directories before files', () => {
        // Create mix of files and directories
        fs.writeFileSync(path.join(tempDir, 'File 1.md'), '');
        fs.writeFileSync(path.join(tempDir, 'File 10.md'), '');
        fs.mkdirSync(path.join(tempDir, 'Dir 1'));
        fs.mkdirSync(path.join(tempDir, 'Dir 10'));
        fs.writeFileSync(path.join(tempDir, 'File 2.md'), '');

        const result = getFolderContents(tempDir);
        const names = result.map(item => ({ name: item.name, type: item.type }));

        expect(names).toEqual([
            { name: 'Dir 1', type: 'directory' },
            { name: 'Dir 10', type: 'directory' },
            { name: 'File 1.md', type: 'file' },
            { name: 'File 2.md', type: 'file' },
            { name: 'File 10.md', type: 'file' }
        ]);
    });

    it('should handle mixed alphanumeric filenames', () => {
        // Create files with mixed patterns
        const files = [
            'Chapter 1.md',
            'Chapter 2.md',
            'Chapter 10.md',
            'Appendix A.md',
            'Appendix B.md',
            'Index.md'
        ];

        files.forEach(filename => {
            fs.writeFileSync(path.join(tempDir, filename), '');
        });

        const result = getFolderContents(tempDir);
        const fileNames = result.map(item => item.name);

        expect(fileNames).toEqual([
            'Appendix A.md',
            'Appendix B.md',
            'Chapter 1.md',
            'Chapter 2.md',
            'Chapter 10.md',
            'Index.md'
        ]);
    });

    it('should be case-insensitive', () => {
        // Create files with different cases
        const files = [
            'apple.md',
            'Banana.md',
            'cherry.md',
            'DELTA.md'
        ];

        files.forEach(filename => {
            fs.writeFileSync(path.join(tempDir, filename), '');
        });

        const result = getFolderContents(tempDir);
        const fileNames = result.map(item => item.name);

        expect(fileNames).toEqual([
            'apple.md',
            'Banana.md',
            'cherry.md',
            'DELTA.md'
        ]);
    });
});
