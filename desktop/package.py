"""Create the Windows demo ZIP from an official embeddable CPython ZIP."""

import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

ROOT = Path(__file__).resolve().parent
WEB = ROOT.parent / "app" / "src" / "main" / "assets" / "www"
ASSETS = WEB.parent
PREFIX = "Avatar Chat/"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("runtime", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--llama-dir", required=True, type=Path)
    parser.add_argument("--vendor-dir", required=True, type=Path)
    args = parser.parse_args()
    with ZipFile(args.runtime) as runtime, ZipFile(args.output, "w", ZIP_DEFLATED) as output:
        for name in ("Start.cmd", "desktop.py", "Readme.txt", "local_chat.py", "offline_speech.py",
                     "melo_korean.py", "cloud_speech.py"):
            output.write(ROOT / name, PREFIX + name)
        for name in ("app.js", "style.css"):
            output.write(WEB / name, PREFIX + "www/" + name)
        html = (WEB / "index.html").read_text(encoding="utf-8")
        output.writestr(PREFIX + "www/index.html", html.replace('<html lang="ko">', '<html lang="ko" data-avatar-desktop>', 1))
        for entry in runtime.infolist():
            if not entry.is_dir():
                data = runtime.read(entry)
                if entry.filename.endswith("._pth"):
                    data = data + b"\n..\nvendor\n"
                output.writestr(PREFIX + "runtime/" + entry.filename, data)
        for path in args.vendor_dir.rglob("*"):
            relative = path.relative_to(args.vendor_dir)
            if path.is_file() and "__pycache__" not in relative.parts and relative.parts[0] != "bin":
                output.write(path, PREFIX + "runtime/vendor/" + relative.as_posix())
        for path in args.llama_dir.iterdir():
            if path.is_file() and (path.suffix == ".dll" or path.name == "llama-server.exe"
                                   or path.name.startswith("LICENSE")):
                output.write(path, PREFIX + "llama/" + path.name)
        for path in (ASSETS / "tts").iterdir():
            if path.is_file():
                compression = ZIP_STORED if path.name.endswith(".bz2") else ZIP_DEFLATED
                output.write(path, PREFIX + "tts/" + path.name, compress_type=compression)
        for path in (ASSETS / "licenses").iterdir():
            if path.is_file():
                output.write(path, PREFIX + "licenses/" + path.name)


if __name__ == "__main__":
    main()
