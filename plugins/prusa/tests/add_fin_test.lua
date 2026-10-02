-- Geometry arithmetic test for add_fin.lua, against a mock API.
--
-- This mock models the REAL 3.0 semantics the shipped plugins rely on:
--   * make_cube is corner-origin, spanning [0,w]x[0,d]x[0,h];
--   * make_cylinder runs along Z from 0, centred in XY;
--   * other_volumes[].translate is RELATIVE TO THE MAIN MESH (object origin),
--     and a volume's rotate (degrees, right-handed -- the bundled temp_tower's
--     rotate x=90 stands its text upright and readable) turns it about its own
--     mesh origin first;
--   * the print preset's layer_height / first_layer_height set the layer grid.
-- It checks every piece OVERLAPS the fin (the check that caught the old
-- "scattered boxes" bug), the turned rail's top face IS the slope, the fill stays
-- under the slope with its notches inside the rail, the foot stays clear of the
-- part, and every tine is one layer on the grid and reaches across the gap into
-- the part.
--
--   Run:  cd plugins/prusa/tests && lua add_fin_test.lua

package.path = "../com.printfins.support-fins/?.lua;" .. package.path

VolumeType = {Solid="Solid", Negative="Negative", Modifier="Modifier",
              SupportBlocker="SupportBlocker", SupportEnforcer="SupportEnforcer"}

local emitted
local LAYER, FIRST = 0.2, 0.2
local SPACING = 6

local function box(x0, x1, y0, y1, z0, z1, kind)
    local m = {kind=kind, b={min_x=x0, max_x=x1, min_y=y0, max_y=y1, min_z=z0, max_z=z1}}
    function m:bounds() local b = self.b
        return {min_x=b.min_x, max_x=b.max_x, min_y=b.min_y, max_y=b.max_y, min_z=b.min_z, max_z=b.max_z} end
    return m
end

