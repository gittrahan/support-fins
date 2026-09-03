-- Geometry arithmetic test for add_fin.lua, against a mock API.
-- Confirms the fin's shape: flared foot on the plate, thick wall, necked tip on
-- top, and a comb of tines that jut off the +X gripping face, denser near the
-- base -- and that the tine comb toggles off.
--
--   Run:  cd plugin/tests && lua add_fin_test.lua

local BUNDLE = "../com.printfins.support-fins/"

VolumeType = {Solid="Solid", Negative="Negative", Modifier="Modifier",
              SupportBlocker="SupportBlocker", SupportEnforcer="SupportEnforcer"}

local emitted

local function cube(x, y, z)  -- corner origin at (0,0,0)
    return {sx=x, sy=y, sz=z, bounds = function()
        return {min_x=0, max_x=x, min_y=0, max_y=y, min_z=0, max_z=z}
    end}
end

api = {
    make_cube = cube,
    project = {
        current_bed = function() end,
        add_object = function(_, o)
            local ot = o.translate or {x=0, y=0, z=0}
            local function aabb(m, t)
                t = t or {x=0, y=0, z=0}
                local b = m:bounds()
                return {x0=b.min_x+t.x+ot.x, x1=b.max_x+t.x+ot.x,
                        y0=b.min_y+t.y+ot.y, y1=b.max_y+t.y+ot.y,
                        z0=b.min_z+t.z+ot.z, z1=b.max_z+t.z+ot.z, m=m}
            end
            emitted = {main = aabb(o.mesh), vols = {}}
            for _, v in ipairs(o.other_volumes or {}) do
                emitted.vols[#emitted.vols+1] = {type=v.type, aabb=aabb(v.mesh, v.translate)}
            end
            emitted.support_material = o.object_params and o.object_params.support_material
        end
    }
}

dofile(BUNDLE .. "add_fin.lua")

local function near(a, b) return math.abs(a - b) < 1e-6 end
local function w(a) return a.x1 - a.x0 end
local fail = 0
local function chk(name, cond)
    print((cond and "  ok   " or "  FAIL ") .. name)
    if not cond then fail = fail + 1 end
end

-- ---- tines on ----
execute({fin_height=25, length=15, wall_thickness=1.2, foot_width=7, tines=true})

local wall = emitted.main
local foot, tip, tines = nil, nil, {}
for _, v in ipairs(emitted.vols) do
    local a = v.aabb
    if near(a.m.sz, 0.3) then tines[#tines+1] = a          -- TINE_H
    elseif a.m.sx == 7 then foot = a                       -- foot_w
    elseif a.m.sx == 0.6 then tip = a                      -- TIP_W
    end
end

print("Add-a-Fin checks (h=25, len=15, tines on):")
chk("wall base on plate z=0",                  near(wall.z0, 0))
chk("wall is the thin blade (1.2 in X)",       near(w(wall), 1.2))
chk("foot on plate, wider than wall",          foot and near(foot.z0, 0) and w(foot) > w(wall))
chk("tip narrower than wall, tops out at fin_h",tip and w(tip) < w(wall) and near(tip.z1, 25))
chk("7 tines emitted",                          #tines == 7)

local all_jut, in_height, lowest, highest = true, true, math.huge, -math.huge
for _, t in ipairs(tines) do
    if t.x1 <= wall.x1 then all_jut = false end            -- must jut past +X wall face
    if t.z0 < 0 or t.z1 > 25 then in_height = false end
    lowest = math.min(lowest, t.z0); highest = math.max(highest, t.z0)
end
chk("every tine juts off the +X gripping face", all_jut)
chk("tines sit within the fin height",          in_height)
chk("tines span low-to-high (a comb up the face)", highest - lowest > 3)

-- denser near base: gap between tine 1&2 smaller than between last two
table.sort(tines, function(a,b) return a.z0 < b.z0 end)
local g_low  = tines[2].z0 - tines[1].z0
local g_high = tines[#tines].z0 - tines[#tines-1].z0
chk("comb is denser near the base",             g_low < g_high)
chk("fin is self-supporting (supports off)",    emitted.support_material == 0)

-- ---- tines off ----
execute({fin_height=25, length=15, wall_thickness=1.2, foot_width=7, tines=false})
local n = 0
for _, v in ipairs(emitted.vols) do if near(v.aabb.m.sz, 0.3) then n = n + 1 end end
print("Add-a-Fin checks (tines off):")
chk("tine comb removed when tines off",         n == 0)

print(fail == 0 and "\nALL ADD-A-FIN CHECKS PASS" or ("\n" .. fail .. " CHECK(S) FAILED"))
os.exit(fail)
