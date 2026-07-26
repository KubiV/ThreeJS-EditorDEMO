import { escapeHtml } from '../annotations/wikitext.js';
import { DEFAULT_CATEGORIES } from './sidebar.js';
import { formatLineLength, lineLengthControlMarkup, lineLengthControlValues } from './line-length-control.js';

/**
 * Persistent panel used while creating a label. Parameters are selected before
 * anchoring, so the line preview can be evaluated directly in the 3D scene.
 */
export function renderTagDraftPanel(host, draft, { categories = DEFAULT_CATEGORIES, onChange, onSave, onCancel, onResetAnchor, onAddCategory }) {
  const isAnchored = Array.isArray(draft.position);
  const lineLengthControl = lineLengthControlValues(draft);
  host.innerHTML = `
    <aside class="tag-draft-panel" aria-label="Nový štítek modelu">
      <div class="tag-draft-heading"><div><p class="eyebrow">EDITOR POPISKU</p><h2>Nový štítek</h2></div><button type="button" class="icon-button" data-cancel aria-label="Zavřít přidávání štítku">×</button></div>
      <ol class="draft-steps"><li class="is-done">Nastavte údaje</li><li class="${isAnchored ? 'is-done' : 'is-current'}">Klikněte na povrch modelu</li><li class="${isAnchored ? 'is-current' : ''}">Uložte štítek</li></ol>
      <p class="draft-autosave">Rozpracovaný štítek se průběžně ukládá v tomto prohlížeči.</p>
      <label>Název štítku<input name="title" value="${escapeHtml(draft.title)}" placeholder="Např. Hlavní vstup" autocomplete="off" /></label>
      <div class="draft-category-row"><label>Kategorie<select name="category">${categories.map((category) => `<option value="${escapeHtml(category.id)}" ${draft.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></label><button type="button" class="small-button" data-add-category>＋ Nová kategorie</button></div>
      ${lineLengthControlMarkup(draft)}
      <p class="draft-help">Táhněte posuvník a sledujte přerušovanou čáru v modelu. Po kliknutí na povrch se ukotvení zamkne.</p>
      <label>Detailní popisek <span class="field-note">podporuje [[Wiki odkazy]]</span><textarea name="description" rows="5" placeholder="Např. odkaz na související část…">${escapeHtml(draft.description)}</textarea></label>
      <div class="draft-anchor-state ${isAnchored ? 'is-anchored' : ''}" role="status">${isAnchored ? 'Bod na modelu je vybraný. Můžete jej vybrat znovu.' : 'Bod zatím není vybraný — najeďte na model a klikněte.'}</div>
      <div class="draft-actions"><button type="button" class="button button-secondary" data-reset ${isAnchored ? '' : 'disabled'}>Vybrat jiný bod</button><button type="button" class="button button-primary" data-save ${isAnchored && draft.title.trim() ? '' : 'disabled'}>Přidat štítek</button></div>
    </aside>`;

  const emit = () => {
    const title = host.querySelector('[name="title"]').value;
    const category = host.querySelector('[name="category"]').value;
    const lineLength = Number(host.querySelector('[name="lineLength"]').value);
    const description = host.querySelector('[name="description"]').value;
    host.querySelector('[data-line-length]').textContent = formatLineLength(lineLength, lineLengthControl.step);
    host.querySelector('[data-save]').disabled = !isAnchored || !title.trim();
    onChange({ title, category, lineLength, description });
  };
  host.querySelectorAll('input, select, textarea').forEach((input) => input.addEventListener('input', emit));
  host.querySelector('[data-cancel]').addEventListener('click', onCancel);
  host.querySelector('[data-add-category]').addEventListener('click', onAddCategory);
  host.querySelector('[data-reset]').addEventListener('click', onResetAnchor);
  host.querySelector('[data-save]').addEventListener('click', onSave);
}
