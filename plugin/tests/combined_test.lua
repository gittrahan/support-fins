-- Geometry test for combined_support.lua, against a mock API.
--
-- The real risk here is tines landing in air. So the mock independently rebuilds
-- the tilted cube's FRONT face (the y=0 parallelogram) and point-in-polygon tests
-- every tine's grip point against it -- a genuine check, not a restatement of the
-- plugin's own formula. Also checks the wall is vertical/on the plate, the cube
-- rests on the raft, and the `combined` toggle adds/removes the tine comb.
--
--   Run:  cd plugin/tests && lua combined_test.lua

local BUNDLE = "../com.printfins.support-fins/"

VolumeType = {Solid="Solid", Negative="Negative", Modifier="Modifier",
              SupportBlocker="SupportBlocker", SupportEnforcer="SupportEnforcer"}

local emitted

local function cube(x, y, z)  -- corner origin at (0,0,0)
    return {sx=x, sy=y, sz=z,
            bounds = function()
                return {min_x=0, max_x=x, min_y=0, max_y=y, min_z=0, max_z=z}
            end}
end

api = {
    make_cube = cube,
    project = {
        current_bed = function() end,
        add_object = function(_, o)
            emitted = {main = o.mesh, vols = o.other_volumes or {},
                       support_material = o.object_params and o.object_params.support_material}
        end
    }
}

dofile(BUNDLE .. "combined_support.lua")

local function near(a, b, tol) return math.abs(a - b) < (tol or 1e-6) end

-- Point in convex polygon (CCW or CW), XZ plane.
local function in_poly(px, pz, poly)
    local sign = nil
    local n = #poly
    for i = 1, n do
        local a, b = poly[i], poly[(i % n) + 1]
        local cross = (b[1]-a[1]) * (pz-a[2]) - (b[2]-a[2]) * (px-a[1])
        if math.abs(cross) > 1e-9 then
            local s = cross > 0
            if sign == nil then sign = s elseif s ~= sign then return false end
        end
    end
    return true
end

local fail = 0
local function chk(name, cond)
    print((cond and "  ok   " or "  FAIL ") .. name)
    if not cond then fail = fail + 1 end
end

-- ---- combined = true ----
execute({block_size=25, tilt=35, gap=0.2, tine_width=0.5, layer_height=0.2, combined=true})

local S, tilt = 25, 35
local t = tilt * math.pi / 180
local ct, st = math.cos(t), math.sin(t)
local PAD_H = 1.0

-- Rebuild the cube's front (y=0) face: native corners (x,z) rotated -tilt about
-- origin, then z += PAD_H.  x' = x*ct - z*st ;  z' = x*st + z*ct
local function rot(x, z) return x*ct - z*st, x*st + z*ct + PAD_H end
local face = {}
do
    local xs = {{0,0},{S,0},{S,S},{0,S}}   -- CCW around the face
    for i, c in ipairs(xs) do local X,Z = rot(c[1], c[2]); face[i] = {X, Z} end
end

-- Find the wall (main), the tines, block, raft, blocker.
local wall_b = emitted.main:bounds()
local tines, block, raft, blocker = {}, nil, nil, nil
for _, v in ipairs(emitted.vols) do
    if v.rotate then block = v
    elseif v.type == "SupportBlocker" then blocker = v
    elseif v.mesh.sx == 6.0 then raft = v          -- PAD_X = 6
    elseif v.mesh.sz == 0.2 and v.type == "Solid" then tines[#tines+1] = v  -- tine: sz == layer height
    end
end

print("Combined Support checks (S=25, tilt=35, combined=true):")
chk("wall is vertical & thin in Y (main mesh)", wall_b.max_y - wall_b.min_y == 1.2)
chk("wall rises from the plate",                near(wall_b.min_z, 0))
chk("cube is a rotated volume, tilted -35",     block ~= nil and block.rotate and near(block.rotate.y, -35))
chk("cube rests on the raft (z = PAD_H)",       block ~= nil and near(block.translate.z, PAD_H))
chk("7 tines emitted",                          #tines == 7)

-- Each tine's grip point (its X centre, Z centre) must lie on the vertical face.
local inside = 0
for _, tn in ipairs(tines) do
    local b = tn.mesh:bounds()
    local gx = (b.min_x + b.max_x) * 0.5 + tn.translate.x
    local gz = (b.min_z + b.max_z) * 0.5 + tn.translate.z
    if in_poly(gx, gz, face) then inside = inside + 1 end
end
chk("every tine bites the vertical face (in silhouette)", inside == #tines and #tines > 0)
chk("raft under the resting edge on the plate",  raft ~= nil and near(raft.translate.z + raft.mesh:bounds().min_z, 0))
chk("blocker present over the cube",             blocker ~= nil)
chk("slicer supports off",                       emitted.support_material == 0)

-- ---- combined = false: no tines ----
execute({block_size=25, tilt=35, gap=0.2, tine_width=0.5, layer_height=0.2, combined=false})
local ntines = 0
for _, v in ipairs(emitted.vols) do
    if v.mesh.sz == 0.2 and v.type == "Solid" and not v.rotate then ntines = ntines + 1 end
end
print("Combined Support checks (combined=false):")
chk("tines removed when combined is off",        ntines == 0)

print(fail == 0 and "\nALL COMBINED-SUPPORT CHECKS PASS" or ("\n" .. fail .. " CHECK(S) FAILED"))
os.exit(fail)
