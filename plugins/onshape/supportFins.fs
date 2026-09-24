FeatureScript 2931;
import(path : "onshape/std/common.fs", version : "2931.0");
icon::import(path : "abefb5afa905b59c44256585", version : "f6c32f7274276435879a139a");


/**
 * Support-Fins FS
 *
 * Adds designed-in breakaway supports to a part, so it prints support-free in
 * any slicer. A FeatureScript port of printfins.com
 * (github.com/gittrahan/support-fins, MIT), which automates Slant3D's combined
 * support fin (youtube.com/watch?v=vnn4XeKQobs).
 *
 * Three kinds of support are generated as separate parts that overlap the
 * original; export the part and its supports together as ONE STL and the slicer
 * unions them:
 *
 *   Overhang props   An upside-down-T rib under each overhang. The top follows
 *                    the underside a breakaway gap below it, necks to a thin
 *                    contact tip, and carries a comb of one-layer horizontal
 *                    tines that fuse into the part so it cannot peel or twist
 *                    off. Bend the rib and the tines snap clean.
 *   Stabilize fins   A round-topped wall standing a gap off a near-upright
 *                    face, on an elliptical base, gripping the face with rows
 *                    of tines -- for a part tipped onto an edge.
 *   Bed pad          A thin oval under a small bed contact, conforming to the
 *                    part and tacked to it, so a tilted part does not peel.
 *
 * Differences from the browser engine, all because Onshape has a real kernel:
 *   - The part is not reoriented. Pick the build plate (plane, face or mate
 *     connector) and the feature works in that frame.
 *   - The breakaway gap is certified by subtracting a copy of the part offset
 *     outward by the gap, instead of by point-sampling a triangle mesh.
 *   - Underside contours come from kernel raycasts against the B-rep.
 *
 * Why the tines are horizontal and one layer tall: a horizontal tine prints as
 * one continuous bead (nozzle runs along the wall, into the part, back out, no
 * retraction), which is what makes it both fuse and bend-snap clean. Set the
 * layer height to the slicer's, or each tine slices into two partial layers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Copyright (c) 2026 Chris Lee, Southeast Expedition Medical, LLC
 * Fin geometry and constants ported from support-fins,
 * Copyright (c) Matthew Trahan, MIT License.
 *
 * MIT License
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum SupportMaterial
{
    annotation { "Name" : "PLA" }
    PLA,
    annotation { "Name" : "PETG" }
    PETG,
    annotation { "Name" : "Custom" }
    CUSTOM
}

export enum StabilizeMode
{
    annotation { "Name" : "Off" }
    OFF,
    annotation { "Name" : "Auto" }
    AUTO,
    annotation { "Name" : "Selected faces" }
    SELECTED
}

export enum PadMode
{
    annotation { "Name" : "Auto (small bed contact)" }
    AUTO,
    annotation { "Name" : "Always" }
    ALWAYS,
    annotation { "Name" : "Never" }
    NEVER
}

// ─── Bounds constants ─────────────────────────────────────────────────────────

const LAYER_BOUNDS =
{
    (millimeter) : [0.04, 0.2, 1.0],
    (inch)       : 0.008
} as LengthBoundSpec;

const GAP_BOUNDS =
{
    (millimeter) : [0.05, 0.2, 2.0],
    (inch)       : 0.008
} as LengthBoundSpec;

const PROP_BITE_BOUNDS =
{
    (millimeter) : [0.05, 0.5, 3.0],
    (inch)       : 0.02
} as LengthBoundSpec;

const FIN_BITE_BOUNDS =
{
    (millimeter) : [0.05, 0.3, 3.0],
    (inch)       : 0.012
} as LengthBoundSpec;

const PAD_HEIGHT_BOUNDS =
{
    (millimeter) : [0.1, 0.6, 3.0],
    (inch)       : 0.02
} as LengthBoundSpec;

const PAD_GRAB_BOUNDS =
{
    (millimeter) : [-1.0, 0.05, 1.0],
    (inch)       : 0.002
} as LengthBoundSpec;

const SPAN_BOUNDS =
{
    (millimeter) : [3.0, 12.0, 200.0],
    (inch)       : 0.5
} as LengthBoundSpec;

const TINE_STEP_BOUNDS =
{
    (millimeter) : [0.5, 2.0, 20.0],
    (inch)       : 0.08
} as LengthBoundSpec;

const OVERHANG_ANGLE_BOUNDS =
{
    (degree) : [5, 45, 85]
} as AngleBoundSpec;

const FIN_LEAN_BOUNDS =
{
    (degree) : [0, 45, 75]
} as AngleBoundSpec;

const FIN_COUNT_BOUNDS =
{
    (unitless) : [1, 2, 20]
} as IntegerBoundSpec;

const WALL_COUNT_BOUNDS =
{
    (unitless) : [1, 60, 500]
} as IntegerBoundSpec;

// ─── Geometry constants (from support-fins; see docs/FIN-SPEC.md there) ──────

// Overhang analysis -- web/overhangs.js
const BED_EPS         = 0.35 * millimeter;        // a face this close to the plate IS the bottom
const MIN_REGION_AREA = 12.0 * millimeter ^ 2;    // ignore slivers
const ANGLE_EPS       = 1e-4;                     // a face exactly on the threshold is self-supporting

// Overhang prop -- web/prop.js PROP
const PROP_TH           = 1.0 * millimeter;       // stem thickness
const PROP_TIP          = 0.6 * millimeter;       // contact tip thickness
const PROP_TIP_H        = 1.5 * millimeter;       // height of the necked tip
const PROP_FOOT_MIN     = 1.6 * millimeter;       // flange half-width limits
const PROP_FOOT_MAX     = 3.0 * millimeter;
const PROP_FOOT_RATIO   = 0.12;                   // flange half-width / wall height
const PROP_MIN_SPAN     = 7.0 * millimeter;       // shorter walls are not worth the plate space
const PROP_MIN_SPAN_SQ  = 4.0 * millimeter;       // ...unless squat (cheap)
const PROP_MIN_H        = 1.5 * millimeter;       // below this a wall is squat
const PROP_MIN_H_SQ     = 0.6 * millimeter;       // below this the first layers self-support
const SQUAT_BRIM_W      = 2.5 * millimeter;       // squat brim half-width
const STATION_STEP      = 1.0 * millimeter;       // spacing of underside samples along a wall
const MAX_STATIONS      = 300;
const MIN_STATIONS      = 3;
const CONTOUR_SLOPE_MIN = 0.15;                   // steeper undersides get walls running down-slope
const TUBE_MIN_AREA     = 300 * millimeter ^ 2;   // curved regions this big get one wall on the lowest line
const TINE_W            = 0.5 * millimeter;       // one nozzle bead (Slant3D: 0.4-0.8)
const TINE_OVERLAP      = 0.3 * millimeter;       // how far a tine sinks back into the wall
const TINE_EDGE_BAND    = 8.0 * millimeter;       // dense comb this far from each end of a wall
const TINE_MID_FACTOR   = 2.0;                    // interior spacing multiplier
const TINE_STEP_SPARSE  = 5.0 * millimeter;       // never thinner than this across the middle
const TINE_TOP_CLEAR    = 0.5 * millimeter;       // bare zone at a sloped wall's top end
const TINE_SLOPE_MIN    = 1.0 * millimeter;       // rise before a wall counts as sloped
const MIN_GRIP_TINES    = 3;                      // grip floor per wall

// Stabilize fin -- web/fins.js FIN, web/planes.js
const FIN_TH            = 1.2 * millimeter;       // wall thickness
const FIN_BASE_H        = 1.0 * millimeter;       // base ellipse thickness
const FIN_ROWS_LOW      = 8;                      // "7 or 8 low down"
const FIN_TINE_GRIP     = 0.4 * millimeter;       // how far a tine reaches back into the wall
const FIN_TINE_SPACING  = 14.0 * millimeter;      // between tines along the wall
const FIN_ROW_GAP_MIN   = 0.8 * millimeter;       // rows closer than this merge
const FIN_DENSE_ZONE    = 6.0 * millimeter;       // height that gets the dense rows
const FIN_ROW_GROWTH    = 1.6;                    // row spacing multiplier above the dense zone
const FIN_BASE_MINOR    = 9.0 * millimeter;       // base ellipse depth, across the wall
const FIN_BASE_PAD      = 3.0 * millimeter;       // base ellipse overhang past the wall ends
const FIN_ELLIPSE_SEGS  = 40;
const FIN_MIN_TINES     = 3;                      // fewer and it is a prop, not a combined support
const FIN_STILT_FRAC    = 0.4;                    // reject faces whose bottom sits above this * top
const FIN_MAX_LEN       = 25.0 * millimeter;      // a fin is a short brace, not a full-length wall
const FIN_MIN_PATCH     = 4.0 * millimeter;
const FIN_MIN_AREA      = 25.0 * millimeter ^ 2;
const FIN_MIN_RATIO     = 0.25;                   // later fins must score this fraction of the best
const FIN_MIN_SEP       = 60 * degree;            // later fins face this far from earlier ones
const FIN_MIN_SITE_GAP  = 12.0 * millimeter;      // ...and stand this far from them
const FIN_WIDE_FACE     = 55.0 * millimeter;      // wider faces get a row of fins
const FIN_WIDE_AREA     = 1500 * millimeter ^ 2;
const FIN_ROW_PITCH     = 55.0 * millimeter;
const FIN_ROW_MAX       = 20;

// Bed pad -- web/fins.js buildPad
const PAD_MARGIN        = 4.0 * millimeter;       // grip spread past the contact
const PAD_MIN_AREA      = 60.0 * millimeter ^ 2;  // above this much bed contact no pad is needed
const PAD_SEGS          = 48;
const PAD_FLOOR         = 0.05 * millimeter;      // a gapped pad still kisses the resting edge

// ─── Feature definition ───────────────────────────────────────────────────────

annotation {
    "Feature Type Name" : "Support-Fins FS",
    "Icon" : icon::BLOB_DATA,
    "Feature Type Description" : "Adds breakaway supports that are part of the model, so the part prints in a strong tilted orientation with slicer supports OFF. 1. Orient the part the way you will print it. The Top plane is the build plate unless you pick another. 2. Select the part. Overhangs are found and get ribs automatically. 3. Set Layer height to your slicer's layer height. 4. Export the part AND its orange supports together as one STL. Slice with supports off. 5. After printing, bend each support sideways to snap it off.",
    "Tooltip" : "Designed-in breakaway supports with gripping tines, for printing a part tilted"
}
export const supportFins = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Parts to support", "Filter" : EntityType.BODY && BodyType.SOLID,
                     "Description" : "The part(s) to add supports to, already positioned the way they will print. Each part gets its own supports. The parts themselves are never modified." }
        definition.parts is Query;

        annotation { "Name" : "Build plate (default: Top plane)",
                     "Filter" : (EntityType.FACE && GeometryType.PLANE) || BodyType.MATE_CONNECTOR,
                     "MaxNumberOfPicks" : 1,
                     "Description" : "A plane, flat face or mate connector whose direction is the printer bed. Leave empty to use the Top plane. Up is taken to be the side the part is on." }
        definition.bedPlane is Query;

        annotation { "Name" : "Flip build direction", "UIHint" : UIHint.OPPOSITE_DIRECTION,
                     "Description" : "Reverse which way is up, if the supports come out on the wrong side." }
        definition.flipUp is boolean;

        annotation { "Name" : "Seat part on plate", "Default" : true,
                     "Description" : "Treat the part's lowest point as the bed surface, so only the plate's direction matters, not its position. Turn off to use the plate exactly where it is." }
        definition.seatOnBed is boolean;

        // ── Overhang props ───────────────────────────────────────────────────
        annotation { "Group Name" : "Overhang ribs", "Collapsed By Default" : false }
        {
            annotation { "Name" : "Auto-detect overhangs", "Default" : true,
                         "Description" : "Find downward faces too flat to print unsupported, and put a rib under each. A rib is a thin upside-down-T wall that stops a small gap below the part." }
            definition.autoDetect is boolean;

            if (definition.autoDetect)
            {
                annotation { "Name" : "Overhang angle (from plate)",
                             "Description" : "Downward faces flatter than this, measured from the bed, get ribs. 45 deg is the usual limit for printing without support; raise it for more supports." }
                isAngle(definition.overhangAngle, OVERHANG_ANGLE_BOUNDS);

                annotation { "Name" : "Exclude faces",
                             "Filter" : EntityType.FACE && ConstructionObject.NO && SketchObject.NO,
                             "Description" : "Detected overhang faces that should NOT get ribs, e.g. a cosmetic surface or one that bridges fine." }
                definition.excludeFaces is Query;
            }

            annotation { "Name" : "Add overhang faces",
                         "Filter" : EntityType.FACE && ConstructionObject.NO && SketchObject.NO,
                         "Description" : "Faces to support even if detection skipped them. Any face that points at all downward can be added." }
            definition.extraFaces is Query;

            annotation { "Name" : "Max unsupported span",
                         "Description" : "The widest stretch of overhang left between two ribs. Wide overhangs get a row of ribs spaced no farther apart than this. Smaller = more ribs." }
            isLength(definition.maxSpan, SPAN_BOUNDS);

            annotation { "Name" : "Gripping tines", "Default" : true,
                         "Description" : "Tiny one-layer bridges from the rib top into the part. They stop a tilted part from sliding or peeling off the rib, and snap cleanly when you bend the rib off. Off = plain breakaway ribs." }
            definition.propTines is boolean;

            if (definition.propTines)
            {
                annotation { "Name" : "Tine spacing",
                             "Description" : "Distance between tines near the ends of each rib (the middle is spaced twice as far). Smaller = stronger grip but more marks on the part." }
                isLength(definition.tineStep, TINE_STEP_BOUNDS);
            }

            annotation { "Name" : "Max walls per part",
                         "Description" : "Safety cap on how many ribs one part can get." }
            isInteger(definition.maxWalls, WALL_COUNT_BOUNDS);
        }

        // ── Stabilize fins ───────────────────────────────────────────────────
        annotation { "Group Name" : "Side bracing fins", "Collapsed By Default" : true }
        {
            annotation { "Name" : "Side fins", "Default" : StabilizeMode.OFF,
                         "Description" : "For a part tipped onto an edge or corner that could fall over during printing. A side fin is a thin wall standing next to a flat side of the part, a small gap away, with rows of tines reaching across to grip it, like a hand holding it upright. Auto picks the best sides facing different directions; Selected faces lets you choose." }
            definition.stabilizeMode is StabilizeMode;

            if (definition.stabilizeMode == StabilizeMode.AUTO)
            {
                annotation { "Name" : "Max fin sites",
                             "Description" : "How many sides of the part may get a fin. 2 braces opposite sides, which is usually enough." }
                isInteger(definition.maxFins, FIN_COUNT_BOUNDS);
            }

            if (definition.stabilizeMode == StabilizeMode.SELECTED)
            {
                annotation { "Name" : "Faces to brace",
                             "Filter" : EntityType.FACE && GeometryType.PLANE && ConstructionObject.NO && SketchObject.NO,
                             "Description" : "Flat sides to put a fin against. A face works if it leans no more than the Max face lean from vertical, reaches down near the bed, and has open space beside it. Pick faces on opposite sides so the part can't tip either way." }
                definition.stabilizeFaces is Query;
            }

            if (definition.stabilizeMode != StabilizeMode.OFF)
            {
                annotation { "Name" : "Max face lean (from vertical)",
                             "Description" : "Steepest face lean, measured from vertical, that can take a side fin. The fin leans with its face, so past 45 deg the fin wall itself becomes an overhang and may print poorly." }
                isAngle(definition.finMaxLean, FIN_LEAN_BOUNDS);
            }
        }

        // ── Bed pad ──────────────────────────────────────────────────────────
        annotation { "Group Name" : "Bed pad", "Collapsed By Default" : true }
        {
            annotation { "Name" : "Bed pad", "Default" : PadMode.AUTO,
                         "Description" : "A thin oval brim under where the part touches the bed, lightly tacked to it. Auto adds one only when the part rests on an edge or point (under 60 sq mm of flat contact), which would otherwise peel off." }
            definition.padMode is PadMode;
        }

        // ── Print settings ───────────────────────────────────────────────────
        annotation { "Group Name" : "Print settings", "Collapsed By Default" : false }
        {
            annotation { "Name" : "Layer height (tine height)",
                         "Description" : "Set this to your slicer's layer height. Each tine is exactly one layer tall and lined up with the layers, so it prints as a single strand that snaps clean." }
            isLength(definition.layerHeight, LAYER_BOUNDS);

            annotation { "Name" : "Material", "Default" : SupportMaterial.PLA,
                         "Description" : "Sets the clearances. PETG sticks to supports much harder than PLA, so it gets bigger gaps and shallower tines. Custom exposes every value." }
            definition.material is SupportMaterial;

            if (definition.material == SupportMaterial.CUSTOM)
            {
                annotation { "Name" : "Support gap",
                             "Description" : "Air gap between the supports and the part. Larger = easier removal, rougher underside." }
                isLength(definition.supportGap, GAP_BOUNDS);

                annotation { "Name" : "Rib tine bite",
                             "Description" : "How far each rib tine reaches into the part. Smaller = smaller marks, weaker grip." }
                isLength(definition.propBite, PROP_BITE_BOUNDS);

                annotation { "Name" : "Side fin tine bite",
                             "Description" : "How far each side-fin tine reaches into the part." }
                isLength(definition.finBite, FIN_BITE_BOUNDS);

                annotation { "Name" : "Base height (rib flanges + pad)",
                             "Description" : "Height of everything lying on the bed: the rib flanges and the bed pad share it, so they meet with no step. Rounded to whole layers." }
                isLength(definition.padHeight, PAD_HEIGHT_BOUNDS);

                annotation { "Name" : "Pad grab (negative = gap)",
                             "Description" : "How far the pad overlaps the part's underside to hold it. Negative leaves a gap instead, for easier removal." }
                isLength(definition.padGrab, PAD_GRAB_BOUNDS);
            }
        }

        annotation { "Name" : "Show detected overhangs", "Default" : false,
                     "Description" : "Highlight the overhang faces that were found, in red, to check detection." }
        definition.showOverhangs is boolean;
    }
    {
        const parts = evaluateQuery(context, definition.parts);
        if (size(parts) == 0)
        {
            throw regenError("Select at least one part to support.", ["parts"]);
        }

        const cfg = resolveConfig(definition);
        const bedPlane = resolvePlane(context, definition.bedPlane);

        var total = { "walls" : 0, "tines" : 0, "fins" : 0, "pads" : 0, "regions" : 0, "unserved" : 0, "bodies" : 0 };
        var warnings = [];
        for (var i = 0; i < size(parts); i += 1)
        {
            const r = supportPart(context, id + ("part" ~ i), parts[i], bedPlane, definition, cfg);
            total.walls += r.walls;
            total.tines += r.tines;
            total.fins += r.fins;
            total.pads += r.pad ? 1 : 0;
            total.regions += r.regions;
            total.unserved += r.unserved;
            total.bodies += r.bodies;
            for (var w in r.warnings)
            {
                warnings = append(warnings, w);
            }
        }

        var msg = total.regions ~ " overhang region(s): " ~ total.walls ~ " rib(s), " ~
                  total.tines ~ " tine(s), " ~ total.fins ~ " side fin(s), " ~
                  total.pads ~ " bed pad(s).";
        if (total.unserved > 0)
        {
            msg = msg ~ " " ~ total.unserved ~ " region(s) got no wall (too small, too low, or over the part rather than the plate).";
        }
        for (var w in warnings)
        {
            msg = msg ~ " " ~ w;
        }

        if (total.bodies == 0)
        {
            reportFeatureWarning(context, id, "No supports generated. " ~ msg);
        }
        else
        {
            reportFeatureInfo(context, id, msg ~ " Export each part together with its supports as one STL; slice with supports off.");
        }
    });

// ─── Configuration ────────────────────────────────────────────────────────────

/** Material clearances, mirroring web/app.js MATERIAL. */
function resolveConfig(definition is map) returns map
{
    var cfg = {
        "layer"    : definition.layerHeight,
        "propGap"  : 0.2 * millimeter,
        "finGap"   : 0.2 * millimeter,
        "propBite" : 0.5 * millimeter,
        "finBite"  : 0.30 * millimeter,
        "baseH"    : 0.6 * millimeter,   // rib flanges, squat brims and the pad: one height, no step
        "padGrab"  : 0.05 * millimeter,
        "angle"    : definition.overhangAngle is ValueWithUnits ? definition.overhangAngle : 45 * degree,
        "maxSpan"  : definition.maxSpan,
        "tines"    : definition.propTines,
        "tineStep" : definition.tineStep is ValueWithUnits ? definition.tineStep : 2.0 * millimeter,
        "maxWalls" : definition.maxWalls,
        "maxFins"  : definition.maxFins is number ? definition.maxFins : 2,
        "finLean"  : definition.finMaxLean is ValueWithUnits ? definition.finMaxLean : 45 * degree
    };

    if (definition.material == SupportMaterial.PETG)
    {
        // PETG welds to a support far harder than PLA: more clearance everywhere,
        // and the pad stands a hair below the part instead of tacking to it.
        cfg.propGap = 0.3 * millimeter;
        cfg.finGap = 0.3 * millimeter;
        cfg.finBite = 0.15 * millimeter;
        cfg.baseH = 0.4 * millimeter;
        cfg.padGrab = -0.1 * millimeter;
    }
    else if (definition.material == SupportMaterial.CUSTOM)
    {
        cfg.propGap = definition.supportGap;
        cfg.finGap = definition.supportGap;
        cfg.propBite = definition.propBite;
        cfg.finBite = definition.finBite;
        cfg.baseH = definition.padHeight;
        cfg.padGrab = definition.padGrab;
    }
    // whole layers only, so the pad and the flanges it meets top out on the same layer
    cfg.baseH = max(cfg.layer, round(cfg.baseH / cfg.layer) * cfg.layer);
    return cfg;
}

