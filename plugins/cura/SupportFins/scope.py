"""Which parts a menu command acts on. No Cura imports, so it's tested without Cura.

The selection when there is one; with nothing selected, every part on the plate --
forgetting to click the part first was the one snag in Matthew's hand test, and Cura's
Extensions menu can't grey an item out to say so. Remove already worked this way.
Groups can't be finned (their mesh lives in the children), and they are named in the
report rather than skipped in silence.
"""


def is_group(node):
    return bool(node.callDecoration("isGroup"))


def usable(node):
    """A part with its own mesh (not a group)."""
    return not is_group(node) and node.getMeshData() is not None


def prints(node):
    """A mesh Cura prints as a part. Support blockers, support / infill / cutting meshes
    are sliceable too (their Mesh Type is a per-object setting), but fins under them
    would be plastic under nothing."""
    return not node.callDecoration("isNonPrintingMesh") and not node.callDecoration("isSupportMesh")


def _group_note(node):
    return f"{node.getName()}: a group, ungroup it to give it fins"


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
    """Every printing part on the plate: the scene root's sliceable children, not fins."""
    return [n for n in root_children
            if n.callDecoration("isSliceable") and not is_fins(n) and usable(n) and prints(n)]


def parts_to_fin(selected, root_children, is_fins):
    """(parts, message, notes): the selection's parts, or every part on the plate when
    nothing is selected. `message` says why there is nothing to fin; `notes` name the
    groups left out, for the report."""
    pool = selected if selected else root_children
    notes = [_group_note(n) for n in pool if is_group(n)]
    if selected:
        parts = selected_parts(selected, is_fins)
        return parts, None if parts else "Groups can't get fins: ungroup the part first.", notes
    parts = plate_parts(root_children, is_fins)
    if parts or notes:
        return parts, None if parts else "Groups can't get fins: ungroup the part first.", notes
    return parts, "Load a part onto the plate first.", notes
