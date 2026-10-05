// The add-in SolidWorks loads: COM registration, the Support Fins command on the
// ribbon, and the dialog window it opens. Everything about fins happens in the
// dialog page (page/), which runs the printfins.com engine; see FinsWindow.cs.
//
// Only interfaces (ISldWorks, not the SldWorks class): the interop types are
// embedded (see the .csproj), and an embedded interop can't name a COM class.
using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;
using SolidWorks.Interop.swpublished;

namespace SupportFins.SolidWorks
{
    [Guid("6C1D6F2A-3B8E-4E43-9C5D-2F0A8B7E41D3")]
    [ComVisible(true)]
    public class Addin : ISwAddin
    {
        internal const string Title = "Support Fins";
        const string Description = "Breakaway support fins from printfins.com, added to the part as bodies";
        const int GroupId = 4817;
        const int CommandId = 1;

        ISldWorks sw;
        int cookie;
        ICommandManager commands;
        FinsWindow window;

        internal static string Folder => Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        internal static string Version => Assembly.GetExecutingAssembly().GetName().Version.ToString(3);

        public bool ConnectToSW(object thisSW, int cookie)
        {
            sw = (ISldWorks)thisSW;
            this.cookie = cookie;
            // SolidWorks looks for assemblies next to its own exe, not ours: point it at
            // the WebView2 DLLs that ship with the add-in. Before anything touches them.
            AppDomain.CurrentDomain.AssemblyResolve += ResolveFromAddinFolder;
            sw.SetAddinCallbackInfo2(0, this, cookie);
            LoadAtStartup();
            AddCommand();
            return true;
        }

        public bool DisconnectFromSW()
        {
            try { window?.Close(); } catch { }
            window = null;
            RemoveCommand();
            AppDomain.CurrentDomain.AssemblyResolve -= ResolveFromAddinFolder;
            Marshal.ReleaseComObject(sw);
            sw = null;
            GC.Collect();
            GC.WaitForPendingFinalizers();
            return true;
        }

        // install.bat writes the load-at-startup key for the account that elevated it,
        // which may be another admin's. Write it for this user too, unless SolidWorks
        // already keeps one (unticking Start Up in Tools > Add-Ins sets it to 0).
        void LoadAtStartup()
        {
            try
            {
                var path = $@"Software\SolidWorks\AddInsStartup\{{{GetType().GUID}}}";
                using (var key = Registry.CurrentUser.OpenSubKey(path))
                    if (key != null) return;
                using (var key = Registry.CurrentUser.CreateSubKey(path))
                    key.SetValue(null, 1);
            }
            catch { }
        }

        static Assembly ResolveFromAddinFolder(object sender, ResolveEventArgs args)
        {
            var path = Path.Combine(Folder, new AssemblyName(args.Name).Name + ".dll");
            return File.Exists(path) ? Assembly.LoadFrom(path) : null;
        }

        void AddCommand()
        {
            commands = sw.GetCommandManager(cookie);
            int err = 0;
            var group = commands.CreateCommandGroup2(GroupId, Title, Description, Title, -1, true, ref err);
            var icons = new[] { 20, 32, 40, 64, 96, 128 }
                .Select(s => Path.Combine(Folder, "icons", $"fins_{s}.png")).ToArray();
            group.IconList = icons;
            group.MainIconList = icons;
            int item = group.AddCommandItem2("Support Fins", -1,
                "Add breakaway support fins under the part's overhangs", "Support Fins", 0,
                nameof(OnSupportFins), nameof(CanSupportFins), CommandId,
                (int)(swCommandItemType_e.swMenuItem | swCommandItemType_e.swToolbarItem));
            group.HasToolbar = true;
            group.HasMenu = true;
            group.Activate();

            const int part = (int)swDocumentTypes_e.swDocPART;
            var tab = commands.GetCommandTab(part, Title);
            if (tab != null) commands.RemoveCommandTab(tab);
            tab = commands.AddCommandTab(part, Title);
            tab.AddCommandTabBox().AddCommands(new[] { group.CommandID[item] },
                new[] { (int)swCommandTabButtonTextDisplay_e.swCommandTabButton_TextBelow });
        }

        void RemoveCommand()
        {
            try
            {
                var tab = commands?.GetCommandTab((int)swDocumentTypes_e.swDocPART, Title);
                if (tab != null) commands.RemoveCommandTab(tab);
                commands?.RemoveCommandGroup2(GroupId, true);
            }
            catch { }
            commands = null;
        }

        // Ribbon callbacks, found by name: public, on this class.
        public void OnSupportFins()
        {
            try
            {
                if (window == null || window.IsDisposed) window = new FinsWindow(sw);
                window.ShowAndRead();
            }
            catch (Exception e)
            {
                sw.SendMsgToUser2($"{Title}: {e.Message}", (int)swMessageBoxIcon_e.swMbStop, (int)swMessageBoxBtn_e.swMbOk);
            }
        }

        public int CanSupportFins() =>
            sw?.ActiveDoc is IModelDoc2 doc && doc.GetType() == (int)swDocumentTypes_e.swDocPART ? 1 : 0;

        // regasm /codebase calls these: list the add-in in Tools > Add-Ins and load it at startup.
        [ComRegisterFunction]
        public static void Register(Type t)
        {
            using (var key = Registry.LocalMachine.CreateSubKey($@"SOFTWARE\SolidWorks\Addins\{{{t.GUID}}}"))
            {
                key.SetValue(null, 0);
                key.SetValue("Title", Title);
                key.SetValue("Description", Description);
            }
            using (var key = Registry.CurrentUser.CreateSubKey($@"Software\SolidWorks\AddInsStartup\{{{t.GUID}}}"))
                key.SetValue(null, 1);
        }

        [ComUnregisterFunction]
        public static void Unregister(Type t)
        {
            Registry.LocalMachine.DeleteSubKeyTree($@"SOFTWARE\SolidWorks\Addins\{{{t.GUID}}}", false);
            Registry.CurrentUser.DeleteSubKeyTree($@"Software\SolidWorks\AddInsStartup\{{{t.GUID}}}", false);
        }
    }
}