function resolvePlane(context is Context, q is Query) returns Plane
{
    if (isQueryEmpty(context, q))
    {
        return XY_PLANE;
    }
    const mates = evaluateQuery(context, q->qBodyType(BodyType.MATE_CONNECTOR));
    if (size(mates) > 0)
    {
        const cs = evMateConnector(context, { "mateConnector" : mates[0] });
        return plane(cs.origin, cs.zAxis, cs.xAxis);
    }
    return evPlane(context, { "face" : q });
}

/**
 * The print frame for one part. The plate's normal is turned to point into the
 * part (the user can flip it), and with "seat on plate" the frame's origin drops
 * to the part's lowest point, so heights are measured from where it touches.
 */
function makeEnv(context is Context, part is Query, bedPlane is Plane, definition is map, cfg is map) returns map
{
    var up = bedPlane.normal;
    const centroid = evApproximateCentroid(context, { "entities" : part });
    if (dot(centroid - bedPlane.origin, up) < 0 * meter)
    {
        up = -up;
    }
    if (definition.flipUp)
    {
        up = -up;
    }
    const xAxis = normalize(bedPlane.x - up * dot(bedPlane.x, up));

    var bedCS = coordSystem(bedPlane.origin, xAxis, up);
    var partBox = evBox3d(context, { "topology" : part, "cSys" : bedCS, "tight" : true });
    if (definition.seatOnBed)
    {
        bedCS = coordSystem(bedPlane.origin + up * partBox.minCorner[2], xAxis, up);
        partBox = evBox3d(context, { "topology" : part, "cSys" : bedCS, "tight" : true });
    }

    return {
        "part"      : part,
        "partFaces" : qOwnedByBody(part, EntityType.FACE),
        "up"        : up,
        "bedX"      : xAxis,
        "bedY"      : cross(up, xAxis),
        "bedCS"     : bedCS,
        "partBox"   : partBox,
        "cfg"       : cfg,
        "cut"       : cos(cfg.angle) + ANGLE_EPS
    };
}

