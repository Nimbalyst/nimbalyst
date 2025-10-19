import { z } from 'zod';
import * as yaml from 'js-yaml';
import type { Agent, AgentMetadata } from '@nimbalyst/runtime/agents';

const AgentParameterSchema = z.object({
  type: z.enum(['text', 'string', 'select', 'number', 'boolean']),
  description: z.string().optional(),
  default: z.any().optional(),
  required: z.boolean().optional(),
  options: z.union([z.array(z.string()), z.array(z.number())]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const AgentMetadataSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  parameters: z.record(AgentParameterSchema).optional(),
  origin: z.enum(['user', 'extension', 'builtin']).optional(),
  extensionId: z.string().optional(),
});

export class AgentValidator {
  static validateMetadata(metadata: unknown): AgentMetadata {
    return AgentMetadataSchema.parse(metadata);
  }

  static parseAgentFile(content: string, filePath?: string): Agent {
    // Extract frontmatter and content
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      throw new Error('Invalid agent file format: missing frontmatter');
    }

    const [, frontmatter, instructions] = match;

    // Parse YAML frontmatter
    let metadata: unknown;
    try {
      metadata = yaml.load(frontmatter);
    } catch (error) {
      throw new Error(`Invalid YAML frontmatter: ${error}`);
    }

    // Validate metadata
    const validatedMetadata = this.validateMetadata(metadata);

    // Generate agent ID
    const id = filePath || `agent:${validatedMetadata.name}`;

    return {
      id,
      path: filePath,
      metadata: validatedMetadata,
      content: instructions.trim(),
    };
  }

  static validateParameters(
    parameters: Record<string, any>,
    schema?: Record<string, any>
  ): Record<string, any> {
    if (!schema) return parameters;

    const validated: Record<string, any> = {};

    for (const [key, paramDef] of Object.entries(schema)) {
      const value = parameters[key];
      const param = paramDef as any;

      // Check required
      if (param.required && value === undefined) {
        throw new Error(`Missing required parameter: ${key}`);
      }

      // Use default if not provided
      if (value === undefined && param.default !== undefined) {
        validated[key] = param.default;
        continue;
      }

      // Skip if optional and not provided
      if (value === undefined) continue;

      // Validate type
      switch (param.type) {
        case 'text':
        case 'string':
          if (typeof value !== 'string') {
            throw new Error(`Parameter ${key} must be a string`);
          }
          break;
        case 'number':
          if (typeof value !== 'number') {
            throw new Error(`Parameter ${key} must be a number`);
          }
          if (param.min !== undefined && value < param.min) {
            throw new Error(`Parameter ${key} must be >= ${param.min}`);
          }
          if (param.max !== undefined && value > param.max) {
            throw new Error(`Parameter ${key} must be <= ${param.max}`);
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean') {
            throw new Error(`Parameter ${key} must be a boolean`);
          }
          break;
        case 'select':
          if (param.options && !param.options.includes(value)) {
            throw new Error(`Parameter ${key} must be one of: ${param.options.join(', ')}`);
          }
          break;
      }

      validated[key] = value;
    }

    return validated;
  }
}