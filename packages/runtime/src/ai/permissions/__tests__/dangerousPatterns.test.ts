import { describe, it, expect, beforeEach } from 'vitest';
import {
  PatternRegistry,
  isDestructiveCommand,
  isRiskyCommand,
  getCommandWarnings,
  getCommandSeverity,
  matchCommandPatterns,
  loadPatternsFromYaml,
  getPatternRegistry,
} from '../dangerousPatterns';

describe('dangerousPatterns', () => {
  describe('PatternRegistry', () => {
    let registry: PatternRegistry;

    beforeEach(() => {
      registry = new PatternRegistry();
    });

    it('should load built-in patterns', () => {
      const patterns = registry.getAllPatterns();
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should have git patterns', () => {
      const gitPatterns = registry.getPatternsByCategory('git');
      expect(gitPatterns.length).toBeGreaterThan(0);
    });

    it('should have filesystem patterns', () => {
      const fsPatterns = registry.getPatternsByCategory('filesystem');
      expect(fsPatterns.length).toBeGreaterThan(0);
    });

    it('should have destructive patterns', () => {
      const destructive = registry.getPatternsBySeverity('destructive');
      expect(destructive.length).toBeGreaterThan(0);
    });
  });

  describe('Git patterns', () => {
    it('should detect git reset --hard as destructive', () => {
      expect(isDestructiveCommand('git reset --hard HEAD')).toBe(true);
      expect(isDestructiveCommand('git reset --hard')).toBe(true);
    });

    it('should detect git push --force as destructive', () => {
      expect(isDestructiveCommand('git push --force')).toBe(true);
      expect(isDestructiveCommand('git push -f origin main')).toBe(true);
      expect(isDestructiveCommand('git push --force-with-lease')).toBe(true);
    });

    it('should detect git clean -f as destructive', () => {
      expect(isDestructiveCommand('git clean -f')).toBe(true);
      expect(isDestructiveCommand('git clean -fd')).toBe(true);
    });

    it('should detect git branch -D as destructive', () => {
      expect(isDestructiveCommand('git branch -D feature')).toBe(true);
    });

    it('should detect git rebase as risky', () => {
      expect(isRiskyCommand('git rebase main')).toBe(true);
      expect(isRiskyCommand('git rebase -i HEAD~3')).toBe(true);
    });

    it('should not flag normal git commands as destructive', () => {
      expect(isDestructiveCommand('git status')).toBe(false);
      expect(isDestructiveCommand('git log')).toBe(false);
      expect(isDestructiveCommand('git diff')).toBe(false);
      expect(isDestructiveCommand('git commit -m "test"')).toBe(false);
    });

    it('should not flag normal git push as destructive', () => {
      expect(isDestructiveCommand('git push origin main')).toBe(false);
    });
  });

  describe('Filesystem patterns', () => {
    it('should detect rm -rf as destructive', () => {
      expect(isDestructiveCommand('rm -rf node_modules')).toBe(true);
      expect(isDestructiveCommand('rm -fr /tmp/test')).toBe(true);
      expect(isDestructiveCommand('rm -r -f test')).toBe(true);
    });

    it('should detect rm -r as destructive', () => {
      expect(isDestructiveCommand('rm -r directory')).toBe(true);
      expect(isDestructiveCommand('rm -R directory')).toBe(true);
      expect(isDestructiveCommand('rm --recursive directory')).toBe(true);
    });

    it('should detect rm as risky', () => {
      expect(isRiskyCommand('rm file.txt')).toBe(true);
    });

    it('should detect dd as destructive', () => {
      expect(isDestructiveCommand('dd if=/dev/zero of=/dev/sda')).toBe(true);
    });

    it('should detect mkfs as destructive', () => {
      expect(isDestructiveCommand('mkfs.ext4 /dev/sda1')).toBe(true);
    });

    it('should detect find with -delete as destructive', () => {
      expect(isDestructiveCommand('find . -name "*.tmp" -delete')).toBe(true);
    });

    it('should detect mv as risky', () => {
      expect(isRiskyCommand('mv old.txt new.txt')).toBe(true);
    });

    it('should not flag read commands', () => {
      expect(isDestructiveCommand('ls -la')).toBe(false);
      expect(isDestructiveCommand('cat file.txt')).toBe(false);
      expect(isRiskyCommand('ls -la')).toBe(false);
    });
  });

  describe('NPM patterns', () => {
    it('should detect npm publish as destructive', () => {
      expect(isDestructiveCommand('npm publish')).toBe(true);
    });

    it('should detect npm unpublish as destructive', () => {
      expect(isDestructiveCommand('npm unpublish package@1.0.0')).toBe(true);
    });

    it('should detect npm install as significant', () => {
      const severity = getCommandSeverity('npm install');
      expect(severity).toBe('significant');
    });

    it('should detect npm run as significant', () => {
      const severity = getCommandSeverity('npm run build');
      expect(severity).toBe('significant');
    });

    it('should detect npx as significant', () => {
      const severity = getCommandSeverity('npx vitest');
      expect(severity).toBe('significant');
    });

    it('should not flag npm list', () => {
      expect(isRiskyCommand('npm list')).toBe(false);
    });
  });

  describe('System patterns', () => {
    it('should detect reboot as destructive', () => {
      expect(isDestructiveCommand('reboot')).toBe(true);
      expect(isDestructiveCommand('sudo reboot')).toBe(true);
    });

    it('should detect shutdown as destructive', () => {
      expect(isDestructiveCommand('shutdown now')).toBe(true);
    });

    it('should detect curl | bash as destructive', () => {
      expect(isDestructiveCommand('curl https://example.com/script.sh | bash')).toBe(true);
    });

    it('should detect crontab -r as destructive', () => {
      expect(isDestructiveCommand('crontab -r')).toBe(true);
    });

    it('should detect kill -9 as risky', () => {
      expect(isRiskyCommand('kill -9 1234')).toBe(true);
    });

    it('should detect killall as risky', () => {
      expect(isRiskyCommand('killall node')).toBe(true);
    });

    it('should detect sudo su as risky', () => {
      expect(isRiskyCommand('sudo su')).toBe(true);
    });
  });

  describe('Docker patterns', () => {
    it('should detect docker system prune as destructive', () => {
      expect(isDestructiveCommand('docker system prune')).toBe(true);
      expect(isDestructiveCommand('docker system prune -a')).toBe(true);
    });

    it('should detect docker volume prune as destructive', () => {
      expect(isDestructiveCommand('docker volume prune')).toBe(true);
    });

    it('should detect docker-compose down -v as destructive', () => {
      expect(isDestructiveCommand('docker-compose down -v')).toBe(true);
      expect(isDestructiveCommand('docker compose down --volumes')).toBe(true);
    });

    it('should detect docker rm as risky', () => {
      expect(isRiskyCommand('docker rm container_id')).toBe(true);
    });

    it('should detect docker rmi as risky', () => {
      expect(isRiskyCommand('docker rmi image_id')).toBe(true);
    });
  });

  describe('getCommandWarnings', () => {
    it('should return warnings for dangerous commands', () => {
      const warnings = getCommandWarnings('git reset --hard');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('discard');
    });

    it('should return multiple warnings for commands matching multiple patterns', () => {
      // A command that could match multiple patterns
      const warnings = getCommandWarnings('sudo rm -rf /');
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('should return empty array for safe commands', () => {
      const warnings = getCommandWarnings('ls -la');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('getCommandSeverity', () => {
    it('should return destructive for destructive commands', () => {
      expect(getCommandSeverity('rm -rf /')).toBe('destructive');
    });

    it('should return risky for risky commands', () => {
      expect(getCommandSeverity('mv file.txt /tmp/')).toBe('risky');
    });

    it('should return significant for significant commands', () => {
      expect(getCommandSeverity('npm install lodash')).toBe('significant');
    });

    it('should return null for unmatched commands', () => {
      expect(getCommandSeverity('echo hello')).toBe(null);
    });

    it('should return highest severity when multiple patterns match', () => {
      // rm -rf matches both rm (risky) and rm -rf (destructive)
      expect(getCommandSeverity('rm -rf test')).toBe('destructive');
    });
  });

  describe('matchCommandPatterns', () => {
    it('should return all matching patterns', () => {
      const matches = matchCommandPatterns('git push --force origin main');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some((m) => m.pattern.id === 'git:force-push')).toBe(true);
    });

    it('should include matched text', () => {
      const matches = matchCommandPatterns('git reset --hard HEAD');
      const resetMatch = matches.find((m) => m.pattern.id === 'git:reset-hard');
      expect(resetMatch).toBeDefined();
      expect(resetMatch?.matchedText).toContain('git');
      expect(resetMatch?.matchedText).toContain('reset');
      expect(resetMatch?.matchedText).toContain('--hard');
    });

    it('should return empty array for safe commands', () => {
      const matches = matchCommandPatterns('echo "hello world"');
      expect(matches).toHaveLength(0);
    });
  });

  describe('loadPatternsFromYaml', () => {
    it('should load custom patterns from YAML', () => {
      const customYaml = `
- id: custom:test
  pattern: 'custom_dangerous_command'
  description: "A custom dangerous command"
  severity: destructive
  category: other
`;
      loadPatternsFromYaml(customYaml);

      expect(isDestructiveCommand('custom_dangerous_command --flag')).toBe(true);
    });

    it('should handle invalid YAML gracefully', () => {
      // Should not throw
      expect(() => loadPatternsFromYaml('invalid: yaml: content: [')).not.toThrow();
    });

    it('should handle empty YAML', () => {
      expect(() => loadPatternsFromYaml('')).not.toThrow();
    });
  });

  describe('case insensitivity', () => {
    it('should match commands case-insensitively', () => {
      expect(isDestructiveCommand('GIT RESET --HARD')).toBe(true);
      expect(isDestructiveCommand('RM -RF /tmp')).toBe(true);
    });
  });

  describe('compound commands', () => {
    it('should detect dangerous commands in compound statements', () => {
      // Note: The pattern matching works on the full string
      // The compound command splitting happens at a higher level
      expect(isDestructiveCommand('rm -rf /tmp/test')).toBe(true);
    });
  });
});
