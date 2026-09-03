-- Geometry arithmetic test for support_fins.lua, against a mock API.
--
-- `api`, `VolumeType` and the preset system exist only inside PrusaSlicer, so
-- plugin BEHAVIOUR can't be unit-tested. What CAN be tested is the placement
-- arithmetic: does the fin land under the overhang tip, at the breakaway gap.
-- The mock's make_cube is corner-origin (matching the real primitive) and it
-- replays translates the way the slicer would (volume translate, then object
-- translate), reporting each volume's final world AABB.
--
--   Run:  cd plugin/tests && lua geometry_test.lua      (or: make -C .. test)

local BUNDLE = "../com.printfins.support-fins/"

VolumeType = {Solid="Solid", Negative="Negative", Modifier="Modifier",
              SupportBlocker="SupportBlocker", SupportEnforcer="SupportEnforcer"}

local emitted

local function cube(x, y, z)  -- corner origin at (0,0,0)
    return {size = {x, y, z},
            bounds = function()
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

dofile(BUNDLE .. "support_fins.lua")
execute({reach=36, clearance_height=30, gap=0.2, wall_thickness=1.2, foot_width=7})

local H, POST_W = 30, 10
local total_x = POST_W + 36
local fin_x = total_x - 4
local function near(a, b) return math.abs(a - b) < 1e-6 end

local fail = 0
local function chk(name, cond)
    print((cond and "  ok   " or "  FAIL ") .. name)
    if not cond then fail = fail + 1 end
end

print("Geometry checks (defaults: reach=36, H=30, gap=0.2):")
chk("post (main) base on plate z=0",            near(emitted.main.z0, 0))
chk("post height reaches H",                     near(emitted.main.z1, H))

local shelf   = emitted.vols[1].aabb
local wall    = emitted.vols[2].aabb
local foot    = emitted.vols[3].aabb
local blocker = emitted.vols[4]
local wall_cx = (wall.x0 + wall.x1) / 2

chk("shelf underside at overhang height H",      near(shelf.z0, H))
chk("shelf spans post->tip in X",                near(shelf.x0, 0) and near(shelf.x1, total_x))
chk("fin wall top sits gap below shelf",         near(wall.z1, H - 0.2))
chk("fin wall rises from plate",                 near(wall.z0, 0))
chk("fin centred under the free tip (inset 4)",  near(wall_cx, fin_x))
chk("fin foot on plate, wider than wall",        near(foot.z0, 0) and (foot.x1-foot.x0) > (wall.x1-wall.x0))
chk("foot concentric with wall",                 near((foot.x0+foot.x1)/2, wall_cx))
chk("blocker is a SupportBlocker",               blocker.type == "SupportBlocker")
chk("blocker covers the overhang span",          blocker.aabb.x0 <= POST_W and blocker.aabb.x1 >= total_x)
chk("slicer supports off for the object",        emitted.support_material == 0)

print(fail == 0 and "\nALL GEOMETRY CHECKS PASS" or ("\n" .. fail .. " CHECK(S) FAILED"))
os.exit(fail)
