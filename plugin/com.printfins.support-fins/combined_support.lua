-- Support Fins -- Combined Support Demo (the Slant3D fin).
--
-- A cube tilted onto its edge so it WOULD topple mid-print, held by a support
-- fin with a comb of HORIZONTAL TINES biting into it -- Slant3D's "combined"
-- support (youtube.com/watch?v=vnn4XeKQobs). Print it, bend the fin off: the
-- horizontal tines fatigue and snap clean, leaving faint marks, no welts.
--
-- The `combined` toggle is the whole lesson: tines ON = the fin grips and the
-- cube prints; tines OFF = a plain wall the cube falls away from, exactly the
-- failure Slant3D demos. Same on-screen as the web tool's tine toggle.
--
-- Why this is buildable in the sandbox: the cube is tilted about the Y axis, so
-- its FRONT face stays on the plane y = 0 -- still vertical. The tines are then
-- identical horizontal nubs crossing a constant gap into a flat vertical face,
-- no per-height contouring. The cube is a rotated VOLUME; the fin wall (the
-- object's main mesh) stays unrotated, as the API requires.

info = {
    id = "support_fins_combined",
    type = "project.plugin",
    title = "Combined Support Demo",
    menu = "Support Fins/Combined Support Demo",
    params = {
        {name = "block_size",   label = "Cube Size [mm]",       type = "float", default = 25},
        {name = "tilt",         label = "Tilt [deg]",           type = "float", default = 35},
        {name = "gap",          label = "Breakaway Gap [mm]",    type = "float", default = 0.2},
        {name = "tine_width",   label = "Tine Width [mm]",       type = "float", default = 0.5},
        {name = "layer_height", label = "Layer Height [mm]",     type = "float", default = 0.2},
        {name = "combined",     label = "Tines (combined)",      type = "bool",  default = true}
    }
}

-- Fixed profile numbers (docs/FIN-SPEC.md), kept out of the dialog.
local WALL_T    = 1.2    -- fin wall thickness [mm]
local FOOT_W    = 8.0    -- fin foot flare (in Y, for bed grip) [mm]
local PAD_H     = 1.0    -- foot / raft thickness [mm]
local TINE_BITE = 0.3    -- how far a tine reaches past the face into the cube [mm]
local INSET     = 2.0    -- keep tine grip points this far inside the face edge [mm]
local N_TINES   = 7      -- tines near the base, spreading out (spec: 7-8)
local MARGIN    = 2.0    -- fin wall margin around the tine field [mm]
local PAD_X     = 6.0    -- width of the raft under the cube's resting edge [mm]
local D2R       = math.pi / 180.0

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
    local S    = math.max(8, opts.block_size)
    local tilt = math.max(5, math.min(60, opts.tilt))
    local t    = tilt * D2R
    local gap  = math.max(0.05, opts.gap)
    local tw   = math.max(0.4, opts.tine_width)
    local th   = math.max(0.1, opts.layer_height)
    local ct, st = math.cos(t), math.sin(t)

    -- Tine grip points on the front face (y = 0), marched along the cube's lower
    -- overhang edge from the resting corner (0, PAD_H) toward (S*cos, S*sin),
    -- pushed INSET inside so each nub bites solid face, not the edge.
    local Bx, Bz = S * ct, S * st
    local inx, inz = -st, ct                    -- unit normal into the cube face
    local grips = {}
    local minx, maxx, maxz = math.huge, -math.huge, -math.huge
    for i = 1, N_TINES do
        local q  = i / (N_TINES + 1)
        local gx = q * Bx + INSET * inx
        local gz = PAD_H + q * Bz + INSET * inz
        grips[i] = {x = gx, z = gz}
        minx = math.min(minx, gx); maxx = math.max(maxx, gx); maxz = math.max(maxz, gz)
    end

    -- Fin wall: vertical, thin in Y, standing just in front of the face (back
    -- face at y = -gap), spanning the tine field. MAIN mesh -> stays unrotated.
    local wx  = (maxx - minx) + 2 * MARGIN
    local wxc = (minx + maxx) * 0.5
    local wz  = maxz + MARGIN
    local wyc = -gap - WALL_T * 0.5             -- wall centre in Y (back at -gap)
    local wall = api.make_cube(wx, WALL_T, wz)

    local other = {}

    -- Fin foot: wider in Y, welds the wall to the bed.
    other[#other+1] = vol(api.make_cube(wx, FOOT_W, PAD_H), wxc, wyc, 0.0, VolumeType.Solid)

    -- The cube, tilted about its resting edge (the local origin) and lifted onto
    -- the raft. A rotated volume, positioned by its rotate + translate (place()
    -- is for unrotated meshes only).
    other[#other+1] = {
        mesh = api.make_cube(S, S, S),
        type = VolumeType.Solid,
        rotate = {y = -tilt},
        translate = {x = 0, y = 0, z = PAD_H}
    }

    -- Raft under the resting edge: a real first-layer footprint for the near-zero
    -- edge contact (the cube rests on a line). Breakaway.
    other[#other+1] = vol(api.make_cube(PAD_X, S, PAD_H), 0.0, S * 0.5, 0.0, VolumeType.Solid)

    -- Horizontal tines biting the vertical face -- the "combined" upgrade. Each
    -- runs from inside the wall across the gap to TINE_BITE past the face.
    if opts.combined then
        local tine_len = WALL_T + gap + TINE_BITE
        local tyc      = (-(gap + WALL_T) + TINE_BITE) * 0.5   -- front at wall front
        for i = 1, N_TINES do
            local g = grips[i]
            other[#other+1] = vol(api.make_cube(tw, tine_len, th),
                                  g.x, tyc, g.z - th * 0.5, VolumeType.Solid)
        end
    end

    -- Keep the slicer's own supports out of the cube's envelope.
    local bxs = S * (st + ct) + 2
    local bzs = S * (st + ct) + PAD_H + 1
    other[#other+1] = vol(api.make_cube(bxs, S + 2, bzs),
                          (S * ct - S * st) * 0.5, S * 0.5, 0.0, VolumeType.SupportBlocker)

    api.project:add_object {
        mesh = wall,
        other_volumes = other,
        object_params = {support_material = 0}
    }
end
