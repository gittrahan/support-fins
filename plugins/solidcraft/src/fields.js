// The slot forms' field names. A setting is named as the command line's flag
// (plugins/cli/cli.js flagOf), so it reads the same in SolidCraft, the CLI and the MCP
// server: sway.on -> sway, sway.gripFrom -> sway-grip-from, tineDensity -> tine-density.
// build.py writes the forms from options.json with the same names (field_of), and
// tests/fields.test.js pins all three to each other.
import { OPTIONS_SCHEMA } from '../../shared/engine/fins_entry.js';

export const fieldOf = (key) => key.replace(/\.on$/, '').replace(/\./g, '-')
  .replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const FIELD_OF_KEY = Object.fromEntries(OPTIONS_SCHEMA.options.map((o) => [o.key, fieldOf(o.key)]));

// A percent setting is typed as the site's slider shows it, 0-100; the engine takes 0-1.
export const PERCENT_KEYS = new Set(OPTIONS_SCHEMA.options.filter((o) => o.percent).map((o) => o.key));
