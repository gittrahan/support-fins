-- Geometry arithmetic test for add_fin.lua, against a mock API.
-- Confirms the standalone fin's shape: foot on the plate, thick wall, thin tip
-- that tops out at overhang_height - gap and overlaps the wall so it unions.
--
--   Run:  cd plugin/tests && lua add_fin_test.lua

local BUNDLE = "../com.printfins.support-fins/"

VolumeType = {Solid="Solid", Negative="Negative", Modifier="Modifier",
              SupportBlocker="SupportBlocker", SupportEnforcer="SupportEnforcer"}

local emitted

local function cube(x, y, z)  -- corner origin at (0,0,0)
    return {bounds = function()
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
                        z0=b.min_z+t.z+ot.z, z1=b.max_z+t.z+ot.z}
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
execute({overhang_height=30, length=40, gap=0.2, wall_thickness=1.2, foot_width=7})

local function near(a, b) return math.abs(a - b) < 1e-6 end
local function w(a) return a.x1 - a.x0 end
local fail = 0
local function chk(name, cond)
    print((cond and "  ok   " or "  FAIL ") .. name)
    if not cond then fail = fail + 1 end
end

local wall = emitted.main
local foot = emitted.vols[1].aabb
local tip  = emitted.vols[2].aabb
local wcx  = (wall.x0 + wall.x1) / 2

print("Add-a-Fin checks (overhang=30, len=40, gap=0.2, wall=1.2, foot=7):")
chk("wall base on plate z=0",                 near(wall.z0, 0))
chk("foot on plate, wider than wall",         near(foot.z0, 0) and w(foot) > w(wall))
chk("tip is narrower than wall",              w(tip) < w(wall))
chk("tip tops out gap below overhang (29.8)", near(tip.z1, 30 - 0.2))
chk("tip overlaps the wall (unions)",         tip.z0 < wall.z1)
chk("foot concentric with wall in X",         near((foot.x0+foot.x1)/2, wcx))
chk("tip concentric with wall in X",          near((tip.x0+tip.x1)/2, wcx))
chk("fin length matches param",               near(wall.y1 - wall.y0, 40))
chk("fin is self-supporting (supports off)",  emitted.support_material == 0)

print(fail == 0 and "\nALL ADD-A-FIN CHECKS PASS" or ("\n" .. fail .. " CHECK(S) FAILED"))
os.exit(fail)
