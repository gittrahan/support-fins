// The command line's and the MCP server's version (plugins/shared/version.py): the
// build compiles the real number in as SUPPORT_FINS_VERSION; run from a checkout it
// is the unstamped base.
/* global SUPPORT_FINS_VERSION */
export const VERSION = typeof SUPPORT_FINS_VERSION === 'string' ? SUPPORT_FINS_VERSION : '0.7.0';
