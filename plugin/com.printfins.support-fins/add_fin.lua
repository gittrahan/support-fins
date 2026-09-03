-- Support Fins -- Add a Fin.
--
-- Drops ONE standalone breakaway support fin into the scene, sized to your
-- overhang. You then slide it under the overhang with PrusaSlicer's own move
-- tool -- the plugin sandbox can't read your model or place things on its
-- surface, so positioning is by hand here (that's what printfins.com automates).
--
-- The fin is the web tool's prop primitive: a thin WALL on a wide FOOT (an
-- upside-down T), necking to a thin TIP at the top so the contact is a light
-- kiss that snaps off clean. Build it as tall as the overhang MINUS the breakaway
-- gap, keep its foot on the plate, and centre it in X/Y under the overhang; the
-- tip then lands `gap` below the surface and the overhang bridges the last layer.
--
-- Pure geometry, one separate solid body -- exactly how the web tool exports a
-- fin. No tines (a plain overhang wants none; the toppling/tine case is the
-- Overhang Test demo's job).

info = {
    id = "support_fins_add_fin",
    type = "project.plugin",
    title = "Add a Fin",
    menu = "Support Fins/Add a Fin",
    params = {
        {name = "overhang_height", label = "Overhang Height [mm]", type = "float", default = 30},
        {name = "length",          label = "Fin Length [mm]",     type = "float", default = 40},
        {name = "gap",             label = "Breakaway Gap [mm]",   type = "float", default = 0.2},
        {name = "wall_thickness",  label = "Fin Wall [mm]",        type = "float", default = 1.2},
        {name = "foot_width",      label = "Fin Foot [mm]",        type = "float", default = 7}
    }
}

-- Fixed profile numbers (from docs/FIN-SPEC.md), kept out of the dialog.
local PAD_H   = 1.0    -- foot (bed flange) thickness [mm]
local TIP_W   = 0.6    -- necked contact width at the top [mm]
local TIP_H   = 1.5    -- height of the necked tip [mm]
local OVERLAP = 0.3    -- how far the tip sinks into the wall so they union [mm]

-- Place `mesh` so its XY centre is (cx, cy) and its underside at z = bz.
-- Origin-agnostic: reads the mesh's own bounds (the one rule DEVINFO repeats).
local function place(mesh, cx, cy, bz)
    local b = mesh:bounds()
    return {
        x = cx - (b.min_x + b.max_x) * 0.5,
        y = cy - (b.min_y + b.max_y) * 0.5,
        z = bz - b.min_z
    }
end

local function vol(mesh, cx, cy, bz, vtype)
    return {mesh = mesh, type = vtype, translate = place(mesh, cx, cy, bz)}
end

function execute(opts)
    local length = math.max(4, opts.length)
    local gap    = math.max(0.05, opts.gap)
    local wall_t = math.max(0.4, opts.wall_thickness)
    local foot_w = math.max(wall_t, opts.foot_width)

    -- Fin stands from the plate to `gap` below the overhang.
    local fin_h  = math.max(TIP_H + 0.4, opts.overhang_height - gap)
    local wall_h = fin_h - TIP_H          -- the thick wall stops where the tip begins

    -- Main mesh is the wall (a solid, unrotated body). Its native corner frame is
    -- the object's frame; the foot and tip are placed concentric with it. The tip
    -- sinks OVERLAP into the wall so the slicer unions the three into one body.
    local wall = api.make_cube(wall_t, length, wall_h)
    local wcx  = wall_t * 0.5             -- wall centre in X, native corner frame
    local wcy  = length * 0.5

    local foot = api.make_cube(foot_w, length, PAD_H)
    local tip  = api.make_cube(TIP_W,  length, TIP_H + OVERLAP)

    api.project:add_object {
        mesh = wall,
        other_volumes = {
            vol(foot, wcx, wcy, 0.0,             VolumeType.Solid),   -- wide bed foot
            vol(tip,  wcx, wcy, wall_h - OVERLAP, VolumeType.Solid)   -- thin breakaway tip
        },
        object_params = {
            support_material = 0   -- the fin is self-supporting; no slicer supports on it
        }
    }
end