// ─── Per-part driver ──────────────────────────────────────────────────────────

function supportPart(context is Context, pid is Id, part is Query, bedPlane is Plane, definition is map, cfg is map) returns map
{
    // Onshape requires every operation sharing an id prefix to be contiguous in
    // history, so each stage below owns one prefix and deletes its own scratch
    // bodies before the next stage starts. What survives under `pid` is supports.
    const env = makeEnv(context, part, bedPlane, definition, cfg);
    const supQ = qBodyType(qCreatedBy(pid, EntityType.BODY), BodyType.SOLID);

    var result = { "walls" : 0, "tines" : 0, "fins" : 0, "pad" : false, "regions" : 0,
                   "unserved" : 0, "bodies" : 0, "warnings" : [] };

    if (!definition.seatOnBed && env.partBox.minCorner[2] < -0.01 * millimeter)
    {
        result.warnings = append(result.warnings,
                "Part extends below the selected plate; enable 'Seat part on plate' or move the plate.");
    }

    const faceData = classifyFaces(context, env, definition);

    // ── Overhang props ───────────────────────────────────────────────────────
    const regions = groupRegions(context, faceData.info);
    var propTines = [];
    var wallCount = 0;
    for (var tids in regions)
    {
        const plan = planRegion(context, env, faceData.info, tids);
        if (plan.skip)
        {
            continue;
        }
        result.regions += 1;
        if (definition.showOverhangs)
        {
            addDebugEntities(context, plan.regionQ, DebugColor.RED);
        }

        var served = false;
        for (var c in plan.lines)
        {
            const runs = traceLine(context, env, faceData.info, plan, c);
            for (var run in runs)
            {
                if (wallCount >= cfg.maxWalls || size(run) < MIN_STATIONS)
                {
                    continue;
                }
                const n = size(run);
                var maxTop = 0 * millimeter;
                for (var s in run)
                {
                    maxTop = max(maxTop, s.z - cfg.propGap);
                }
                const squat = maxTop < PROP_MIN_H;
                const span = run[n - 1].r - run[0].r;
                const minSpan = (squat || plan.forced) ? PROP_MIN_SPAN_SQ : PROP_MIN_SPAN;
                if (span < minSpan)
                {
                    continue;
                }

                buildPropWall(context, pid + "props" + ("w" ~ wallCount), env, plan, c, run, squat, maxTop);
                if (cfg.tines)
                {
                    const anchors = propTineAnchors(context, env, plan, c, run, squat);
                    for (var a in anchors)
                    {
                        propTines = append(propTines, a);
                    }
                }
                wallCount += 1;
                served = true;
            }
        }
        if (!served)
        {
            result.unserved += 1;
        }
    }
    result.walls = wallCount;

    if (wallCount > 0)
    {
        // Certify the breakaway gap everywhere at once: whatever is left of a
        // wall after removing the part grown by the gap cannot touch the part.
        // Tines are added AFTER this, because they are meant to touch.
        const keepOut = buildKeepOut(context, pid + "keepOut", env, cfg.propGap - 0.01 * millimeter);
        if (!keepOut.offsetOk)
        {
            result.warnings = append(result.warnings,
                    "Could not offset the part for clearance; used a vertical-only gap, so check wall flanks.");
        }
        const propsQ = qBodyType(qCreatedBy(pid + "props", EntityType.BODY), BodyType.SOLID);
        try silent
        {
            opBoolean(context, pid + "propCut", {
                        "targets" : propsQ,
                        "tools" : keepOut.query,
                        "operationType" : BooleanOperationType.SUBTRACTION,
                        "keepTools" : true
                    });
        }
        catch
        {
            opDeleteBodies(context, pid + "propCutFail", { "entities" : propsQ });
            result.warnings = append(result.warnings, "Clearance cut failed; overhang ribs were removed.");
            propTines = [];
            result.walls = 0;
        }
        opDeleteBodies(context, pid + "keepOutDel", { "entities" : keepOut.query });
        // pieces of a wall cut free of the plate are floating scrap
        pruneFloating(context, pid + "propPrune", env, supQ, 0.3 * millimeter);
    }

    // ── Stabilize fins ───────────────────────────────────────────────────────
    if (definition.stabilizeMode != StabilizeMode.OFF)
    {
        const m = 50 * millimeter + max(env.partBox.maxCorner[2], 10 * millimeter);
        localBox(context, pid + "belowBed", env.bedCS,
                 vector(env.partBox.minCorner[0] - m, env.partBox.minCorner[1] - m, -m),
                 vector(env.partBox.maxCorner[0] + m, env.partBox.maxCorner[1] + m, 0 * millimeter));
        const belowQ = qCreatedBy(pid + "belowBed", EntityType.BODY);
        const fins = buildStabilizeFins(context, pid + "fins", mergeMaps(env, { "belowBed" : belowQ }), definition);
        opDeleteBodies(context, pid + "belowBedDel", { "entities" : belowQ });
        result.fins = fins.fins;
        result.tines += fins.tines;
        for (var note in fins.notes)
        {
            result.warnings = append(result.warnings, note);
        }
        if (fins.fins == 0)
        {
            result.warnings = append(result.warnings,
                    "No side fin fit: a fin needs a flat face at least 4 x 4 mm that leans no more than the Max face lean " ~
                    "from vertical, reaches down near the bed, and has open space beside it.");
        }
    }

    // ── Bed pad ──────────────────────────────────────────────────────────────
    result.pad = buildPad(context, pid + "pad", env, faceData.bedArea, definition.padMode);

    // ── Prop tines ───────────────────────────────────────────────────────────
    result.tines += emitBoxes(context, pid + "propTines", env, propTines,
                              -TINE_OVERLAP, cfg.propBite, TINE_W / 2);

    // ── Merge each support into one body, drop floaters ─────────────────────
    var merged = size(evaluateQuery(context, supQ)) < 2;
    if (!merged)
    {
        try silent
        {
            opBoolean(context, pid + "merge", {
                        "tools" : supQ,
                        "operationType" : BooleanOperationType.UNION
                    });
            merged = true;
        }
    }
    if (merged)
    {
        // a tine that missed its wall is a loose speck on the plate
        pruneFloating(context, pid + "finalPrune", env, supQ, 0 * millimeter);
    }
    else
    {
        result.warnings = append(result.warnings, "Supports could not be merged; tines are separate bodies.");
    }

    const bodies = evaluateQuery(context, supQ);
    result.bodies = size(bodies);
    var partName = "Part";
    try silent
    {
        partName = getProperty(context, { "entity" : part, "propertyType" : PropertyType.NAME });
    }
    for (var i = 0; i < size(bodies); i += 1)
    {
        setProperty(context, {
                    "entities" : bodies[i],
                    "propertyType" : PropertyType.NAME,
                    "value" : partName ~ " support " ~ (i + 1)
                });
    }
    if (size(bodies) > 0)
    {
        setProperty(context, {
                    "entities" : supQ,
                    "propertyType" : PropertyType.APPEARANCE,
                    "value" : color(1.0, 0.55, 0.1)
                });
    }
    return result;
}

