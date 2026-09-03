-- Support Fins -- Overhang Test.
--
-- Generates a cantilever overhang test object with a breakaway SUPPORT FIN baked
-- in beside it: a thin wall on a wide flat foot that rises from the plate and
-- stops a hair (the breakaway `gap`) below the overhang. The overhang bridges
-- that last layer, so the fin never fuses to the part -- it snaps off clean and
-- the underside is smooth.
--
-- This is the printable proof of the mechanism behind printfins.com. The website
-- does the automatic version -- load any STL, rotate it stronger, and it works
-- out the overhangs and contours the fins for you, baked into the STL so it
-- prints support-free in ANY slicer. That needs to read the model's triangles,
-- which the plugin sandbox can't do, so the auto tool stays on the web. What a
-- plugin CAN do is generate the fin from scratch -- which is exactly this.
--
-- Pure geometry: no G-code tricks. The fin is a separate solid body in the same
-- object, the same way the web tool exports the fin as its own closed solid.

info = {
    id = "support_fins_overhang_test",
    type = "project.plugin",
    title = "Support Fin Overhang Test",
    menu = "Calibration/Support Fin Overhang Test",
    params = {
        {name = "reach",            label = "Overhang Reach [mm]",   type = "float", default = 36},
        {name = "clearance_height", label = "Overhang Height [mm]",  type = "float", default = 30},
        {name = "gap",              label = "Breakaway Gap [mm]",    type = "float", default = 0.2},
        {name = "wall_thickness",   label = "Fin Wall [mm]",         type = "float", default = 1.2},
        {name = "foot_width",       label = "Fin Foot [mm]",         type = "float", default = 7}
    }
}

-- Fixed dimensions -- the numbers that don't change the lesson. Kept out of the
-- dialog so the five that matter stay legible.
local DEPTH     = 15.0   -- Y extent of the whole test object [mm]
local POST_W    = 10.0   -- the upright the overhang cantilevers from [mm]
local SHELF_H   = 4.0    -- overhang slab thickness [mm]
local PAD_H     = 1.0    -- fin foot (bed flange) thickness [mm]
local TIP_INSET = 4.0    -- fin sits this far in from the free tip (edge placement) [mm]

-- Place `mesh` so its XY centre lands at (cx, cy) and its underside at z = bz.
-- Origin-agnostic: reads the mesh's own bounds rather than assuming where the
-- primitive starts (the one rule DEVINFO repeats -- silent misplacement lives in
-- assumed origins). Returns a translate table.
local function place(mesh, cx, cy, bz)
    local b = mesh:bounds()
    return {
        x = cx - (b.min_x + b.max_x) * 0.5,
        y = cy - (b.min_y + b.max_y) * 0.5,
        z = bz - b.min_z
    }
end

-- Full volume definition: a mesh placed at (cx, cy, base bz) with a volume type.
local function vol(mesh, cx, cy, bz, vtype)
    return {mesh = mesh, type = vtype, translate = place(mesh, cx, cy, bz)}
end

function execute(opts)
    local reach   = math.max(8, opts.reach)
    local H       = math.max(8, opts.clearance_height)
    local gap     = math.max(0.05, opts.gap)
    local wall_t  = math.max(0.4, opts.wall_thickness)
    local foot_w  = math.max(wall_t, opts.foot_width)

    -- Work in the post's native corner frame: the post (the main mesh) can't be
    -- translated, only the object can, so everything else is placed relative to
    -- it. make_cube is corner-origin at (0,0,0), so the post spans x[0,POST_W],
    -- y[0,DEPTH], z[0,H] and every target below is expressed in that frame.
    local total_x = POST_W + reach              -- full footprint in X
    local cy      = DEPTH * 0.5
    local fin_x   = total_x - TIP_INSET         -- fin centreline, in from the tip
    local overhang_mid = POST_W + reach * 0.5   -- centre of the unsupported span

    -- The part: an upright post carrying a slab that cantilevers out over air.
    -- The slab underside (z = H, x in [POST_W, total_x]) is the overhang.
    local post  = api.make_cube(POST_W,  DEPTH, H)        -- MAIN mesh, sits natively
    local shelf = api.make_cube(total_x, DEPTH, SHELF_H)

    -- The support fin: a thin wall on a wide foot (an upside-down T, the web
    -- tool's own prop primitive). The wall tops out `gap` below the slab so the
    -- overhang bridges the last layer and the fin breaks away.
    local wall = api.make_cube(wall_t, DEPTH, H - gap)
    local foot = api.make_cube(foot_w, DEPTH, PAD_H)

    -- Keep the slicer's own supports out of the span, so the printed proof is
    -- that OUR fin -- and only our fin -- holds the overhang up.
    local blocker = api.make_cube(reach + 2, DEPTH + 2, H)

    api.project:add_object {
        mesh = post,                                        -- main body: the post
        other_volumes = {
            vol(shelf,   total_x * 0.5,  cy, H,   VolumeType.Solid),          -- the overhang slab
            vol(wall,    fin_x,          cy, 0.0, VolumeType.Solid),          -- fin wall
            vol(foot,    fin_x,          cy, 0.0, VolumeType.Solid),          -- fin foot (unions with wall)
            vol(blocker, overhang_mid,   cy, 0.0, VolumeType.SupportBlocker)  -- no slicer supports here
        },
        object_params = {
            support_material = 0   -- our fin is the support; leave slicer supports off
        }
    }
end
