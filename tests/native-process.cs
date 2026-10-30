using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PanelFixtureProcess
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct Startup
    {
        public int cb; public string reserved, desktop, title;
        public int x, y, xSize, ySize, xCount, yCount, fill, flags;
        public short show, reserved2; public IntPtr reservedPointer, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)] public struct Info { public IntPtr process, thread; public uint pid, tid; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string app, StringBuilder command, IntPtr process, IntPtr thread,
        bool inherit, uint flags, IntPtr environment, string cwd, ref Startup startup, out Info info);
    [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] public static extern bool TerminateProcess(IntPtr handle, uint code);
    [DllImport("kernel32.dll")] public static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    public static Info Start(string app, string command) { return Start(app, command, null); }
    public static Info Start(string app, string command, string environment)
    {
        Startup startup = new Startup(); startup.cb = Marshal.SizeOf(startup);
        IntPtr block = environment == null ? IntPtr.Zero : Marshal.StringToHGlobalUni(environment);
        try
        {
            Info info;
            if (!CreateProcess(app, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, false,
                0x08000404, block, null, ref startup, out info)) throw new System.ComponentModel.Win32Exception();
            return info;
        }
        finally { if (block != IntPtr.Zero) Marshal.FreeHGlobal(block); }
    }
}
