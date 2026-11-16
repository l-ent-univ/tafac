"""Make the CFF charstring widths of an OpenType/CFF font agree with hmtx.

Usage: fix_cff_widths.py in.woff2 out.woff2
Only the width operand at the head of each charstring is rewritten: outlines,
hints and every other table are left alone.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.misc.psCharStrings import T2WidthExtractor

src, dst = sys.argv[1], sys.argv[2]
font = TTFont(src)
top = font['CFF '].cff.topDictIndex[0]
assert not hasattr(top, 'FDArray'), 'CID-keyed font: not handled'
private = top.Private
nominal = private.rawDict.get('nominalWidthX', 0)
default = private.rawDict.get('defaultWidthX', 0)
local_subrs = getattr(private, 'Subrs', [])
global_subrs = font['CFF '].cff.GlobalSubrs

def width_with(cs, nom):
    ex = T2WidthExtractor(local_subrs, global_subrs, nom, default)
    ex.execute(cs)
    return ex.width

changed = 0
for name in font.getGlyphOrder():
    cs = top.CharStrings[name]
    cs.decompile()
    advance = font['hmtx'][name][0]
    # A width operand is there when the width follows nominalWidthX.
    w0, w1 = width_with(cs, 0), width_with(cs, 1000)
    has_operand = w0 != w1
    program = list(cs.program)
    if has_operand:
        assert isinstance(program[0], (int, float)) and program[0] == w0, name
        program = program[1:]
    old = (w0 + nominal) if has_operand else default
    if advance != default:
        program = [advance - nominal] + program
    if old != advance:
        changed += 1
    cs.program = program
    cs.bytecode = None  # force a recompile from the program

font.save(dst)
print(f'{src.split("/")[-1]}: {changed} widths rewritten')
