/**
 * 3MF import and export. The code lives in web/threemf/: write.js (the package
 * the site exports), read.js (any slicer's or CAD tool's 3MF in), slicers.js
 * (Bambu / Orca / PrusaSlicer config files, read side) and common.js (what both
 * halves share). This file keeps the one import path the site, the CLI and the
 * tests use.
 */
export { meshXML, mergeColors, SEPARATE_CENTRE, strandedFrom, writeThreeMF, writePlate3MF } from './threemf/write.js';
export { readThreeMF, readThreeMFParts } from './threemf/read.js';
export { PAINT_ATTRS, SESSION_PART, scanXML } from './threemf/common.js';
