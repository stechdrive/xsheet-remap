using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

// An unselected Win32 desktop keeps normal Tauri window activation away from the
// operator's desktop. This helper never switches desktops or synthesizes input.
public sealed class WebviewDesktop : IDisposable
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public string reserved, desktop, title;
        public uint x, y, width, height, xChars, yChars, fill, flags;
        public ushort show, reservedSize;
        public IntPtr reservedBytes, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInfo
    {
        public IntPtr process, thread;
        public uint processId, threadId;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode, uint flags, uint access, IntPtr security);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetThreadDesktop(uint threadId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenDesktopW(string name, uint flags, bool inherit, uint access);
    private delegate bool WindowCallback(IntPtr window, IntPtr context);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumDesktopWindows(IntPtr desktop, WindowCallback callback, IntPtr context);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder value, uint bytes, out uint needed);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(string app, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
        bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    private IntPtr desktop;
    public string Name { get; private set; }
    public Process App { get; private set; }

    private static string ObjectName(IntPtr handle)
    {
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var value = new StringBuilder(256);
        uint needed;
        if (!GetUserObjectInformationW(handle, 2, value, (uint)(value.Capacity * 2), out needed))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return value.ToString();
    }
    public static string InputDesktopName()
    {
        var handle = OpenInputDesktop(0, false, 0x0001); // DESKTOP_READOBJECTS
        try { return ObjectName(handle); }
        finally { if (handle != IntPtr.Zero) CloseDesktop(handle); }
    }
    public static string ObserverDesktopName() { return ObjectName(GetThreadDesktop(GetCurrentThreadId())); }
    public static bool TestDesktopExists(string name)
    {
        if (name == null || !name.StartsWith("xsheet-webview-")) throw new ArgumentException("Not a test desktop");
        var handle = OpenDesktopW(name, 0, false, 0x0001);
        if (handle != IntPtr.Zero) { CloseDesktop(handle); return true; }
        var error = Marshal.GetLastWin32Error();
        if (error != 2) throw new Win32Exception(error);
        return false;
    }
    public bool HasAppWindow()
    {
        bool found = false;
        WindowCallback callback = delegate(IntPtr window, IntPtr context) {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner == App.Id) found = true;
            return true;
        };
        if (!EnumDesktopWindows(desktop, callback, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return found;
    }

    public WebviewDesktop(string executable, string cwd)
    {
        var observer = ObserverDesktopName();
        Name = "xsheet-webview-" + Guid.NewGuid().ToString("N");
        // READOBJECTS | CREATEWINDOW | WRITEOBJECTS; no SWITCHDESKTOP right.
        desktop = CreateDesktopW(Name, IntPtr.Zero, IntPtr.Zero, 0, 0x0083, IntPtr.Zero);
        if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var info = new ProcessInfo();
        try
        {
            if (ObserverDesktopName() != observer || InputDesktopName() == Name)
                throw new InvalidOperationException("Desktop creation changed the observer/input desktop");
            var startup = new StartupInfo { cb = Marshal.SizeOf(typeof(StartupInfo)), desktop = Name };
            // Explicit executable + no arguments, inherited environment, no inherited handles.
            if (!CreateProcessW(executable, new StringBuilder("\"" + executable + "\""), IntPtr.Zero, IntPtr.Zero,
                    false, 0, IntPtr.Zero, cwd, ref startup, out info))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            App = Process.GetProcessById((int)info.processId);
            var retained = App.Handle;
            if (!App.WaitForInputIdle(10000))
                throw new InvalidOperationException("Test process did not initialize its window event loop");
        }
        catch (Exception error)
        {
            error.Data["testDesktopName"] = Name;
            if (info.process != IntPtr.Zero) TerminateProcess(info.process, 1);
            if (App != null) { App.WaitForExit(5000); App.Dispose(); App = null; }
            CloseDesktop(desktop); desktop = IntPtr.Zero;
            throw;
        }
        finally
        {
            if (info.thread != IntPtr.Zero) CloseHandle(info.thread);
            if (info.process != IntPtr.Zero) CloseHandle(info.process);
        }
    }
    public void Dispose()
    {
        if (App != null)
        {
            if (!App.HasExited) App.Kill();
            if (!App.WaitForExit(5000)) throw new InvalidOperationException("Test EXE did not exit");
            App.Dispose(); App = null;
        }
        if (desktop != IntPtr.Zero)
        {
            if (!CloseDesktop(desktop)) throw new Win32Exception(Marshal.GetLastWin32Error());
            desktop = IntPtr.Zero;
        }
    }
}
