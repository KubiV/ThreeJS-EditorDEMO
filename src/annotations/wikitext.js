const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
}[character]));

/**
 * Small safe subset of Wikitext used in annotation descriptions.  It deliberately
 * escapes the source before introducing only known internal wiki links.
 */
export function renderWikitext(source = '', { wikiArticleUrl = () => '' } = {}) {
  const internalLink = (page, label) => {
    const href = wikiArticleUrl(page.replace(/ /g, '_'));
    return href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : label;
  };

  return escapeHtml(source)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_match, page, label) => {
      return internalLink(page, label);
    })
    .replace(/\[\[([^\]]+)\]\]/g, (_match, page) => {
      return internalLink(page, page);
    })
    .replace(/'''([^']+)'''/g, '<strong>$1</strong>')
    .replace(/''([^']+)''/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

export { escapeHtml };