// ─── Overhang analysis (web/overhangs.js) ─────────────────────────────────────

/**
 * Per-face overhang data, keyed by transient id. Planar faces are exact; curved
 * faces are sampled on a 5x5 parameter grid and carry the fraction that
 * overhangs plus the mean overhanging normal. Faces resting on the plate are
 * skipped, and the planar ones are summed into the bed-contact area.
 */
function classifyFaces(context is Context, env is map, definition is map) returns map
{
    const excluded = definition.autoDetect ? tidSet(context, definition.excludeFaces) : {};
    const forced = tidSet(context, definition.extraFaces);

    var params = [];
    for (var i = 0; i < 5; i += 1)
    {
        for (var j = 0; j < 5; j += 1)
        {
            params = append(params, vector(0.1 + 0.2 * i, 0.1 + 0.2 * j));
        }
    }

    var info = {};
    var bedArea = 0 * millimeter ^ 2;
    for (var f in evaluateQuery(context, env.partFaces))
    {
        const tid = tidOf(context, f);
        const fbox = evBox3d(context, { "topology" : f, "cSys" : env.bedCS, "tight" : true });
        const area = evArea(context, { "entities" : f });
        const planar = !isQueryEmpty(context, qGeometry(f, GeometryType.PLANE));
        const isForced = forced[tid] == true;

        var normal = undefined;
        var frac = 0;
        if (planar)
        {
            normal = evFaceTangentPlane(context, { "face" : f, "parameter" : vector(0.5, 0.5) }).normal;
            if (dot(normal, env.up) < -env.cut)
            {
                frac = 1;
            }
        }

        if (fbox.maxCorner[2] < BED_EPS)
        {
            // resting on the plate: this IS the bottom, not an overhang
            if (planar && dot(normal, env.up) < -0.99)
            {
                bedArea += area;
            }
            continue;
        }

        if (!planar)
        {
            const planes = evFaceTangentPlanes(context, { "face" : f, "parameters" : params });
            var over = vector(0, 0, 0);
            var down = vector(0, 0, 0);
            var count = 0;
            for (var p in planes)
            {
                const nz = dot(p.normal, env.up);
                if (nz < -env.cut)
                {
                    over += p.normal;
                    count += 1;
                }
                if (nz < 0)
                {
                    down += p.normal;
                }
            }
            frac = count / size(planes);
            if (count > 0)
            {
                normal = normalize(over);
            }
            else if (isForced && norm(down) > 1e-9)
            {
                normal = normalize(down);
            }
        }

        const candidate = normal != undefined &&
                          (isForced || (definition.autoDetect && frac > 0 && excluded[tid] != true));
        info[tid] = {
            "q" : f,
            "planar" : planar,
            "normal" : normal,
            "frac" : frac,
            "area" : area,
            "forced" : isForced,
            "candidate" : candidate
        };
    }
    return { "info" : info, "bedArea" : bedArea };
}

/** Candidate faces clustered by shared edges (union-find), like overhangs.js. */
function groupRegions(context is Context, info is map) returns array
{
    var parent = {};
    for (var entry in info)
    {
        if (entry.value.candidate)
        {
            parent[entry.key] = entry.key;
        }
    }
    for (var entry in parent)
    {
        const adj = evaluateQuery(context, qAdjacent(info[entry.key].q, AdjacencyType.EDGE, EntityType.FACE));
        for (var a in adj)
        {
            const other = tidOf(context, a);
            if (parent[other] == undefined)
            {
                continue;
            }
            var ra = entry.key;
            while (parent[ra] != ra)
            {
                ra = parent[ra];
            }
            var rb = other;
            while (parent[rb] != rb)
            {
                rb = parent[rb];
            }
            if (ra != rb)
            {
                parent[ra] = rb;
            }
        }
    }

    var groups = {};
    for (var entry in parent)
    {
        var r = entry.key;
        while (parent[r] != r)
        {
            r = parent[r];
        }
        if (groups[r] == undefined)
        {
            groups[r] = [];
        }
        groups[r] = append(groups[r], entry.key);
    }

    var out = [];
    for (var entry in groups)
    {
        out = append(out, entry.value);
    }
    return out;
}

// ─── Overhang props (web/prop.js) ─────────────────────────────────────────────

/**
 * Decide how walls tile one region. On a sloped underside the walls run down
 * the slope (a robust, part-aligned axis); on a near-flat one they run along the
 * footprint's longer plate axis. Walls are tiled across at no more than the
 * max-unsupported-span pitch -- except a large curved band (a tube lying down),
 * which gets ONE wall under its lowest line.
 */
function planRegion(context is Context, env is map, info is map, tids is array) returns map
{
    var area = 0 * millimeter ^ 2;
    var curvedArea = 0 * millimeter ^ 2;
    var nSum = vector(0, 0, 0);
    var qs = [];
    var faceSet = {};
    var forced = false;
    for (var t in tids)
    {
        const fi = info[t];
        const w = fi.forced ? fi.area : fi.area * fi.frac;
        area += w;
        if (!fi.planar)
        {
            curvedArea += w;
        }
        nSum += fi.normal * (w / millimeter ^ 2);
        qs = append(qs, fi.q);
        faceSet[t] = true;
        forced = forced || fi.forced;
    }
    if (area < MIN_REGION_AREA && !forced)
    {
        return { "skip" : true };
    }

    const regionQ = qUnion(qs);
    const nMean = norm(nSum) > 1e-9 ? normalize(nSum) : -env.up;
    const nz = dot(nMean, env.up);
    const h = nMean - env.up * nz;
    const slope = norm(h) / max(abs(nz), 1e-6);

    var run;
    if (norm(h) > 1e-6 && slope >= CONTOUR_SLOPE_MIN)
    {
        run = normalize(h);   // the underside rises this way
    }
    else
    {
        const bb = evBox3d(context, { "topology" : regionQ, "cSys" : env.bedCS, "tight" : true });
        const dx = bb.maxCorner[0] - bb.minCorner[0];
        const dy = bb.maxCorner[1] - bb.minCorner[1];
        run = dx >= dy ? env.bedX : env.bedY;
    }

    const cs = coordSystem(env.bedCS.origin, run, env.up);
    const rb = evBox3d(context, { "topology" : regionQ, "cSys" : cs, "tight" : true });
    var plan = {
        "skip" : false,
        "regionQ" : regionQ,
        "set" : faceSet,
        "forced" : forced,
        "cs" : cs,
        "run" : run,
        "crossDir" : cross(env.up, run),   // = cs y-axis
        "rMin" : rb.minCorner[0],
        "rMax" : rb.maxCorner[0],
        "lines" : []
    };
    if (plan.rMax - plan.rMin < PROP_MIN_SPAN_SQ)
    {
        return plan;
    }

    const cMin = rb.minCorner[1];
    const cMax = rb.maxCorner[1];
    const isTube = curvedArea >= 0.5 * area && area >= TUBE_MIN_AREA && slope < CONTOUR_SLOPE_MIN;
    if (isTube)
    {
        plan.lines = [lowestLine(context, env, info, plan, (plan.rMin + plan.rMax) / 2, cMin, cMax)];
    }
    else
    {
        const width = cMax - cMin;
        const n = max(1, ceil(width / env.cfg.maxSpan));
        for (var i = 0; i < n; i += 1)
        {
            plan.lines = append(plan.lines, cMin + width * (i + 0.5) / n);
        }
    }
    return plan;
}

/** The cross position where a curved region's underside hangs lowest. */
function lowestLine(context is Context, env is map, info is map, plan is map, r is ValueWithUnits,
    cMin is ValueWithUnits, cMax is ValueWithUnits) returns ValueWithUnits
{
    var best = (cMin + cMax) / 2;
    var bestZ = undefined;
    const n = min(60, max(2, ceil((cMax - cMin) / (0.5 * millimeter))));
    for (var k = 0; k <= n; k += 1)
    {
        const c = cMin + (cMax - cMin) * k / n;
        const s = sampleStation(context, env, info, plan, r, c);
        if (s.ok && (bestZ == undefined || s.z < bestZ))
        {
            best = c;
            bestZ = s.z;
        }
    }
    return best;
}

/**
 * Sample the region's underside along one wall line and split it into runs of
 * usable stations. A station is usable only where the FIRST thing a ray fired up
 * from the plate hits is this region -- so the path from plate to overhang is
 * clear and the overhang sits over the plate, not over another part of the body.
 */
