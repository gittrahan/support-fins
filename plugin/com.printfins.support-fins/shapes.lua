-- Shared geometry helpers.
--
-- Vendored (MIT) from leotrax3d/prusaslicer-plugins-unofficial -- these are the
-- patterns proven to work against the real PrusaSlicer 3.0 API, unlike a mock.
--
-- Two things here are worth knowing before using them.
--
-- Boolean ordering. PrusaSlicer applies volumes in list order: a Negative
-- subtracts from everything before it, and a Solid added afterwards is put back.
-- That ordering is the only boolean tool the API gives us -- there is no
-- intersection.
--
-- Object origins. add_object takes a single `mesh` plus `other_volumes`, and the
-- main mesh has no translate of its own; only the object does, and every
-- other_volume translate is expressed RELATIVE TO THE FIRST VOLUME. The builder
-- below works in one flat object space and, on emit, shifts the object so the
-- first volume lands where it should. Nothing has to assume where a primitive
-- puts its origin.

local M = {}

--- Places a cylinder by its bounding box rather than its assumed origin.
-- make_cylinder's origin is one of the open questions in DEVINFO.md, so every
-- cylinder goes through here.
--@return table mesh plus x/y/z, ready for builder:add
function M.cylinder_at(radius, height, cx, cy, z0)
    local mesh = api.make_cylinder(radius, height)
    local b = mesh:bounds()
    return {
        mesh = mesh,
        x = cx - (b.min_x + b.max_x) * 0.5,
        y = cy - (b.min_y + b.max_y) * 0.5,
        z = z0 - b.min_z
    }
end

--- Collects volumes in object space and emits them as one object.
local Builder = {}
Builder.__index = Builder

function M.builder()
    return setmetatable({ volumes = {} }, Builder)
end

--- Adds a volume. The first one added becomes the object's main mesh, so it must
-- be solid and unrotated.
--@param opts table mesh, x?, y?, z?, type?, rotate?, params?
function Builder:add(opts)
    self.volumes[#self.volumes + 1] = {
        mesh = opts.mesh,
        x = opts.x or 0,
        y = opts.y or 0,
        z = opts.z or 0,
        type = opts.type,
        rotate = opts.rotate,
        params = opts.params
    }
    return self
end

--- Emits the collected volumes as a single object placed at `pos`.
-- The first volume carries the object; every other translate is expressed
-- relative to it, which keeps all the arithmetic above in one flat space.
function Builder:emit(pos, object_params)
    pos = pos or {}
    local first = self.volumes[1]
    local others = {}

    for i = 2, #self.volumes do
        local v = self.volumes[i]
        others[#others + 1] = {
            mesh = v.mesh,
            type = v.type,
            rotate = v.rotate,
            params = v.params,
            translate = { x = v.x - first.x, y = v.y - first.y, z = v.z - first.z }
        }
    end

    api.project:add_object {
        mesh = first.mesh,
        translate = {
            x = (pos.x or 0) + first.x,
            y = (pos.y or 0) + first.y,
            z = (pos.z or 0) + first.z
        },
        other_volumes = others,
        object_params = object_params
    }
end

return M
