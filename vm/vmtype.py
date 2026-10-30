#!/usr/bin/env python3
"""Type text into VM 222 through the QEMU monitor (US keyboard layout).
   vmtype.py 'text'        type it
   vmtype.py --key ret     press one key/combo (e.g. meta_l-r, ret, esc)"""
import subprocess, sys, os
ID = os.environ.get("ID", "222")
SHIFTED = {'~':'grave_accent','!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0',
           '_':'minus','+':'equal','{':'bracket_left','}':'bracket_right','|':'backslash',':':'semicolon',
           '"':'apostrophe','<':'comma','>':'dot','?':'slash'}
PLAIN = {' ':'spc','-':'minus','=':'equal','[':'bracket_left',']':'bracket_right','\\':'backslash',';':'semicolon',
         "'":'apostrophe',',':'comma','.':'dot','/':'slash','`':'grave_accent','\n':'ret','\t':'tab'}
def keys(text):
    for c in text:
        if c.isalpha() and c.isascii(): yield ('shift-' if c.isupper() else '') + c.lower()
        elif c.isdigit(): yield c
        elif c in PLAIN: yield PLAIN[c]
        elif c in SHIFTED: yield 'shift-' + SHIFTED[c]
        else: raise SystemExit(f"cannot type {c!r}")
if sys.argv[1] == '--key': ks = sys.argv[2:]
else: ks = list(keys(sys.argv[1]))
subprocess.run(["qm", "monitor", ID], input="".join(f"sendkey {k}\n" for k in ks), text=True, capture_output=True, check=True)
