import { AnatomyModule } from './anatomy/index.js';

const registry = new Map();

/**
 * Registers a new domain nomenclature/vocabulary module.
 * @param {Object} moduleDefinition
 */
export function registerModule(moduleDefinition) {
  if (!moduleDefinition || !moduleDefinition.id) {
    throw new Error('Modul musí mít definované unikátní id.');
  }
  registry.set(moduleDefinition.id, moduleDefinition);
}

/**
 * Returns all registered modules.
 */
export function getRegisteredModules() {
  return Array.from(registry.values());
}

/**
 * Retrieves a module by its ID.
 */
export function getModule(id) {
  if (!id) return null;
  return registry.get(id) || null;
}

// Register default built-in modules
registerModule(AnatomyModule);
