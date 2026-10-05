// The Support Fins dialog: a small window, owned by SolidWorks' main window,
// holding a WebView2 that shows page/index.html. The page runs the engine (in
// Edge's V8, at the site's speed, with SolidWorks never waiting on it); this side
// only answers its messages, on SolidWorks' UI thread:
//
//   ready / readPart  -> read the active part (PartReader) and send it
//   insert            -> import the pieces into the part that was read (FinImporter)
//
// The protocol is spelled out at the top of page/dialog.js.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using SolidWorks.Interop.sldworks;

namespace SupportFins.SolidWorks
{
    sealed class FinsWindow : Form
    {
        const string Host = "supportfins.solidworks";
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        readonly ISldWorks sw;
        readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill };
        IModelDoc2 doc;              // the part the page's soup came from
        bool ready;

        public FinsWindow(ISldWorks sw)
        {
            this.sw = sw;
            Text = Addin.Title;
            ClientSize = new Size(420, 700);
            MinimumSize = new Size(320, 420);
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            FormBorderStyle = FormBorderStyle.SizableToolWindow;
            Controls.Add(view);
        }

        /// <summary>Show the window (over SolidWorks) and send the active part.</summary>
        public void ShowAndRead()
        {
            if (!Visible)
            {
                var owner = new SolidWorksWindow(((IFrame)sw.Frame()).GetHWndx64());
                var area = Screen.FromHandle(owner.Handle).WorkingArea;
                Location = new Point(area.Right - Width - 24, area.Top + 120);
                Show(owner);
                if (view.CoreWebView2 == null) Start();
            }
            Activate();
            if (ready) SendPart();         // otherwise the page asks once it has loaded
        }

        async void Start()
        {
            try
            {
                UseBundledLoader();
                var data = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),
                    "SupportFins", "SolidWorks", "WebView2");
                var env = await CoreWebView2Environment.CreateAsync(null, data);
                await view.EnsureCoreWebView2Async(env);
                var web = view.CoreWebView2;
                web.Settings.AreDefaultContextMenusEnabled = false;
                web.Settings.IsStatusBarEnabled = false;
                web.SetVirtualHostNameToFolderMapping(Host, Path.Combine(Addin.Folder, "page"),
                    CoreWebView2HostResourceAccessKind.Deny);
                web.WebMessageReceived += OnMessage;
                web.Navigate($"https://{Host}/index.html");
            }
            catch (WebView2RuntimeNotFoundException)
            {
                Fail("Support Fins needs the Microsoft Edge WebView2 Runtime, which this computer doesn't have. "
                     + "Install it from https://developer.microsoft.com/microsoft-edge/webview2/ and open Support Fins again.");
            }
            catch (Exception e)
            {
                Fail("The Support Fins window could not start: " + e.Message);
            }
        }

        static bool loaderSet;

        // WebView2Loader.dll ships in the add-in folder (or the package's runtimes/
        // layout); SolidWorks' own folder is where it would look otherwise. WebView2
        // takes the folder once per process, before its loader loads: a second window
        // (or another add-in that loaded it first) must not set it again, or it throws.
        static void UseBundledLoader()
        {
            if (loaderSet) return;
            loaderSet = true;
            foreach (var dir in new[] { "", "x64", Path.Combine("runtimes", "win-x64", "native") })
            {
                var folder = Path.Combine(Addin.Folder, dir);
                if (File.Exists(Path.Combine(folder, "WebView2Loader.dll")))
                {
                    try { CoreWebView2Environment.SetLoaderDllFolderPath(folder); }
                    catch (InvalidOperationException) { /* already loaded: use that one */ }
                    return;
                }
            }
        }

        void Fail(string message)
        {
            Close();
            sw.SendMsgToUser2(message, 4 /* swMbStop */, 2 /* swMbOk */);
        }

        void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            Dictionary<string, object> msg;
            try { msg = Json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson); }
            catch { return; }
            switch (msg.TryGetValue("type", out var t) ? t as string : null)
            {
                case "ready":
                    ready = true;
                    SendPart();
                    break;
                case "readPart":
                    SendPart();
                    break;
                case "insert":
                    Insert(msg);
                    break;
            }
        }

        void SendPart()
        {
            PartMesh mesh;
            string error;
            try
            {
                mesh = PartReader.Read(sw, out error);
                doc = mesh != null ? (IModelDoc2)sw.ActiveDoc : null;
            }
            catch (Exception e)
            {
                mesh = null;
                error = "Couldn't read the part: " + e.Message;
            }
            if (mesh == null)
            {
                Send(new Dictionary<string, object> { ["type"] = "part", ["error"] = error, ["version"] = Addin.Version });
                return;
            }
            Send(new Dictionary<string, object>
            {
                ["type"] = "part",
                ["name"] = mesh.Name,
                ["soup"] = PartReader.SoupBase64(mesh.Soup),
                ["bodies"] = mesh.Bodies,
                ["earlier"] = mesh.Earlier,
                ["face"] = mesh.FaceNormal == null ? null
                    : new Dictionary<string, object> { ["normal"] = mesh.FaceNormal, ["point"] = mesh.FacePoint },
                ["version"] = Addin.Version,
            });
        }

        void Insert(Dictionary<string, object> msg)
        {
            var reply = new Dictionary<string, object> { ["type"] = "inserted" };
            try
            {
                if (doc == null) throw new InvalidOperationException("no part has been read");
                var pieces = ((IEnumerable)msg["pieces"]).Cast<Dictionary<string, object>>()
                    .Select(p => new Piece { Name = (string)p["name"], Stl = Convert.FromBase64String((string)p["stl"]) })
                    .ToList();
                var failed = FinImporter.Insert(sw, doc, pieces, out int count);
                reply["count"] = count;
                reply["failed"] = failed;
            }
            catch (Exception e)
            {
                reply["error"] = e.Message;
            }
            Send(reply);
        }

        void Send(object msg) => view.CoreWebView2?.PostWebMessageAsJson(Json.Serialize(msg));

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            doc = null;
            view.Dispose();
            base.OnFormClosed(e);
        }

        // SolidWorks' main window as the owner, so the dialog stays above it and minimises with it.
        sealed class SolidWorksWindow : IWin32Window
        {
            public SolidWorksWindow(long hwnd) { Handle = new IntPtr(hwnd); }
            public IntPtr Handle { get; }
        }
    }
}
