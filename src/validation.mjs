export class BoardError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function requireValue(condition, code, message) {
  if (!condition) throw new BoardError(code, message);
}
export function text(value, field, max = 200, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max,
    'INVALID_ARGUMENT', `${field} must be nonblank text, at most ${max} characters`);
  return value.trim();
}
// Implements only the JSON Schema subset used by this server's own tool schemas.
export function validate(schema, value, path = 'arguments') {
  if (schema.type === 'object') {
    requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_ARGUMENT', `${path} must be an object`);
    for (const key of schema.required ?? []) requireValue(Object.hasOwn(value, key), 'INVALID_ARGUMENT', `${path}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      requireValue(Object.hasOwn(schema.properties, key), 'INVALID_ARGUMENT', `Unknown field ${path}.${key}`);
      validate(schema.properties[key], item, `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    requireValue(Array.isArray(value) && value.length <= (schema.maxItems ?? 100), 'INVALID_ARGUMENT', `${path} must be an array of at most ${schema.maxItems ?? 100} items`);
    for (const item of value) validate(schema.items, item, path);
  } else if (schema.type === 'boolean') {
    requireValue(typeof value === 'boolean', 'INVALID_ARGUMENT', `${path} must be a boolean`);
  } else if (schema.type === 'integer') {
    requireValue(Number.isSafeInteger(value) && value >= (schema.minimum ?? 0), 'INVALID_ARGUMENT', `${path} must be a positive integer`);
  } else if (schema.type === 'string') {
    requireValue(typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? 16384), 'INVALID_ARGUMENT', `${path} must be text within its length limit`);
  }
  if (schema.enum) requireValue(schema.enum.includes(value), 'INVALID_ARGUMENT', `${path} must be one of ${schema.enum.join(', ')}`);
}
