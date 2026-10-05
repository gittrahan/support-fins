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
                if (IsOurs(body)) { mesh.Earlier++; continue; }
                mesh.Bodies++;
                foreach (IFace2 face in (object[])body.GetFaces() ?? new object[0])
                {
                    // true: no unit conversion, so metres whatever the document's units
                    var tess = (float[])face.GetTessTriangles(true);
                    if (tess == null) continue;
                    var norms = (float[])face.GetTessNorms();
                    for (int t = 0; t + 9 <= tess.Length; t += 9) AddTriangle(soup, tess, norms, t);
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

        // An earlier run's body: named by FinImporter, or (should a rename not have
        // taken) made by one of its features. Fins must never get fins.
        static bool IsOurs(IBody2 body)
        {
            if ((body.Name ?? "").StartsWith(Prefix, StringComparison.Ordinal)) return true;
            foreach (IFeature f in (object[])body.GetFeatures() ?? new object[0])
                if ((f.Name ?? "").StartsWith(Prefix, StringComparison.Ordinal)) return true;
            return false;
        }

        // One triangle, in mm, wound so its normal points out of the part: the engine
        // tells an overhang by which way a face points. SolidWorks' vertex normals
        // (GetTessNorms, same layout) are outward; its winding isn't documented to be.
        static void AddTriangle(List<double> soup, float[] t, float[] n, int i)
        {
            double ax = t[i + 3] - t[i], ay = t[i + 4] - t[i + 1], az = t[i + 5] - t[i + 2];
            double bx = t[i + 6] - t[i], by = t[i + 7] - t[i + 1], bz = t[i + 8] - t[i + 2];
            double cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
            bool flip = false;
            if (n != null && n.Length >= i + 9)
            {
                double s = 0;
                for (int k = 0; k < 9; k += 3) s += cx * n[i + k] + cy * n[i + k + 1] + cz * n[i + k + 2];
                flip = s < 0;
            }
            foreach (int v in flip ? new[] { 0, 6, 3 } : new[] { 0, 3, 6 })
                for (int k = 0; k < 3; k++) soup.Add(t[i + v + k] * 1000.0);
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
