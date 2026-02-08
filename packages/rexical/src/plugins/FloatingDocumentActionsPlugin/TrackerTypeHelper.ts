/**
 * Helper functions for tracker type operations
 * This is a simplified version that doesn't depend on runtime internals
 */

export interface TrackerTypeInfo {
  type: string;
  displayName: string;
  icon: string;
  color: string;
}

/**
 * Get built-in tracker types that support full-document mode
 */
export function getBuiltInFullDocumentTrackerTypes(): TrackerTypeInfo[] {
  return [
    {
      type: 'plan',
      displayName: 'Plan',
      icon: 'flag',
      color: '#3b82f6',
    },
    {
      type: 'decision',
      displayName: 'Decision',
      icon: 'gavel',
      color: '#8b5cf6',
    },
  ];
}

/**
 * Get the current tracker type from markdown content
 */
export function getCurrentTrackerTypeFromMarkdown(markdown: string): string | null {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
  const match = markdown.match(frontmatterRegex);

  if (!match) {
    return null;
  }

  const yamlContent = match[1];

  // Check for planStatus
  if (yamlContent.includes('planStatus:')) {
    return 'plan';
  }

  // Check for decisionStatus
  if (yamlContent.includes('decisionStatus:')) {
    return 'decision';
  }

  return null;
}

/**
 * Get default frontmatter template for a tracker type
 */
export function getDefaultFrontmatterForType(trackerType: string): Record<string, any> {
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  // Generate a simple ID (using timestamp + random)
  const generateId = (prefix: string) => {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  };

  if (trackerType === 'plan') {
    return {
      planId: generateId('plan'),
      title: '',
      status: 'draft',
      planType: 'feature',
      priority: 'medium',
      progress: 0,
      owner: '',
      stakeholders: [],
      tags: [],
      created: today,
      updated: now,
    };
  } else if (trackerType === 'decision') {
    return {
      decisionId: generateId('dec'),
      title: '',
      status: 'to-do',
      chosen: '',
      priority: 'medium',
      owner: '',
      stakeholders: [],
      tags: [],
      created: today,
      updated: now,
    };
  }

  return {};
}

/**
 * Apply tracker type to markdown content
 */
export function applyTrackerTypeToMarkdown(markdown: string, trackerType: string): string {
  const defaultData = getDefaultFrontmatterForType(trackerType);

  // Determine the frontmatter key
  let frontmatterKey = 'trackerStatus';
  if (trackerType === 'plan') {
    frontmatterKey = 'planStatus';
  } else if (trackerType === 'decision') {
    frontmatterKey = 'decisionStatus';
  }

  // Simple YAML serialization (basic approach)
  const yamlLines = [`${frontmatterKey}:`];
  for (const [key, value] of Object.entries(defaultData)) {
    if (Array.isArray(value)) {
      yamlLines.push(`  ${key}: []`);
    } else if (typeof value === 'string') {
      yamlLines.push(`  ${key}: "${value}"`);
    } else {
      yamlLines.push(`  ${key}: ${value}`);
    }
  }

  const yamlContent = yamlLines.join('\n');

  const frontmatterRegex = /^---\n[\s\S]*?\n---\n?/;
  const hasFrontmatter = frontmatterRegex.test(markdown);

  if (hasFrontmatter) {
    // Replace existing frontmatter
    return markdown.replace(frontmatterRegex, `---\n${yamlContent}\n---\n`);
  } else {
    // Add frontmatter at the beginning
    return `---\n${yamlContent}\n---\n${markdown}`;
  }
}

/**
 * Remove tracker type from markdown content
 */
export function removeTrackerTypeFromMarkdown(markdown: string): string {
  const frontmatterRegex = /^---\n[\s\S]*?\n---\n?/;
  return markdown.replace(frontmatterRegex, '');
}
