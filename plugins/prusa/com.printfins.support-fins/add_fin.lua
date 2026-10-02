-- Support Fins -- Add a Fin.
--
-- Drops ONE breakaway support fin into the scene for a part printed TILTED: a
-- thin right triangle that stands under the part's sloped underside, the same
-- shape as the 30/45/60 deg angled-print fins people already place by hand
-- (printables.com/model/1771718). Its SLOPE runs from a low tip on the plate up
-- to the top of a straight back edge, a gap under the part, on a thin foot. Along the slope runs a comb of TINES: one-layer horizontal nubs that
-- reach across the gap into the part, so each prints as a single strand that
-- fuses in and snaps clean when you bend the fin off (docs/FIN-SPEC.md).
--
-- You position it by hand with PrusaSlicer's move tool -- the plugin sandbox
-- can't read your model or place on its surface (that's what printfins.com
-- automates). Set Slope Angle to the underside's angle, turn the fin (about Z
-- only) so its slope climbs the same way, and slide it until the slope sits
-- GAP (0.2 mm) under the part -- e.g. the low tip GAP/sin(angle) out from
-- where the underside meets the plate.
--
-- Frame: thin in Y (thickness). The low tip is at x = 0 on the plate; the
-- slope climbs toward +X at the chosen angle to height H, then a short flat
-- (never a point) runs to the vertical back edge. The tines point -X, down the
-- slope, horizontally into the part above it.
--
-- The smooth slope is ONE cube turned to the angle (a rail whose top face IS
-- the slope); a stack of cube steps fills under it, every step corner inside
-- the rail, one layer tall below where the rail starts so the slope is never
-- notched deeper than the slicer's own layer steps. The API's only triangle (make_prism) is isosceles with its apex
-- centred and would need a Negative cut that the slicer draws as a grey box.
--
-- All geometry is built in ONE flat object space via shapes.builder(): every
-- piece is placed in the SAME frame as the first step, and the builder anchors
-- the whole object to it on emit.

info = {
    id = "support_fins_add_fin",
    type = "project.plugin",
    title = "Add a Fin",
    menu = "Support Fins/Add a Fin",
    params = {
        {name = "angle",      label = "Slope Angle [deg]", type = "float", default = 45},
        {name = "fin_height", label = "Fin Height [mm]",   type = "float", default = 25},
        {name = "tines",      label = "Gripping Tines",    type = "bool",  default = true}
    }
}

-- Fin numbers (web/prop/config.js PROP, docs/FIN-SPEC.md).
local FIN_TH       = 1.2    -- fin thickness [mm]
local TOP_W        = 1.2    -- flat at the top of the slope: never a point [mm]
local RAIL_T       = 1.5    -- the turned cube's depth under the slope [mm]
local STEP_H       = 1.0    -- fill step under the rail; its notches must fit in RAIL_T [mm]
local OVERLAP      = 0.1    -- each step sinks into the one below so they union [mm]
local BASE_H       = 0.6    -- foot thickness, snapped to whole layers (PROP.baseH) [mm]
local BASE_W       = 9.0    -- foot width across the fin [mm]
local BASE_PAD     = 3.0    -- foot runs this far past the back edge [mm]
local GAP          = 0.2    -- slope to part clearance, square to the slope (PROP.gap) [mm]
local BITE         = 0.5    -- how far a tine reaches horizontally into the part (PROP.tineBite) [mm]
local TINE_GRIP    = 0.4    -- how far a tine sinks back into the fin [mm]
local TINE_W       = 0.5    -- tine width: one nozzle bead (PROP.tineW) [mm]
local TINE_STEP    = 2.0    -- tines this far apart along the slope (PROP.tineStep) [mm]
local TOP_CLEAR    = 0.5    -- bare slope kept at the top (PROP.tineTopClear) [mm]
local MIN_ANGLE, MAX_ANGLE = 20, 70
local MIN_H        = 5.0

-- The print's layer grid: tops at first, first + layer, ... A tine must fill
-- exactly one of these slots or it slices into two partial layers. Reads the
-- bed's print preset; a per-object layer height override isn't seen.
local function layer_grid()
    local layer, first = 0.2, nil
    pcall(function()
        local p = api.project:current_bed():print_presets()
        layer = tonumber(p:value("layer_height")) or layer
        local f = p:value("first_layer_height")
        if type(f) == "string" and f:find("%%") then
            first = (tonumber((f:gsub("%%", ""))) or 100) / 100 * layer
        else
            first = tonumber(f)
        end
    end)
    if not layer or layer <= 0 then layer = 0.2 end
    if not first or first <= 0 then first = layer end
    return layer, first
end

-- Snap a height to the nearest layer top (never below the first layer).
local function snap_top(z, layer, first)
    if z <= first then return first end
    return first + math.floor((z - first) / layer + 0.5) * layer
