using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

// By default an unselected Win32 desktop keeps Tauri activation away from the
// operator. Explicit interactive mode is only for the approved Explorer runner.
// Both modes own a process job. Neither switches desktops or synthesizes input.
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
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public int length; public IntPtr descriptor; public int inherit; }
    [StructLayout(LayoutKind.Sequential)] private struct StartupInfoEx { public StartupInfo startup; public IntPtr attributes; }
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
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder value, uint bytes, out uint needed);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(string app, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
        bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessWithAttributes(string app, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
        bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfoEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr info, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);

    private IntPtr desktop;
    private IntPtr job;
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

    // Children opened by the application's normal native command remain in the
    // same job. Never enumerate/terminate unrelated daily-use Remap instances.
    public int[] OwnedProcessIds()
    {
        if (job == IntPtr.Zero) return new int[0];
        int size = 8 + 256 * IntPtr.Size;
        var buffer = Marshal.AllocHGlobal(size);
        try {
            if (!QueryInformationJobObject(job, 3, buffer, (uint)size, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            int count = Marshal.ReadInt32(buffer, 4);
            if (count > 256) throw new InvalidOperationException("Unexpected test job process count");
            var result = new List<int>();
            for (int i = 0; i < count; i++) result.Add(Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt32());
            return result.ToArray();
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    public bool OwnsProcess(int pid) { return Array.IndexOf(OwnedProcessIds(), pid) >= 0; }
    public string[] OwnedWindows()
    {
        var result = new List<string>();
        var owners = OwnedProcessIds();
        var input = OpenInputDesktop(0, false, 0x0001);
        try { foreach (var handle in new [] { desktop, input }) {
            WindowCallback callback = delegate(IntPtr window, IntPtr context) {
                uint pid; GetWindowThreadProcessId(window, out pid);
                if (Array.IndexOf(owners, (int)pid) >= 0) {
                    var title = new StringBuilder(1024); GetWindowTextW(window, title, title.Capacity);
                    result.Add(ObjectName(handle) + "|" + pid + "|" + title.ToString());
                }
                return true;
            };
            if (!EnumDesktopWindows(handle, callback, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
        } } finally { if (input != IntPtr.Zero) CloseDesktop(input); }
        return result.ToArray();
    }
    public void KillChild(int pid)
    {
        if (pid == App.Id || !OwnsProcess(pid)) throw new InvalidOperationException("Not an owned child process");
        using (var child = Process.GetProcessById(pid)) {
            child.Kill();
            if (!child.WaitForExit(5000)) throw new InvalidOperationException("Test child did not exit");
        }
    }

    public WebviewDesktop(string executable, string cwd) : this(executable, cwd, false) { }
    public WebviewDesktop(string executable, string cwd, bool interactive)
    {
        var observer = ObserverDesktopName();
        Name = interactive ? InputDesktopName() : "xsheet-webview-" + Guid.NewGuid().ToString("N");
        // READOBJECTS | CREATEWINDOW | WRITEOBJECTS; no SWITCHDESKTOP right.
        var security = new SecurityAttributes { length = Marshal.SizeOf(typeof(SecurityAttributes)), inherit = 1 };
        var securityPointer = Marshal.AllocHGlobal(security.length);
        try {
            Marshal.StructureToPtr(security, securityPointer, false);
            desktop = interactive ? OpenInputDesktop(0, true, 0x0083) : CreateDesktopW(Name, IntPtr.Zero, IntPtr.Zero, 0, 0x0083, securityPointer);
        } finally { Marshal.FreeHGlobal(securityPointer); }
        if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var info = new ProcessInfo();
        try
        {
            job = CreateJobObjectW(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            // JOBOBJECT_EXTENDED_LIMIT_INFORMATION; limit flags are at offset 16.
            int size = IntPtr.Size == 8 ? 144 : 112;
            var limits = Marshal.AllocHGlobal(size);
            try {
                Marshal.Copy(new byte[size], 0, limits, size);
                Marshal.WriteInt32(limits, 16, 0x2000); // KILL_ON_JOB_CLOSE
                if (!SetInformationJobObject(job, 9, limits, (uint)size)) throw new Win32Exception(Marshal.GetLastWin32Error());
            } finally { Marshal.FreeHGlobal(limits); }
            if (ObserverDesktopName() != observer || (!interactive && InputDesktopName() == Name))
                throw new InvalidOperationException("Desktop creation changed the observer/input desktop");
            // Inherit only the test desktop. Its inheritable handle keeps native
            // child launches off Default; do not inherit arbitrary host handles.
            IntPtr attributeSize = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
            var attributes = Marshal.AllocHGlobal(attributeSize);
            var handles = Marshal.AllocHGlobal(IntPtr.Size);
            bool initialized = false;
            try {
                if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref attributeSize)) throw new Win32Exception(Marshal.GetLastWin32Error());
                initialized = true;
                Marshal.WriteIntPtr(handles, desktop);
                if (!UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
                var startup = new StartupInfoEx { startup = new StartupInfo { cb = Marshal.SizeOf(typeof(StartupInfoEx)), desktop = Name }, attributes = attributes };
                if (!CreateProcessWithAttributes(executable, new StringBuilder("\"" + executable + "\""), IntPtr.Zero, IntPtr.Zero,
                        true, 0x80004, IntPtr.Zero, cwd, ref startup, out info)) // extended startup + suspended
                    throw new Win32Exception(Marshal.GetLastWin32Error());
            } finally {
                if (initialized) DeleteProcThreadAttributeList(attributes);
                Marshal.FreeHGlobal(attributes); Marshal.FreeHGlobal(handles);
            }
            if (!AssignProcessToJobObject(job, info.process)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (ResumeThread(info.thread) == UInt32.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
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
            if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
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
        // Closing the job also releases the WebView and template child processes.
        var children = OwnedProcessIds();
        if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
        foreach (int pid in children) {
            try { using (var child = Process.GetProcessById(pid)) {
                if (!child.WaitForExit(5000)) throw new InvalidOperationException("Test job process did not exit");
            } } catch (ArgumentException) { /* Already exited. */ }
        }
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
