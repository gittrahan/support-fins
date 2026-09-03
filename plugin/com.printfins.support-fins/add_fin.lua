-- Support Fins -- Add a Fin.
--
-- Drops ONE breakaway support fin into the scene: a thin blade on a flared foot,
-- necking to a thin tip, with a COMB OF HORIZONTAL TINES up its gripping face --
-- Slant3D's combined support (youtube.com/watch?v=vnn4XeKQobs), the same fin the
-- website bakes in. The tines are the whole point: they fuse into the part in one
-- continuous layer line, so you BEND the fin off and they snap clean.
--
-- You position it by hand with PrusaSlicer's move tool -- the plugin sandbox
-- can't read your model or place on its surface (that's what printfins.com
-- automates). Turn the fin so the TINE FACE (+X, the combed side) sits against
-- your part's overhanging face, foot on the plate, and nudge it until the tines
-- just touch. Auto-fitting to the surface is the website's job.
--
-- Frame: thin in X (thickness), long in Y (length), tall in Z. Tines project +X.

info = {
    id = "support_fins_add_fin",
    type = "project.plugin",
    title = "Add a Fin",
    menu = "Support Fins/Add a Fin",
    params = {
        {name = "fin_height",     label = "Fin Height [mm]",  type = "float", default = 25},
        {name = "length",         label = "Fin Length [mm]",  type = "float", default = 15},
        {name = "wall_thickness", label = "Fin Wall [mm]",    type = "float", default = 1.2},
        {name = "foot_width",     label = "Fin Foot [mm]",    type = "float", default = 7},
        {name = "tines",          label = "Gripping Tines",   type = "bool",  default = true}
    }
}

-- Fixed profile numbers (docs/FIN-SPEC.md), kept out of the dialog.
local PAD_H     = 1.0    -- foot (bed flange) thickness [mm]
local TIP_W     = 0.6    -- necked contact width at the top [mm]
local TIP_H     = 1.5    -- height of the necked tip [mm]
local OVERLAP   = 0.3    -- how far pieces sink into the wall so they union [mm]
local N_TINES   = 7      -- tines up the face, denser near the base (spec: 7-8)
local TINE_H    = 0.3    -- tine height -- one layer line [mm]
local TINE_REACH= 2.0    -- how far a tine juts off the wall face [mm]
local TINE_FRAC = 0.8    -- tine rib length as a fraction of the fin length
local TOP_FRAC  = 0.6    -- tines occupy the lower this-fraction of the fin

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
    local length = math.max(6, opts.length)
    local wall_t = math.max(0.4, opts.wall_thickness)
    local foot_w = math.max(wall_t, opts.foot_width)
    local fin_h  = math.max(TIP_H + 4, opts.fin_height)
    local wall_h = fin_h - TIP_H            -- thick wall stops where the tip begins

    -- Everything centred on the wall in X/Y (wall spans x[-wall_t/2, wall_t/2]).
    local wall = api.make_cube(wall_t, length, wall_h)   -- MAIN mesh, unrotated
    local foot = api.make_cube(foot_w, length + 2, PAD_H)
    local tip  = api.make_cube(TIP_W, length, TIP_H + OVERLAP)

    local other = {
        vol(foot, 0, 0, 0.0,               VolumeType.Solid),   -- flared bed foot
        vol(tip,  0, 0, wall_h - OVERLAP,  VolumeType.Solid)    -- thin breakaway tip
    }

    -- The tine comb: horizontal ribs up the +X (gripping) face, denser near the
    -- base where the part is least stable. Each rib overlaps into the wall and
    -- juts TINE_REACH out so it can bite the part face you set it against.
    if opts.tines then
        local rib_len = length * TINE_FRAC
        local rib_dx  = TINE_REACH + OVERLAP
        local rib_cx  = wall_t * 0.5 + (TINE_REACH - OVERLAP) * 0.5   -- juts off +X face
        for i = 1, N_TINES do
            local f  = (i - 1) / (N_TINES - 1)          -- 0 at base .. 1 at top
            local z  = 1.0 + (TOP_FRAC * fin_h - 1.0) * (f ^ 1.4)   -- ^1.4 => denser low
            other[#other+1] = vol(api.make_cube(rib_dx, rib_len, TINE_H),
                                  rib_cx, 0, z, VolumeType.Solid)
        end
    end

    api.project:add_object {
        mesh = wall,
        other_volumes = other,
        object_params = {support_material = 0}
    }
end
