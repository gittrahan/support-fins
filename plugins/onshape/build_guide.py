"""Support-Fins FS user guide, styled to match VectorRuler_User_Guide.pdf."""
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import Color, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
                                TableStyle, KeepTogether, CondPageBreak)
from reportlab.graphics.shapes import Drawing, Polygon, Line, String, Rect, Circle, Ellipse, Wedge
from reportlab.lib.units import inch

import os
# Writes the PDF next to this script:  python build_guide.py   (needs: pip install reportlab)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "SupportFins_User_Guide.pdf")
NAME = "Support-Fins FS"

# ── palette, sampled from VectorRuler_User_Guide.pdf ──
PRIMARY = Color(0.180392, 0.423529, 0.619608)
TITLE = Color(0.121569, 0.305882, 0.474510)
TEXT = Color(0.101961, 0.101961, 0.101961)
FOOT = Color(0.478431, 0.478431, 0.478431)
NOTE_BG = Color(0.992157, 0.952941, 0.890196)
NOTE_FG = Color(0.690196, 0.478431, 0.086275)
ALT = Color(0.929412, 0.949020, 0.968627)
GRID = Color(0.784314, 0.831373, 0.878431)
ORANGE = Color(1.0, 0.55, 0.1)
ORANGE_DK = Color(0.70, 0.35, 0.0)
PART = Color(0.62, 0.74, 0.86)
PART_DK = Color(0.25, 0.40, 0.56)
ICON = Color(0.30, 0.30, 0.30)

LM = RM = 0.8 * inch
W, H = letter
CW = W - LM - RM

body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=13.8, textColor=TEXT,
                      alignment=TA_JUSTIFY, spaceAfter=7, leftIndent=8, rightIndent=8)
cell = ParagraphStyle("cell", fontName="Helvetica", fontSize=8.5, leading=11.5, textColor=TEXT)
cellb = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold")
head = ParagraphStyle("head", parent=cell, fontName="Helvetica-Bold", textColor=white, alignment=TA_CENTER)
note = ParagraphStyle("note", fontName="Helvetica-Oblique", fontSize=9, leading=12.5, textColor=NOTE_FG)
sub = ParagraphStyle("sub", fontName="Helvetica-Bold", fontSize=11.5, leading=14, textColor=PRIMARY,
                     spaceBefore=8, spaceAfter=3, leftIndent=8)
bullet = ParagraphStyle("bullet", parent=body, leftIndent=26, bulletIndent=14, spaceAfter=4)
caption = ParagraphStyle("caption", fontName="Helvetica-Oblique", fontSize=8, leading=10, textColor=FOOT,
                         alignment=TA_CENTER, spaceAfter=8)
copy = ParagraphStyle("copy", parent=body, fontSize=9, alignment=TA_LEFT, spaceAfter=10)
ARROW = '<font name="Symbol">\u2192</font>'

story = []
P = lambda t, s=body: story.append(Paragraph(t, s))


def section(num, title):
    t = Table([[Paragraph(f"{num}&nbsp;&nbsp;{title}",
                          ParagraphStyle("sec", fontName="Helvetica-Bold", fontSize=12, leading=14,
                                         textColor=white))]], colWidths=[CW])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PRIMARY),
                           ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 5),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story.append(CondPageBreak(1.3 * inch))
    story.append(Spacer(1, 8))
    story.append(t)
    story.append(Spacer(1, 8))


def subsection(title, intro=None):
    story.append(CondPageBreak(1.0 * inch))
    P(title.replace("  ", "&nbsp;&nbsp;"), sub)
    if intro:
        P(intro)


def notebox(text, label="Note:"):
    t = Table([[Paragraph(f"<b>{label}</b> {text}", note)]], colWidths=[CW - 20])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), NOTE_BG),
                           ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                           ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story.append(Spacer(1, 2))
    story.append(t)
    story.append(Spacer(1, 10))


def steps(rows):
    data = [[Paragraph(f"<b>{i + 1}</b>", cell), Paragraph(r, cell)] for i, r in enumerate(rows)]
    t = Table(data, colWidths=[28, CW - 44])
    st = [("GRID", (0, 0), (-1, -1), 0.5, GRID), ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
          ("LEFTPADDING", (0, 0), (-1, -1), 7)]
    for i in range(1, len(rows), 2):
        st.append(("BACKGROUND", (0, i), (-1, i), ALT))
    t.setStyle(TableStyle(st))
    story.append(t)
    story.append(Spacer(1, 10))


