// The active part as the dialog page takes it: every visible solid body's
// triangles in the part's own frame, in millimetres, plus the selected flat face
// (for "Selected face" as the print bed). Bodies an earlier run inserted are
// skipped and counted, so fins never get fins.
using System;
using System.Collections.Generic;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;

namespace SupportFins.SolidWorks
{
    sealed class PartMesh
    {
        public string Name;
        public double[] Soup;          // 9 per triangle, mm, part frame
        public int Bodies;
        public int Earlier;            // our bodies from an earlier run, skipped
        public double[] FaceNormal;    // the selected planar face, or null
        public double[] FacePoint;     // a point on it, mm
    }

    static class PartReader
    {
        // The prefix every inserted body's name starts with (page/host.js PREFIX).
        public const string Prefix = "Support Fins";

        /// <summary>The active part, or an error the dialog shows as is.</summary>
        public static PartMesh Read(ISldWorks sw, out string error)
        {
            error = null;
            if (!(sw.ActiveDoc is IModelDoc2 doc) || doc.GetType() != (int)swDocumentTypes_e.swDocPART)
            {
                error = "Open a part (not an assembly or drawing), then press Read part.";
                return null;
            }
            var mesh = new PartMesh { Name = doc.GetTitle() };
            var soup = new List<double>();
            var bodies = (object[])((IPartDoc)doc).GetBodies2((int)swBodyType_e.swSolidBody, true) ?? new object[0];
            foreach (IBody2 body in bodies)
            {
                if ((body.Name ?? "").StartsWith(Prefix, StringComparison.Ordinal)) { mesh.Earlier++; continue; }
                mesh.Bodies++;
                foreach (IFace2 face in (object[])body.GetFaces() ?? new object[0])
                {
                    // true: no unit conversion, so metres whatever the document's units
                    var tess = (float[])face.GetTessTriangles(true);
                    if (tess == null) continue;
                    foreach (var v in tess) soup.Add(v * 1000.0);
                }
            }
            if (mesh.Bodies == 0)
            {
                error = mesh.Earlier > 0
                    ? "The only visible bodies are Support Fins from an earlier run. Show the part's own bodies, then press Read part."
                    : "This part has no visible solid bodies.";
                return null;
            }
            if (soup.Count == 0)
            {
                error = "SolidWorks gave no triangles for this part's bodies.";
                return null;
            }
            mesh.Soup = soup.ToArray();
            ReadSelectedFace(doc, mesh);
            return mesh;
        }

        static void ReadSelectedFace(IModelDoc2 doc, PartMesh mesh)
        {
            var sel = (ISelectionMgr)doc.SelectionManager;
            int n = sel.GetSelectedObjectCount2(-1);
            for (int i = 1; i <= n; i++)
            {
                if (sel.GetSelectedObjectType3(i, -1) != (int)swSelectType_e.swSelFACES) continue;
                var normal = (double[])((IFace2)sel.GetSelectedObject6(i, -1)).Normal;
                // (0, 0, 0) for a face that isn't flat: not a bed
                if (normal == null || Math.Abs(normal[0]) + Math.Abs(normal[1]) + Math.Abs(normal[2]) < 1e-9) continue;
                var at = (double[])sel.GetSelectionPoint2(i, -1);
                if (at == null) continue;
                mesh.FaceNormal = normal;
                mesh.FacePoint = new[] { at[0] * 1000.0, at[1] * 1000.0, at[2] * 1000.0 };
                return;
            }
        }

        /// <summary>The soup as the page decodes it: base64 of little-endian float64s.</summary>
        public static string SoupBase64(double[] soup)
        {
            var bytes = new byte[soup.Length * 8];
            Buffer.BlockCopy(soup, 0, bytes, 0, bytes.Length);
            return Convert.ToBase64String(bytes);
        }
    }
}
