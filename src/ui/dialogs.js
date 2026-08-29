import { escapeHtml } from '../annotations/wikitext.js';
import { DEFAULT_CATEGORIES } from './sidebar.js';
import { categoryColor, normalizeCategoryDefinitions, normalizeCategoryId } from '../api/model3d-format.js';
import { formatLineLength, lineLengthControlMarkup, lineLengthControlValues } from './line-length-control.js';
import { actionIconMarkup } from './brand.js';

/** Opens the shared metadata editor used from both the hub and the viewer. */
export function showModelInfoDialog(model, { onSave } = {}) {
  const draft = {
    title: '', description: '', license: '', author: '', origin: '', sourceUrl: '',
    ...model
  };
  const licenseOptions = [
    '', 'CC BY 4.0', 'CC BY-SA 4.0', 'CC0 1.0', 'Public domain',
    'Vlastní licence / práva vyhrazena', 'Jiná (uveďte v původu)'
  ];
  if (draft.license && !licenseOptions.includes(draft.license)) licenseOptions.push(draft.license);
  const dialog = document.createElement('dialog');
  dialog.className = 'modal model-info-modal';
  dialog.innerHTML = `
    <form method="dialog">
      <button class="modal-close" type="button" data-close aria-label="Zavřít">${actionIconMarkup('cancel')}</button>
      <h2>Upravit informace o modelu</h2>
      <p>Tyto údaje se uloží do definujícího článku 3D modelu.</p>
      <label>Název modelu<input name="title" required maxlength="120" value="${escapeHtml(draft.title)}"></label>
      <label>Popis<textarea name="description" rows="4" maxlength="20000">${escapeHtml(draft.description)}</textarea></label>
      <label>Licence<select name="license">${licenseOptions.map((license) => `<option value="${escapeHtml(license)}" ${draft.license === license ? 'selected' : ''}>${escapeHtml(license || 'Vyberte licenci…')}</option>`).join('')}</select></label>
      <label>Autor / držitel práv<input name="author" maxlength="160" value="${escapeHtml(draft.author)}"></label>
      <label>Původ modelu<input name="origin" maxlength="300" value="${escapeHtml(draft.origin)}"></label>
      <label>Zdrojový odkaz<input name="sourceUrl" type="url" maxlength="1000" value="${escapeHtml(draft.sourceUrl)}"></label>
      <div class="form-actions"><button type="button" data-close class="button button-secondary">${actionIconMarkup('cancel')}Zrušit</button><button class="button button-primary" type="submit">${actionIconMarkup('save')}Uložit informace</button></div>
      <p class="form-message" role="status"></p>
    </form>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = dialog.querySelector('.form-message');
    const submit = form.querySelector('[type="submit"]');
    const values = Object.fromEntries(new FormData(form));
    try {
      submit.disabled = true;
      message.textContent = 'Ukládám informace o modelu…';
      await onSave?.(values);
      dialog.close();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
}

export function showTagDialog(tag, { onSave, onEditLeaderLine, categories = DEFAULT_CATEGORIES, lineLengthOptions = {} }) {
  const draft = { title: '', category: 'kosti', description: '', lineLength: 1.5, ...tag };
  const lineLength = lineLengthControlValues({ ...lineLengthOptions, lineLength: draft.lineLength });
  const categoryColour = (categoryId) => categories.find((category) => category.id === categoryId)?.color || categoryColor(categoryId);
  const hasSurface = Boolean(draft.highlight);
  const tagStyle = draft.style || draft.highlight;
  const surfaceColorMode = tagStyle?.colorMode === 'custom' ? 'custom' : 'category';
  const surfaceColor = surfaceColorMode === 'custom' ? tagStyle.color : categoryColour(draft.category);
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `
    <form method="dialog">
      <button class="modal-close" type="button" data-close aria-label="Zavřít">${actionIconMarkup('cancel')}</button>
      <h2>${tag.id ? 'Upravit štítek' : 'Nový štítek'}</h2>
      <p>Souřadnice jsou ukotveny na povrchu modelu. Táhněte koncovým bodem vodicí čáry přímo ve 3D pohledu.</p>
      <label>Název štítku<input name="title" required value="${escapeHtml(draft.title)}" placeholder="Např. Hlavní vstup" /></label>
      <label>Kategorie<select name="category">${categories.map((category) => `<option value="${escapeHtml(category.id)}" ${draft.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></label>
      ${lineLengthControlMarkup({ ...lineLengthOptions, lineLength: draft.lineLength })}
      <fieldset class="modal-surface-tools"><legend>${hasSurface ? 'Plocha a vodicí čára' : 'Barva a vodicí čára'}</legend><label>${hasSurface ? 'Barva štítku a plochy' : 'Barva štítku a čáry'}<input type="color" name="surfaceColor" value="${escapeHtml(surfaceColor)}" ${surfaceColorMode === 'custom' ? '' : 'disabled'}></label><label class="modal-surface-override"><input type="checkbox" name="surfaceColorOverride" ${surfaceColorMode === 'custom' ? 'checked' : ''}> Ručně přepsat barvu kategorie</label><button type="button" class="small-button" data-edit-line>${actionIconMarkup('edit')}Upravit polohu čáry</button><p>Dialog se zavře a pak přetáhněte barevný kruh u plovoucího štítku.</p></fieldset>
      <label>Detailní popisek (podporuje [[Wiki odkazy]])<textarea name="description" rows="6" placeholder="Např. odkaz na související část…">${escapeHtml(draft.description)}</textarea></label>
      <div class="form-actions"><button type="button" data-close class="button button-secondary">${actionIconMarkup('cancel')}Zrušit</button><button class="button button-primary" type="submit">${actionIconMarkup('save')}Uložit štítek</button></div>
    </form>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.querySelector('[name="lineLength"]').addEventListener('input', (event) => {
    dialog.querySelector('[data-line-length]').textContent = formatLineLength(event.currentTarget.value, lineLength.step);
  });
  const colorInput = dialog.querySelector('[name="surfaceColor"]');
  const override = dialog.querySelector('[name="surfaceColorOverride"]');
  const syncSurfaceColour = () => {
    const automatic = categoryColour(dialog.querySelector('[name="category"]').value);
    colorInput.disabled = !override.checked;
    if (!override.checked) colorInput.value = automatic;
  };
  override.addEventListener('change', syncSurfaceColour);
  dialog.querySelector('[name="category"]').addEventListener('change', syncSurfaceColour);
  dialog.querySelector('[data-edit-line]').addEventListener('click', () => {
    dialog.close();
    onEditLeaderLine?.();
  });
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const style = {
      colorMode: dialog.querySelector('[name="surfaceColorOverride"]').checked ? 'custom' : 'category',
      color: dialog.querySelector('[name="surfaceColor"]').value
    };
    const highlight = hasSurface ? {
      ...draft.highlight,
      colorMode: style.colorMode,
      color: style.color
    } : undefined;
    onSave({
      ...draft,
      title: data.title,
      category: data.category,
      description: data.description,
      style,
      ...(highlight ? { highlight } : {}),
      lineLength: Number(data.lineLength)
    });
    dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());
}

/** Edits the shared category catalogue used by every 3D model. */
export function showCategoryDialog(categories, { onSave, usedCategoryIds = [], startAdding = false } = {}) {
  let draft = normalizeCategoryDefinitions(categories);
  if (startAdding) {
    draft.push({ id: '', name: '', description: '', isNew: true });
  }
  const used = new Set(usedCategoryIds);
  const dialog = document.createElement('dialog');
  dialog.className = 'modal category-modal';

  const render = () => {
    dialog.innerHTML = `
      <form method="dialog">
        <button class="modal-close" type="button" data-close aria-label="Zavřít">${actionIconMarkup('cancel')}</button>
        <h2>Společné kategorie</h2>
        <p>Kategorie jsou sdílené mezi všemi 3D modely a ukládají se do článku 3D:Kategorie. Jejich barva se vypočítá z názvu a zůstává stejná ve vieweru i ve vloženém prohlížeči.</p>
        <div class="category-editor-list">${draft.map((category, index) => `
          <fieldset data-category-index="${index}"><legend><i class="category-swatch" style="--category-color:${escapeHtml(category.color || categoryColor(category.name))}"></i>${escapeHtml(category.name || 'Nová kategorie')}</legend>
            <label>Název<input name="name" value="${escapeHtml(category.name)}" placeholder="Např. Důležité body" required maxlength="100" /></label>
            <label>Vysvětlení<input name="description" value="${escapeHtml(category.description)}" maxlength="1000" /></label>
            <button type="button" class="small-button category-remove" data-remove="${index}" ${used.has(category.id) ? 'disabled title="Kategorie se právě používá u štítku"' : ''}>${actionIconMarkup('delete')}Odstranit</button>
          </fieldset>`).join('') || '<p class="empty-note">Zatím nemáte žádné vlastní kategorie.</p>'}</div>
        <div class="form-actions category-editor-actions"><button type="button" class="button button-secondary" data-add>${actionIconMarkup('add')}Přidat novou kategorii</button><button class="button button-primary" type="submit">${actionIconMarkup('save')}Uložit kategorie</button></div>
        <p class="form-message" role="status"></p>
      </form>`;
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-add]').addEventListener('click', () => {
      draft.push({ id: '', name: '', description: '', isNew: true });
      render();
    });
    dialog.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => {
      draft.splice(Number(button.dataset.remove), 1);
      render();
    }));
    dialog.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const fields = [...dialog.querySelectorAll('[data-category-index]')];
      const next = fields.map((field, index) => {
        const name = field.querySelector('[name="name"]').value;
        return {
          id: draft[index].isNew ? normalizeCategoryId(name) : (draft[index].id || normalizeCategoryId(name)),
          name,
          description: field.querySelector('[name="description"]').value
        };
      });
      const normalized = normalizeCategoryDefinitions(next);
      const message = dialog.querySelector('.form-message');
      const submit = dialog.querySelector('[type="submit"]');
      if (normalized.length !== next.length) {
        message.textContent = 'Každá kategorie musí mít vyplněný název.';
        return;
      }
      try {
        submit.disabled = true;
        message.textContent = 'Ukládám společné kategorie…';
        await onSave?.(normalized);
        dialog.close();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    });
  };
  document.body.append(dialog);
  render();
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove());
}

export function showExportDialog(parserTag, { onPublish, onCopied, onPublished, title = '', wikiConfig = {} }) {
  const pagePrefix = String(wikiConfig.pagePrefix || '').replace(/:+$/, '');
  const qualifiedExample = pagePrefix ? `${pagePrefix}:Název článku` : 'Název článku';
  const configurationNote = wikiConfig.endpoint
    ? `Článek v prostoru <code>${escapeHtml(qualifiedExample)}</code> bude vytvořen nebo aktualizován vaším přihlášeným účtem MediaWiki.`
    : 'Pro aktualizaci je třeba nastavit připojení k MediaWiki na serveru vieweru.';
  const dialog = document.createElement('dialog');
  dialog.className = 'modal export-modal';
  dialog.innerHTML = `
    <form method="dialog">
      <button class="modal-close" type="button" data-close aria-label="Zavřít">${actionIconMarkup('cancel')}</button>
      <h2>Aktualizovat 3D model</h2>
      <p>Do definujícího článku se zapíše úplná konfigurace modelu: soubory, varianty, vzhled, kamera, kategorie i štítky. ${configurationNote}</p>
      <textarea readonly rows="11" data-parser-tag>${escapeHtml(parserTag)}</textarea>
      <label>Článek s definicí modelu${pagePrefix ? ` <span class="namespace-prefix">${escapeHtml(pagePrefix)}:</span>` : ''}<input name="title" value="${escapeHtml(title)}" placeholder="Např. Srdce" /></label>
      <label>URL MediaWiki API<input name="endpoint" type="url" value="${escapeHtml(wikiConfig.endpoint || 'http://localhost:8000/api.php')}" /></label>
      <div class="form-actions"><button type="button" data-copy class="button button-secondary">${actionIconMarkup('copy')}Kopírovat kód</button><button class="button button-primary" type="submit">${actionIconMarkup('save')}Aktualizovat článek</button></div>
      <p class="form-message" role="status"></p>
    </form>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.querySelector('[data-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(parserTag);
      onCopied?.();
    } catch {
      dialog.querySelector('.form-message').textContent = 'Schránka není v tomto prohlížeči dostupná. Kód označte a zkopírujte ručně.';
    }
  });
  dialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const message = dialog.querySelector('.form-message');
    const submit = event.currentTarget.querySelector('[type="submit"]');
    if (!data.title) {
      message.textContent = 'Doplňte název definujícího článku 3D.';
      return;
    }
    try {
      submit.disabled = true;
      message.textContent = 'Aktualizuji článek 3D modelu…';
      const result = await onPublish({ ...data, text: parserTag });
      message.textContent = `Článek ${result.publishedTitle || data.title} byl aktualizován.`;
      await onPublished?.(result, data);
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
}