-- The 8 corners of a mesh's box, turned by `r` about the mesh origin, then moved.
local function corners(m, t, r, ot)
    local b = m:bounds()
    local out = {}
    for _, x in ipairs{b.min_x, b.max_x} do for _, y in ipairs{b.min_y, b.max_y} do
        for _, z in ipairs{b.min_z, b.max_z} do
            local X, Y, Z = x, y, z
            if r and r.y then                       -- right-handed about Y
                local a = math.rad(r.y)
                X, Z = x * math.cos(a) + z * math.sin(a), -x * math.sin(a) + z * math.cos(a)
            end
            assert(not (r and (r.x or r.z)), "mock only turns about Y")
            out[#out+1] = {x=X + t.x + ot.x, y=Y + t.y + ot.y, z=Z + t.z + ot.z, top=(z == b.max_z)}
        end
    end end
    return out
end

api = {
    make_cube = function(x, y, z) return box(0, x, 0, y, 0, z, "cube") end,
    make_cylinder = function(r, h) return box(-r, r, -r, r, 0, h, "cyl") end,
    project = {
        current_bed = function()
            return {print_presets = function()
                return {value = function(_, k)
                    if k == "layer_height" then return LAYER end
                    if k == "first_layer_height" then return FIRST end
                end}
            end}
        end,
        add_object = function(_, o)
            local ot = o.translate or {x=0, y=0, z=0}
            local function vol(m, t, r)
                local c = corners(m, t or {x=0, y=0, z=0}, r, ot)
                local a = {x0=math.huge, x1=-math.huge, y0=math.huge, y1=-math.huge,
                           z0=math.huge, z1=-math.huge, m=m, rotate=r, c=c}
                for _, p in ipairs(c) do
                    a.x0, a.x1 = math.min(a.x0, p.x), math.max(a.x1, p.x)
                    a.y0, a.y1 = math.min(a.y0, p.y), math.max(a.y1, p.y)
                    a.z0, a.z1 = math.min(a.z0, p.z), math.max(a.z1, p.z)
                end
                return a
            end
            emitted = {main = vol(o.mesh), vols = {}}
            for _, v in ipairs(o.other_volumes or {}) do
                emitted.vols[#emitted.vols+1] = vol(v.mesh, v.translate, v.rotate)
            end
            emitted.support_material = o.object_params and o.object_params.support_material
        end
    }
}

dofile("../com.printfins.support-fins/add_fin.lua")

local E = 1e-6
local function near(a, b, e) return math.abs(a - b) < (e or E) end
local function w(a) return a.x1 - a.x0 end
local function d(a) return a.y1 - a.y0 end
local function h(a) return a.z1 - a.z0 end
local function overlaps(a, b)
    return  math.min(a.x1,b.x1) - math.max(a.x0,b.x0) > 0
        and math.min(a.y1,b.y1) - math.max(a.y0,b.y0) > 0
        and math.min(a.z1,b.z1) - math.max(a.z0,b.z0) > 0
end
local fail = 0
local function chk(name, cond)
    print((cond and "  ok   " or "  FAIL ") .. name)
    if not cond then fail = fail + 1 end
end

-- steps: unturned, 1.2 thick; rail: the turned one; tines: one layer, one bead;
-- the rest is foot.
local function pieces()
    local p = {steps = {emitted.main}, tines = {}, foot = {}}
    for _, a in ipairs(emitted.vols) do
        if a.rotate then p.rail = a
        elseif near(d(a), 1.2) then p.steps[#p.steps+1] = a
        elseif near(d(a), 0.5) and near(h(a), LAYER) then p.tines[#p.tines+1] = a
        else p.foot[#p.foot+1] = a end
    end
    table.sort(p.steps, function(a, b) return a.z0 < b.z0 end)
    table.sort(p.tines, function(a, b) return a.z0 < b.z0 end)
    return p
end

local function on_grid(z)
    local k = (z - FIRST) / LAYER
    return z >= FIRST - E and near(k, math.floor(k + 0.5), 1e-6)
end

local function check_fin(deg, H, tines_on)
    local p = pieces()
    local th = math.rad(deg)
    local sn, cs, tn = math.sin(th), math.cos(th), math.tan(th)
    local st, rail = p.steps, p.rail
    local top_w = math.max(1.2, 1.5 * sn)
    local back = H / tn + top_w
    -- signed distance ABOVE the slope z = x*tan (positive = in the part's side)
    local function above(x, z) return z * cs - x * sn end

    chk("fin base on the plate",                    near(st[1].z0, 0))
    chk("fin tops out at fin height",               near(st[#st].z1, H))
    -- where the rail's top face starts: below it the fill IS the slope
    local rail_lo = math.huge
    if rail then for _, c in ipairs(rail.c) do if c.top then rail_lo = math.min(rail_lo, c.z) end end end
    local straight, under, joined, notch, fine = true, true, true, true, true
    for i, s in ipairs(st) do
        if not near(s.x1, back) then straight = false end
        if above(s.x0, s.z1) > E then under = false end             -- corner on/under slope
        local prev = (i > 1) and st[i-1].z1 or 0
        if (s.z1 - prev) * cs >= 1.5 then notch = false end
        if prev < rail_lo - E and s.z1 - prev > LAYER + E then fine = false end
        if i > 1 and not overlaps(s, st[i-1]) then joined = false end
    end
    chk("back edge is one straight vertical line",  straight)
    chk("fill stays under the slope",               under)
    chk("fill notches fit inside the rail",         notch)
    chk("below the rail the fill steps one layer at a time", fine)
    chk("each fill step fuses into the one below",  joined)
    chk("flat top, never a point (>= 1.2 mm)",      near(w(st[#st]), top_w) and top_w >= 1.2)
    chk("fin is 1.2 mm thick",                      near(d(st[1]), 1.2) and near(st[1].y0, 0))

    chk("slope rail is one turned cube",            rail ~= nil)
    if rail then
        local on, below, inside = true, true, true
        for _, c in ipairs(rail.c) do
            if c.top and not near(above(c.x, c.z), 0, 1e-6) then on = false end
            if above(c.x, c.z) > 1e-6 then below = false end
            if c.z < -1e-6 or c.x > back + 1e-6 or c.x < -1e-6 then inside = false end
        end
        chk("rail's top face IS the slope",         on)
        chk("rail lies under the slope",            below)
        chk("rail stays above the plate, inside the back edge", inside)
        local lo, hi = math.huge, -math.huge
        for _, c in ipairs(rail.c) do if c.top then lo, hi = math.min(lo, c.z), math.max(hi, c.z) end end
        chk("rail covers the slope right to the top", near(hi, H, 1e-6))
        chk("rail starts within 1.5 mm of the plate", lo <= 1.5 + E)
        chk("rail is the fin's thickness, on it",   near(rail.y0, 0) and near(d(rail), 1.2))
        local touches = false
        for _, s in ipairs(st) do if overlaps(rail, s) then touches = true end end
        chk("rail fuses into the fill",             touches)
    end

    chk("foot is 2 pieces (slab + round back end)", #p.foot == 2)
    if #p.foot ~= 2 then return end
    local slab, rnd = p.foot[1], p.foot[2]
    local plate = slab and rnd and near(slab.z0, 0) and near(rnd.z0, 0)
    chk("foot sits on the plate",                   plate)
    chk("foot meets the fin",                       slab and overlaps(slab, st[1]))
    chk("round end meets the slab",                 slab and rnd and overlaps(rnd, slab))
    local fx0 = math.min(slab.x0, rnd.x0)
    local foot_top = slab.z1
    chk("foot never reaches in front of the low tip", fx0 >= -E)
    -- the part's face at the foot's top is gap/sin (level) out from the slope;
    -- the foot must keep at least that level gap, the slope's own
    chk("part keeps the slope's level gap off the foot's top layer",
        fx0 - (foot_top / tn - 0.2 / sn) >= 0.2 / sn - 1e-6)
    chk("foot runs 3 mm past the back edge (more if short)", math.max(slab.x1, rnd.x1) >= back + 3 - E)
    chk("foot is 9 mm wide, centred",               near(d(slab), 9) and near((slab.y0+slab.y1)/2, 0.6))
    chk("foot ~0.6 mm, whole layers",               on_grid(foot_top) and near(foot_top, 0.6, LAYER/2 + E))

    if tines_on then
        local t = p.tines
        local join, bite, grip, grid, inside = #t > 0, true, true, true, true
        for _, n in ipairs(t) do
            local on = false
            for _, s in ipairs(st) do if overlaps(n, s) then on = true end end
            if not on then join = false end
            -- the part's face, level from the slope by gap/sin, at mid-layer
            local face = (n.z0 + n.z1) / 2 / tn - 0.2 / sn
            if not near(n.x0, face - 0.5, 1e-6) then bite = false end
            local gx = n.x1 - n.z1 / tn                   -- grip past the slope at the top
            if gx < 0.4 - E or gx > 0.4 + 1.0 / tn + 0.1 + E then grip = false end
            if not on_grid(n.z1) then grid = false end
            if n.z0 < foot_top or n.z1 > H - 0.5 + E or not near((n.y0+n.y1)/2, 0.6) then inside = false end
        end
        chk("every tine sinks into the fin",        join)
        chk("every tine crosses the gap and bites exactly 0.5 into the part", bite)
        chk("every tine grips 0.4+ into the fin, never far past the step", grip)
        chk("every tine one layer, top on the grid",grid)
        chk("tines above the foot, below the top, centred", inside)
        local ok = #t >= 3
        for i = 2, #t do
            local ds = (t[i].z1 - t[i-1].z1) / sn
            if ds > SPACING + LAYER / sn + E then ok = false end
        end
        chk(("at least 3 tines, no more than %g mm apart on the slope"):format(SPACING), ok)
        chk("tines start just above the foot",      #t > 0 and t[1].z1 <= foot_top + 0.2 + 2 * LAYER + E)
        chk("tines run up to just under the top",   #t > 0 and t[#t].z1 >= H - 0.5 - LAYER - E)
        return t
    end
end

for _, deg in ipairs{45, 30, 60} do
    print(("Add-a-Fin checks (%d deg, h=25, layer 0.2):"):format(deg))
    execute({angle=deg, fin_height=25, tines=true})
    check_fin(deg, 25, true)
end
chk("fin is self-supporting (supports off)",    emitted.support_material == 0)

LAYER, FIRST = 0.3, 0.25
print("Add-a-Fin checks (45 deg, layer 0.3, first 0.25):")
execute({angle=45, fin_height=25, tines=true})
check_fin(45, 25, true)

local real_bed = api.project.current_bed
api.project.current_bed = function()
    return {print_presets = function()
        return {value = function(_, k)
            if k == "layer_height" then return "0.2" end
            if k == "first_layer_height" then return "150%" end
        end}
    end}
end
LAYER, FIRST = 0.2, 0.3
print("Add-a-Fin checks (layer \"0.2\", first \"150%\"):")
execute({angle=45, fin_height=25, tines=true})
check_fin(45, 25, true)

api.project.current_bed = function() error("no bed") end
LAYER, FIRST = 0.2, 0.2
print("Add-a-Fin checks (no preset -> 0.2 grid):")
execute({angle=45, fin_height=25, tines=true})
check_fin(45, 25, true)
api.project.current_bed = real_bed

print("Add-a-Fin checks (clamped: 5 deg -> 20, 1 mm -> 5 mm):")
execute({angle=5, fin_height=1, tines=true})
check_fin(20, 5, true)
print("Add-a-Fin checks (clamped: 89 deg -> 70):")
execute({angle=89, fin_height=12, tines=true})
check_fin(70, 12, true)

-- ---- Tine Spacing ----
local function count(deg, step)
    execute({angle=deg, fin_height=25, tines=true, tine_step=step})
    return #pieces().tines
end
print("Add-a-Fin checks (Tine Spacing):")
local n6, n2, n12 = count(45, 6), count(45, 2), count(45, 12)
print(("  (45 deg, 25 mm: %d tines at 6 mm, %d at 2 mm, %d at 12 mm)"):format(n6, n2, n12))
chk("default 6 mm is sparse: ~6-8 tines on a 25 mm 45 deg fin", n6 >= 6 and n6 <= 8)
chk("tighter spacing gives more tines",          n2 > n6 and n6 > n12)
chk("a huge spacing still keeps 3 tines (grip floor)", count(45, 500) == 3)
chk("spacing is floored at 1 mm (0 doesn't flood)", count(45, 0) == count(45, 1))
SPACING = 2
execute({angle=30, fin_height=25, tines=true, tine_step=2})
check_fin(30, 25, true)
SPACING = 12
execute({angle=60, fin_height=25, tines=true, tine_step=12})
check_fin(60, 25, true)
SPACING = 6

print("Add-a-Fin checks (tines off):")
execute({angle=45, fin_height=25, tines=false})
chk("tine comb removed when tines off",         #pieces().tines == 0)

print(fail == 0 and "\nALL ADD-A-FIN CHECKS PASS" or ("\n" .. fail .. " CHECK(S) FAILED"))
os.exit(fail)
