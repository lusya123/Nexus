import { Fragment } from 'react';
import type { ReactNode } from 'react';

interface MarkdownLiteProps {
  content: string;
}

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; code: string; lang?: string }
  | { type: 'hr' };

const ANSI_ESCAPE_REGEX = new RegExp(String.raw`[\u001B]\[[0-?]*[ -/]*[@-~]`, 'g');
const ANSI_OSC_REGEX = new RegExp(String.raw`[\u001B]\][^\u0007]*(?:\u0007|[\u001B]\\)`, 'g');

function removeControlChars(input: string): string {
  let output = '';
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (ch === '\n' || ch === '\t' || code >= 0x20) {
      output += ch;
    }
  }
  return output;
}

function cleanContent(raw: string): string {
  return removeControlChars(
    raw
    .replace(/\r\n?/g, '\n')
    .replace(ANSI_OSC_REGEX, '')
    .replace(ANSI_ESCAPE_REGEX, '')
  );
}

function isFenceStart(line: string): RegExpMatchArray | null {
  return line.match(/^\s*```([\w-]+)?\s*$/);
}

function isHorizontalRule(line: string): boolean {
  return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function isHeading(line: string): RegExpMatchArray | null {
  return line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
}

function isBulletItem(line: string): RegExpMatchArray | null {
  return line.match(/^\s*[-*+]\s+(.*)$/);
}

function isOrderedItem(line: string): RegExpMatchArray | null {
  return line.match(/^\s*\d+\.\s+(.*)$/);
}

function isBlockquote(line: string): RegExpMatchArray | null {
  return line.match(/^\s*>\s?(.*)$/);
}

function isBlockBoundary(line: string): boolean {
  return (
    line.trim().length === 0 ||
    Boolean(isFenceStart(line)) ||
    isHorizontalRule(line) ||
    Boolean(isHeading(line)) ||
    Boolean(isBulletItem(line)) ||
    Boolean(isOrderedItem(line)) ||
    Boolean(isBlockquote(line))
  );
}

function parseBlocks(content: string): MarkdownBlock[] {
  const cleaned = cleanContent(content);
  const lines = cleaned.split('\n');
  const blocks: MarkdownBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    const fenceStart = isFenceStart(line);
    if (fenceStart) {
      const lang = fenceStart[1]?.trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && /^\s*```\s*$/.test(lines[i])) {
        i += 1;
      }
      blocks.push({ type: 'code', code: codeLines.join('\n'), lang });
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    const heading = isHeading(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, text: heading[2] });
      i += 1;
      continue;
    }

    if (isBulletItem(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = isBulletItem(lines[i]);
        if (!match) break;
        items.push(match[1]);
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (isOrderedItem(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = isOrderedItem(lines[i]);
        if (!match) break;
        items.push(match[1]);
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    if (isBlockquote(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const match = isBlockquote(lines[i]);
        if (!match) break;
        quoteLines.push(match[1]);
        i += 1;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join('\n') });
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length && !isBlockBoundary(lines[i])) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join('\n') });
  }

  if (blocks.length === 0) {
    return [{ type: 'paragraph', text: cleaned }];
  }

  return blocks;
}

function withPattern(
  nodes: ReactNode[],
  pattern: RegExp,
  renderMatch: (parts: RegExpExecArray, key: string) => ReactNode,
  keyPrefix: string
): ReactNode[] {
  let matchCount = 0;

  return nodes.flatMap((node, nodeIndex) => {
    if (typeof node !== 'string') return [node];

    const source = node;
    const next: ReactNode[] = [];
    let cursor = 0;
    pattern.lastIndex = 0;

    let match = pattern.exec(source);
    while (match) {
      const start = match.index;
      const end = start + match[0].length;

      if (start > cursor) {
        next.push(source.slice(cursor, start));
      }

      const key = `${keyPrefix}-${nodeIndex}-${matchCount}`;
      next.push(renderMatch(match, key));
      matchCount += 1;
      cursor = end;

      if (match[0].length === 0) break;
      match = pattern.exec(source);
    }

    if (cursor < source.length) {
      next.push(source.slice(cursor));
    }

    return next;
  });
}

