"""Exercise the builder's actual checksum/extraction boundary with tiny archives."""
import hashlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest


HELPER = Path(__file__).resolve().parents[1] / 'guest/archive.sh'


def archive_bytes(entries, mode='w:gz'):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode=mode) as archive:
        for name, content, kind in entries:
            entry = tarfile.TarInfo(name)
            if kind == 'link':
                entry.type = tarfile.SYMTYPE
                entry.linkname = content
                archive.addfile(entry)
            else:
                entry.size = len(content)
                archive.addfile(entry, io.BytesIO(content))
    return output.getvalue()


def source_bytes(mode='w:gz'):
    return archive_bytes([('source/marker', b'trusted', 'file')], mode)


def digest(data):
    return hashlib.sha256(data).hexdigest()


class ArchiveIntegrity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def prepare(self, data, expected=None, root=None):
        root = root or self.root
        (root / 'source.tar').write_bytes(data)
        return subprocess.run(
            ['sh', '-c', '. "$1"; prepare_source source.tar source "$2"',
             'archive-test', str(HELPER), expected or digest(data)],
            cwd=root, capture_output=True, text=True,
        )

    def assert_clean(self):
        self.assertFalse((self.root / 'source').exists())
        self.assertEqual(list(self.root.glob('.source-*')), [])

    def test_supported_formats_and_warm_cache(self):
        for mode in ['w:gz', 'w:xz', 'w:bz2']:
            with self.subTest(mode=mode):
                root = self.root / mode.replace(':', '-')
                root.mkdir()
                data = source_bytes(mode)
                result = self.prepare(data, root=root)
                self.assertEqual(result.returncode, 0, result.stderr)
                marker = root / 'source/marker'
                self.assertEqual(marker.read_bytes(), b'trusted')
                # A warm build must keep its compilation outputs.
                (root / 'source/compiled').write_text('cached build')
                before = marker.stat().st_mtime_ns
                result = self.prepare(data, root=root)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(marker.stat().st_mtime_ns, before)
                self.assertEqual((root / 'source/compiled').read_text(), 'cached build')
                # Even with a source tree present, a corrupted archive fails.
                self.assertNotEqual(self.prepare(b'corrupted', digest(data), root).returncode, 0)

    def test_self_replacing_archive_cannot_bypass_checksum(self):
        clean = source_bytes()
        malicious = archive_bytes([
            ('source/marker', b'unverified', 'file'),
            ('original.tar', clean, 'file'),
            ('source.tar', 'original.tar', 'link'),
        ])
        # Establish that this fixture reproduces the old extract-then-check bug.
        legacy = self.root / 'legacy'
        legacy.mkdir()
        (legacy / 'source.tar').write_bytes(malicious)
        subprocess.run(['tar', 'xf', 'source.tar'], cwd=legacy, check=True)
        self.assertEqual(digest((legacy / 'source.tar').read_bytes()), digest(clean))
        self.assertEqual((legacy / 'source/marker').read_bytes(), b'unverified')

        result = self.prepare(malicious, digest(clean))
        self.assertNotEqual(result.returncode, 0)
        self.assert_clean()
        self.assertFalse((self.root / 'original.tar').exists())
        self.assertFalse((self.root / 'source.tar').is_symlink())
        self.assertEqual((self.root / 'source.tar').read_bytes(), malicious)

    def test_bad_digest_then_legitimate_retry(self):
        clean = source_bytes()
        malicious = archive_bytes([('source/marker', b'unverified', 'file')])
        # A server-supplied checksum matching the bad download is not a pin.
        (self.root / 'sha256sums.asc').write_text(digest(malicious) + '  source.tar\n')
        self.assertNotEqual(self.prepare(malicious, digest(clean)).returncode, 0)
        self.assert_clean()
        self.assertEqual(self.prepare(clean).returncode, 0)
        self.assertEqual((self.root / 'source/marker').read_bytes(), b'trusted')

    def test_concurrent_download_cannot_replace_verified_input(self):
        clean = source_bytes()
        (self.root / 'source.tar').write_bytes(clean)
        (self.root / 'replacement.tar').write_bytes(archive_bytes([
            ('source/marker', b'unverified', 'file'),
        ]))
        tools = self.root / 'tools'
        tools.mkdir()
        checker = tools / 'sha256sum'
        # Model a second builder's delayed download completing immediately
        # after the first builder's real checksum check has succeeded.
        checker.write_text('''#!/bin/sh
"$REAL_SHA256SUM" "$@" || exit "$?"
cp replacement.tar source.tar
''')
        checker.chmod(0o755)
        env = dict(os.environ, REAL_SHA256SUM=shutil.which('sha256sum'),
                   PATH=str(tools) + os.pathsep + os.environ['PATH'])
        result = subprocess.run(
            ['sh', '-c', '. "$1"; prepare_source source.tar source "$2"',
             'archive-race', str(HELPER), digest(clean)],
            cwd=self.root, env=env, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotEqual(digest((self.root / 'source.tar').read_bytes()), digest(clean))
        self.assertEqual((self.root / 'source/marker').read_bytes(), b'trusted')

    def test_incomplete_extraction_is_not_published(self):
        # The first member is extracted before tar discovers the truncated one.
        partial = archive_bytes([
            ('source/marker', b'partial', 'file'),
            ('source/large', b'x' * 4096, 'file'),
        ], 'w')[:2048]
        result = self.prepare(partial)
        self.assertNotEqual(result.returncode, 0)
        self.assert_clean()
        self.assertEqual(self.prepare(source_bytes()).returncode, 0)
        self.assertEqual((self.root / 'source/marker').read_bytes(), b'trusted')

    def test_missing_expected_root_is_not_cached(self):
        data = archive_bytes([('other/marker', b'wrong root', 'file')])
        self.assertNotEqual(self.prepare(data).returncode, 0)
        self.assert_clean()
        self.assertFalse((self.root / 'other').exists())

    def test_symlink_source_root_is_not_cached(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'marker').write_text('untouched')
        data = archive_bytes([('source', str(outside), 'link')])
        self.assertNotEqual(self.prepare(data).returncode, 0)
        self.assert_clean()
        self.assertEqual((outside / 'marker').read_text(), 'untouched')


if __name__ == '__main__':
    unittest.main(verbosity=2)
