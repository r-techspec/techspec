/**
 * Markdown formatting utilities for terminal output
 * 
 * Requirements:
 * - 7.3: Format markdown and code blocks appropriately for terminal output
 */

// ANSI escape codes for terminal formatting
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const UNDERLINE = '\x1b[4m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const MAGENTA = '\x1b[35m';
const GRAY = '\x1b[90m';

/**
 * Formats markdown text for terminal display
 * Requirement 7.3: Format markdown for terminal output
 */
export function formatMarkdown(text: string): string {
  let result = text;
  
  // Process code blocks first (to avoid processing markdown inside them)
  result = formatCodeBlocks(result);
  
  // Process inline elements
  result = formatHeaders(result);
  result = formatLists(result);
  result = formatInlineCode(result);
  result = formatEmphasis(result);
  result = formatLinks(result);
  
  return result;
}

/**
 * Formats fenced code blocks with syntax highlighting
 */
function formatCodeBlocks(text: string): string {
  // Match fenced code blocks: ```language\ncode\n```
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  
  return text.replace(codeBlockRegex, (_, language: string, code: string) => {
    const lang = language || 'text';
    const header = `${GRAY}─── ${lang} ${'─'.repeat(Math.max(0, 50 - lang.length))}${RESET}`;
    const footer = `${GRAY}${'─'.repeat(56)}${RESET}`;
    
    // Apply basic syntax highlighting
    const highlightedCode = highlightCode(code.trim(), lang);
    
    return `\n${header}\n${highlightedCode}\n${footer}\n`;
  });
}

/**
 * Basic syntax highlighting for code
 */
function highlightCode(code: string, language: string): string {
  // Simple keyword highlighting for common languages
  const keywords: Record<string, string[]> = {
    javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import', 'export', 'from', 'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'true', 'false', 'null', 'undefined'],
    typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import', 'export', 'from', 'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'true', 'false', 'null', 'undefined', 'interface', 'type', 'enum', 'implements', 'extends', 'public', 'private', 'protected'],
    python: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'as', 'try', 'except', 'raise', 'with', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'lambda', 'yield', 'async', 'await'],
    bash: ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'return', 'exit', 'echo', 'export', 'source', 'cd', 'ls', 'rm', 'cp', 'mv', 'mkdir', 'cat', 'grep', 'sed', 'awk'],
    sh: ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'return', 'exit', 'echo', 'export'],
  };

  const langKeywords = keywords[language.toLowerCase()] ?? [];
  
  if (langKeywords.length === 0) {
    return code;
  }

  let result = code;
  
  // Highlight strings (simple approach)
  result = result.replace(/(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, `${GREEN}$&${RESET}`);
  
  // Highlight comments
  result = result.replace(/(\/\/.*$|#.*$)/gm, `${GRAY}$1${RESET}`);
  
  // Highlight keywords (word boundaries)
  for (const keyword of langKeywords) {
    const regex = new RegExp(`\\b(${keyword})\\b`, 'g');
    result = result.replace(regex, `${MAGENTA}$1${RESET}`);
  }
  
  // Highlight numbers
  result = result.replace(/\b(\d+\.?\d*)\b/g, `${YELLOW}$1${RESET}`);
  
  return result;
}

/**
 * Formats markdown headers
 */
function formatHeaders(text: string): string {
  // H1: # Header
  text = text.replace(/^# (.+)$/gm, `\n${BOLD}${UNDERLINE}$1${RESET}\n`);
  
  // H2: ## Header
  text = text.replace(/^## (.+)$/gm, `\n${BOLD}$1${RESET}\n`);
  
  // H3: ### Header
  text = text.replace(/^### (.+)$/gm, `\n${BOLD}${CYAN}$1${RESET}\n`);
  
  // H4-H6
  text = text.replace(/^#{4,6} (.+)$/gm, `\n${CYAN}$1${RESET}\n`);
  
  return text;
}

/**
 * Formats markdown lists
 */
function formatLists(text: string): string {
  // Unordered lists: - item or * item
  text = text.replace(/^(\s*)[-*] (.+)$/gm, '$1• $2');
  
  // Ordered lists: 1. item
  text = text.replace(/^(\s*)\d+\. (.+)$/gm, '$1◦ $2');
  
  return text;
}

/**
 * Formats inline code
 */
function formatInlineCode(text: string): string {
  // `code` -> highlighted code
  return text.replace(/`([^`]+)`/g, `${CYAN}$1${RESET}`);
}

/**
 * Formats emphasis (bold, italic)
 */
function formatEmphasis(text: string): string {
  // Bold: **text** or __text__
  text = text.replace(/\*\*([^*]+)\*\*/g, `${BOLD}$1${RESET}`);
  text = text.replace(/__([^_]+)__/g, `${BOLD}$1${RESET}`);
  
  // Italic: *text* or _text_
  text = text.replace(/\*([^*]+)\*/g, `${ITALIC}$1${RESET}`);
  text = text.replace(/_([^_]+)_/g, `${ITALIC}$1${RESET}`);
  
  return text;
}

/**
 * Formats links
 */
function formatLinks(text: string): string {
  // [text](url) -> text (url)
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${UNDERLINE}$1${RESET} ${DIM}($2)${RESET}`);
}

/**
 * Strips all markdown formatting (for plain text output)
 */
export function stripMarkdown(text: string): string {
  let result = text;
  
  // Remove code blocks
  result = result.replace(/```[\s\S]*?```/g, '');
  
  // Remove inline code
  result = result.replace(/`([^`]+)`/g, '$1');
  
  // Remove headers
  result = result.replace(/^#{1,6} /gm, '');
  
  // Remove emphasis
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');
  result = result.replace(/\*([^*]+)\*/g, '$1');
  result = result.replace(/_([^_]+)_/g, '$1');
  
  // Remove links
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  return result;
}
