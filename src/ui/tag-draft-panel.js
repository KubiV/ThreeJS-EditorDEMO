import { escapeHtml } from '../annotations/wikitext.js';
import { DEFAULT_CATEGORIES } from './sidebar.js';
import { formatLineLength, lineLengthControlMarkup, lineLengthControlValues } from './line-length-control.js';
import { actionIconMarkup } from './brand.js';

/**
 * Persistent panel used while creating a label. Parameters are selected before
 * anchoring, so the line preview can be evaluated directly in the 3D scene.
 */
export function renderTagDraftPanel(host, draft, { categories = DEFAULT_CATEGORIES, onChange, onSave, onCancel, onResetAnchor, onAddCategory }) {
  const isAnchored = Array.isArray(draft.position);
  const lineLengthControl = lineLengthControlValues(draft);
  const brushMode = Boolean(draft.brushMode);
  const brushRadius = Number(draft.brushRadius) || 1;
  const brushMinimum = Number(draft.brushMinRadius) || 0.01;
  const brushMaximum = Number(draft.brushMaxRadius) || Math.max(brushRadius, 1);
  const brushStep = Number(draft.brushStep) || 0.01;
  const categoryColor = categories.find((category) => category.id === draft.category)?.color || '#d64b3b';
  const brushColorMode = draft.brushColorMode === 'custom' ? 'custom' : 'category';
  const brushColor = brushColorMode === 'custom' && /^#[0-9a-f]{6}$/i.test(String(draft.brushColor || '')) ? draft.brushColor : categoryColor;
  host.innerHTML = `
    <aside class="tag-draft-panel" aria-label="Nový štítek modelu">
      <div class="tag-draft-heading"><div><p class="eyebrow">EDITOR POPISKU</p><h2>Nový štítek</h2></div><button type="button" class="icon-button" data-cancel aria-label="Zavřít přidávání štítku">×</button></div>
      <ol class="draft-steps"><li class="is-done">Nastavte údaje</li><li class="${isAnchored ? 'is-done' : 'is-current'}">${brushMode ? 'Malujte po povrchu' : 'Klikněte na povrch modelu'}</li><li class="${isAnchored ? 'is-current' : ''}">Uložte štítek</li></ol>
      <p class="draft-autosave">Rozpracovaný štítek se průběžně ukládá v tomto prohlížeči.</p>
      <label>Název štítku<input name="title" value="${escapeHtml(draft.title)}" placeholder="Např. Hlavní vstup" autocomplete="off" /></label>
      <div class="draft-category-row"><label>Kategorie<select name="category">${categories.map((category) => `<option value="${escapeHtml(category.id)}" ${draft.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></label><button type="button" class="small-button" data-add-category>${actionIconMarkup('add')}Nová kategorie</button></div>
      <fieldset class="brush-mode-card ${brushMode ? 'is-active' : ''}"><legend>Štětec plochy</legend><label class="brush-toggle"><input type="checkbox" name="brushMode" ${brushMode ? 'checked' : ''}><span><b>Plošné zvýraznění</b><small>Namaluje část modelu místo jediného bodu.</small></span></label><div class="brush-settings ${brushMode ? '' : 'is-disabled'}"><label class="brush-category-colour"><span>Barva z kategorie</span><i style="--brush-category-color:${escapeHtml(categoryColor)}"></i><input type="checkbox" name="brushColorOverride" ${brushColorMode === 'custom' ? 'checked' : ''} ${brushMode ? '' : 'disabled'}> Ručně přepsat</label><label>Barva štítku a plochy<input type="color" name="brushColor" value="${escapeHtml(brushColor)}" ${brushMode && brushColorMode === 'custom' ? '' : 'disabled'}></label><label>Velikost štětce <output data-brush-radius>${formatLineLength(brushRadius, brushStep)}</output><input type="range" name="brushRadius" min="${brushMinimum}" max="${brushMaximum}" step="${brushStep}" value="${brushRadius}" ${brushMode ? '' : 'disabled'}></label></div><p class="draft-help brush-help">${brushMode ? 'Štětec je aktivní — táhněte po povrchu modelu. Pohled se během malování nezmění.' : 'Zapnutím štětce můžete místo bodu zvýraznit celou plochu modelu.'}</p></fieldset>
      ${lineLengthControlMarkup(draft)}
      <p class="draft-help">Táhněte posuvník a sledujte přerušovanou čáru v modelu. ${brushMode ? 'První tah štětce nastaví ukotvení vodicí čáry.' : 'Po kliknutí na povrch se ukotvení zamkne.'}</p>
      <label>Detailní popisek <span class="field-note">podporuje [[Wiki odkazy]]</span><textarea name="description" rows="5" placeholder="Např. odkaz na související část…">${escapeHtml(draft.description)}</textarea></label>
      <div class="draft-anchor-state ${isAnchored ? 'is-anchored' : ''}" role="status">${isAnchored ? (brushMode ? 'Plocha na modelu je vybraná. Můžete ji namalovat znovu.' : 'Bod na modelu je vybraný. Můžete jej vybrat znovu.') : (brushMode ? 'Plocha zatím není vybraná — táhněte štětcem po modelu.' : 'Bod zatím není vybraný — najeďte na model a klikněte.')}</div>
      <div class="draft-actions"><button type="button" class="button button-secondary" data-reset ${isAnchored ? '' : 'disabled'}>${actionIconMarkup('refresh')}Vybrat jiný bod</button><button type="button" class="button button-primary" data-save ${isAnchored && draft.title.trim() ? '' : 'disabled'}>${actionIconMarkup('add')}Přidat štítek</button></div>
    </aside>`;

  const emit = () => {
    const title = host.querySelector('[name="title"]').value;
    const category = host.querySelector('[name="category"]').value;
    const lineLength = Number(host.querySelector('[name="lineLength"]').value);
    const description = host.querySelector('[name="description"]').value;
    const brushMode = host.querySelector('[name="brushMode"]').checked;
    const brushColorMode = host.querySelector('[name="brushColorOverride"]').checked ? 'custom' : 'category';
    const brushColor = host.querySelector('[name="brushColor"]').value;
    const brushRadius = Number(host.querySelector('[name="brushRadius"]').value);
    const brushCategoryColor = categories.find((item) => item.id === category)?.color || '#d64b3b';
    host.querySelector('[data-line-length]').textContent = formatLineLength(lineLength, lineLengthControl.step);
    host.querySelector('[data-brush-radius]').textContent = formatLineLength(brushRadius, brushStep);
    host.querySelector('[data-save]').disabled = !isAnchored || !title.trim();
    onChange({ title, category, lineLength, description, brushMode, brushColorMode, brushColor, brushCategoryColor, brushRadius });
  };
  host.querySelectorAll('input, select, textarea').forEach((input) => input.addEventListener('input', emit));
  ['brushMode', 'brushColorOverride', 'category'].forEach((name) => host.querySelector(`[name="${name}"]`).addEventListener('change', () => {
    emit();
    renderTagDraftPanel(host, draft, { categories, onChange, onSave, onCancel, onResetAnchor, onAddCategory });
  }));
  host.querySelector('[data-cancel]').addEventListener('click', onCancel);
  host.querySelector('[data-add-category]').addEventListener('click', onAddCategory);
  host.querySelector('[data-reset]').addEventListener('click', onResetAnchor);
  host.querySelector('[data-save]').addEventListener('click', onSave);
}

/**
 * The editor for an existing label deliberately uses the same persistent
 * viewport panel as label creation. Keeping the scene uncovered matters here:
 * the user can grab the leader-line endpoint while the form stays visible.
 */
export function renderTagEditorPanel(host, draft, { categories = DEFAULT_CATEGORIES, onChange, onSave, onCancel, onEditLeaderLine, onEditAnchor, anchorSelectionActive = false, hasEditedAnchor = false }) {
  const lineLengthControl = lineLengthControlValues(draft);
  const categoryColor = categories.find((category) => category.id === draft.category)?.color || '#d64b3b';
  const colorMode = draft.style?.colorMode === 'custom' ? 'custom' : 'category';
  const color = colorMode === 'custom' && /^#[0-9a-f]{6}$/i.test(String(draft.style?.color || ''))
    ? draft.style.color
    : categoryColor;
  const surfaceTitle = draft.highlight ? 'Plocha a vodicí čára' : 'Barva a vodicí čára';

  host.innerHTML = `
    <aside class="tag-draft-panel" aria-label="Úprava štítku modelu">
      <div class="tag-draft-heading"><div><p class="eyebrow">EDITOR POPISKU</p><h2>Upravit štítek</h2></div><button type="button" class="icon-button" data-cancel aria-label="Zavřít úpravu štítku">×</button></div>
      <p class="draft-autosave">Souřadnice jsou ukotveny na povrchu modelu. Koncový bod vodicí čáry upravíte přímo ve 3D pohledu.</p>
      <label>Název štítku<input name="title" value="${escapeHtml(draft.title)}" autocomplete="off" /></label>
      <label>Kategorie<select name="category">${categories.map((category) => `<option value="${escapeHtml(category.id)}" ${draft.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></label>
      <fieldset class="tag-editor-style"><legend>${surfaceTitle}</legend><label>Barva<select name="colorMode"><option value="category" ${colorMode === 'category' ? 'selected' : ''}>Podle kategorie</option><option value="custom" ${colorMode === 'custom' ? 'selected' : ''}>Vlastní barva</option></select></label><label>${draft.highlight ? 'Barva štítku a plochy' : 'Barva štítku a čáry'}<input type="color" name="color" value="${escapeHtml(color)}" ${colorMode === 'custom' ? '' : 'disabled'}></label><button type="button" class="small-button" data-edit-line>${actionIconMarkup('edit')}Upravit polohu čáry</button><button type="button" class="small-button ${anchorSelectionActive ? 'is-active' : ''}" data-edit-anchor>${actionIconMarkup('view')}${anchorSelectionActive ? 'Klikněte na nový bod' : 'Upravit bod na modelu'}</button><p>${anchorSelectionActive ? 'Režim výběru je aktivní — klikněte na nové místo na povrchu modelu.' : hasEditedAnchor ? 'Nový bod je vybraný. Uložte změny pro jeho potvrzení.' : 'Čára končí barevným kruhem u plovoucího štítku. Přetažením kruhu ji přesunete.'}</p></fieldset>
      ${lineLengthControlMarkup(draft)}
      <label>Detailní popisek <span class="field-note">podporuje [[Wiki odkazy]]</span><textarea name="description" rows="5">${escapeHtml(draft.description)}</textarea></label>
      <div class="draft-actions"><button type="button" class="button button-secondary" data-cancel>Zrušit</button><button type="button" class="button button-primary" data-save ${draft.title.trim() ? '' : 'disabled'}>${actionIconMarkup('save')}Uložit změny</button></div>
    </aside>`;

  const emit = () => {
    const title = host.querySelector('[name="title"]').value;
    const category = host.querySelector('[name="category"]').value;
    const lineLength = Number(host.querySelector('[name="lineLength"]').value);
    const description = host.querySelector('[name="description"]').value;
    const colorMode = host.querySelector('[name="colorMode"]').value === 'custom' ? 'custom' : 'category';
    const color = host.querySelector('[name="color"]').value;
    host.querySelector('[data-line-length]').textContent = formatLineLength(lineLength, lineLengthControl.step);
    host.querySelector('[data-save]').disabled = !title.trim();
    onChange({ title, category, lineLength, description, style: { colorMode, color } });
  };
  host.querySelectorAll('input, select, textarea').forEach((input) => input.addEventListener('input', emit));
  ['category', 'colorMode'].forEach((name) => host.querySelector(`[name="${name}"]`).addEventListener('change', () => {
    emit();
    renderTagEditorPanel(host, draft, { categories, onChange, onSave, onCancel, onEditLeaderLine, onEditAnchor, anchorSelectionActive, hasEditedAnchor });
  }));
  host.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', onCancel));
  host.querySelector('[data-edit-line]').addEventListener('click', onEditLeaderLine);
  host.querySelector('[data-edit-anchor]').addEventListener('click', onEditAnchor);
  host.querySelector('[data-save]').addEventListener('click', onSave);
}
