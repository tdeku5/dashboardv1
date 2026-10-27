#!/usr/bin/env python3
"""Asset Class Models literal counter — the one instrument for the design revamp.

Counts hard-coded style literals in TSX/TS and CSS, in four buckets:

  colour     hex (#rgb, #rgba, #rrggbb, #rrggbbaa) and rgb()/rgba()/hsl()/hsla()
             calls, anywhere in code (TSX inline styles, Recharts props such as
             stroke="#..." / fill="#...", constant maps, CSS values).
  font-size  CSS `font-size:` and TSX `fontSize:` / `fontSize={...}` whose value
             is a bare number or a px/rem/em length. var(...) values and named
             constants (e.g. CHART_TICK_FONT_SIZE) don't count.
  spacing    CSS padding/margin/gap/row-gap/column-gap (incl. -top/-right/...),
             TSX padding*/margin*/gap keys in style objects, whose value holds a
             literal length. `0`, `auto`, `none`, `inherit` and pure var(...)
             values don't count.
  radius     CSS border*-radius and TSX borderRadius with a literal value
             (`0` and `50%` don't count). Reported separately from the three
             Phase 0 buckets.

How TSX is read: comments are stripped, then the patterns above run over the
whole source, so inline `style={{...}}` objects, Recharts props and module
constants are all caught. Recharts layout props — `margin={{ top, ... }}` on a
chart, width, height, strokeWidth, minTickGap, dash arrays — are layout, not
style literals (Phase 3 rule 3), and are not counted: chart `margin` keys
(top/right/bottom/left) aren't in the spacing pattern.

CSS is read rule by rule after stripping comments; --css-select keeps only the
rules whose selector list contains a matching selector.

Usage
  acm-literals.py FILE [FILE ...] [--lines A-B] [--css-select REGEX] [-v]
  acm-literals.py --section [--rev REV] [-v]

  --lines A-B      count only lines A..B (1-based, inclusive) of a single file
  --css-select RE  CSS only: count only rules whose selector matches RE
  --section        every file reachable by relative import (TS/TSX/CSS) from
                   client/src/pages/STIRDashboardPage.tsx, minus the
                   definition layer (components/acm/, styles/acm-tokens.css,
                   constants/identityColors.ts), which is reported on its own
  --rev REV        read the tree at git revision REV (via `git archive` into a
                   temp dir; the working tree is never touched)
  -v               list every literal found
"""
import os
import re
import subprocess
import sys
import tarfile
import tempfile
from io import BytesIO

LEN = r'-?\d*\.?\d+(?:px|rem|em)?'
COLOR = re.compile(r'#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|\b(?:rgba?|hsla?)\(')
CSS_FONT = re.compile(r'font-size\s*:\s*(?!var\()(' + LEN + r')')
CSS_SPACE = re.compile(r'(?:^|[;{\s])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block))?\s*:\s*([^;}]*)')
CSS_RADIUS = re.compile(r'border(?:-[a-z]+)*-radius\s*:\s*([^;}]*)')
TSX_FONT = re.compile(r'fontSize\s*[:=]\s*\{?\s*[\'"]?(' + LEN + r')')
TSX_SPACE = re.compile(r'\b(?:padding|margin|gap)(?:Top|Right|Bottom|Left|Inline|Block)?\s*:\s*([\'"][^\'"]*[\'"]|-?\d*\.?\d+)')
TSX_RADIUS = re.compile(r'\bborderRadius\s*:\s*([\'"][^\'"]*[\'"]|\d*\.?\d+)')
BUCKETS = ('colour', 'font-size', 'spacing', 'radius')
DEFINITION_LAYER = re.compile(r'^(components/acm/|styles/acm-tokens\.css$|constants/identityColors\.ts$)')
SECTION_ROOT = 'pages/STIRDashboardPage.tsx'


def strip_comments(src: str, css: bool) -> str:
    src = re.sub(r'/\*[\s\S]*?\*/', '', src)
    if not css:
        src = re.sub(r'(^|[^:\'"`])//.*$', r'\1', src, flags=re.M)
    return src