end

function execute(opts)
    local shapes = require('shapes')

    local deg   = math.max(MIN_ANGLE, math.min(MAX_ANGLE, opts.angle))
    local th    = math.rad(deg)
    local sn, cs, tn = math.sin(th), math.cos(th), math.tan(th)
    local H     = math.max(MIN_H, opts.fin_height)
    local run   = H / tn                         -- level run of the slope
    -- the flat is wide enough for the rail's far corner, so the rail runs the
    -- slope's full length even when steep
    local top_w = math.max(TOP_W, RAIL_T * sn)
    local back  = run + top_w                    -- x of the vertical back edge
    local slope = H / sn                         -- slope length
    local layer, first = layer_grid()
    local base_h = math.max(first, snap_top(BASE_H, layer, first))
    local s0     = RAIL_T * cs / sn              -- rail starts here along the slope...
    local z_rail = s0 * sn                       -- ...at this height

    local fin = shapes.builder()

    -- Fill: steps from the plate up, each running from the slope (at the step's
    -- TOP, so its corner lands on the slope and the rest stays under it) to the
    -- back edge -- one layer tall until the rail starts, STEP_H under it. The
    -- first step is added first => the anchor.
    local steps = {}
    local z0 = 0
    while z0 < H - 1e-6 do
        local z1 = math.min(H, z0 + ((z0 < z_rail - 1e-6) and layer or STEP_H))
        local x0 = z1 / tn
        local lo = (z0 > 0) and (z0 - OVERLAP) or 0
        fin:add { mesh = api.make_cube(back - x0, FIN_TH, z1 - lo), x = x0, y = 0, z = lo }
        steps[#steps + 1] = { z0 = z0, z1 = z1, x0 = x0 }
        z0 = z1
    end

    -- Rail: a cube turned up to the angle (rotate about Y by -angle takes +X up
    -- the slope and +Z to the slope's outward normal), so its TOP face is the
    -- slope and its body lies under it. It turns about its own corner, which
    -- goes RAIL_T straight under the slope; it starts where that corner clears
    -- the plate and runs to the top (the flat leaves room for its far corner).
    local s1 = slope
    if s1 > s0 then
        fin:add {
            mesh = api.make_cube(s1 - s0, FIN_TH, RAIL_T),
            rotate = { y = -deg },
            x = s0 * cs + RAIL_T * sn,
            y = 0,
            z = s0 * sn - RAIL_T * cs
        }
    end

    -- Foot: a slab with a round back end, centred on the fin, from where the
    -- slope rises above the foot top (so the part keeps the slope's own level
    -- gap, GAP/sin, off the foot's top layer -- a vertical GAP closes to 0.07 mm
    -- level at 70 deg and welds), to BASE_PAD past the back edge.
    local br = BASE_W * 0.5
    local cy = FIN_TH * 0.5
    local fx0 = base_h / tn
    local bx  = math.max(fx0 + br, back + BASE_PAD - br)   -- round end's centre
    fin:add { mesh = api.make_cube(bx - fx0, BASE_W, base_h), x = fx0, y = cy - br, z = 0 }
    fin:add(shapes.cylinder_at(br, base_h, bx, cy, 0))

    -- Tines along the slope, TINE_STEP apart measured along it, each one layer
    -- on the grid. A tine reaches from inside the fin -- TINE_GRIP past the
    -- slope at its own top, and at least into the fill step behind it, so it
    -- holds on even without the rail -- out across the GAP (GAP/sin measured
    -- level) and BITE into the part, measured at mid-layer where the slicer cuts.
    if opts.tines then
        local z_lo = base_h + 0.2
        local z_hi = H - TOP_CLEAR
        local last
        local z = z_lo
        while true do
            local top = snap_top(z + layer, layer, first)
            if top > z_hi then break end
            if not last or top > last + 1e-6 then
                local x_top = top / tn                -- slope at the tine's top
                local x_mid = (top - layer * 0.5) / tn  -- slope at mid-layer, where it slices
                -- the fill step holding the tine's bottom
                local x_step = x_top
                for _, st in ipairs(steps) do
                    if st.z0 <= top - layer + 1e-6 and st.z1 > top - layer + 1e-6 then x_step = st.x0 end
                end
                local xa = x_mid - GAP / sn - BITE
                local xb = math.max(x_top + TINE_GRIP, x_step + OVERLAP)
                fin:add {
                    mesh = api.make_cube(xb - xa, TINE_W, layer),
                    x = xa,
                    y = cy - TINE_W * 0.5,
                    z = top - layer
                }
                last = top
            end
            z = z + TINE_STEP * sn
        end
    end

    fin:emit({ x = 0, y = 0, z = 0 }, { support_material = 0 })
end