def table(header, rows, widths):
    data = [[Paragraph(h, head) for h in header]]
    for r in rows:
        data.append([Paragraph(r[0], cellb)] + [Paragraph(c, cell) for c in r[1:]])
    tw = sum(widths)
    t = Table(data, colWidths=[w * (CW - 16) / tw for w in widths], repeatRows=1)
    st = [("GRID", (0, 0), (-1, -1), 0.5, GRID), ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
          ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 5),
          ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("LEFTPADDING", (0, 0), (-1, -1), 7),
          ("RIGHTPADDING", (0, 0), (-1, -1), 7)]
    for i in range(2, len(data), 2):
        st.append(("BACKGROUND", (0, i), (-1, i), ALT))
    t.setStyle(TableStyle(st))
    story.append(t)
    story.append(Spacer(1, 10))


def bullets(items):
    for it in items:
        story.append(Paragraph(it, bullet, bulletText="\u2022"))
    story.append(Spacer(1, 4))


# ── diagrams ──────────────────────────────────────────────────────────────────

def label(d, x, y, text, size=7.5, anchor="start", color=TEXT, bold=False):
    d.add(String(x, y, text, fontName="Helvetica-Bold" if bold else "Helvetica", fontSize=size,
                 fillColor=color, textAnchor=anchor))


def leader(d, x0, y0, x1, y1):
    d.add(Line(x0, y0, x1, y1, strokeColor=FOOT, strokeWidth=0.5))


def rib_diagram():
    """Side view of a rib under a sloped overhang, plus its cross-section."""
    d = Drawing(CW, 200)
    # ---- side view ----
    bed = 40
    d.add(Rect(10, bed - 6, 300, 6, fillColor=Color(0.6, 0.62, 0.66), strokeColor=None))
    label(d, 14, bed - 16, "build plate", 7, color=FOOT)
    # part: sloped underside from (40,bed+8) rising to (290,bed+118)
    ux0, uy0, ux1, uy1 = 40, bed + 10, 290, bed + 120
    slope = (uy1 - uy0) / (ux1 - ux0)
    d.add(Polygon([ux0, uy0, ux1, uy1, ux1, 192, ux0 - 25, 192, ux0 - 25, uy0 + 20],
                  fillColor=PART, strokeColor=PART_DK, strokeWidth=0.8))
    label(d, 70, 170, "part", 9, color=PART_DK, bold=True)
    gap = 7
    ra, rb = 95, 275
    top = lambda x: uy0 + (x - ux0) * slope - gap
    # rib body
    d.add(Polygon([ra, bed, ra, top(ra), rb, top(rb), rb, bed], fillColor=ORANGE,
                  strokeColor=ORANGE_DK, strokeWidth=0.6))
    # flange
    d.add(Rect(ra, bed, rb - ra, 5, fillColor=ORANGE_DK, strokeColor=None))
    # tines: small blocks bridging the gap, denser at the ends
    for x in (100, 108, 116, 150, 185, 220, 250, 258):
        y = top(x)
        d.add(Rect(x - 2.5, y - 1, 6, gap + 3, fillColor=ORANGE_DK, strokeColor=None))
    # annotations
    import math
    from reportlab.graphics.shapes import Group
    ang = math.degrees(math.atan(slope))
    gx = 185
    g = Group(String(0, 0, "overhang (underside)", fontName="Helvetica", fontSize=7, fillColor=PART_DK))
    g.transform = (math.cos(math.radians(ang)), math.sin(math.radians(ang)),
                   -math.sin(math.radians(ang)), math.cos(math.radians(ang)),
                   gx, uy0 + (gx - ux0) * slope + 5)
    d.add(g)
    leader(d, 135, top(135) + gap / 2, 150, 165)
    label(d, 118, 167, "breakaway gap", 7)
    leader(d, 108, top(108) + 4, 60, 122)
    label(d, 14, 125, "tines (one layer)", 7)
    leader(d, 230, bed + 3, 240, bed - 12)
    label(d, 200, bed - 20, "flange on the plate", 7)
    label(d, 185, bed + 40, "rib", 9, color=white, bold=True)
    label(d, 160, 4, "Side view: the rib top follows the underside", 7.5, anchor="middle", color=FOOT)

    # ---- cross-section ----
    ox, oy = 390, bed
    d.add(Rect(ox - 60, oy - 6, 120, 6, fillColor=Color(0.6, 0.62, 0.66), strokeColor=None))
    d.add(Rect(ox - 45, oy + 118, 90, 40, fillColor=PART, strokeColor=PART_DK, strokeWidth=0.8))
    label(d, ox, oy + 140, "part", 8, anchor="middle", color=PART_DK, bold=True)
    stem, tip = 10, 6
    d.add(Polygon([ox - 30, oy, ox + 30, oy, ox + 30, oy + 7, ox + stem, oy + 7, ox + stem, oy + 88,
                   ox + tip, oy + 88, ox + tip, oy + 111, ox - tip, oy + 111, ox - tip, oy + 88,
                   ox - stem, oy + 88, ox - stem, oy + 7, ox - 30, oy + 7],
                  fillColor=ORANGE, strokeColor=ORANGE_DK, strokeWidth=0.6))
    for (x, y, t, a) in [(ox + 36, oy + 106, "tip 0.6 mm, top 1.5 mm", "start"),
                         (ox + 36, oy + 60, "stem 1.0 mm", "start"),
                         (ox + 36, oy + 10, "flange: base height", "start"),
                         (ox + 36, oy + 122, "gap", "start")]:
        label(d, x, y, t, 7, anchor=a)
    leader(d, ox + tip, oy + 108, ox + 34, oy + 108)
    leader(d, ox + stem, oy + 62, ox + 34, oy + 62)
    leader(d, ox + 30, oy + 5, ox + 34, oy + 12)
    leader(d, ox + 8, oy + 114, ox + 34, oy + 124)
    label(d, ox + 10, 4, "Cross-section: an upside-down T", 7.5, anchor="middle", color=FOOT)
    return d


