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
--
-- All geometry is built in ONE flat object space via shapes.builder(): every
-- piece is placed by its min-corner in the SAME frame as the wall, and the
-- builder anchors the whole object to the first volume on emit. This is the
-- pattern proven against the real 3.0 API -- the earlier hand-rolled version
-- centred the attachments at y=0 while the wall spanned y[0,length], flinging
-- the foot/tip/tines ~half the length off the blade (the "scattered boxes" bug).

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

function execute(opts)
    local shapes = require('shapes')

    local length = math.max(6, opts.length)
    local wall_t = math.max(0.4, opts.wall_thickness)
    local foot_w = math.max(wall_t, opts.foot_width)
    local fin_h  = math.max(TIP_H + 4, opts.fin_height)
    local wall_h = fin_h - TIP_H            -- thick wall stops where the tip begins

    -- One flat object space, corner-origin cubes (spans [0,w]x[0,d]x[0,h]).
    -- The wall spans x[0,wall_t], y[0,length]; everything else is centred on it
    -- IN THAT SAME FRAME so the pieces actually meet the blade.
    local cx = wall_t * 0.5   -- wall centre in X
    local cy = length * 0.5   -- wall centre in Y

    local fin = shapes.builder()

    -- MAIN mesh: the thin blade, base on the plate. Added first => the anchor.
    fin:add { mesh = api.make_cube(wall_t, length, wall_h), x = 0, y = 0, z = 0 }

    -- Flared bed foot, centred on the wall, base on the plate.
    fin:add {
        mesh = api.make_cube(foot_w, length + 2, PAD_H),
        x = cx - foot_w * 0.5,
        y = cy - (length + 2) * 0.5,
        z = 0
    }

    -- Necked breakaway tip on top, overlapping down into the wall so they union.
    fin:add {
        mesh = api.make_cube(TIP_W, length, TIP_H + OVERLAP),
        x = cx - TIP_W * 0.5,
        y = 0,
        z = wall_h - OVERLAP
    }

    -- The tine comb: horizontal ribs up the +X (gripping) face, denser near the
    -- base where the part is least stable. Each rib overlaps into the wall and
    -- juts TINE_REACH past the +X face so it can bite the part you set it against.
    if opts.tines then
        local rib_len = length * TINE_FRAC
        local rib_dx  = TINE_REACH + OVERLAP           -- OVERLAP into wall + reach out
        for i = 1, N_TINES do
            local f = (i - 1) / (N_TINES - 1)          -- 0 at base .. 1 at top
            local z = 1.0 + (TOP_FRAC * fin_h - 1.0) * (f ^ 1.4)   -- ^1.4 => denser low
            fin:add {
                mesh = api.make_cube(rib_dx, rib_len, TINE_H),
                x = wall_t - OVERLAP,                  -- starts inside the +X face
                y = cy - rib_len * 0.5,
                z = z
            }
        end
    end

    fin:emit({ x = 0, y = 0, z = 0 }, { support_material = 0 })
end
