// The fins into the part: each piece (a wall with its tines, a sway brace, the
// bed pad) is its own STL, imported as its own solid body and named after it,
// so the user can hide or delete one fin, and the next run knows them as ours.
//
// SolidWorks takes an STL through its import settings; they are set for the
// import (solid body, millimetres, no diagnostics dialog) and put back after.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;

namespace SupportFins.SolidWorks
{
    sealed class Piece
    {
        public string Name;
        public byte[] Stl;     // binary STL, mm, part frame
    }

    static class FinImporter
    {
        /// <summary>Imports every piece into the active part; returns the names that failed.</summary>
        public static List<string> Insert(ISldWorks sw, IModelDoc2 doc, IList<Piece> pieces, out int inserted)
        {
            inserted = 0;
            var failed = new List<string>();
            var part = (IPartDoc)doc;
            var dir = Path.Combine(Path.GetTempPath(), "SupportFins-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            using (new ImportSettings(sw))
            {
                try
                {
                    for (int i = 0; i < pieces.Count; i++)
                    {
                        var p = pieces[i];
                        var file = Path.Combine(dir, $"piece{i + 1}.stl");
                        File.WriteAllBytes(file, p.Stl);
                        var before = new HashSet<string>(BodyNames(part));
                        int err;
                        var feature = part.InsertImportedFeature(file, out err) as IFeature;
                        if (feature == null) { failed.Add(p.Name); continue; }
                        var name = Unique(p.Name, n => part.FeatureByName(n) != null);
                        feature.Name = name;
                        var taken = new HashSet<string>(BodyNames(part));
                        foreach (IBody2 body in Bodies(part).Where(b => !before.Contains(b.Name ?? "")))
                        {
                            var bodyName = Unique(name, taken.Contains);
                            body.Name = bodyName;
                            taken.Add(bodyName);
                        }
                        inserted++;
                    }
                }
                finally
                {
                    try { Directory.Delete(dir, true); } catch { }
                }
            }
            doc.GraphicsRedraw2();
            return failed;
        }

        static IEnumerable<IBody2> Bodies(IPartDoc part) =>
            ((object[])part.GetBodies2((int)swBodyType_e.swAllBodies, false) ?? new object[0]).Cast<IBody2>();

        static IEnumerable<string> BodyNames(IPartDoc part) => Bodies(part).Select(b => b.Name ?? "");

        // "Support Fins wall 1", or "Support Fins wall 1 (2)" when a run left that name.
        static string Unique(string name, Func<string, bool> taken)
        {
            if (!taken(name)) return name;
            for (int k = 2; ; k++)
                if (!taken($"{name} ({k})")) return $"{name} ({k})";
        }

        /// <summary>STL import as solid bodies in mm, quietly; restores the user's settings on Dispose.</summary>
        sealed class ImportSettings : IDisposable
        {
            readonly ISldWorks sw;
            readonly int modelType, units;
            readonly bool asMesh, diagnose;
            const int ModelType = (int)swUserPreferenceIntegerValue_e.swImportStlVrmlModelType;
            const int Units = (int)swUserPreferenceIntegerValue_e.swImportStlVrmlUnits;
            const int AsMesh = (int)swUserPreferenceToggle_e.swVrmlStlImportAsPSMesh;
            const int Diagnose = (int)swUserPreferenceToggle_e.swImportAutoRunImportDiagnostics;

            public ImportSettings(ISldWorks sw)
            {
                this.sw = sw;
                modelType = sw.GetUserPreferenceIntegerValue(ModelType);
                units = sw.GetUserPreferenceIntegerValue(Units);
                asMesh = sw.GetUserPreferenceToggle(AsMesh);
                diagnose = sw.GetUserPreferenceToggle(Diagnose);
                sw.SetUserPreferenceIntegerValue(ModelType, (int)swImportStlVrmlModelType_e.swImportStlVrmlModelType_Solid);
                sw.SetUserPreferenceIntegerValue(Units, (int)swLengthUnit_e.swMM);
                sw.SetUserPreferenceToggle(AsMesh, false);
                sw.SetUserPreferenceToggle(Diagnose, false);
            }

            public void Dispose()
            {
                sw.SetUserPreferenceIntegerValue(ModelType, modelType);
                sw.SetUserPreferenceIntegerValue(Units, units);
                sw.SetUserPreferenceToggle(AsMesh, asMesh);
                sw.SetUserPreferenceToggle(Diagnose, diagnose);
            }
        }
    }
}