function traceLine(context is Context, env is map, info is map, plan is map, c is ValueWithUnits) returns array
{
    const len = plan.rMax - plan.rMin;
    const n = min(MAX_STATIONS, max(2, ceil(len / STATION_STEP)));
    const step = len / n;
    const nudge = min(0.05 * millimeter, step / 4);
    var runs = [];
    var cur = [];
    for (var k = 0; k <= n; k += 1)
    {
        var r = plan.rMin + step * k;
        // keep the end rays off the region's boundary edges
        if (k == 0)
        {
            r += nudge;
        }
        if (k == n)
        {
            r -= nudge;
        }
        const s = sampleStation(context, env, info, plan, r, c);
        if (s.ok)
        {
            cur = append(cur, s);
        }
        else if (size(cur) > 0)
        {
            runs = append(runs, cur);
            cur = [];
        }
    }
    if (size(cur) > 0)
    {
        runs = append(runs, cur);
    }
    return runs;
}

function sampleStation(context is Context, env is map, info is map, plan is map, r is ValueWithUnits,
    c is ValueWithUnits) returns map
{
    const origin = toWorld(plan.cs, vector(r, c, -1 * millimeter));
    const hits = evRaycast(context, { "entities" : env.partFaces, "ray" : line(origin, env.up), "closest" : true });
    if (size(hits) == 0)
    {
        return { "ok" : false };
    }
    const hit = hits[0];
    const tid = tidOf(context, hit.entity);
    if (plan.set[tid] != true)
    {
        return { "ok" : false };
    }
    const z = hit.distance - 1 * millimeter;
    if (z < max(PROP_MIN_H_SQ, env.cfg.propGap + 0.3 * millimeter))
    {
        return { "ok" : false };
    }

    const fi = info[tid];
    if (!fi.planar && fi.frac >= 1 && !fi.forced)
    {
        // Every sample of this curved face overhangs, so the station is valid
        // without evaluating the surface. Its normal is only needed if a tine
        // lands here, so it is found then (propTineAt), not at every station.
        return { "ok" : true, "r" : r, "z" : z, "normal" : undefined,
                 "face" : fi.q, "pt" : hit.intersection, "param" : hit.parameter };
    }
    const n = fi.planar ? fi.normal : normalAt(context, fi.q, hit.intersection, hit.parameter);
    const nz = dot(n, env.up);
    if (fi.forced ? nz > -0.05 : nz >= -env.cut)
    {
        return { "ok" : false };
    }
    return { "ok" : true, "r" : r, "z" : z, "normal" : n };
}

/**
 * Surface normal of a curved face at a point it contains. The ray hit's own
 * parameter is tried first (one evaluation) and trusted only if it lands back
 * on the point; otherwise the point is projected onto the face (two).
 */
function normalAt(context is Context, face is Query, pt is Vector, param) returns Vector
{
    var fast = undefined;
    if (param is Vector && size(param) == 2)
    {
        try silent
        {
            const tp = evFaceTangentPlane(context, { "face" : face, "parameter" : param });
            if (norm(tp.origin - pt) < 1e-3 * millimeter)
            {
                fast = tp.normal;
            }
        }
    }
    if (fast != undefined)
    {
        return fast;
    }
    const d = evDistance(context, { "side0" : face, "side1" : pt });
    return evFaceTangentPlane(context, { "face" : face, "parameter" : d.sides[0].parameter }).normal;
}

/**
 * Douglas-Peucker: drop points that sit within `tol` of the line through their
 * neighbours. A flat underside sampled every millimetre collapses to its two
 * ends, and a curved one to the few points its curvature needs -- far fewer
 * sketch segments to solve, and far fewer faces for the clearance cut.
 */
function simplifyPolyline(pts is array, tol is ValueWithUnits) returns array
{
    const n = size(pts);
    if (n < 3)
    {
        return pts;
    }
    var keep = makeArray(n, false);
    keep[0] = true;
    keep[n - 1] = true;
    var stack = [[0, n - 1]];
    while (size(stack) > 0)
    {
        const seg = stack[size(stack) - 1];
        stack = resize(stack, size(stack) - 1);
        const i0 = seg[0];
        const i1 = seg[1];
        if (i1 - i0 < 2)
        {
            continue;
        }
        const ab = pts[i1] - pts[i0];
        const len = norm(ab);
        var best = -1;
        var bestD = tol;
        for (var k = i0 + 1; k < i1; k += 1)
        {
            const ap = pts[k] - pts[i0];
            const d = len > 1e-9 * millimeter ? abs(ab[0] * ap[1] - ab[1] * ap[0]) / len : norm(ap);
            if (d > bestD)
            {
                bestD = d;
                best = k;
            }
        }
        if (best >= 0)
        {
            keep[best] = true;
            stack = append(stack, [i0, best]);
            stack = append(stack, [best, i1]);
        }
    }
    var out = [];
    for (var k = 0; k < n; k += 1)
    {
        if (keep[k])
        {
            out = append(out, pts[k]);
        }
    }
    return out;
}

/**
 * One upside-down-T rib: a 0.6 mm contact tip following the underside `gap`
 * below it, a 1.0 mm stem that stops a tip-height short of that, and a flat
 * flange on the plate. A squat wall (lower than PROP_MIN_H) is just the tip on a
 * wide, thin brim, because the flange would not fit under it.
 */
function buildPropWall(context is Context, wid is Id, env is map, plan is map, c is ValueWithUnits,
    run is array, squat is boolean, maxTop is ValueWithUnits)
{
    const gap = env.cfg.propGap;
    const n = size(run);
    const r0 = run[0].r;
    const rn = run[n - 1].r;
    const zero = 0 * millimeter;
    const floorTop = 0.1 * millimeter;

    var tipTop = [];
    var stemTop = [];
    for (var s in run)
    {
        const top = max(s.z - gap, floorTop);
        tipTop = append(tipTop, vector(s.r, top));
        stemTop = append(stemTop, vector(s.r, min(top, max(top - PROP_TIP_H, env.cfg.baseH + 0.1 * millimeter))));
    }
    // 0.02 mm of contour error, well inside the gap; the clearance cut still
    // guarantees the gap wherever a straight segment would bulge toward the part
    const tol = 0.02 * millimeter;
    const tipPts = concatenateArrays([[vector(r0, zero)], simplifyPolyline(tipTop, tol),
                                      [vector(rn, zero), vector(r0, zero)]]);
    const stemPts = concatenateArrays([[vector(r0, zero)], simplifyPolyline(stemTop, tol),
                                       [vector(rn, zero), vector(r0, zero)]]);

    extrudeProfile(context, wid, "tip", plan, c, tipPts, PROP_TIP);

    // flange half-width scales with height but never overlaps the next wall's
    const spanCap = max(PROP_FOOT_MIN, (env.cfg.maxSpan - 1 * millimeter) / 2);
    if (squat)
    {
        const half = min(SQUAT_BRIM_W, spanCap);
        localBox(context, wid + "brim", plan.cs,
                 vector(r0, c - half, zero), vector(rn, c + half, env.cfg.baseH));
    }
    else
    {
        extrudeProfile(context, wid, "stem", plan, c, stemPts, PROP_TH);
        const foot = max(PROP_FOOT_MIN, min(min(PROP_FOOT_MAX, spanCap), maxTop * PROP_FOOT_RATIO));
        localBox(context, wid + "flange", plan.cs,
                 vector(r0, c - foot, zero), vector(rn, c + foot, env.cfg.baseH));
    }
}

/**
 * Extrude a closed (run, height) profile to `thickness`, centred on cross
 * position c, as op `wid + name`; its sketch is made and deleted alongside.
 */
function extrudeProfile(context is Context, wid is Id, name is string, plan is map, c is ValueWithUnits,
    pts is array, thickness is ValueWithUnits)
{
    // plane normal -crossDir with x = run puts sketch y straight up
    const skid = wid + (name ~ "Sk");
    const origin = plan.cs.origin + plan.crossDir * (c + thickness / 2);
    const sk = newSketchOnPlane(context, skid, { "sketchPlane" : plane(origin, -plan.crossDir, plan.run) });
    skPolyline(sk, "profile", { "points" : pts });
    skSolve(sk);
    opExtrude(context, wid + name, {
                "entities" : qSketchRegion(skid),
                "direction" : -plan.crossDir,
                "endBound" : BoundingType.BLIND,
                "endDepth" : thickness
            });
    opDeleteBodies(context, wid + (name ~ "SkDel"), { "entities" : qCreatedBy(skid, EntityType.BODY) });
}

/**
 * Where the tines go along one wall: dense within TINE_EDGE_BAND of each end
 * (the overhang's edges, where marks hide and grip has the longest lever),
 * thinned across the middle, never fewer than MIN_GRIP_TINES. A sloped wall is
 * combed up from its LOW end -- where a tilted part peels first -- starting at
 * the lowest station a tine actually grips.
 */
function propTineAnchors(context is Context, env is map, plan is map, c is ValueWithUnits, run is array,
    squat is boolean) returns array
{
    const n = size(run);
    const minTop = env.cfg.baseH + 0.2 * millimeter;
    const lowFirst = run[0].z <= run[n - 1].z;
    const total = abs(run[n - 1].r - run[0].r);
    const spacing = total / (n - 1);
    const step = min(env.cfg.tineStep, total / MIN_GRIP_TINES);
    const midStep = min(step * TINE_MID_FACTOR, max(TINE_STEP_SPARSE, step));
    const band = min(TINE_EDGE_BAND, total / 2);
    const sloped = abs(run[n - 1].z - run[0].z) >= TINE_SLOPE_MIN;

    var anchors = [];
    var tried = {};
    if (!sloped)
    {
        // level wall: plain even comb, edge-biased
        var u = step / 2;
        while (u < total)
        {
            const k = stationAt(u, spacing, n, lowFirst);
            if (tried[k] != true)
            {
                tried[k] = true;
                const t = propTineAt(context, env, plan, c, run[k], minTop);
                if (t.ok)
                {
                    anchors = append(anchors, t.anchor);
                }
            }
            u += min(u, total - u) <= band ? step : midStep;
        }
        return anchors;
    }

    // sloped wall: anchor the comb at the lowest station that grips
    const uTop = total - min(step / 2, TINE_TOP_CLEAR);
    var u = min(TINE_W / 2, step / 2);
    var anchored = false;
    while (u <= uTop && !anchored)
    {
        const k = stationAt(u, spacing, n, lowFirst);
        if (tried[k] != true)
        {
            tried[k] = true;
            const t = propTineAt(context, env, plan, c, run[k], minTop);
            if (t.ok)
            {
                anchors = append(anchors, t.anchor);
                anchored = true;
            }
        }
        if (!anchored)
        {
            u += min(TINE_W, step / 2);
        }
    }
    if (!anchored)
    {
        return anchors;
    }
    while (true)
    {
        const dense = min(u, total - u) <= band || total - (u + midStep) <= band;
        u += dense ? step : midStep;
        if (u > uTop)
        {
            break;
        }
        const k = stationAt(u, spacing, n, lowFirst);
        if (tried[k] == true)
        {
            continue;
        }
        tried[k] = true;
        const t = propTineAt(context, env, plan, c, run[k], minTop);
        if (t.ok)
        {
            anchors = append(anchors, t.anchor);
        }
    }
    return anchors;
}

