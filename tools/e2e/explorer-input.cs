using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;
using System.Windows.Automation;
using System.Windows.Forms;

// Bounded, explicit interactive test driver. No background-input claim, hooks,
// private Explorer interfaces, global settings, or retry of a failed drop.
public static class ExplorerInput {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct Mouse { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public Mouse Mouse; }
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    private delegate bool EnumWindow(IntPtr window, IntPtr value);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr value);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    public static IntPtr AppWindow(int pid, string title) {
        IntPtr found=IntPtr.Zero;
        EnumWindows(delegate(IntPtr window,IntPtr value) {
            uint owner; GetWindowThreadProcessId(window,out owner);
            var text=new StringBuilder(512); GetWindowText(window,text,text.Capacity);
            if(owner==pid && IsWindowVisible(window) && text.ToString()==title) {
                if(found!=IntPtr.Zero) throw new InvalidOperationException("Ambiguous test application window");
                found=window;
            }
            return true;
        },IntPtr.Zero);
        return found;
    }
    public static void Place(IntPtr window, bool explorer) {
        var previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            var r=Screen.PrimaryScreen.WorkingArea;
            int width=explorer ? Math.Max(500,(int)(r.Width*.36)) : r.Width;
            if(!SetWindowPos(window,IntPtr.Zero,r.Left,r.Top,width,r.Height,0x0050)) throw new InvalidOperationException("Could not place test window");
        } finally { SetThreadDpiAwarenessContext(previous); }
    }
    public static int[] ClientBounds(IntPtr window) {
        var previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
        try { Rect r; var p=new Point();
            if(!GetClientRect(window,out r)||!ClientToScreen(window,ref p)) throw new InvalidOperationException("No client bounds");
            return new [] {p.X,p.Y,r.Right-r.Left,r.Bottom-r.Top};
        } finally { SetThreadDpiAwarenessContext(previous); }
    }
    public static double[] SelectedItemBounds(IntPtr window, string filename) {
        var root=AutomationElement.FromHandle(window);
        var all=root.FindAll(TreeScope.Descendants,new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.ListItem),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.DataItem)));
        AutomationElement found=null;
        foreach(AutomationElement item in all) {
            if(item.Current.Name != filename && item.Current.Name != Path.GetFileNameWithoutExtension(filename)) continue;
            object pattern;
            if(!item.TryGetCurrentPattern(SelectionItemPattern.Pattern,out pattern)||!((SelectionItemPattern)pattern).Current.IsSelected) continue;
            if(found!=null) throw new InvalidOperationException("Ambiguous selected Explorer item");
            found=item;
        }
        if(found==null||found.Current.IsOffscreen) throw new InvalidOperationException("Selected Explorer item not visible");
        var rect=found.Current.BoundingRectangle;
        if(rect.IsEmpty||rect.Width<2||rect.Height<2) throw new InvalidOperationException("Selected item has no bounds");
        return new [] {rect.X,rect.Y,rect.Width,rect.Height};
    }
    public static void Screenshot(IntPtr window,string file) {
        var previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
        try { Rect r; if(!GetWindowRect(window,out r)) throw new InvalidOperationException("No window bounds");
            using(var bitmap=new Bitmap(r.Right-r.Left,r.Bottom-r.Top)) using(var g=Graphics.FromImage(bitmap)) {
                var dc=g.GetHdc(); bool captured;
                try { captured=PrintWindow(window,dc,2); } finally {g.ReleaseHdc(dc);}
                if(!captured) throw new InvalidOperationException("Explorer screenshot failed");
                bitmap.Save(file,ImageFormat.Png);
            }
        } finally {SetThreadDpiAwarenessContext(previous);}
    }
    private static void Send(uint flags,int x=0,int y=0) {
        var input=new Input {Type=0,Mouse=new Mouse {X=x,Y=y,Flags=flags}};
        if(SendInput(1,new [] {input},Marshal.SizeOf(typeof(Input)))!=1) throw new InvalidOperationException("Windows rejected test input; no retry");
    }
    private static void Move(int x,int y) {
        var r=SystemInformation.VirtualScreen;
        Send(0xC001,(int)Math.Round((x-r.Left)*65535.0/(r.Width-1)),(int)Math.Round((y-r.Top)*65535.0/(r.Height-1)));
    }
    public static void Drop(IntPtr source,IntPtr target,int sourceX,int sourceY,int targetX,int targetY,int targetPid) {
        var previous=SetThreadDpiAwarenessContext(new IntPtr(-4)); bool held=false;
        try {
            uint owner; GetWindowThreadProcessId(target,out owner);
            if(owner!=targetPid) throw new InvalidOperationException("Wrong target process");
            if(GetAncestor(WindowFromPoint(new Point {X=sourceX,Y=sourceY}),2)!=source || GetAncestor(WindowFromPoint(new Point {X=targetX,Y=targetY}),2)!=target)
                throw new InvalidOperationException("A drop point is covered by another window; no input sent");
            foreach(int key in new [] {1,2,16,17,18,27}) if(GetAsyncKeyState(key)<0) throw new InvalidOperationException("User input is held; no input sent");
            Move(sourceX,sourceY); Thread.Sleep(150); Send(2); held=true;
            for(int step=1;step<=16;step++) {
                if(GetAsyncKeyState(27)<0) throw new InvalidOperationException("Operator cancelled");
                Move(sourceX+(targetX-sourceX)*step/16,sourceY+(targetY-sourceY)*step/16); Thread.Sleep(25);
            }
            Thread.Sleep(150); Send(4); held=false;
        } finally { if(held) Send(4); SetThreadDpiAwarenessContext(previous); }
    }
}