function sanitizeHttpUrl(rawHref: string): string | null {
  try {
    const url = new URL(rawHref);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  let nodes: ReactNode[] = [text];

  nodes = withPattern(
    nodes,
    /`([^`\n]+)`/g,
    (parts, key) => (
      <code key={key} className="md-code">
        {parts[1]}
      </code>
    ),
    `${keyPrefix}-code`
  );

  nodes = withPattern(
    nodes,
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (parts, key) => {
      const safeHref = sanitizeHttpUrl(parts[2]);
      if (!safeHref) return parts[0];
      return (
        <a key={key} className="md-link" href={safeHref} target="_blank" rel="noreferrer">
          {parts[1]}
        </a>
      );
    },
    `${keyPrefix}-link`
  );

  nodes = withPattern(
    nodes,
    /\*\*([^*\n]+)\*\*/g,
    (parts, key) => (
      <strong key={key} className="md-strong">
        {parts[1]}
      </strong>
    ),
    `${keyPrefix}-strong`
  );

  return nodes;
}

function renderInlineWithBreaks(text: string, keyPrefix: string): ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => (
    <Fragment key={`${keyPrefix}-line-${i}`}>
      {i > 0 && <br />}
      {renderInline(line, `${keyPrefix}-inline-${i}`)}
    </Fragment>
  ));
}

export function MarkdownLite({ content }: MarkdownLiteProps) {
  const blocks = parseBlocks(content);

  return (
    <div className="md-root">
      {blocks.map((block, idx) => {
        const key = `block-${idx}`;

        if (block.type === 'heading') {
          if (block.level === 1) {
            return (
              <h1 key={key} className="md-h md-h1">
                {renderInline(block.text, `${key}-h1`)}
              </h1>
            );
          }
          if (block.level === 2) {
            return (
              <h2 key={key} className="md-h md-h2">
                {renderInline(block.text, `${key}-h2`)}
              </h2>
            );
          }
          if (block.level === 3) {
            return (
              <h3 key={key} className="md-h md-h3">
                {renderInline(block.text, `${key}-h3`)}
              </h3>
            );
          }
          if (block.level === 4) {
            return (
              <h4 key={key} className="md-h md-h4">
                {renderInline(block.text, `${key}-h4`)}
              </h4>
            );
          }
          if (block.level === 5) {
            return (
              <h5 key={key} className="md-h md-h5">
                {renderInline(block.text, `${key}-h5`)}
              </h5>
            );
          }
          return (
            <h6 key={key} className="md-h md-h6">
              {renderInline(block.text, `${key}-h6`)}
            </h6>
          );
        }

        if (block.type === 'paragraph') {
          return (
            <p key={key} className="md-p">
              {renderInlineWithBreaks(block.text, `${key}-p`)}
            </p>
          );
        }

        if (block.type === 'ul') {
          return (
            <ul key={key} className="md-ul">
              {block.items.map((item, i) => (
                <li key={`${key}-item-${i}`} className="md-li">
                  {renderInlineWithBreaks(item, `${key}-item-${i}`)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={key} className="md-ol">
              {block.items.map((item, i) => (
                <li key={`${key}-item-${i}`} className="md-li">
                  {renderInlineWithBreaks(item, `${key}-item-${i}`)}
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote key={key} className="md-quote">
              {renderInlineWithBreaks(block.text, `${key}-quote`)}
            </blockquote>
          );
        }

        if (block.type === 'code') {
          return (
            <div key={key} className="md-codeblock">
              {block.lang && <div className="md-codeblock-lang">{block.lang}</div>}
              <pre className="md-pre">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        return <hr key={key} className="md-hr" />;
      })}
    </div>
  );
}
