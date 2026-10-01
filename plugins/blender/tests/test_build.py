"""build.py's flat_wheel: mini-racer's wheel with its package at the root, so Blender
4.2 / 4.3 (which don't map .data/purelib) install it where Python imports it.

    python3 -m pytest -q plugins/blender/tests/test_build.py
"""
import importlib.util
import pathlib
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("blender_build", HERE.parent / "build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


def test_flat_wheel_moves_the_package_to_the_root(tmp_path):
    src = tmp_path / "in" / "mini_racer-0.14.1-py3-none-any.whl"
    src.parent.mkdir()
    record = ("mini_racer-0.14.1.data/purelib/py_mini_racer/__init__.py,sha256=abc,3\n"
              "mini_racer-0.14.1.data/purelib/py_mini_racer/lib.so,sha256=def,4\n"
              "mini_racer-0.14.1.dist-info/RECORD,,\n")
    with zipfile.ZipFile(src, "w") as z:
        z.writestr("mini_racer-0.14.1.data/purelib/py_mini_racer/__init__.py", "x=1")
        z.writestr("mini_racer-0.14.1.data/purelib/py_mini_racer/lib.so", b"\0\1\2\3")
        z.writestr("mini_racer-0.14.1.dist-info/WHEEL", "Root-Is-Purelib: false\n")
        z.writestr("mini_racer-0.14.1.dist-info/RECORD", record)
    (tmp_path / "out").mkdir()
    out = build.flat_wheel(src, tmp_path / "out")
    assert out.name == src.name
    with zipfile.ZipFile(out) as z:
        assert sorted(z.namelist()) == ["mini_racer-0.14.1.dist-info/RECORD", "mini_racer-0.14.1.dist-info/WHEEL",
                                        "py_mini_racer/__init__.py", "py_mini_racer/lib.so"]
        assert z.read("py_mini_racer/lib.so") == b"\0\1\2\3"
        assert z.read("mini_racer-0.14.1.dist-info/RECORD").decode() == (
            "py_mini_racer/__init__.py,sha256=abc,3\n"
            "py_mini_racer/lib.so,sha256=def,4\n"
            "mini_racer-0.14.1.dist-info/RECORD,,\n")
