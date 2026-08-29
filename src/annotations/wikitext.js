const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
}[character]));

/**
 * Small safe subset of Wikitext used in annotation descriptions. It deliberately
 * escapes the source before introducing only known safe wiki markup and links.
 */
export function renderWikitext(source = '', { wikiArticleUrl = () => '' } = {}) {
  if (!source) return '';

  const internalLink = (page, label) => {
    const href = wikiArticleUrl(page.replace(/ /g, '_'));
    return href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="wikitext-link internal-link">${label}</a>`
      : label;
  };

  const externalLink = (url, label) => {
    const rawUrl = url.replace(/&amp;/g, '&');
    return `<a href="${escapeHtml(rawUrl)}" target="_blank" rel="noopener noreferrer" class="wikitext-link external-link">${label || rawUrl}</a>`;
  };

  let text = escapeHtml(source);

  // Bold / Italic (handles both escaped &#039; and raw single quotes)
  text = text
    .replace(/(?:&#039;|'){5}([\s\S]+?)(?:&#039;|'){5}/g, '<strong><em>$1</em></strong>')
    .replace(/(?:&#039;|'){3}([\s\S]+?)(?:&#039;|'){3}/g, '<strong>$1</strong>')
    .replace(/(?:&#039;|'){2}([\s\S]+?)(?:&#039;|'){2}/g, '<em>$1</em>');

  // Internal wiki links [[Page|Label]] or [[Page]]
  text = text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_match, page, label) => internalLink(page, label))
    .replace(/\[\[([^\]]+)\]\]/g, (_match, page) => internalLink(page, page));

  // External links [http(s)://url label] or [http(s)://url]
  text = text
    .replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, (_match, url, label) => externalLink(url, label))
    .replace(/\[(https?:\/\/[^\s\]]+)\]/g, (_match, url) => externalLink(url, url));

  // Process bullet lists (* item) and newlines
  const lines = text.split('\n');
  const result = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('*')) {
      if (!inList) {
        result.push('<ul class="wikitext-list">');
        inList = true;
      }
      const itemContent = trimmed.replace(/^\*+\s*/, '');
      result.push(`<li>${itemContent}</li>`);
    } else {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      if (trimmed === '') {
        result.push('<br>');
      } else {
        result.push(line);
      }
    }
  }

  if (inList) {
    result.push('</ul>');
  }

  let html = '';
  for (let i = 0; i < result.length; i++) {
    const item = result[i];
    if (item.startsWith('<ul') || item.startsWith('<li>') || item === '</ul>' || item === '<br>') {
      html += item;
    } else {
      html += item;
      const next = result[i + 1];
      if (next && !next.startsWith('<ul') && next !== '</ul>' && next !== '<br>') {
        html += '<br>';
      }
    }
  }

  return html;
}

export { escapeHtml };

