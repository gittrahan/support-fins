// Rim walls (prop/rim.js, local issue 062): a level overhang's free outline gets a
// wall under it when the judge (prop/judge.js) says it holds more -- the edge rows
// stop short of, which curls or droops (#269's cable reel). Pieces come out one by one.
import { buildTopology, analyze, fins, block, loadModel, rotX, assert } from './_util.js';
import { RIM } from '../web/prop/rim.js';

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const topoOf = (tris) => buildTopology({ getAttribute: (k) => (k === 'position' ? { array: tris } : null) });
const build = (topo, rot, extra = {}) =>
  fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode: 'auto', bedPad: true, tines: true, coverage: 0.5, ...extra });
// post y -10..0, ledge 28 wide (x) x 14 deep (y), underside z 25: main's rows stop 4 mm short of y 14
const ledge = () => topoOf(new Float32Array([...block(0, 28, -10, 0, 0, 27), ...block(0, 28, 0, 14, 25, 27)]));
const len = (line) => line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);

Deno.test('rim: a ledge off one edge gets a wall under its free edge, in pull-out pieces', () => {
  const rims = build(ledge(), I).props.filter((q) => q.rimWall);
  assert(rims.some((q) => q.line.every((p) => p[1] > 10)), 'no rim wall along the free y edge');
  for (const q of rims) assert(len(q.line) <= RIM.pieceLen + 1, `a rim piece ${len(q.line).toFixed(1)} mm long`);
  // none along the attached edge (the post's side goes down from it)
  assert(!rims.some((q) => q.line.every((p) => p[1] < 3)), 'a rim wall along the attached edge');
});

Deno.test('rim: rimWalls:false and raster:false build no rim', () => {
  for (const o of [{ rimWalls: false }, { raster: false }]) {
    assert(!build(ledge(), I, o).props.some((q) => q.rimWall), `${JSON.stringify(o)} built a rim`);
  }
});

Deno.test('rim: a tilted face gets no rim (tube X25 keeps its 4 walls)', () => {
  const b = build(loadModel('tube'), rotX(25));
  assert(!b.props.some((q) => q.rimWall) && b.props.length === 4, `${b.props.length} walls`);
});

Deno.test('rim: a deck laid on two unwelded posts is attached there -- no rim, no swap', () => {
  const topo = topoOf(new Float32Array([...block(-20, 20, 40, 44, 0, 17), ...block(-20, 20, -44, -40, 0, 17),
                                         ...block(-20, 20, -40, 40, 15, 17)]));
  assert(!build(topo, I).props.some((q) => q.rimWall), 'the deck took a rim: the posts read as free edges');
});
