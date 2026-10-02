"""Which parts a menu command acts on. No Cura imports, so it's tested without Cura.

The selection when there is one; with nothing selected, every part on the plate --
forgetting to click the part first was the one snag in Matthew's hand test, and Cura's
Extensions menu can't grey an item out to say so. Remove already worked this way.
"""


def usable(node):
    """A part with its own mesh. Groups are skipped (their mesh lives in the
    children) -- ungroup first."""
    return not node.callDecoration("isGroup") and node.getMeshData() is not None


def selected_parts(selected, is_fins):
    """Selected parts; a selected fins object counts as its part."""
    out = []
    for n in selected:
        if is_fins(n):
            n = n.getParent()
        if n is None or n in out or not usable(n):
            continue
        out.append(n)
    return out


def plate_parts(root_children, is_fins):
    """Every part on the plate: the scene root's sliceable children, not fins."""
    return [n for n in root_children
            if n.callDecoration("isSliceable") and not is_fins(n) and usable(n)]


def parts_to_fin(selected, root_children, is_fins):
    """(parts, message): the selection's parts, or every part on the plate when nothing
    is selected. A selection that holds no part (only a group) says so instead of
    quietly finning the whole plate."""
    if selected:
        parts = selected_parts(selected, is_fins)
        return parts, None if parts else "Groups can't get fins: ungroup the part first."
    parts = plate_parts(root_children, is_fins)
    return parts, None if parts else "Load a part onto the plate first."
