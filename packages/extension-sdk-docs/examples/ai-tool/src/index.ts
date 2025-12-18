/**
 * Word Stats Extension
 *
 * An AI-tool-only extension (no custom editor).
 * Provides tools for analyzing text documents.
 */

import type { ExtensionAITool } from '@nimbalyst/extension-sdk';

// No components needed for tool-only extensions
export const components = {};

// AI tools for text analysis
export const aiTools: ExtensionAITool[] = [
  {
    name: 'wordstats.count',
    description: 'Count words, characters, sentences, and paragraphs in the current document',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (_args, context) => {
      if (!context.fileContent) {
        return { error: 'No file is currently open' };
      }

      const text = context.fileContent;

      // Word count (split on whitespace)
      const words = text.trim().split(/\s+/).filter(w => w.length > 0);

      // Character counts
      const characters = text.length;
      const charactersNoSpaces = text.replace(/\s/g, '').length;

      // Sentence count (rough estimate)
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;

      // Paragraph count (split on double newlines)
      const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;

      return {
        words: words.length,
        characters,
        charactersNoSpaces,
        sentences,
        paragraphs,
        filePath: context.filePath,
      };
    },
  },

  {
    name: 'wordstats.frequency',
    description: 'Get the most frequently used words in the document',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of words to return (default: 20)',
        },
        minLength: {
          type: 'number',
          description: 'Minimum word length to include (default: 3)',
        },
      },
    },
    handler: async (args, context) => {
      if (!context.fileContent) {
        return { error: 'No file is currently open' };
      }

      const limit = args.limit ?? 20;
      const minLength = args.minLength ?? 3;

      // Extract words (lowercase, letters only)
      const words = context.fileContent
        .toLowerCase()
        .match(/\b[a-z]+\b/g) || [];

      // Count frequencies
      const freq: Record<string, number> = {};
      for (const word of words) {
        if (word.length >= minLength) {
          freq[word] = (freq[word] || 0) + 1;
        }
      }

      // Sort by frequency
      const sorted = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);

      return {
        topWords: sorted.map(([word, count]) => ({ word, count })),
        uniqueWords: Object.keys(freq).length,
        totalWords: words.length,
      };
    },
  },

  {
    name: 'wordstats.readability',
    description: 'Calculate readability metrics (Flesch-Kincaid grade level)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (_args, context) => {
      if (!context.fileContent) {
        return { error: 'No file is currently open' };
      }

      const text = context.fileContent;

      // Count syllables (rough approximation)
      const countSyllables = (word: string): number => {
        word = word.toLowerCase();
        if (word.length <= 3) return 1;

        word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
        word = word.replace(/^y/, '');

        const syllables = word.match(/[aeiouy]{1,2}/g);
        return syllables ? syllables.length : 1;
      };

      // Get words and sentences
      const words = text.match(/\b[a-z]+\b/gi) || [];
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);

      if (words.length === 0 || sentences.length === 0) {
        return { error: 'Document is too short for readability analysis' };
      }

      // Count total syllables
      const totalSyllables = words.reduce((sum, word) => sum + countSyllables(word), 0);

      // Flesch-Kincaid Grade Level
      const avgWordsPerSentence = words.length / sentences.length;
      const avgSyllablesPerWord = totalSyllables / words.length;

      const gradeLevel = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;

      // Flesch Reading Ease
      const readingEase = 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord;

      // Interpret the scores
      let difficulty: string;
      if (gradeLevel < 6) difficulty = 'Easy (elementary school)';
      else if (gradeLevel < 9) difficulty = 'Medium (middle school)';
      else if (gradeLevel < 12) difficulty = 'Fairly difficult (high school)';
      else if (gradeLevel < 16) difficulty = 'Difficult (college)';
      else difficulty = 'Very difficult (graduate level)';

      return {
        fleschKincaidGrade: Math.round(gradeLevel * 10) / 10,
        fleschReadingEase: Math.round(readingEase * 10) / 10,
        difficulty,
        avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
        avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 100) / 100,
        totalWords: words.length,
        totalSentences: sentences.length,
      };
    },
  },
];

// Lifecycle hooks
export function activate() {
  console.log('Word Stats extension activated');
}

export function deactivate() {
  console.log('Word Stats extension deactivated');
}
