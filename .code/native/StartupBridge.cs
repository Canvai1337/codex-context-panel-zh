using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

// Windows invokes this short-lived helper before the package's initial thread
// runs. Only the command-line data is changed; no code or application file is
// patched. The initial thread is resumed even when panel setup fails.
internal static class StartupBridge
{
    internal sealed class Config
    {
        public string executablePath { get; set; }
        public string nodePath { get; set; }
        public string daemonPath { get; set; }
        public string servicePath { get; set; }
        public string stateRoot { get; set; }
        public string userDataDirectory { get; set; }
        public bool launchDaemon = true;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicInformation
    {
        public IntPtr ExitStatus, PebBaseAddress, AffinityMask, BasePriority,
            UniqueProcessId, InheritedFromUniqueProcessId;
    }

    [ComImport, Guid("F27C3930-8029-4AD1-94E3-3DBA417810C1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPackageDebugSettings
    {
        [PreserveSig] int EnableDebugging([MarshalAs(UnmanagedType.LPWStr)] string package,
            [MarshalAs(UnmanagedType.LPWStr)] string debugger, IntPtr environment);
        [PreserveSig] int DisableDebugging([MarshalAs(UnmanagedType.LPWStr)] string package);
    }

    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenThread(uint access, bool inherit, uint tid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint GetProcessIdOfThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsWow64Process(IntPtr process, out bool wow64);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder path, ref uint size);
    [DllImport("ntdll.dll")] private static extern int NtQueryInformationProcess(IntPtr process, int infoClass,
        out BasicInformation info, int size, out int returned);
    [DllImport("ntdll.dll")] private static extern int NtQueryInformationThread(IntPtr thread, int infoClass,
        out uint info, int size, out int returned);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ReadProcessMemory(IntPtr process,
        IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr read);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool WriteProcessMemory(IntPtr process,
        IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr written);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr VirtualAllocEx(IntPtr process,
        IntPtr address, UIntPtr size, uint allocationType, uint protection);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool VirtualFreeEx(IntPtr process,
        IntPtr address, UIntPtr size, uint freeType);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CommandLineToArgvW(string commandLine, out int argc);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);

    private static Exception Error(string action) { return new Win32Exception(Marshal.GetLastWin32Error(), action); }
    private static byte[] Read(IntPtr process, IntPtr address, int count)
    {
        byte[] bytes = new byte[count]; UIntPtr read;
        if (!ReadProcessMemory(process, address, bytes, (UIntPtr)count, out read) || read.ToUInt64() != (ulong)count)
            throw Error("Read startup parameters");
        return bytes;
    }
    private static void Write(IntPtr process, IntPtr address, byte[] bytes)
    {
        UIntPtr written;
        if (!WriteProcessMemory(process, address, bytes, (UIntPtr)bytes.Length, out written) || written.ToUInt64() != (ulong)bytes.Length)
            throw Error("Write startup parameters");
    }
    private static string[] Arguments(string command)
    {
        int count; IntPtr pointer = CommandLineToArgvW(command, out count);
        if (pointer == IntPtr.Zero) throw Error("Parse startup parameters");
        try { string[] args = new string[count]; for (int i = 0; i < count; i++) args[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer, i * IntPtr.Size)); return args; }
        finally { LocalFree(pointer); }
    }
    private static string Patch(IntPtr process, Config config)
    {
        if (IntPtr.Size != 8) throw new NotSupportedException("The bridge requires Windows x64");
        bool wow64; if (!IsWow64Process(process, out wow64) || wow64) throw new NotSupportedException("The target must be x64");
        uint length = 32768; StringBuilder image = new StringBuilder((int)length);
        if (!QueryFullProcessImageName(process, 0, image, ref length)) throw Error("Identify startup process");
        if (!String.Equals(Path.GetFullPath(image.ToString()), Path.GetFullPath(config.executablePath), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Startup target does not match the installed application");
        BasicInformation info; int returned;
        if (NtQueryInformationProcess(process, 0, out info, Marshal.SizeOf(typeof(BasicInformation)), out returned) != 0)
            throw new InvalidOperationException("Cannot query startup parameters");
        // PEB.ProcessParameters and RTL_USER_PROCESS_PARAMETERS.CommandLine on x64.
        IntPtr parametersAddress = IntPtr.Add(info.PebBaseAddress, 0x20);
        byte[] originalParameters = Read(process, parametersAddress, 8);
        IntPtr parameters = new IntPtr(BitConverter.ToInt64(originalParameters, 0));
        IntPtr address = IntPtr.Add(parameters, 0x70);
        byte[] original = Read(process, address, 16);
        int byteLength = BitConverter.ToUInt16(original, 0), maximum = BitConverter.ToUInt16(original, 2);
        if (byteLength == 0 || byteLength % 2 != 0 || maximum < byteLength) throw new InvalidOperationException("Invalid startup command line");
        string command = Encoding.Unicode.GetString(Read(process, new IntPtr(BitConverter.ToInt64(original, 8)), byteLength));
        string[] args = Arguments(command); string profile = null;
        foreach (string arg in args)
        {
            if (arg.StartsWith("--type=", StringComparison.Ordinal)) return null;
            if (arg.StartsWith("--user-data-dir=", StringComparison.Ordinal)) profile = arg.Substring("--user-data-dir=".Length);
            if (arg.StartsWith("--remote-debugging-port=", StringComparison.Ordinal)) return null;
        }
        if (profile == null) profile = config.userDataDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Codex", "web", "Codex");
        string updated = command + " --remote-debugging-port=0 --remote-debugging-address=127.0.0.1";
        byte[] text = Encoding.Unicode.GetBytes(updated + "\0");
        if (text.Length > 65534) throw new InvalidOperationException("Startup command line is too long");
        byte[] header = Read(process, parameters, 16);
        int maximumLength = BitConverter.ToInt32(header, 0);
        if (maximumLength < 0x80 || maximumLength > 1024 * 1024 || (BitConverter.ToUInt32(header, 8) & 1) == 0)
            throw new InvalidOperationException("Unsupported startup parameter layout");
        // The loader relocates the parameter block during initialization. A
        // command-line buffer outside that block is not valid at this stage.
        int textOffset = (maximumLength + 15) & ~15;
        int newLength = checked(textOffset + text.Length);
        byte[] replacement = new byte[newLength];
        Buffer.BlockCopy(Read(process, parameters, maximumLength), 0, replacement, 0, maximumLength);
        IntPtr allocation = VirtualAllocEx(process, IntPtr.Zero, (UIntPtr)newLength, 0x3000, 0x04);
        if (allocation == IntPtr.Zero) throw Error("Allocate startup parameters");
        bool committed = false;
        try
        {
            long oldBase = parameters.ToInt64(), newBase = allocation.ToInt64();
            for (int offset = 0; offset + 8 <= maximumLength; offset += 8)
            {
                long pointer = BitConverter.ToInt64(replacement, offset);
                if (pointer >= oldBase && pointer < oldBase + maximumLength)
                    Buffer.BlockCopy(BitConverter.GetBytes(newBase + pointer - oldBase), 0, replacement, offset, 8);
            }
            Buffer.BlockCopy(BitConverter.GetBytes(newLength), 0, replacement, 0, 4);
            Buffer.BlockCopy(BitConverter.GetBytes(newLength), 0, replacement, 4, 4);
            Buffer.BlockCopy(BitConverter.GetBytes((ushort)(text.Length - 2)), 0, replacement, 0x70, 2);
            Buffer.BlockCopy(BitConverter.GetBytes((ushort)text.Length), 0, replacement, 0x72, 2);
            Buffer.BlockCopy(BitConverter.GetBytes(newBase + textOffset), 0, replacement, 0x78, 8);
            Buffer.BlockCopy(text, 0, replacement, textOffset, text.Length);
            Write(process, allocation, replacement);
            try { Write(process, parametersAddress, BitConverter.GetBytes(newBase)); committed = true; }
            catch { Write(process, parametersAddress, originalParameters); throw; }
        }
        finally { if (!committed) VirtualFreeEx(process, allocation, UIntPtr.Zero, 0x8000); }
        return Path.Combine(profile, "DevToolsActivePort");
    }
    private static int Register(string package, bool remove)
    {
        if (!package.StartsWith("OpenAI.Codex_", StringComparison.Ordinal) || !package.EndsWith("__2p2nqsd0c76g0", StringComparison.Ordinal))
            throw new InvalidOperationException("Only the Codex application package is supported");
        IPackageDebugSettings settings = (IPackageDebugSettings)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("B1AEC16F-2383-4852-B0E9-8F0B1DC66B4D")));
        try
        {
            string helper = Process.GetCurrentProcess().MainModule.FileName;
            int result = remove ? settings.DisableDebugging(package) : settings.EnableDebugging(package, "\"" + helper + "\"", IntPtr.Zero);
            Marshal.ThrowExceptionForHR(result); return 0;
        }
        finally { Marshal.ReleaseComObject(settings); }
    }
    private sealed class RuntimeInfo { public uint? ownerPid { get; set; } }
    private static uint RuntimeOwner(Config config, uint fallback)
    {
        // A second activation can forward to an existing main process and exit.
        // Reuse the previously verified owner when recovering its panel service.
        try
        {
            RuntimeInfo runtime = new JavaScriptSerializer().Deserialize<RuntimeInfo>(File.ReadAllText(Path.Combine(config.stateRoot, "runtime.json"), Encoding.UTF8));
            if (!runtime.ownerPid.HasValue || runtime.ownerPid.Value == fallback) return fallback;
            IntPtr process = OpenProcess(0x1000, false, runtime.ownerPid.Value);
            if (process == IntPtr.Zero) return fallback;
            try
            {
                uint exit; uint size = 32768; StringBuilder image = new StringBuilder((int)size);
                if (GetExitCodeProcess(process, out exit) && exit == 259 && QueryFullProcessImageName(process, 0, image, ref size) &&
                    String.Equals(Path.GetFullPath(image.ToString()), Path.GetFullPath(config.executablePath), StringComparison.OrdinalIgnoreCase)) return runtime.ownerPid.Value;
            }
            finally { CloseHandle(process); }
        }
        catch { }
        return fallback;
    }
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 2 && (args[0] == "--register" || args[0] == "--unregister"))
        { try { return Register(args[1], args[0] == "--unregister"); } catch { return 5; } }
        uint pid = 0, tid = 0;
        for (int i = 0; i + 1 < args.Length; i++)
        {
            if (args[i] == "-p") UInt32.TryParse(args[i + 1], out pid);
            if (args[i] == "-tid") UInt32.TryParse(args[i + 1], out tid);
        }
        if (pid == 0 || tid == 0) return 2;
        IntPtr thread = OpenThread(0x0042, false, tid); // query + suspend/resume
        if (thread == IntPtr.Zero) return 3;
        if (GetProcessIdOfThread(thread) != pid) { CloseHandle(thread); return 4; }
        IntPtr process = IntPtr.Zero; Config config = null; string portFile = null, failure = null;
        Stopwatch elapsed = Stopwatch.StartNew();
        string stateRoot = Environment.GetEnvironmentVariable("CODEX_PANEL_STATE_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Packages", "OpenAI.Codex_2p2nqsd0c76g0", "LocalCache", "Local", "CodexContextPanel");
        try
        {
            uint suspendCount; int returned;
            if (NtQueryInformationThread(thread, 35, out suspendCount, 4, out returned) != 0 || suspendCount == 0)
                throw new InvalidOperationException("The target is not a suspended startup thread");
            string directory = AppDomain.CurrentDomain.BaseDirectory;
            config = new JavaScriptSerializer().Deserialize<Config>(File.ReadAllText(Path.Combine(directory, "bridge-config.json"), Encoding.UTF8));
            if (!String.IsNullOrEmpty(config.stateRoot)) stateRoot = config.stateRoot;
            process = OpenProcess(0x0438, false, pid); // query + VM operation/read/write
            if (process == IntPtr.Zero) throw Error("Open startup process");
            portFile = Patch(process, config);
        }
        catch (Exception error)
        {
            failure = error.Message;
            try { Directory.CreateDirectory(stateRoot); File.AppendAllText(Path.Combine(stateRoot, "startup-error.log"), DateTime.UtcNow.ToString("o") + " " + error.Message + Environment.NewLine); } catch { }
        }
        try { Directory.CreateDirectory(stateRoot); File.WriteAllText(Path.Combine(stateRoot, "startup-status.json"), new JavaScriptSerializer().Serialize(new { pid, tid, patched = portFile != null, failure, milliseconds = elapsed.ElapsedMilliseconds, updatedAt = DateTime.UtcNow.ToString("o") })); } catch { }
        finally
        {
            ResumeThread(thread); CloseHandle(thread);
            if (process != IntPtr.Zero) CloseHandle(process);
        }
        if (portFile != null && config != null && config.launchDaemon)
        {
            try
            {
                ProcessStartInfo start = new ProcessStartInfo(config.nodePath,
                    "\"" + (config.servicePath ?? config.daemonPath) + "\" --owner-pid " + RuntimeOwner(config, pid) + " --port-file \"" + portFile + "\"");
                start.UseShellExecute = false; start.CreateNoWindow = true;
                start.WorkingDirectory = Path.GetDirectoryName(config.servicePath ?? config.daemonPath);
                start.EnvironmentVariables["CODEX_PANEL_STATE_DIR"] = config.stateRoot;
                Process.Start(start);
            }
            catch (Exception error)
            {
                try { File.AppendAllText(Path.Combine(stateRoot, "startup-error.log"), DateTime.UtcNow.ToString("o") + " service-start: " + error.Message + Environment.NewLine); } catch { }
            }
        }
        return 0;
    }
}