/** Station index at arc length u, measured from the wall's low end. */
function stationAt(u is ValueWithUnits, spacing is ValueWithUnits, n is number, lowFirst is boolean) returns number
{
    const k = min(n - 1, max(0, round(u / spacing)));
    return lowFirst ? k : n - 1 - k;
}

/**
 * One tine at one station, or nothing. The tine is exactly one layer tall and
 * snapped to the layer grid (so it slices as a single bead, not two partial
 * layers), and it pokes horizontally into the part along the downhill direction
 * of the underside. It is only emitted if its tip is verified inside the part --
 * on a near-flat underside a horizontal poke lands in air, so no tine.
 */
function propTineAt(context is Context, env is map, plan is map, c is ValueWithUnits, s is map,
    minTop is ValueWithUnits) returns map
{
    const layer = env.cfg.layer;
    if (s.z - env.cfg.propGap < minTop)
    {
        return { "ok" : false };
    }
    const tineTop = round(s.z / layer) * layer;
    const zMid = s.z - layer / 2;

    var dirs = [];
    const normal = s.normal != undefined ? s.normal : normalAt(context, s.face, s.pt, s.param);
    const nh = normal - env.up * dot(normal, env.up);
    if (norm(nh) > 0.05)
    {
        dirs = append(dirs, -normalize(nh));
    }
    dirs = concatenateArrays([dirs, [-plan.run, plan.run]]);

    const mid = toWorld(plan.cs, vector(s.r, c, zMid));
    for (var d in dirs)
    {
        if (!isQueryEmpty(context, qContainsPoint(env.part, mid + d * env.cfg.propBite)))
        {
            return { "ok" : true, "anchor" : { "origin" : toWorld(plan.cs, vector(s.r, c, tineTop)), "xDir" : d } };
        }
    }
    return { "ok" : false };
}

// ─── Stabilize fins (web/fins.js buildFin, web/planes.js) ─────────────────────

/**
 * A fin stands BESIDE the part, parallel to a flat near-upright face and a gap
 * off it, and grips it with rows of horizontal tines. In Auto mode the best
 * faces are ranked by how much grippable wall they offer, and at most maxFins
 * are chosen facing at least FIN_MIN_SEP apart ("long parts: two fins,
 * opposite sides"). A face much wider than a corner brace gets a row.
 */
function buildStabilizeFins(context is Context, fid is Id, env is map, definition is map) returns map
{
    const isAuto = definition.stabilizeMode == StabilizeMode.AUTO;
    var faces = [];
    if (isAuto)
    {
        faces = evaluateQuery(context, qGeometry(env.partFaces, GeometryType.PLANE));
    }
    else if (definition.stabilizeFaces is Query)
    {
        faces = evaluateQuery(context, qIntersection([definition.stabilizeFaces, env.partFaces]));
    }

    var sites = [];
    var notes = [];
    for (var i = 0; i < size(faces); i += 1)
    {
        const s = finSite(context, env, faces[i], isAuto);
        if (s.ok)
        {
            sites = append(sites, mergeMaps(s, { "label" : "face " ~ (i + 1) }));
        }
        else if (!isAuto)
        {
            notes = append(notes, "Side fin, face " ~ (i + 1) ~ ": " ~ s.reason ~ ".");
        }
    }
    sites = sort(sites, function(a, b)
        {
            return (b.score - a.score) / millimeter ^ 2;
        });

    var out = { "fins" : 0, "tines" : 0, "notes" : notes };
    var chosen = [];
    var attempt = 0;
    for (var s in sites)
    {
        if (isAuto)
        {
            if (size(chosen) >= env.cfg.maxFins || s.score < FIN_MIN_RATIO * sites[0].score)
            {
                break;
            }
            var clash = false;
            for (var o in chosen)
            {
                if (dot(o.nh, s.nh) > cos(FIN_MIN_SEP) || norm(o.centroid - s.centroid) < FIN_MIN_SITE_GAP)
                {
                    clash = true;
                }
            }
            if (clash)
            {
                continue;
            }
        }

        var built = 0;
        var why = "";
        for (var win in s.windows)
        {
            if (out.fins >= FIN_ROW_MAX)
            {
                break;
            }
            const b = buildFinAt(context, fid + ("f" ~ attempt), env, s, win);
            attempt += 1;
            if (b.ok)
            {
                built += 1;
                out.fins += 1;
                out.tines += b.tines;
                if (!s.row)
                {
                    break;   // a corner brace needs one window, the first that fits
                }
            }
            else
            {
                why = b.reason;
            }
        }
        if (built > 0)
        {
            chosen = append(chosen, s);
        }
        else if (!isAuto)
        {
            out.notes = append(out.notes, "Side fin, " ~ s.label ~ ": " ~ why ~ ".");
        }
    }
    return out;
}

/**
 * The face's frame, outline and best windows as a fin site; { ok : false } if it
 * can't take one. A window is judged against the face's real OUTLINE, not its
 * bounding box: a tilted square face is a diamond, and a wall sized to the
 * diamond's bounding box stands mostly in air beside it. Across a window the
 * wall rises only as high as the face reaches at EVERY point of the window, so
 * the whole wall has face behind it.
 */
function finSite(context is Context, env is map, f is Query, isAuto is boolean) returns map
{
    const tp = evFaceTangentPlane(context, { "face" : f, "parameter" : vector(0.5, 0.5) });
    const n = tp.normal;
    const nz = dot(n, env.up);
    // Slack on the limit: a part tilted exactly to it has faces landing exactly
    // on it, and float noise would otherwise accept one side and reject the other.
    if (abs(nz) > sin(env.cfg.finLean) + 1e-4)
    {
        return { "ok" : false, "reason" : "leans more than the Max face lean (" ~
                 roundToPrecision(env.cfg.finLean / degree, 1) ~ " deg) from vertical" };
    }
    const uDir = normalize(cross(env.up, n));   // horizontal, along the face
    const tDir = cross(n, uDir);                 // up the face
    const h = sqrt(1 - nz * nz);
    const nh = (n - env.up * nz) / h;
    const origin = tp.origin;

    const fb = evBox3d(context, { "topology" : f, "cSys" : coordSystem(origin, uDir, n), "tight" : true });
    const uLen = fb.maxCorner[0] - fb.minCorner[0];
    const tLen = fb.maxCorner[1] - fb.minCorner[1];
    const area = evArea(context, { "entities" : f });
    if (uLen < FIN_MIN_PATCH || tLen < FIN_MIN_PATCH || area < FIN_MIN_AREA)
    {
        return { "ok" : false, "reason" : "smaller than 4 x 4 mm" };
    }

    var s = {
        "ok" : true,
        "q" : f,
        "n" : n,
        "nz" : nz,
        "h" : h,
        "nh" : nh,
        "uDir" : uDir,
        "tDir" : tDir,
        "origin" : origin,
        "zO" : dot(origin - env.bedCS.origin, env.up),
        "tz" : dot(tDir, env.up),
        "centroid" : evApproximateCentroid(context, { "entities" : f }),
        "row" : uLen >= FIN_WIDE_FACE && area >= FIN_WIDE_AREA,
        "segs" : faceOutline(context, f, origin, uDir, tDir)
    };

    // candidate windows: a row across a wide face, else a sweep for the best corner brace
    const inset = 0.5 * millimeter;
    const len = min(FIN_MAX_LEN, uLen - 2 * inset);
    const lo = fb.minCorner[0] + inset + len / 2;
    const hi = fb.maxCorner[0] - inset - len / 2;
    var centres = [];
    if (s.row)
    {
        const count = min(FIN_ROW_MAX, floor((hi - lo) / FIN_ROW_PITCH) + 1);
        for (var i = 0; i < count; i += 1)
        {
            centres = append(centres, count == 1 ? (lo + hi) / 2 : lo + (hi - lo) * i / (count - 1));
        }
    }
    else
    {
        const k = hi - lo < 0.5 * millimeter ? 1 : 9;
        for (var i = 0; i < k; i += 1)
        {
            centres = append(centres, k == 1 ? (lo + hi) / 2 : lo + (hi - lo) * i / (k - 1));
        }
    }

    var windows = [];
    var why = "no usable stretch of face";
    for (var cu in centres)
    {
        const w = finWindow(s, cu - len / 2, cu + len / 2, isAuto);
        if (w.ok)
        {
            windows = append(windows, w);
        }
        else
        {
            why = w.reason;
        }
    }
    if (size(windows) == 0)
    {
        return { "ok" : false, "reason" : why };
    }
    if (!s.row)
    {
        windows = sort(windows, function(a, b)
            {
                return (b.score - a.score) / millimeter ^ 2;
            });
    }
    var best = windows[0].score;
    for (var w in windows)
    {
        best = max(best, w.score);
    }
    s.windows = windows;
    s.score = best;
    return s;
}

/**
 * How much face backs the window [u0, u1]: sampled across it, the wall top is
 * the LOWEST face top and the face bottom is the lowest face point. Invalid if
 * the face does not span the whole window, or leaves too little to grip.
 */
