import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SlashCommandService } from '../SlashCommandService';

describe('SlashCommandService', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'slash-command-service-'));
  });

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  });

  it('includes project skills from .claude/skills in the slash command list', async () => {
    const skillsDir = path.join(workspacePath, '.claude', 'skills', 'workspace-skill');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'SKILL.md'),
      `---
name: workspace-skill-test
description: Workspace skill for autocomplete coverage
argument-hint: [topic]
---

# Workspace Skill
`,
      'utf-8'
    );

    const service = new SlashCommandService(workspacePath);
    const commands = await service.listCommands([], []);
    const skill = commands.find(cmd => cmd.name === 'workspace-skill-test');

    expect(skill).toBeDefined();
    expect(skill?.kind).toBe('skill');
    expect(skill?.source).toBe('project');
    expect(skill?.argumentHint).toBe('[topic]');
  });

  it('hides skills with user-invocable: false from the slash command list', async () => {
    const skillsDir = path.join(workspacePath, '.claude', 'skills', 'hidden-skill');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'SKILL.md'),
      `---
name: hidden-skill-test
description: Hidden skill for autocomplete coverage
user-invocable: false
---

# Hidden Skill
`,
      'utf-8'
    );

    const service = new SlashCommandService(workspacePath);
    const commands = await service.listCommands([], []);

    expect(commands.some(cmd => cmd.name === 'hidden-skill-test')).toBe(false);
  });
});
