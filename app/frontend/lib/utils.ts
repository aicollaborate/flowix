import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Extract title, description, tags and preview image from markdown content
 */
export interface NoteMeta {
  title: string
  description: string
  tags: string[]
  todos: Array<{ content: string; status: string }>
  previewImage: string | null
}

export function extractNoteMeta(content: string): NoteMeta {
  if (!content || !content.trim()) {
    return { title: 'Untitled', description: '', tags: [], todos: [], previewImage: null }
  }

  // Strip frontmatter if present, then find first non-empty line in body
  let body = content;
  const fmMatch = FRONTMATTER_RE.exec(content);
  if (fmMatch) {
    body = fmMatch[1]; // body is the part after ---...---
  }

  const lines = body.split('\n');
  let firstLine = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      firstLine = trimmed;
      break;
    }
  }

  // Extract title from first line - preserve # heading markers
  let title = firstLine.replace(/^#+\s*/, '').trim();
  if (!title) {
    title = firstLine;
  }

  // Build description from first line (preserve original format)
  const description = firstLine.slice(0, 200)

  // 2. Extract tags (#tag pattern) from full content (tags are in body, not frontmatter)
  const tagPattern = /#[^\s\p{P}]+(?=$|[\s\p{P}])/gu;
  const tagMatches = body.match(tagPattern) || [];
  const tags = [...new Set(tagMatches.map(tag => tag.slice(1)))].sort();

  // 3. Extract todos (- [ ] or - [x] or - [] patterns)
  const todoPattern = /^(\s*)-\s*\[([ xX]?)\][^\S\r\n]*(.*)$/gm;
  const todos: Array<{ content: string; status: string }> = [];
  let match;
  while ((match = todoPattern.exec(body)) !== null) {
    const todoContent = match[3].trim();
    if (isBlankTodoContent(todoContent)) continue;

    const status = match[2].toLowerCase() === 'x' ? 'done' : 'pending';
    todos.push({ content: todoContent, status });
  }

  // 4. Extract preview image (first localhost image)
  const imagePattern = /!\[([^\]]*)\]\(([^)]*localhost[^)]*)\)/;
  const imageMatch = body.match(imagePattern);
  const previewImage = imageMatch ? imageMatch[2] : null;

  return { title, description, tags, todos, previewImage }
}

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n([\s\S]*)$/;

function isBlankTodoContent(content: string): boolean {
  return content.replace(/&nbsp;|\u00a0/gi, '').trim() === '';
}

/**
 * Format a timestamp (ms) to a consistent YYYY/M/D HH:mm string
 */
export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