function finWindow(s is map, u0 is ValueWithUnits, u1 is ValueWithUnits, isAuto is boolean) returns map
{
    const nS = 9;
    const pad = 0.05 * millimeter;
    var tTop = undefined;
    var tBot = undefined;
    for (var i = 0; i < nS; i += 1)
    {
        const u = u0 + pad + (u1 - u0 - 2 * pad) * i / (nS - 1);
        const r = tRangeAt(s.segs, u);
        if (r == undefined)
        {
            return { "ok" : false, "reason" : "face is too narrow or irregular for a fin" };
        }
        tTop = tTop == undefined ? r[1] : min(tTop, r[1]);
        tBot = tBot == undefined ? r[0] : min(tBot, r[0]);
    }
    if (tTop - tBot < FIN_MIN_PATCH)
    {
        return { "ok" : false, "reason" : "face is too short for a fin" };
    }
    const zTop = s.zO + tTop * s.tz;
    const zBot = s.zO + tBot * s.tz;
    if (zTop < FIN_BASE_H + 3 * millimeter)
    {
        return { "ok" : false, "reason" : "face is too close to the bed" };
    }
    // a bare stilt holds little and is most of the plastic
    const stilt = max(0 * millimeter, zBot - FIN_BASE_H);
    if (isAuto && stilt > FIN_STILT_FRAC * zTop)
    {
        return { "ok" : false, "reason" : "face starts too high above the bed" };
    }
    const grip = zTop - max(zBot, FIN_BASE_H);
    return {
        "ok" : true,
        "u0" : u0,
        "u1" : u1,
        "tTop" : tTop,
        "zTop" : zTop,
        "zBot" : zBot,
        "score" : (u1 - u0) * grip / (1 + stilt / zTop)
    };
}

/** The face's boundary as (u, t) segments, each edge sampled as a polyline. */
function faceOutline(context is Context, f is Query, origin is Vector, uDir is Vector, tDir is Vector) returns array
{
    const nP = 12;
    var params = [];
    for (var i = 0; i <= nP; i += 1)
    {
        params = append(params, i / nP);
    }
    var segs = [];
    for (var e in evaluateQuery(context, qAdjacent(f, AdjacencyType.EDGE, EntityType.EDGE)))
    {
        const lines = evEdgeTangentLines(context, { "edge" : e, "parameters" : params });
        var prev = undefined;
        for (var ln in lines)
        {
            const d = ln.origin - origin;
            const q = vector(dot(d, uDir), dot(d, tDir));
            if (prev != undefined)
            {
                segs = append(segs, [prev, q]);
            }
            prev = q;
        }
    }
    return segs;
}

/** [lowest, highest] t where the outline crosses the line u = const, or undefined. */
function tRangeAt(segs is array, u is ValueWithUnits)
{
    const eps = 1e-5 * millimeter;
    var lo = undefined;
    var hi = undefined;
    for (var sg in segs)
    {
        const a = sg[0];
        const b = sg[1];
        const du = b[0] - a[0];
        var ts = [];
        if (abs(du) < eps)
        {
            if (abs(u - a[0]) < 1e-3 * millimeter)
            {
                ts = [a[1], b[1]];
            }
        }
        else
        {
            const k = (u - a[0]) / du;
            if (k >= -1e-9 && k <= 1 + 1e-9)
            {
                ts = [a[1] + (b[1] - a[1]) * k];
            }
        }
        for (var tt in ts)
        {
            lo = lo == undefined ? tt : min(lo, tt);
            hi = hi == undefined ? tt : max(hi, tt);
        }
    }
    if (lo == undefined || hi - lo < eps)
    {
        return undefined;
    }
    return [lo, hi];
}

/**
 * Build one fin over a site window [u0, u1]: the round-topped wall (section in the
 * face's (t, w) plane, extruded along u, trimmed at the plate), the elliptical
 * base tangent to the wall's inner face and pushed outboard, and the tine rows.
 * The fin is abandoned -- not shortened -- if it comes within the gap of the
 * part anywhere or grips with fewer than FIN_MIN_TINES tines.
 */
function buildFinAt(context is Context, fid is Id, env is map, s is map, win is map) returns map
{
    const u0 = win.u0;
    const u1 = win.u1;
    const gap = env.cfg.finGap;
    const layer = env.cfg.layer;
    const rr = FIN_TH / 2;
    const wIn = gap;
    const wOut = gap + FIN_TH;

    // height of face-frame point (w, t) above the plate: zO + w*nz + t*tz
    const tBedIn = (-s.zO - wIn * s.nz) / s.tz;
    const tBedOut = (-s.zO - wOut * s.nz) / s.tz;
    const tTop = win.tTop;   // never above the face anywhere across the window
    if (tTop - rr <= max(tBedIn, tBedOut) + 0.5 * millimeter)
    {
        return { "ok" : false, "reason" : "face is too close to the bed" };
    }
    const below = -0.5 * millimeter;
    const tLow = min((below - s.zO - wIn * s.nz) / s.tz, (below - s.zO - wOut * s.nz) / s.tz);

    // ── wall ──
    const wallSk = newSketchOnPlane(context, fid + "wallSk",
            { "sketchPlane" : plane(s.origin + s.uDir * u0, s.uDir, s.tDir) });   // sketch (x, y) = (t, w)
    skLineSegment(wallSk, "inner", { "start" : vector(tLow, wIn), "end" : vector(tTop - rr, wIn) });
    skArc(wallSk, "top", {
                "start" : vector(tTop - rr, wIn),
                "mid" : vector(tTop, wIn + rr),
                "end" : vector(tTop - rr, wOut)
            });
    skLineSegment(wallSk, "outer", { "start" : vector(tTop - rr, wOut), "end" : vector(tLow, wOut) });
    skLineSegment(wallSk, "bottom", { "start" : vector(tLow, wOut), "end" : vector(tLow, wIn) });
    skSolve(wallSk);
    opExtrude(context, fid + "wall", {
                "entities" : qSketchRegion(fid + "wallSk"),
                "direction" : s.uDir,
                "endBound" : BoundingType.BLIND,
                "endDepth" : u1 - u0
            });
    opBoolean(context, fid + "trim", {
                "targets" : qCreatedBy(fid + "wall", EntityType.BODY),
                "tools" : env.belowBed,
                "operationType" : BooleanOperationType.SUBTRACTION,
                "keepTools" : true
            });

    // ── base: tangent to the wall's inner face, never reaching the part ──
    const baseOut = s.nz < -0.05 ? 1 * millimeter : 0 * millimeter;
    const bw = FIN_BASE_MINOR / 2;
    const bu = (u1 - u0) / 2 + FIN_BASE_PAD;
    const foot = s.origin + s.uDir * ((u0 + u1) / 2) + s.tDir * tBedIn + s.n * wIn;
    var centre = foot + s.nh * (bw + baseOut);
    centre -= env.up * dot(centre - env.bedCS.origin, env.up);
    var ell = [];
    for (var i = 0; i < FIN_ELLIPSE_SEGS; i += 1)
    {
        const a = 360 * degree * i / FIN_ELLIPSE_SEGS;
        ell = append(ell, vector(bw * cos(a), bu * sin(a)));
    }
    ell = append(ell, ell[0]);
    const baseSk = newSketchOnPlane(context, fid + "baseSk", { "sketchPlane" : plane(centre, env.up, s.nh) });
    skPolyline(baseSk, "ellipse", { "points" : ell });
    skSolve(baseSk);
    opExtrude(context, fid + "base", {
                "entities" : qSketchRegion(fid + "baseSk"),
                "direction" : env.up,
                "endBound" : BoundingType.BLIND,
                "endDepth" : FIN_BASE_H
            });
    opDeleteBodies(context, fid + "skDel", {
                "entities" : qUnion([qCreatedBy(fid + "wallSk", EntityType.BODY), qCreatedBy(fid + "baseSk", EntityType.BODY)])
            });

    const finQ = qBodyType(qUnion([qCreatedBy(fid + "wall", EntityType.BODY), qCreatedBy(fid + "base", EntityType.BODY)]),
            BodyType.SOLID);
    const clearance = evDistance(context, { "side0" : finQ, "side1" : env.part }).distance;
    if (clearance < gap - 0.02 * millimeter)
    {
        opDeleteBodies(context, fid + "clash", { "entities" : finQ });
        return { "ok" : false, "reason" : "the fin or its foot would touch another part of the model" };
    }

    // ── tines: rows dense low, spreading with height ──
    const zWallTop = s.zO + (wIn + rr) * s.nz + tTop * s.tz;
    const zLo = max(win.zBot, FIN_BASE_H) + 0.4 * millimeter;
    const zHi = min(win.zTop, zWallTop) - layer - 0.5 * millimeter;
    var rows = [];
    if (zHi > zLo)
    {
        const dense = min(zHi - zLo, FIN_DENSE_ZONE);
        var step = max(FIN_ROW_GAP_MIN, dense / FIN_ROWS_LOW);
        var z = zLo;
        while (z <= zHi)
        {
            const snapped = round((z + layer) / layer) * layer;   // tine TOP on the layer grid
            if (size(rows) == 0 || snapped > rows[size(rows) - 1])
            {
                rows = append(rows, snapped);
            }
            if (z > zLo + dense)
            {
                step *= FIN_ROW_GROWTH;
            }
            z += step;
        }
    }

    const inset = min(TINE_W, (u1 - u0) / 4);
    const sA = u0 + inset;
    const sB = u1 - inset;
    const nU = sB > sA ? max(2, ceil((sB - sA) / FIN_TINE_SPACING) + 1) : 1;
    const xDir = -s.nh;   // horizontally into the part
    var anchors = [];
    for (var tineTop in rows)
    {
        const zMid = tineTop - layer / 2;
        const tMid = (zMid - s.zO) / s.tz;
        for (var i = 0; i < nU; i += 1)
        {
            const uv = nU == 1 ? (sA + sB) / 2 : sA + (sB - sA) * i / (nU - 1);
            const onFace = s.origin + s.uDir * uv + s.tDir * tMid;   // part face at zMid
            // a patch's bounding box is not its shape: confirm the bite lands in solid
            if (!isQueryEmpty(context, qContainsPoint(env.part, onFace + xDir * (env.cfg.finBite / s.h))))
            {
                anchors = append(anchors, { "origin" : onFace + env.up * (layer / 2), "xDir" : xDir });
            }
        }
    }
    if (size(anchors) < FIN_MIN_TINES)
    {
        opDeleteBodies(context, fid + "noGrip", { "entities" : finQ });
        return { "ok" : false, "reason" : "fewer than " ~ FIN_MIN_TINES ~ " tines could grip the face" };
    }

    // tine spans from grip-deep in the wall to bite-deep in the part, measured normal to the face
    const count = emitBoxes(context, fid + "tines", env, anchors,
                            -(gap + FIN_TINE_GRIP) / s.h, env.cfg.finBite / s.h, TINE_W / 2);
    return { "ok" : true, "tines" : count };
}