def fin_diagram():
    """Section through a side fin standing beside a leaning face."""
    d = Drawing(CW, 175)
    bed = 28
    d.add(Rect(40, bed - 6, 400, 6, fillColor=Color(0.6, 0.62, 0.66), strokeColor=None))
    label(d, 44, bed - 16, "build plate", 7, color=FOOT)
    # part: leaning face from (150,bed) to (215,bed+130); part to the left
    fx0, fy0, fx1, fy1 = 150, bed, 215, bed + 130
    d.add(Polygon([fx0, fy0, fx1, fy1, 90, fy1 + 10, 50, bed + 40], fillColor=PART,
                  strokeColor=PART_DK, strokeWidth=0.8))
    label(d, 105, bed + 90, "part", 9, color=PART_DK, bold=True)
    # wall parallel to the face, offset outward
    import math
    dx, dy = fx1 - fx0, fy1 - fy0
    L = math.hypot(dx, dy)
    nx, ny = dy / L, -dx / L   # outward normal (to the right/down)
    g, th = 6, 11
    def off(x, y, w):
        return x + nx * w, y + ny * w
    a0 = off(fx0, fy0, g); a1 = off(fx1 - dx * 0.1, fy1 - dy * 0.1, g)
    b1 = off(fx1 - dx * 0.1, fy1 - dy * 0.1, g + th); b0 = off(fx0, fy0, g + th)
    # clip bottom to the plate: extend to y=bed along the face direction
    def to_bed(p):
        k = (p[1] - bed) / dy
        return p[0] - dx * k, bed
    a0 = to_bed(a0); b0 = to_bed(b0)
    d.add(Polygon([a0[0], a0[1], a1[0], a1[1], b1[0], b1[1], b0[0], b0[1]], fillColor=ORANGE,
                  strokeColor=ORANGE_DK, strokeWidth=0.6))
    cx, cy = (a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2
    d.add(Circle(cx, cy, th / 2, fillColor=ORANGE, strokeColor=None))
    # base on the plate, outboard
    d.add(Rect(a0[0] - 2, bed, 95, 7, fillColor=ORANGE_DK, strokeColor=None))
    # tine rows: horizontal, denser low
    for y in (bed + 14, bed + 22, bed + 30, bed + 38, bed + 48, bed + 64, bed + 88):
        k = (y - fy0) / dy
        xf = fx0 + dx * k
        d.add(Rect(xf - 4, y, (g + th * 0.5) + 6, 2.2, fillColor=ORANGE_DK, strokeColor=None))
    label(d, 262, bed + 128, "side fin wall, rounded top", 7)
    leader(d, cx + 4, cy, 258, bed + 130)
    label(d, 262, bed + 70, "tines: horizontal, one layer each,", 7)
    label(d, 262, bed + 61, "denser near the plate", 7)
    leader(d, fx0 + dx * (64 / dy) + 10, bed + 65, 258, bed + 68)
    label(d, 262, bed + 30, "gap to the face", 7)
    leader(d, fx0 + dx * (26 / dy) + 4, bed + 26, 258, bed + 32)
    label(d, 262, bed + 4, "oval base, pushed away from the part", 7)
    leader(d, a0[0] + 80, bed + 4, 258, bed + 7)
    label(d, 240, 4, "Section across a side fin: it leans with the face it holds", 7.5, anchor="middle", color=FOOT)
    return d


def fig(d, text):
    story.append(KeepTogether([d, Paragraph(text, caption)]))


# ── page furniture ────────────────────────────────────────────────────────────

def draw_icon(c, x, y, s):
    """The feature icon (supportFins-icon.svg), drawn at scale s from a 24-unit box at (x, y)."""
    def pt(px, py):
        return x + px * s, y + (24 - py) * s
    c.saveState()
    c.setFillColor(ICON)
    c.setStrokeColor(ICON)
    c.rect(*pt(2, 21.5), 20 * s, 1.5 * s, stroke=0, fill=1)
    for poly in ([(11, 20), (11, 18.35), (12.8, 16.85), (12.8, 20)],
                 [(13.8, 20), (13.8, 16), (15.6, 14.5), (15.6, 20)]):
        p = c.beginPath()
        pts = [pt(px + 3.2, py) for px, py in poly]
        p.moveTo(*pts[0])
        for q in pts[1:]:
            p.lineTo(*q)
        p.close()
        c.drawPath(p, stroke=0, fill=1)
    c.setLineWidth(1.5 * s)
    c.setLineJoin(1)
    p = c.beginPath()
    pts = [pt(px + 3.2, py) for px, py in [(7.5, 19.2), (15.16, 12.77), (8.73, 5.11), (1.07, 11.54)]]
    p.moveTo(*pts[0])
    for q in pts[1:]:
        p.lineTo(*q)
    p.close()
    c.drawPath(p, stroke=1, fill=0)
    c.restoreState()


def footer(c, doc):
    c.saveState()
    c.setStrokeColor(GRID)
    c.setLineWidth(0.5)
    c.line(LM + 3.6, 51.84, W - RM - 3.6, 51.84)
    c.setFont("Helvetica", 7.5)
    c.setFillColor(FOOT)
    c.drawCentredString(W / 2, 38, f"{NAME} \u2014 User Guide \u2014 Southeast Expedition Medical, LLC \u2014 2026")
    c.restoreState()


def first_page(c, doc):
    c.saveState()
    c.setFont("Helvetica-Bold", 20)
    c.setFillColor(TITLE)
    c.drawCentredString(W / 2, H - 91, NAME)
    c.setFont("Helvetica", 10)
    c.setFillColor(PRIMARY)
    c.drawString(LM + 2, H - 104, f"{NAME}  \u2022  User Guide")
    draw_icon(c, W - RM - 36, H - 106, 1.5)
    c.setFillColor(PRIMARY)
    c.rect(LM, H - 113, CW, 3, stroke=0, fill=1)
    c.restoreState()
    footer(c, doc)


doc = BaseDocTemplate(OUT, pagesize=letter, leftMargin=LM, rightMargin=RM, topMargin=0.75 * inch,
                      bottomMargin=0.95 * inch, title=f"{NAME} - User Guide",
                      author="Chris Lee, Southeast Expedition Medical, LLC",
                      subject="Onshape custom feature: designed-in breakaway support fins")
doc.addPageTemplates([
    PageTemplate(id="first", frames=[Frame(LM, 0.95 * inch, CW, H - 0.95 * inch - 122, id="f1")],
                 onPage=first_page),
    PageTemplate(id="rest", frames=[Frame(LM, 0.95 * inch, CW, H - 1.7 * inch, id="f2")], onPage=footer),
])
from reportlab.platypus import NextPageTemplate
story.append(NextPageTemplate("rest"))

# ══════════════════════════════════════════════════════════════════════════════
P("Copyright \u00a9 2026 Chris Lee, Southeast Expedition Medical, LLC. Released under the MIT License. "
  "Fin geometry ported from <b>support-fins</b> by Matthew Trahan (MIT License).", copy)

section(1, "Overview")
P(f"<b>{NAME}</b> is a custom feature for your Onshape Part Studio toolbar. It adds breakaway supports "
  "to a part as real geometry, so the part can be printed in a strong tilted orientation with the "
  "slicer's own supports turned off. Because the supports are part of the model, they come out the same "
  "in any slicer, on any printer, in any filament.")
P("Printing a part flat is often its weakest orientation; tilting it can make it several times stronger, "
  "but a tilted part normally needs slicer supports that scar the surface and are slow to pick off. "
  "This feature adds the supports that make the tilted orientation printable, in three kinds:")
bullets([
    "<b>Overhang ribs</b> \u2014 thin upside-down-T walls under each overhang. The top of each rib follows the "
    "underside a small gap below it, and a comb of tiny <b>tines</b> reaches across that gap to hold the part.",
    "<b>Side bracing fins</b> \u2014 thin walls standing beside a flat side of a part that is tipped onto an "
    "edge or corner, gripping it with rows of tines so it cannot fall over.",
    "<b>Bed pad</b> \u2014 a thin oval brim under a part that touches the bed only along an edge or at a point, "
    "so it does not peel off.",
])
P("The technique is Slant3D's designed-in \"support fin\". The feature is a port of the "
  "<b>support-fins</b> browser app (printfins.com, github.com/gittrahan/support-fins) to native Onshape "
  "geometry.")
notebox("The feature needs solid parts: native Onshape parts or imported STEP, Parasolid and similar CAD "
        "files. STL and other mesh files import into Onshape as mesh bodies, which it cannot process. For an "
        "STL, use printfins.com instead.")

section(2, "Step-by-Step Workflow")
P("Complete these steps in order:")
steps([
    "Add the feature to your toolbar once: <b>Custom features</b> (toolbar) " + ARROW + " open the "
    "<b>Fin Supports</b> document " + ARROW + " select <b>Support-Fins FS</b>.",
    "In your Part Studio, orient the part the way it will sit on the printer, for example with a "
    "<b>Transform</b> feature. By default the <b>Top</b> plane is the build plate.",
    "Open <b>Custom features</b> " + ARROW + " <b>Support-Fins FS</b> and select the part under "
    "<b>Parts to support</b>.",
    "Under <b>Print settings</b>, set <b>Layer height</b> to your slicer's layer height and choose the "
    "<b>Material</b>.",
    "Check the preview. Turn on <b>Show detected overhangs</b> to see which faces were found. Adjust "
    "<b>Overhang ribs</b>, and turn on <b>Side bracing fins</b> if the part rests on an edge or corner.",
    "Click <b>OK</b>. The supports appear as orange parts named <i>&lt;part&gt; support 1, 2 \u2026</i>, and "
    "a message reports what was built.",
    "Select the part <b>and</b> all of its supports, right-click " + ARROW + " <b>Export</b>, choose STL, "
    "and export them as one file.",
    "Slice with supports <b>off</b>. After printing, bend each support sideways to snap it off.",
])

section(3, "Feature Dialog Options")
subsection("3.1  Selections", "These sit at the top of the dialog, above the grouped settings.")
table(["Option", "Description"], [
    ["Parts to support", "One or more solid parts, already positioned the way they will print. Each part "
     "gets its own supports. The parts themselves are never modified."],
    ["Build plate", "A plane, flat face or mate connector whose direction is the printer bed. Leave empty to "
     "use the Top plane. Up is taken to be the side the part is on."],
    ["Flip build direction", "Reverses which way is up, if the supports come out on the wrong side."],
    ["Seat part on plate", "On by default. Treats the part's lowest point as the bed surface, so only the "
     "plate's direction matters, not its position. Turn off to use the plate exactly where it is."],
], [1.3, 4])

subsection("3.2  Overhang Ribs", "This group controls the ribs placed under overhanging faces.")
table(["Option", "Description"], [
    ["Auto-detect overhangs", "Finds downward faces too flat to print unsupported and puts ribs under them."],
    ["Overhang angle (from plate)", "Downward faces flatter than this, measured from the bed, get ribs. "
     "Default 45\u00b0, the usual limit for printing without support. Raise it for more supports."],
    ["Exclude faces", "Detected faces that should not get ribs, such as a cosmetic surface or one that "
     "bridges well on its own."],
    ["Add overhang faces", "Faces to support even if detection skipped them. Any face that points at all "
     "downward can be added. Added faces also accept shorter ribs (4 mm instead of 7 mm)."],
    ["Max unsupported span", "The widest stretch of overhang left between two ribs. A wide overhang gets a "
     "row of ribs no farther apart than this. Default 12 mm (0.5 in)."],
    ["Gripping tines", "On by default. Tiny one-layer bridges from the rib top into the part. Off gives "
     "plain breakaway ribs that the part simply rests on."],
    ["Tine spacing", "Distance between tines near the ends of each rib; the middle is spaced twice as far, "
     "up to 5 mm. Smaller grips harder but leaves more marks. Default 2 mm."],
    ["Max walls per part", "A safety cap on how many ribs one part can get. Default 60."],
], [1.3, 4])

subsection("3.3  Side Bracing Fins", "Collapsed and off by default. See Section 4.3 for when to use them.")
table(["Option", "Description"], [
    ["Side fins", "<b>Off</b>, <b>Auto</b> (the feature picks the faces) or <b>Selected faces</b> (you pick "
     "them)."],
    ["Max fin sites", "Auto only. How many sides of the part may get a fin. The default of 2 braces opposite "
     "sides, which is usually enough."],
    ["Faces to brace", "Selected faces only. The flat sides to put a fin against. Pick faces on opposite sides "
     "so the part cannot tip either way."],
    ["Max face lean (from vertical)", "The steepest face lean, measured from vertical, that can take a fin. "
     "Default 45\u00b0. The fin leans with its face, so past 45\u00b0 the fin itself becomes an overhang."],
], [1.3, 4])

subsection("3.4  Bed Pad")
table(["Option", "Description"], [
    ["Bed pad", "<b>Auto</b> adds a pad only when the part has less than 60 mm<super>2</super> of flat contact "
     "with the bed, meaning it rests on an edge or a point. <b>Always</b> and <b>Never</b> override that."],
], [1.3, 4])

subsection("3.5  Print Settings")
table(["Option", "Description"], [
    ["Layer height (tine height)", "Set this to your slicer's layer height. Each tine is exactly one layer tall "
     "and lined up with the layers, so it prints as a single strand that snaps clean."],
    ["Material", "Sets the clearances. PETG sticks to supports much harder than PLA, so it gets bigger gaps, "
     "shallower side-fin tines and a pad that stands just off the part. <b>Custom</b> shows every value."],
    ["Support gap", "Custom only. Air gap between the supports and the part."],
    ["Rib tine bite / Side fin tine bite", "Custom only. How far tines reach into the part. Smaller leaves "
     "smaller marks and grips less."],
    ["Base height / Pad grab", "Custom only. Height of everything lying on the bed (the rib flanges and the "
     "pad share it, so they meet with no step), and how far the pad overlaps the part's underside. A negative "
     "grab leaves a gap instead. Base height is rounded to whole layers."],
    ["Show detected overhangs", "Highlights the overhang faces that were found, in red."],
], [1.3, 4])
P("The material presets use these values:")
table(["Setting", "PLA", "PETG"], [
    ["Support gap", "0.2 mm", "0.3 mm"],
    ["Rib tine bite", "0.5 mm", "0.5 mm"],
    ["Side fin tine bite", "0.3 mm", "0.15 mm"],
    ["Base height (flanges + pad)", "0.6 mm", "0.4 mm"],
    ["Pad grab", "+0.05 mm (tacked on)", "\u22120.1 mm (gap, touching only at the resting edge)"],
], [1.3, 1.6, 2.4])

section(4, "How the Supports Are Built")
subsection("4.1  Overhang ribs")
P("Each downward face flatter than the overhang angle is found, faces that touch are grouped into one "
  "overhang, and overhangs smaller than 12 mm<super>2</super> are ignored. For each overhang:")
bullets([
    "<b>Direction.</b> On a sloped underside the ribs run down the slope; on a nearly flat one they run along "
    "its longer side. A large curved underside, such as a tube lying down, gets a single rib under its "
    "lowest line.",
    "<b>Contour.</b> Along each rib the underside is sampled every 1 mm by firing a ray straight up from the "
    "plate. A rib is only placed where the first thing the ray hits is the overhang itself, so the path "
    "to the plate is clear.",
    "<b>Clearance.</b> A copy of the part, grown outward by the support gap, is subtracted from every rib. "
    "Whatever is left cannot touch the part anywhere, including the flanks.",
    "<b>Size limits.</b> Ribs shorter than 7 mm are skipped. Under 1.5 mm tall a rib becomes a squat wall on "
    "a thin, wide brim; under 0.6 mm the first layers print without help and nothing is added.",
])
fig(rib_diagram(), "Figure 1. An overhang rib: side view (left) and cross-section (right).")

subsection("4.2  Tines")
P("A tine is a small block one layer tall and 0.5 mm wide. It sits on the rib's top, sinks 0.3 mm back into "
  "the rib, and reaches into the part. Because it lies flat in a single layer, the nozzle prints it as one "
  "continuous strand: rib, tine, part and back, with no retraction. That strand is strong enough to hold "
  "the part, and it bends and snaps cleanly when the rib is removed.")
bullets([
    "Each tine is snapped to the layer grid, so it never straddles two layers.",
    "A tine is only added where its tip is confirmed inside the part. On a nearly flat underside a sideways "
    "poke finds nothing to grip, so flat overhangs get plain ribs.",
    "Tines are packed tightly within 8 mm of each end of a rib, where the marks hide on edges and corners, "
    "and spaced out across the middle. Every rib gets at least three.",
])

subsection("4.3  Side bracing fins")
P("A part tipped onto an edge or corner has a tiny footprint and can be knocked over by the nozzle or peel "
  "off partway through the print. Ribs only push up from underneath, so they do little to stop it tipping. "
  "A side fin holds the part from beside it instead:")
bullets([
    "A 1.2 mm wall stands parallel to a flat side of the part, one support gap away, on an oval base "
    "9 mm deep. If the side leans, the fin leans with it.",
    "Rows of horizontal tines cross the gap and fuse into the side: eight rows packed into the first "
    "6 mm above the plate, then spreading out. The part is least stable near the bed.",
    "The fin is at most 25 mm long and only as tall as the face reaches across its whole length, so the "
    "entire fin has face behind it. On a tilted square face, which sits diamond-shaped, it goes in the "
    "middle where the face is tallest.",
    "A fin is abandoned, not shortened, if it or its base would touch another part of the model, or if "
    "fewer than three tines can grip.",
])
fig(fin_diagram(), "Figure 2. A side fin standing beside a leaning face.")
P("<b>When to use them.</b> Turn side fins on when the part balances on an edge or corner, and pair them "
  "with the bed pad. <b>Auto</b> ranks the flat faces by how much grippable wall they offer and picks up to "
  "<b>Max fin sites</b> faces pointing at least 60\u00b0 apart and 12 mm apart. <b>Selected faces</b> tries "
  "every face you pick and reports any it could not use, with the reason. A face 55 mm or wider gets a "
  "row of fins about 55 mm apart instead of one.")
notebox("A face can take a fin if it is flat, at least 4 \u00d7 4 mm, leans no more than the <b>Max face "
        "lean</b> from vertical, reaches down near the bed, and has open space beside it.")

subsection("4.4  Bed pad")
P("The pad is an oval fitted around where the part touches the bed: long and thin under an edge, round "
  "under a point, reaching 4 mm past the contact. Away from the part it is full height for bed grip; under "
  "the part its top follows the underside and overlaps it by the pad grab, a light tack that holds the "
  "part down but peels off afterward. The pad is the same height as the rib flanges, so where the two meet "
  "they merge flush, with no step.")

section(5, "Output")
P("Supports are added as new parts. The original part is never modified.")
table(["Item", "Details"], [
    ["Support parts", "Named <i>&lt;part&gt; support 1, 2 \u2026</i> and colored orange. Ribs, tines, fins "
     "and pad that touch are merged into one part; separate supports stay separate."],
    ["Feature message", "Reports the number of overhangs found, ribs, tines, side fins and pads, plus any "
     "overhangs left unsupported and why."],
    ["Export", "Export the part together with all of its supports as <b>one STL</b>. The supports overlap the "
     "part slightly at the tines and pad; the slicer merges them into one solid."],
], [1.3, 4])
notebox("If you export a 3MF or separate files, the slicer may load the supports as separate objects. "
        "Merge them into one object, or export as a single STL, so the tines fuse to the part.")

section(6, "Printing and Removal")
bullets([
    "Slice with the slicer's supports <b>off</b>. The model already carries its supports.",
    "Match the slicer's layer height, <i>and</i> its first-layer height, to the <b>Layer height</b> setting so "
    "every tine lands on exactly one layer.",
    "To remove a rib or fin, bend it sideways, in the plane of the layers. The tines fatigue and snap, "
    "leaving small, faint marks. Pulling straight off tears them out instead.",
    "Peel the bed pad off from its outer edge toward the part.",
    "For PETG, choose the PETG material. PETG bonds to supports far harder than PLA does.",
])

section(7, "Troubleshooting")
P("The feature reports what it built, and anything it could not build, in a message on the feature. The "
  "table lists each message with its cause and what to do.")
table(["Message", "Cause", "Remedy"], [
    ["Select at least one part to support.", "Parts to support is empty.", "Select a solid part."],
    ["No supports generated.", "Nothing needed or could take a support at these settings.",
     "Check Show detected overhangs. Raise the overhang angle, add faces manually, or turn on side fins."],
    ["N region(s) got no wall", "An overhang was too small, too low, or over another part of the model "
     "rather than the plate.", "Expected for features that bridge. Use Add overhang faces to force a short "
     "rib, or reorient the part."],
    ["Part extends below the selected plate", "Seat part on plate is off and the part dips below the plate.",
     "Turn Seat part on plate on, or move the plate."],
    ["Could not offset the part for clearance", "The part could not be grown by the gap, so only a vertical gap "
     "was cut.", "Check that the rib sides stand clear of the part."],
    ["Clearance cut failed; overhang ribs were removed.", "The clearance cut failed on this geometry.",
     "Simplify small features near the overhang, or try a slightly different gap."],
    ["Supports could not be merged", "The support pieces could not be combined; tines remain separate parts.",
     "Export them all together; the slicer will merge them."],
    ["No side fin fit", "No face met the side fin requirements (Section 4.3).",
     "Select faces manually, or raise Max face lean."],
    ["Side fin, face N: leans more than the Max face lean", "The face is too far from vertical.",
     "Raise Max face lean, or brace a different face."],
    ["Side fin, face N: the fin or its foot would touch another part of the model",
     "There is no open space beside the face.", "Pick a face on the outside of the part."],
    ["Side fin, face N: fewer than 3 tines could grip the face", "The face is too small or oddly shaped for a "
     "grip.", "Pick a larger face."],
    ["Side fin, face N: face is too close to the bed / too short / too narrow",
     "Not enough face to stand a fin against.", "Pick a taller, wider face."],
], [1.5, 1.8, 1.8])
notebox("Faces in the side fin messages are numbered in the order Onshape returns your selection.")

section(8, "Tips and Best Practices")
bullets([
    "Orient first, then support. The feature never chooses the orientation. Only you know which way the part "
    "will be loaded, and so which orientation makes it strong.",
    "Put overhangs on edges and corners where you can. That is where the tines are packed, and where their "
    "marks are hardest to see.",
    "A part whose underside sits at exactly 45\u00b0 counts as self-supporting. Raise the overhang angle a "
    "degree or two to add ribs to it anyway.",
    "Long parts want support on both sides. With side fins, brace opposite faces so the part cannot twist.",
    "If the ribs leave too many marks, increase <b>Tine spacing</b>; if the part shifts during printing, "
    "decrease it.",
    "Keep the Layer height setting in step with the slicer. A tine that spans two layers bonds harder and "
    "marks worse.",
])

section(9, "Credits and License")
P("Fin geometry, dimensions and placement rules are ported from <b>support-fins</b> by Matthew Trahan "
  "(github.com/gittrahan/support-fins, MIT License), which automates Slant3D's designed-in support fin "
  "technique.")
P(f"This FeatureScript is released under the <b>MIT License</b>.")
P("Copyright \u00a9 2026 Chris Lee, Southeast Expedition Medical, LLC")
P("Permission is hereby granted, free of charge, to any person obtaining a copy of this software to deal in "
  "the Software without restriction, including without limitation the rights to use, copy, modify, merge, "
  "publish, distribute, sublicense, and/or sell copies of the Software, subject to the condition that the "
  "above copyright notice and this permission notice shall be included in all copies or substantial "
  "portions of the Software.")
P('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.')

doc.build(story)
print("wrote", OUT)
