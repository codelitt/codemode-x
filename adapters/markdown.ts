import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, basename, extname } from 'path';
import type { Adapter, ToolDefinition, AdapterOptions } from '../src/types.js';

/**
 * Markdown adapter — indexes markdown files as searchable knowledge chunks.
 * Each heading section becomes a "tool" that returns the section content.
 * This allows cmx_search to find relevant docs alongside API tools.
 */
export const markdownAdapter: Adapter = {
  name: 'markdown',

  async parse(source: unknown, opts?: AdapterOptions): Promise<ToolDefinition[]> {
    const pattern = String(source);
    const domain = opts?.domain ?? 'docs';

    // Resolve glob pattern to files
    const files = resolveGlob(pattern);
    const tools: ToolDefinition[] = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8');
      const fileName = basename(filePath, extname(filePath));
      const sections = splitSections(content, fileName);

      for (const section of sections) {
        tools.push({
          name: section.id,
          domain,
          description: section.title,
          parameters: [],
          returnType: 'string',
          readOnly: true,
          // Store the content as an "example" so search can surface it
          examples: [section.content.slice(0, 500)],
        });
      }
    }

    return tools;
  },
};

// ─── Section parsing ─────────────────────────────────────────────

interface Section {
  id: string;
  title: string;
  content: string;
  level: number;
}

/** Split a markdown file into sections by headings */
function splitSections(content: string, fileSlug: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];
  let currentTitle = fileSlug;
  let currentLevel = 1;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);

    if (headingMatch) {
      // Flush previous section
      if (currentLines.length > 0) {
        const sectionContent = currentLines.join('\n').trim();
        if (sectionContent.length > 20) { // Skip trivially small sections
          sections.push({
            id: slugify(`${fileSlug}_${currentTitle}`),
            title: `${fileSlug}: ${currentTitle}`,
            content: sectionContent,
            level: currentLevel,
          });
        }
      }

      currentTitle = headingMatch[2].trim();
      currentLevel = headingMatch[1].length;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Flush final section
  if (currentLines.length > 0) {
    const sectionContent = currentLines.join('\n').trim();
    if (sectionContent.length > 20) {
      sections.push({
        id: slugify(`${fileSlug}_${currentTitle}`),
        title: `${fileSlug}: ${currentTitle}`,
        content: sectionContent,
        level: currentLevel,
      });
    }
  }

  return sections;
}

/** Convert a title to a safe identifier */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

/** Resolve a glob pattern to file paths, supporting ** patterns */
function resolveGlob(pattern: string): string[] {
  // Simple glob implementation for common patterns
  const resolvedPattern = resolve(pattern);

  // If it's a direct file, return it
  try {
    if (statSync(resolvedPattern).isFile()) {
      return [resolvedPattern];
    }
  } catch {}

  // Handle ** glob patterns manually
  const parts = pattern.split('**');
  if (parts.length === 2) {
    const baseDir = resolve(parts[0] || '.');
    const ext = parts[1].replace(/^\/?\*/, ''); // e.g., "/*.md" → ".md"
    return findFilesRecursive(baseDir, ext);
  }

  // Handle simple *.md patterns
  if (pattern.includes('*')) {
    const dir = resolve(pattern.replace(/\/?\*.*$/, '') || '.');
    const ext = pattern.match(/\*(\.\w+)$/)?.[1] ?? '';
    return findFiles(dir, ext);
  }

  // Directory — find all .md files
  try {
    if (statSync(resolvedPattern).isDirectory()) {
      return findFilesRecursive(resolvedPattern, '.md');
    }
  } catch {}

  return [];
}

function findFiles(dir: string, ext: string): string[] {
  try {
    return readdirSync(dir)
      .filter(f => !ext || f.endsWith(ext))
      .map(f => resolve(dir, f))
      .filter(f => statSync(f).isFile());
  } catch {
    return [];
  }
}

function findFilesRecursive(dir: string, ext: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
          results.push(...findFilesRecursive(full, ext));
        } else if (stat.isFile() && (!ext || entry.endsWith(ext))) {
          results.push(full);
        }
      } catch {}
    }
  } catch {}
  return results;
}
