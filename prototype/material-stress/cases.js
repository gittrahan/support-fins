/** Explicit material-part stress matrix. Importing this file runs nothing. */
export const POSES = { flat: [0,0], x30: [30,0], x60y30: [60,30] };
export const VARIANTS = {
  'tines-only': { iface:'tines', separateTines:false },
  'flat-separate': { iface:'flat', separateTines:true },
  'all-separate': { iface:'all', separateTines:true },
};
export function materialCases(models) {
  return models.flatMap(model => Object.keys(POSES).flatMap(pose => ['auto','full'].flatMap(mode =>
    Object.keys(VARIANTS).map(variant => ({ model, pose, mode, variant,
      cutout: model === 'tshape' ? 'diamond' : 'none' })))));
}
export function rotation(pose) {
  const [x,y]=POSES[pose].map(d=>d*Math.PI/180), cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y);
  return [cy,0,-sy, sy*sx,cx,cy*sx, sy*cx,-sx,cy*cx];
}
