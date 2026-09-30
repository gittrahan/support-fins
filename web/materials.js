// Material profiles: the clearances each filament needs, one table for the website
// (ui/settings.js) and the plugins' engine entry (plugins/shared/engine/fins_entry.js),
// so a plugin's PETG prints the site's PETG numbers.
//
// PETG welds to a support far harder than the PLA every bite
// number here was tuned on, so PETG needs more clearance in all three places at
// once: how far each tine sinks into the part (FIN.tineBite), the plain breakaway
// prop's clearance (PROP.gap), and the bed pad -- thinner (FIN.padH) with a gap
// instead of a tack (PAD.grab < 0). PLA is exactly today's numbers, so switching
// to PLA (or never touching this) leaves existing prints unchanged. density is g/cm^3
// for the grams receipt.
export const MATERIAL = Object.freeze({
  pla:  Object.freeze({ tineBite: 0.30, padH: 0.5, padGrab:  0.05, propGap: 0.2,  density: 1.24 }),
  petg: Object.freeze({ tineBite: 0.15, padH: 0.3, padGrab: -0.10, propGap: 0.3,  density: 1.27 }),
});