// ─── Bed pad (web/fins.js buildPad) ───────────────────────────────────────────

/**
 * A part tilted onto an edge has near-zero bed contact and peels before any fin
 * can hold it. The pad is a thin oval around the contact (fitted to its
 * minimum-area direction, so an edge gets a long thin pad), whose top conforms
 * to the part: full height outboard, `grab` past the underside where the part
 * is overhead -- a light tack. A negative grab is a gap; then a PAD_FLOOR film
 * still kisses the resting edge.
 */
function buildPad(context is Context, pid is Id, env is map, bedArea, mode is PadMode) returns boolean
{
    if (mode == PadMode.NEVER || (mode == PadMode.AUTO && bedArea >= PAD_MIN_AREA))
    {
        return false;
    }

    // contact = the part within BED_EPS of the plate
    const m = 1 * millimeter;
    localBox(context, pid + "slab", env.bedCS,
             vector(env.partBox.minCorner[0] - m, env.partBox.minCorner[1] - m, -m),
             vector(env.partBox.maxCorner[0] + m, env.partBox.maxCorner[1] + m, BED_EPS));
    opPattern(context, pid + "copy", {
                "entities" : env.part,
                "transforms" : [identityTransform()],
                "instanceNames" : ["contact"]
            });
    const contactQ = qBodyType(qUnion([qCreatedBy(pid + "slab", EntityType.BODY),
                                       qCreatedBy(pid + "copy", EntityType.BODY),
                                       qCreatedBy(pid + "common", EntityType.BODY)]), BodyType.SOLID);
    var touching = true;
    try silent
    {
        opBoolean(context, pid + "common", {
                    "tools" : contactQ,
                    "operationType" : BooleanOperationType.INTERSECTION
                });
    }
    catch
    {
        touching = false;
    }
    if (!touching || isQueryEmpty(context, contactQ))
    {
        if (!isQueryEmpty(context, contactQ))
        {
            opDeleteBodies(context, pid + "contactDel", { "entities" : contactQ });
        }
        return false;
    }

    // minimum-area bounding direction of the contact
    var best = undefined;
    for (var k = 0; k < 12; k += 1)
    {
        const a = 15 * degree * k;
        const ax = env.bedX * cos(a) + env.bedY * sin(a);
        const cs = coordSystem(env.bedCS.origin, ax, env.up);
        const b = evBox3d(context, { "topology" : contactQ, "cSys" : cs, "tight" : true });
        const ar = (b.maxCorner[0] - b.minCorner[0]) * (b.maxCorner[1] - b.minCorner[1]);
        if (best == undefined || ar < best.area)
        {
            best = { "area" : ar, "cs" : cs, "bbox" : b };
        }
    }
    const b = best.bbox;
    const r1 = (b.maxCorner[0] - b.minCorner[0]) / 2 + PAD_MARGIN;
    const r2 = (b.maxCorner[1] - b.minCorner[1]) / 2 + PAD_MARGIN;
    const centre = toWorld(best.cs, vector((b.minCorner[0] + b.maxCorner[0]) / 2,
                                           (b.minCorner[1] + b.maxCorner[1]) / 2, 0 * millimeter));
    opDeleteBodies(context, pid + "contactDel", { "entities" : contactQ });

    var pts = [];
    for (var i = 0; i < PAD_SEGS; i += 1)
    {
        const a = 360 * degree * i / PAD_SEGS;
        pts = append(pts, vector(r1 * cos(a), r2 * sin(a)));
    }
    pts = append(pts, pts[0]);
    const sk = newSketchOnPlane(context, pid + "sk", { "sketchPlane" : plane(centre, env.up, best.cs.xAxis) });
    skPolyline(sk, "oval", { "points" : pts });
    skSolve(sk);
    opExtrude(context, pid + "disc", {
                "entities" : qSketchRegion(pid + "sk"),
                "direction" : env.up,
                "endBound" : BoundingType.BLIND,
                "endDepth" : env.cfg.baseH
            });

    // conform: remove the part shifted up by `grab`, leaving the pad `grab` past its underside
    opPattern(context, pid + "tool", {
                "entities" : env.part,
                "transforms" : [transform(env.up * env.cfg.padGrab)],
                "instanceNames" : ["tool"]
            });
    opBoolean(context, pid + "conform", {
                "targets" : qCreatedBy(pid + "disc", EntityType.BODY),
                "tools" : qCreatedBy(pid + "tool", EntityType.BODY),
                "operationType" : BooleanOperationType.SUBTRACTION,
                "keepTools" : true
            });
    if (env.cfg.padGrab < PAD_FLOOR)
    {
        opExtrude(context, pid + "floor", {
                    "entities" : qSketchRegion(pid + "sk"),
                    "direction" : env.up,
                    "endBound" : BoundingType.BLIND,
                    "endDepth" : PAD_FLOOR
                });
    }
    opDeleteBodies(context, pid + "scrapDel", {
                "entities" : qUnion([qCreatedBy(pid + "sk", EntityType.BODY), qCreatedBy(pid + "tool", EntityType.BODY)])
            });
    return true;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * A copy of the part grown outward by `offset`: subtracting it leaves every
 * support at least that far from the part. Falls back to the part plus a copy
 * shifted down by `offset` (a vertical-only gap) if the offset fails.
 */
function buildKeepOut(context is Context, kid is Id, env is map, offset is ValueWithUnits) returns map
{
    opPattern(context, kid + "copy", {
                "entities" : env.part,
                "transforms" : [identityTransform()],
                "instanceNames" : ["keepOut"]
            });
    const copyQ = qCreatedBy(kid + "copy", EntityType.BODY);
    var ok = true;
    try silent
    {
        opOffsetFace(context, kid + "grow", {
                    "moveFaces" : qOwnedByBody(copyQ, EntityType.FACE),
                    "offsetDistance" : offset
                });
    }
    catch
    {
        ok = false;
        opPattern(context, kid + "down", {
                    "entities" : env.part,
                    "transforms" : [transform(-env.up * offset)],
                    "instanceNames" : ["keepOutDown"]
                });
    }
    return { "query" : qBodyType(qCreatedBy(kid, EntityType.BODY), BodyType.SOLID), "offsetOk" : ok };
}

/** Axis-aligned box in `cs` coordinates, placed into the world. */
function localBox(context is Context, bid is Id, cs is CoordSystem, lo is Vector, hi is Vector)
{
    fCuboid(context, bid + "box", { "corner1" : lo, "corner2" : hi });
    opTransform(context, bid + "place", {
                "bodies" : qCreatedBy(bid + "box", EntityType.BODY),
                "transform" : toWorld(cs)
            });
}

/**
 * Stamp one small box per anchor: x in [x0, x1] along the anchor's horizontal
 * xDir, y in [-halfW, halfW], z one layer DOWN from the anchor. One template
 * cuboid, one opPattern -- tines number in the hundreds.
 */
function emitBoxes(context is Context, bid is Id, env is map, anchors is array,
    x0 is ValueWithUnits, x1 is ValueWithUnits, halfW is ValueWithUnits) returns number
{
    if (size(anchors) == 0)
    {
        return 0;
    }
    fCuboid(context, bid + "tpl", {
                "corner1" : vector(x0, -halfW, -env.cfg.layer),
                "corner2" : vector(x1, halfW, 0 * millimeter)
            });
    var transforms = [];
    var names = [];
    for (var i = 0; i < size(anchors); i += 1)
    {
        const a = anchors[i];
        const xd = normalize(a.xDir - env.up * dot(a.xDir, env.up));
        transforms = append(transforms, toWorld(coordSystem(a.origin, xd, env.up)));
        names = append(names, "t" ~ i);
    }
    opPattern(context, bid + "pattern", {
                "entities" : qCreatedBy(bid + "tpl", EntityType.BODY),
                "transforms" : transforms,
                "instanceNames" : names
            });
    opDeleteBodies(context, bid + "tplDel", { "entities" : qCreatedBy(bid + "tpl", EntityType.BODY) });
    return size(anchors);
}

/** Delete bodies that don't stand on the plate, or never rise above minTop. */
function pruneFloating(context is Context, did is Id, env is map, q is Query, minTop is ValueWithUnits)
{
    var doomed = [];
    for (var b in evaluateQuery(context, q))
    {
        const bx = evBox3d(context, { "topology" : b, "cSys" : env.bedCS, "tight" : true });
        if (bx.minCorner[2] > 0.02 * millimeter || bx.maxCorner[2] < minTop)
        {
            doomed = append(doomed, b);
        }
    }
    if (size(doomed) > 0)
    {
        opDeleteBodies(context, did, { "entities" : qUnion(doomed) });
    }
}

function tidOf(context is Context, q is Query) returns string
{
    if (q.transientId is string)
    {
        return q.transientId;
    }
    const ev = evaluateQuery(context, q);
    return size(ev) > 0 ? ev[0].transientId : "";
}

function tidSet(context is Context, q) returns map
{
    var s = {};
    if (q is Query)
    {
        for (var f in evaluateQuery(context, q))
        {
            s[tidOf(context, f)] = true;
        }
    }
    return s;
}
