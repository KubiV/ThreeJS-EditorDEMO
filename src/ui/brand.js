import wiki3dLogo from '../assets/wiki3d-logo.svg';

let headerText = '3D prohlížeč';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

export function setBranding({ headerText: configuredHeaderText } = {}) {
  headerText = typeof configuredHeaderText === 'string' ? configuredHeaderText.trim() : '3D prohlížeč';
}

export function brandMarkup({ interactive = false } = {}) {
  const name = headerText ? `<span class="brand-name">${escapeHtml(headerText)}</span>` : '';
  const contents = `<img class="brand-logo" src="${wiki3dLogo}" alt="" />${name}`;

  if (!interactive) return `<div class="brand">${contents}</div>`;

  return `<button type="button" class="brand brand-button" data-action="home" title="Zpět na 3D rozcestník">${contents}</button>`;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

export function wikiSessionIndicatorMarkup(user, { userPageUrl = '', loginUrl = '' } = {}) {
  const signedIn = Boolean(user?.name);
  const title = signedIn
    ? `Přihlášen do MediaWiki jako ${user.name}`
    : 'Uživatel není přihlášen do MediaWiki';
  const loginTarget = safeHttpUrl(loginUrl);
  const attributes = `class="wiki-session-indicator${signedIn ? ' is-signed-in' : loginTarget ? ' is-login' : ''}" data-wiki-session-indicator title="${escapeHtml(title)}"`;
  const name = signedIn ? escapeHtml(user.name) : '';

  if (signedIn && userPageUrl) {
    return `<a ${attributes} href="${escapeHtml(userPageUrl)}" target="_blank" rel="noopener noreferrer">${name}</a>`;
  }
  if (loginTarget) {
    return `<a ${attributes} href="${escapeHtml(loginTarget)}" target="_blank" rel="noopener noreferrer">Přihlásit se</a>`;
  }
  return `<span ${attributes}>${name}</span>`;
}
