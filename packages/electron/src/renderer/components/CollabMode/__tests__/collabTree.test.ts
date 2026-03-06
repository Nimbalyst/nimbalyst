import { describe, expect, it } from 'vitest';
import {
  buildCollabTree,
  getCollabDocumentPath,
  getCollabNodeName,
  getCollabParentPath,
  joinCollabPath,
  normalizeCollabPath,
} from '../collabTree';
import type { SharedDocument } from '../../../store/atoms/collabDocuments';

function makeDocument(
  documentId: string,
  title: string,
  updatedAt = 1
): SharedDocument {
  return {
    documentId,
    title,
    documentType: 'markdown',
    createdBy: 'user-1',
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('collabTree', () => {
  it('normalizes collab paths consistently', () => {
    expect(normalizeCollabPath(' /Specs//API Spec  ')).toBe('Specs/API Spec');
    expect(normalizeCollabPath('Specs\\Deprecated\\Auth')).toBe('Specs/Deprecated/Auth');
    expect(normalizeCollabPath('')).toBe('');
  });

  it('joins and splits folder paths', () => {
    expect(joinCollabPath('Specs/Deprecated', 'Auth')).toBe('Specs/Deprecated/Auth');
    expect(getCollabParentPath('Specs/Deprecated/Auth')).toBe('Specs/Deprecated');
    expect(getCollabParentPath('Specs')).toBeNull();
    expect(getCollabNodeName('Specs/Deprecated/Auth')).toBe('Auth');
  });

  it('builds nested folders from slash-delimited document titles', () => {
    const tree = buildCollabTree([
      makeDocument('doc-1', 'Specs/API Spec'),
      makeDocument('doc-2', 'Specs/Deprecated/Legacy Auth'),
      makeDocument('doc-3', 'RFCs/Auth Redesign'),
    ], []);

    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({ type: 'folder', path: 'RFCs' });
    expect(tree[1]).toMatchObject({ type: 'folder', path: 'Specs' });

    const specsFolder = tree[1];
    if (specsFolder.type !== 'folder') {
      throw new Error('Expected folder');
    }

    expect(specsFolder.children).toHaveLength(2);
    expect(specsFolder.children[0]).toMatchObject({
      type: 'folder',
      path: 'Specs/Deprecated',
    });
    expect(specsFolder.children[1]).toMatchObject({
      type: 'document',
      path: 'Specs/API Spec',
      name: 'API Spec',
    });
  });

  it('keeps explicit empty folders even without documents', () => {
    const tree = buildCollabTree([], ['Architecture', 'Specs/Deprecated']);

    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({ type: 'folder', path: 'Architecture' });
    expect(tree[1]).toMatchObject({ type: 'folder', path: 'Specs' });

    const specsFolder = tree[1];
    if (specsFolder.type !== 'folder') {
      throw new Error('Expected folder');
    }

    expect(specsFolder.children[0]).toMatchObject({
      type: 'folder',
      path: 'Specs/Deprecated',
    });
  });

  it('falls back to document id when title is empty', () => {
    const document = makeDocument('doc-123', '');
    expect(getCollabDocumentPath(document)).toBe('doc-123');
  });
});
