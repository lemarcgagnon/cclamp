# tree.py
from pathlib import Path
import fnmatch

DEFAULT_IGNORE_DIRS = {
    ".git", "node_modules", ".next", "dist", "build", "out",
    ".turbo", ".vercel", ".cache", "coverage",
    "__pycache__", ".pytest_cache",
}

DEFAULT_IGNORE_GLOBS = [
    "*.log", "*.tmp", "*.swp", "*.DS_Store", "Thumbs.db",
    "*.tar", "*.tar.gz", "*.tgz", "*.zip", "*.7z", "*.bz2",
    "*.pdf", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.mp4", "*.mp3",
    "tsconfig.tsbuildinfo",
    # your repo noise (tweak freely)
]

def _matches_any(name: str, rel: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(name, pat) or fnmatch.fnmatch(rel, pat) for pat in patterns)

def build_tree_lines(
    root=".",
    show_files=True,
    max_depth=6,
    ignore_dirs=None,
    ignore_globs=None,
    ignore_names=None,
) -> list[str]:
    root = Path(root).resolve()
    ignore_dirs = set(DEFAULT_IGNORE_DIRS if ignore_dirs is None else ignore_dirs)
    ignore_globs = list(DEFAULT_IGNORE_GLOBS if ignore_globs is None else ignore_globs)
    ignore_names = set(ignore_names or [])

    lines: list[str] = [root.name]

    def walk(dir_path: Path, prefix="", depth=0):
        if max_depth is not None and depth > max_depth:
            return

        try:
            entries = list(dir_path.iterdir())
        except PermissionError:
            return

        filtered = []
        for p in entries:
            rel = p.relative_to(root).as_posix()
            if p.name in ignore_names:
                continue
            if p.is_dir() and p.name in ignore_dirs:
                continue
            if _matches_any(p.name, rel, ignore_globs):
                continue
            if not show_files and p.is_file():
                continue
            filtered.append(p)

        filtered.sort(key=lambda p: (p.is_file(), p.name.lower()))

        for i, p in enumerate(filtered):
            is_last = (i == len(filtered) - 1)
            branch = "└── " if is_last else "├── "
            lines.append(prefix + branch + p.name)

            if p.is_dir():
                extension = "    " if is_last else "│   "
                walk(p, prefix + extension, depth + 1)

    walk(root)
    return lines

def print_tree(
    root=".",
    show_files=True,
    max_depth=6,
    ignore_dirs=None,
    ignore_globs=None,
    ignore_names=None,
    output_file="tree.txt",
    also_print=True,
):
    lines = build_tree_lines(
        root=root,
        show_files=show_files,
        max_depth=max_depth,
        ignore_dirs=ignore_dirs,
        ignore_globs=ignore_globs,
        ignore_names=ignore_names,
    )

    # overwrite/replace if exists
    out_path = Path(root).resolve() / output_file
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    if also_print:
        print("\n".join(lines))

if __name__ == "__main__":
    # Example: show files, depth 5, print + save to tree.txt (overwrites)
    print_tree(".", show_files=True, max_depth=5, output_file="tree.txt", also_print=True)
