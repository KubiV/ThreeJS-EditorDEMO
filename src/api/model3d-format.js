const DEFAULT_CATEGORY_ID = 'obecne';

export const DEFAULT_MODEL_APPEARANCE = Object.freeze({
  color: '#c7dce9',
  sceneBackground: '#f7fafc',
  roughness: 0.6,
  opacity: 1,
  wireframe: false,
  clipX: 100,
  clipY: 100,
  clipZ: 100
});

const rounded = (value) => Number(Number(value).toFixed(5));

export function capitalizeTitle(value, fallback = '') {
  const title = String(value || '').trim().replace(/\s+/g, ' ').normalize('NFC');
  if (!title) return fallback;
  return `${title.charAt(0).toLocaleUpperCase('cs-CZ')}${title.slice(1)}`;
}

function colorKey(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('cs-CZ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function hslToHex(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs(segment % 2 - 1));
  const [red, green, blue] = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const match = l - chroma / 2;
  return `#${[red, green, blue].map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Stable category colour: equal names receive the same contrast-safe hue. */
export function categoryColor(value) {
  const key = colorKey(value) || DEFAULT_CATEGORY_ID;
  let hash = 2166136261;
  for (const character of key) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  // The golden-angle permutation keeps neighbouring hash values visually apart
  // (plain modulo would make e.g. two different category names almost equal).
  const hue = (((hash >>> 0) % 360) * 137.50776405003785) % 360;
  return hslToHex(hue, 58, 42);
}

export function normalizeModelAppearance(value) {
  const appearance = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const numberInRange = (candidate, minimum, maximum, fallback) => Number.isFinite(Number(candidate)) && Number(candidate) >= minimum && Number(candidate) <= maximum
    ? Number(candidate)
    : fallback;
  return {
    color: /^#[0-9a-f]{6}$/i.test(String(appearance.color || '')) ? String(appearance.color).toLowerCase() : DEFAULT_MODEL_APPEARANCE.color,
    sceneBackground: /^#[0-9a-f]{6}$/i.test(String(appearance.sceneBackground || '')) ? String(appearance.sceneBackground).toLowerCase() : DEFAULT_MODEL_APPEARANCE.sceneBackground,
    roughness: numberInRange(appearance.roughness, 0, 1, DEFAULT_MODEL_APPEARANCE.roughness),
    opacity: numberInRange(appearance.opacity, 0.1, 1, DEFAULT_MODEL_APPEARANCE.opacity),
    wireframe: typeof appearance.wireframe === 'boolean' ? appearance.wireframe : DEFAULT_MODEL_APPEARANCE.wireframe,
    clipX: numberInRange(appearance.clipX, -100, 100, DEFAULT_MODEL_APPEARANCE.clipX),
    clipY: numberInRange(appearance.clipY, -100, 100, DEFAULT_MODEL_APPEARANCE.clipY),
    clipZ: numberInRange(appearance.clipZ, -100, 100, DEFAULT_MODEL_APPEARANCE.clipZ)
  };
}

export function quoteAttribute(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

export function model3dTagFromModel(model, camera = model.camera) {
  const rawVariants = model.rawVariants || {};
  const variants = {
    original: String(rawVariants.original || model.rawFile || '').trim(),
    medium: String(rawVariants.medium || '').trim(),
    small: String(rawVariants.small || rawVariants.low || '').trim()
  };
  const metadata = {
    license: String(model.license || '').trim(),
    author: String(model.author || '').trim(),
    origin: String(model.origin || '').trim(),
    sourceUrl: String(model.sourceUrl || '').trim()
  };
  const config = {
    schemaVersion: 4,
    title: capitalizeTitle(model.title),
    description: model.description || '',
    ...(Array.isArray(model.rawFiles) && model.rawFiles.length ? { files: model.rawFiles } : {}),
    ...(variants.medium || variants.small ? { variants: Object.fromEntries(Object.entries(variants).filter(([, value]) => value)) } : {}),
    ...(model.rawThumbnail ? { thumbnail: model.rawThumbnail } : {}),
    ...(Object.values(metadata).some(Boolean) ? { metadata } : {}),
    appearance: normalizeModelAppearance(model.appearance),
    ...(Array.isArray(model.categories) && model.categories.length ? { categories: normalizeCategoryDefinitions(model.categories) } : {}),
    ...(finiteQuaternion(model.orientation?.quaternion) ? {
      orientation: { quaternion: model.orientation.quaternion.map(rounded) }
    } : {}),
    ...(camera?.position && camera?.target ? {
      camera: {
        position: camera.position.map(rounded),
        target: camera.target.map(rounded),
        ...(finiteQuaternion(camera.modelQuaternion) ? { modelQuaternion: camera.modelQuaternion.map(rounded) } : {})
      }
    } : {}),
    tags: (model.tags || []).map(({ id, title, category, position, normal, lineLength, description }) => ({
      id,
      title,
      category: category || DEFAULT_CATEGORY_ID,
      position: position.map(rounded),
      normal: normal.map(rounded),
      lineLength: rounded(lineLength),
      description
    }))
  };
  const file = model.rawFile || model.file?.split('/').pop() || 'DOPLŇTE_NÁZEV_MODELU.glb';
  return `<model3d file="${quoteAttribute(file)}">\n${JSON.stringify(config, null, 2)}\n</model3d>`;
}

export function categoryTagFromDefinitions(categories) {
  const normalized = normalizeCategoryDefinitions(categories);
  return `<model3d-categories>\n${JSON.stringify({ schemaVersion: 1, categories: normalized }, null, 2)}\n</model3d-categories>`;
}

function unescapeAttribute(value = '') {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function readAttributes(source = '') {
  const attributes = {};
  const expression = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = expression.exec(source))) {
    attributes[match[1].toLowerCase()] = unescapeAttribute(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function parseJson(source, label) {
  try {
    return JSON.parse(String(source || '').trim() || '{}');
  } catch {
    throw new Error(`${label} neobsahuje platný JSON.`);
  }
}

function finiteVector(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((number) => !Number.isFinite(Number(number)))) return fallback;
  return value.map(Number);
}

function finiteQuaternion(value) {
  return Array.isArray(value) && value.length === 4
    && value.every((number) => Number.isFinite(Number(number)))
    && value.some((number) => Number(number) !== 0);
}

function cleanAssetPath(value) {
  return String(value || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function cleanVariantMap(value, primaryFile) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const small = cleanAssetPath(input.small || input.low);
  const medium = cleanAssetPath(input.medium);
  const original = cleanAssetPath(input.original || primaryFile);
  return Object.fromEntries(Object.entries({ original, medium, small }).filter(([, file]) => file));
}

function cleanMetadata(value) {
  const metadata = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    license: String(metadata.license || '').trim().slice(0, 160),
    author: String(metadata.author || '').trim().slice(0, 160),
    origin: String(metadata.origin || '').trim().slice(0, 300),
    sourceUrl: String(metadata.sourceUrl || '').trim().slice(0, 1000)
  };
}

function cleanTag(tag, index) {
  if (!tag || typeof tag !== 'object') return null;
  return {
    id: String(tag.id || `tag-${index + 1}`).slice(0, 100),
    title: String(tag.title || 'Nový štítek').slice(0, 160),
    category: String(tag.category || DEFAULT_CATEGORY_ID).slice(0, 80),
    position: finiteVector(tag.position, [0, 0, 0]),
    normal: finiteVector(tag.normal, [0, 0, 1]),
    lineLength: Number.isFinite(Number(tag.lineLength)) ? Math.max(0.0001, Number(tag.lineLength)) : 1.5,
    description: String(tag.description || '').slice(0, 20000)
  };
}

export function parseModel3dWikitext(wikitext) {
  const match = String(wikitext || '').match(/<model3d\b([^>]*)>([\s\S]*?)<\/model3d\s*>/i);
  if (!match) throw new Error('Článek neobsahuje blok <model3d> s konfigurací modelu.');
  const attributes = readAttributes(match[1]);
  if (!attributes.file) throw new Error('Bloku <model3d> chybí atribut file se jménem 3D souboru.');
  const config = parseJson(match[2], 'Blok <model3d>');
  return {
    file: attributes.file,
    config: {
      schemaVersion: Number(config.schemaVersion) || 1,
      title: capitalizeTitle(String(config.title || '').slice(0, 120)),
      description: String(config.description || '').slice(0, 20000),
      files: Array.isArray(config.files) ? config.files.map((file) => String(file || '').trim()).filter(Boolean).slice(0, 20) : [],
      variants: cleanVariantMap(config.variants, attributes.file),
      thumbnail: cleanAssetPath(config.thumbnail),
      metadata: cleanMetadata(config.metadata),
      appearance: normalizeModelAppearance(config.appearance),
      categories: normalizeCategoryDefinitions(config.categories),
      ...(finiteQuaternion(config.orientation?.quaternion) ? {
        orientation: { quaternion: config.orientation.quaternion.map(Number) }
      } : {}),
      camera: config.camera && typeof config.camera === 'object' ? {
        position: finiteVector(config.camera.position, [10, 5, 20]),
        target: finiteVector(config.camera.target, [0, 0, 0]),
        ...(finiteQuaternion(config.camera.modelQuaternion) ? { modelQuaternion: config.camera.modelQuaternion.map(Number) } : {})
      } : undefined,
      tags: Array.isArray(config.tags) ? config.tags.map(cleanTag).filter(Boolean) : []
    },
    match: { start: match.index, end: match.index + match[0].length, source: match[0] }
  };
}

export function replaceModel3dTag(wikitext, nextTag) {
  const source = String(wikitext || '');
  const match = source.match(/<model3d\b[^>]*>[\s\S]*?<\/model3d\s*>/i);
  if (!match || match.index === undefined) return `${source.trim()}${source.trim() ? '\n\n' : ''}${nextTag}\n`;
  return `${source.slice(0, match.index)}${nextTag}${source.slice(match.index + match[0].length)}`;
}

export function normalizeCategoryId(value, fallback = 'kategorie') {
  const id = String(value || '')
    .trim()
    .toLocaleLowerCase('cs-CZ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
  return id || fallback;
}

export function normalizeCategoryDefinitions(categories = []) {
  const used = new Set();
  return (Array.isArray(categories) ? categories : []).reduce((result, category, index) => {
    if (!category || typeof category !== 'object') return result;
    const name = capitalizeTitle(String(category.name || category.title || '').trim().slice(0, 100));
    if (!name) return result;
    const base = normalizeCategoryId(category.id || name, `kategorie-${index + 1}`);
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = `${base.slice(0, 74)}-${suffix++}`;
    used.add(id);
    result.push({
      id,
      name,
      description: String(category.description || '').trim().slice(0, 1000),
      color: categoryColor(name)
    });
    return result;
  }, []);
}

export function parseCategoryWikitext(wikitext) {
  const match = String(wikitext || '').match(/<model3d-categories\b[^>]*>([\s\S]*?)<\/model3d-categories\s*>/i);
  if (!match) return { categories: [], match: undefined };
  const config = parseJson(match[1], 'Blok <model3d-categories>');
  return {
    categories: normalizeCategoryDefinitions(config.categories),
    match: { start: match.index, end: match.index + match[0].length, source: match[0] }
  };
}

export function replaceCategoryTag(wikitext, nextTag) {
  const source = String(wikitext || '');
  const match = source.match(/<model3d-categories\b[^>]*>[\s\S]*?<\/model3d-categories\s*>/i);
  if (!match || match.index === undefined) return `${source.trim()}${source.trim() ? '\n\n' : ''}${nextTag}\n`;
  return `${source.slice(0, match.index)}${nextTag}${source.slice(match.index + match[0].length)}`;
}
