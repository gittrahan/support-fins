"""Which parts Add Support Fins acts on (scope.py): the selection, or with nothing
selected every part on the plate. Fake nodes; no Cura needed."""
import importlib.util
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("sf_scope", HERE.parent / "SupportFins" / "scope.py")
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)


class Node:
    def __init__(self, name, sliceable=True, group=False, mesh=True, parent=None):
        self.name, self.parent = name, parent
        self.deco = {"isSliceable": sliceable, "isGroup": group}
        self.mesh = object() if mesh else None

    def callDecoration(self, k):
        return self.deco.get(k)

    def getMeshData(self):
        return self.mesh

    def getParent(self):
        return self.parent


def is_fins(n):
    return n.name == "Support Fins"


a, b = Node("a"), Node("b")
fins_a = Node("Support Fins", parent=a)
group = Node("group", group=True, mesh=False)
plate_bits = Node("build plate", sliceable=None)
plate = [a, b, group, plate_bits]


def test_nothing_selected_fins_every_part_on_the_plate():
    assert scope.parts_to_fin([], plate, is_fins) == ([a, b], None)


def test_a_selection_fins_only_the_selection():
    assert scope.parts_to_fin([b], plate, is_fins) == ([b], None)


def test_selected_fins_count_as_their_part_once():
    assert scope.parts_to_fin([fins_a, a], plate, is_fins) == ([a], None)


def test_a_selected_group_says_ungroup_not_the_whole_plate():
    parts, why = scope.parts_to_fin([group], plate, is_fins)
    assert parts == [] and "ungroup" in why


def test_an_empty_plate_says_load_a_part():
    parts, why = scope.parts_to_fin([], [plate_bits], is_fins)
    assert parts == [] and "Load a part" in why
