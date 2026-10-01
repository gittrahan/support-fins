import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location('blender_build', Path(__file__).resolve().parents[1] / 'build.py')
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)

class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tree = self.root / 'addon'
        build.stage(self.tree)

    def test_engine_is_current_checkout_and_zip_is_executable(self):
        provenance = json.loads((self.tree / 'engine-provenance.json').read_text())
        self.assertTrue(any(name.startswith('fins/') for name in provenance['web_sha256']))
        for name, digest in provenance['web_sha256'].items():
            self.assertEqual(build.digest(build.ROOT / 'web' / name), digest)
            self.assertEqual(build.digest(self.tree / 'engine/web' / name), digest)
        executable = self.tree / 'runtime/linux-x64/node'
        executable.parent.mkdir(parents=True)
        executable.write_bytes(b'test fixture')
        archive = self.root / 'addon.zip'
        build.write_zip(self.tree, archive)
        with zipfile.ZipFile(archive) as z:
            self.assertEqual((z.getinfo('runtime/linux-x64/node').external_attr >> 16) & 0o777, 0o755)
            self.assertIn('blender_manifest.toml', z.namelist())
            self.assertFalse(any('__pycache__' in n for n in z.namelist()))

    def test_rejects_wrong_runtime(self):
        binary = self.root / 'windows-x64/node.exe'
        binary.parent.mkdir()
        binary.write_bytes(b'not the pinned runtime')
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            build.runtime('windows-x64', self.root)

    def test_bridge_flat_cube_and_three_strength_poses(self):
        node = os.environ.get('NODE') or shutil.which('node')
        self.assertTrue(node, 'Install Node or set NODE to its executable')
        v = [(-10,-10,0),(10,-10,0),(10,10,0),(-10,10,0),(-10,-10,20),(10,-10,20),(10,10,20),(-10,10,20)]
        faces = [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
        item = {'id':'cube','positions':[x for f in faces for i in f for x in v[i]],'loadDefined':True,'load':[0,0,1]}
        def run(action):
            request = self.root / 'request.json'
            output = self.root / 'output.json'
            request.write_text(json.dumps({'action':action,'threshold':45,'items':[item]}))
            subprocess.run([node,str(self.tree/'engine/bridge.mjs'),str(request),str(output)],check=True,timeout=120)
            return json.loads(output.read_text())['results'][0]
        stats = run('analyze')['stats']
        self.assertEqual(stats['regions'],0)
        self.assertAlmostEqual(stats['bedArea'],400)
        candidates = run('strength')['candidates']
        self.assertEqual(len(candidates),3)
        self.assertLess(candidates[0]['load']['cross'],0.01)
        self.assertTrue(all(len(c['rot'])==9 for c in candidates))

if __name__ == '__main__':
    unittest.main()