def count(src: str, css: bool, css_select: str | None = None) -> dict[str, list[str]]:
    src = strip_comments(src, css)
    if css and css_select:
        sel = re.compile(css_select)
        src = '\n'.join(m.group(0) for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', src)
                        if any(sel.search(s.strip()) for s in m.group(1).split(',')))
    font, space, radius = (CSS_FONT, CSS_SPACE, CSS_RADIUS) if css else (TSX_FONT, TSX_SPACE, TSX_RADIUS)
    spaces = []
    for m in space.finditer(src):
        v = m.group(1).strip().strip('\'"')
        if v in ('', '0', 'auto', '0 auto', 'none', 'inherit'):
            continue
        if 'var(' in v and not re.search(r'(?<![\w-])\d*\.?\d+(px|rem|em)', re.sub(r'var\([^)]*\)', '', v)):
            continue
        spaces.append(v)
    radii = [v for v in (m.group(1).strip().strip('\'"') for m in radius.finditer(src))
             if 'var(' not in v and v not in ('0', '50%')]
    return {
        'colour': [m.group(0) for m in COLOR.finditer(src)],
        'font-size': [m.group(1) for m in font.finditer(src)],
        'spacing': spaces,
        'radius': radii,
    }


def fmt(c: dict[str, list[str]]) -> str:
    n = {k: len(v) for k, v in c.items()}
    return (f"colour {n['colour']:4}  font-size {n['font-size']:3}  spacing {n['spacing']:3}  "
            f"= {n['colour'] + n['font-size'] + n['spacing']:4}   (+ radius {n['radius']})")


def section_files(src_root: str) -> list[str]:
    imp = re.compile(r'(?:import\s[^\'"]*?from\s*|import\s*\(\s*|import\s*|export\s[^\'"]*?from\s*)[\'"](\.{1,2}/[^\'"]+)[\'"]')
    seen: set[str] = set()
    stack = [os.path.join(src_root, SECTION_ROOT)]
    while stack:
        f = stack.pop()
        if f in seen:
            continue
        seen.add(f)
        if f.endswith('.css'):
            continue
        for m in imp.finditer(open(f, encoding='utf8').read()):
            base = os.path.normpath(os.path.join(os.path.dirname(f), m.group(1)))
            for c in (base + '.tsx', base + '.ts', base, base + '/index.ts', base + '/index.tsx'):
                if os.path.isfile(c) and re.search(r'\.(tsx?|css)$', c):
                    stack.append(c)
                    break
    rel = sorted(os.path.relpath(f, src_root).replace(os.sep, '/') for f in seen)
    return [f for f in rel if not re.search(r'\.test\.|__fixtures__', f)]


def extract_rev(rev: str) -> str:
    repo = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
    data = subprocess.check_output(['git', '-C', repo, 'archive', rev, 'client/src'])
    out = tempfile.mkdtemp(prefix=f'acm-literals-{rev}-')
    with tarfile.open(fileobj=BytesIO(data)) as t:
        t.extractall(out, filter='data')
    return out


def main(argv: list[str]) -> None:
    verbose = '-v' in argv
    opt = lambda k: argv[argv.index(k) + 1] if k in argv else None
    rev = opt('--rev')
    repo_root = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
    base = extract_rev(rev) if rev else repo_root
    src_root = os.path.join(base, 'client/src')

    if '--section' in argv:
        files = section_files(src_root)
        groups = {'section TSX/TS': [], 'section CSS': [], 'definition layer': []}
        print(f"{'file':58} literals  [{'rev ' + rev if rev else 'working tree'}]")
        for f in files:
            css = f.endswith('.css')
            c = count(open(os.path.join(src_root, f), encoding='utf8').read(), css)
            key = 'definition layer' if DEFINITION_LAYER.search(f) else ('section CSS' if css else 'section TSX/TS')
            groups[key].append(c)
            if sum(len(v) for v in c.values()):
                print(f"{f:58} {fmt(c)}")
        print('-' * 120)
        for key, cs in groups.items():
            tot = {b: [x for c in cs for x in c[b]] for b in BUCKETS}
            print(f"{key + f' ({len(cs)} files)':58} {fmt(tot)}")
        return

    files = [a for a in argv if not a.startswith('-') and a not in (opt('--lines'), opt('--css-select'), rev)]
    for f in files:
        path = f if os.path.isabs(f) or os.path.exists(f) else os.path.join(src_root, f)
        src = open(path, encoding='utf8').read()
        if opt('--lines'):
            a, b = map(int, opt('--lines').split('-'))
            src = '\n'.join(src.split('\n')[a - 1:b])
        c = count(src, path.endswith('.css'), opt('--css-select'))
        print(f"{f}: {fmt(c)}")
        if verbose:
            for k in BUCKETS:
                print(f"  {k}: {c[k]}")


if __name__ == '__main__':
    main(sys.argv[1:])
