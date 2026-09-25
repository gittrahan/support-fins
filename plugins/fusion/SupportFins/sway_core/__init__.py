"""Pure-Python sway-brace geometry: no `adsk` imports, millimetres throughout.

Ported from the Support Fins website (web/sway.js, web/planes.js, web/inside.js in
this repo). Where this port and sway.js disagree, sway.js is the reference.

Everything here works in PRINT SPACE: millimetres, z up, the bed at z = 0. The
Fusion layer (fusion_bridge.py) converts to and from Fusion's centimetres and
whatever up axis the user's bed pick implies.
"""
