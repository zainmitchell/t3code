/**
 * Source of `t3-custody`, the Windows helper behind execution containment. It ships inside the
 * server bundle and is compiled on the host by the .NET Framework compiler Windows includes, so
 * the binary always matches this exact text. `__T3_CUSTODY_KEY__` is replaced by the cache key.
 */
export const CUSTODY_HELPER_SOURCE = String.raw`// t3-custody: the Windows half of T3's execution containment. One job object per generation,
// created once by its holder, which alone assigns members. Modes:
//   version                      the source key this binary was built from
//   identity                     "identity <machine> <session>"
//   hold <name>                  create the job; then serve "count", "assign <pid>", "close" on stdin
//   join <name> -- <cmd> <args>  wait until the holder assigned this process, then run the command
//   probe <name>                 "absent", "active <n>" or "unreadable <code>"
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

static class T3Custody {
  const string Key = "__T3_CUSTODY_KEY__";

  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimit { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimit { public BasicLimit Basic; public IoCounters Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [StructLayout(LayoutKind.Sequential)]
  struct BasicAccounting { public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime; public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct StartupInfo { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)]
  struct StartupInfoEx { public StartupInfo StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInformation { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenJobObjectW(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimit info, int length);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out BasicAccounting info, int length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateEventW(IntPtr attributes, bool manualReset, bool initialState, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetEvent(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, int length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr process, int flags, StringBuilder name, ref int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetFileType(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnSize);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessW(string app, StringBuilder commandLine, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfoEx si, out ProcessInformation pi);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool ProcessIdToSessionId(int pid, out int session);
  [DllImport("kernel32.dll")] static extern int GetCurrentProcessId();

  const uint KillOnJobClose = 0x2000;
  const uint JobAssign = 0x1, JobQuery = 0x4;
  const uint ProcessAssignRights = 0x0001 | 0x0100 | 0x0200 | 0x1000; // terminate, set quota, query, query limited
  const int ErrorFileNotFound = 2, ErrorAlreadyExists = 183;
  const uint ExtendedStartupInfoPresent = 0x80000;
  const uint CreateSuspended = 0x4;
  const uint StartfUseStdHandles = 0x100;
  const uint Infinite = 0xFFFFFFFF;
  static readonly IntPtr HandleListAttribute = (IntPtr)0x20002;

  static int Main(string[] args) {
    try {
      if (args.Length == 1 && args[0] == "version") { Console.WriteLine("version " + Key); return 0; }
      if (args.Length == 1 && args[0] == "identity") { Console.WriteLine(Identity()); return 0; }
      if (args.Length == 2 && args[0] == "probe") return Probe(args[1]);
      if (args.Length == 2 && args[0] == "hold") return Hold(args[1]);
      if (args.Length >= 4 && args[0] == "join" && args[2] == "--") return Join(args[1], args, 3);
      Console.Error.WriteLine("t3-custody: usage");
      return 64;
    } catch (Exception error) {
      Console.Error.WriteLine("t3-custody: " + error.Message);
      return 65;
    }
  }

  static string Identity() {
    string machine = "unknown";
    using (Microsoft.Win32.RegistryKey root = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.LocalMachine, Microsoft.Win32.RegistryView.Registry64))
    using (Microsoft.Win32.RegistryKey crypto = root.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography")) {
      object value = crypto == null ? null : crypto.GetValue("MachineGuid");
      if (value != null) machine = value.ToString();
    }
    int session;
    if (!ProcessIdToSessionId(GetCurrentProcessId(), out session)) throw new Win32Exception();
    return "identity " + machine + " " + session;
  }

  static string EventName(string name, int pid) { return name + "-assigned-" + pid; }

  // The console host Windows starts for a console process joins its job and outlives its last
  // client briefly; it runs nothing of the execution's, so it is not counted as a member.
  static readonly string ConsoleHost = System.IO.Path.Combine(Environment.SystemDirectory, "conhost.exe");

  static int CountMembers(IntPtr job) {
    int capacity = 64;
    for (;;) {
      int size = 8 + IntPtr.Size * capacity;
      IntPtr buffer = Marshal.AllocHGlobal(size);
      try {
        if (!QueryInformationJobObject(job, 3, buffer, size, IntPtr.Zero)) {
          if (Marshal.GetLastWin32Error() == 234) { capacity *= 2; continue; }
          return -1;
        }
        int listed = Marshal.ReadInt32(buffer, 4);
        int members = 0;
        for (int i = 0; i < listed; i++) {
          int pid = (int)Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt64();
          IntPtr process = OpenProcess(0x1000, false, pid);
          if (process == IntPtr.Zero) { members++; continue; }
          // A process can stay listed after it terminated while someone still holds its handle;
          // it runs nothing.
          uint exitCode;
          if (GetExitCodeProcess(process, out exitCode) && exitCode != 259) { CloseHandle(process); continue; }
          StringBuilder image = new StringBuilder(1024);
          int length = image.Capacity;
          bool named = QueryFullProcessImageNameW(process, 0, image, ref length);
          CloseHandle(process);
          if (named && string.Equals(image.ToString(), ConsoleHost, StringComparison.OrdinalIgnoreCase)) continue;
          members++;
        }
        return members;
      } finally { Marshal.FreeHGlobal(buffer); }
    }
  }

  static int Probe(string name) {
    Console.WriteLine(Identity());
    IntPtr job = OpenJobObjectW(JobQuery, false, name);
    if (job == IntPtr.Zero) {
      int error = Marshal.GetLastWin32Error();
      Console.WriteLine(error == ErrorFileNotFound ? "absent" : "unreadable " + error);
      return 0;
    }
    try {
      BasicAccounting accounting;
      if (!QueryInformationJobObject(job, 1, out accounting, Marshal.SizeOf(typeof(BasicAccounting)), IntPtr.Zero)) {
        Console.WriteLine("unreadable " + Marshal.GetLastWin32Error());
        return 0;
      }
      Console.WriteLine("active " + accounting.ActiveProcesses);
      return 0;
    } finally { CloseHandle(job); }
  }

  static int Hold(string name) {
    Console.WriteLine(Identity());
    IntPtr job = CreateJobObjectW(IntPtr.Zero, name);
    int created = Marshal.GetLastWin32Error();
    if (job == IntPtr.Zero) { Console.WriteLine("failed create " + created); return 3; }
    if (created == ErrorAlreadyExists) { CloseHandle(job); Console.WriteLine("failed exists"); return 3; }
    ExtendedLimit limit = new ExtendedLimit();
    limit.Basic.LimitFlags = KillOnJobClose;
    if (!SetInformationJobObject(job, 9, ref limit, Marshal.SizeOf(typeof(ExtendedLimit)))) {
      Console.WriteLine("failed limit " + Marshal.GetLastWin32Error());
      CloseHandle(job);
      return 3;
    }
    Console.WriteLine("ready");
    Console.Out.Flush();
    // Assignment events stay open until the holder ends, so a join that opens its event late still
    // finds it signalled.
    List<IntPtr> events = new List<IntPtr>();
    for (;;) {
      string line = Console.In.ReadLine();
      if (line == null || line == "close") break;
      if (line == "count") {
        int members = CountMembers(job);
        Console.WriteLine(members < 0 ? "failed count " + Marshal.GetLastWin32Error() : "members " + members);
      } else if (line.StartsWith("assign ")) {
        int pid;
        if (!int.TryParse(line.Substring(7), out pid)) { Console.WriteLine("failed assign"); Console.Out.Flush(); continue; }
        IntPtr process = OpenProcess(ProcessAssignRights, false, pid);
        if (process == IntPtr.Zero) { Console.WriteLine("failed assign " + pid + " " + Marshal.GetLastWin32Error()); Console.Out.Flush(); continue; }
        bool assigned = AssignProcessToJobObject(job, process);
        int assignError = Marshal.GetLastWin32Error();
        CloseHandle(process);
        if (!assigned) { Console.WriteLine("failed assign " + pid + " " + assignError); Console.Out.Flush(); continue; }
        IntPtr signal = CreateEventW(IntPtr.Zero, true, false, EventName(name, pid));
        if (signal == IntPtr.Zero || !SetEvent(signal)) { Console.WriteLine("failed signal " + pid); Console.Out.Flush(); continue; }
        events.Add(signal);
        Console.WriteLine("assigned " + pid);
      } else {
        Console.WriteLine("failed unknown");
      }
      Console.Out.Flush();
    }
    foreach (IntPtr signal in events) CloseHandle(signal);
    // Closing the only handle ends every member.
    CloseHandle(job);
    return 0;
  }

  static int Join(string name, string[] args, int start) {
    int self = GetCurrentProcessId();
    IntPtr signal = CreateEventW(IntPtr.Zero, true, false, EventName(name, self));
    if (signal == IntPtr.Zero) return 74;
    WaitForSingleObject(signal, Infinite);
    CloseHandle(signal);
    // The event name is guessable by the same user, so membership is checked, not assumed.
    IntPtr job = OpenJobObjectW(JobQuery, false, name);
    if (job == IntPtr.Zero) return Marshal.GetLastWin32Error() == ErrorFileNotFound ? 70 : 71;
    bool member;
    bool checkedMembership = IsProcessInJob(GetCurrentProcess(), job, out member);
    // A holder that ended meanwhile leaves this handle the last one: closing it ends this process.
    CloseHandle(job);
    if (!checkedMembership || !member) return 73;
    return Run(args, start);
  }

  static string Quote(string argument) {
    if (argument.Length > 0 && argument.IndexOfAny(new char[] { ' ', '\t', '"' }) < 0) return argument;
    StringBuilder quoted = new StringBuilder("\"");
    int backslashes = 0;
    foreach (char c in argument) {
      if (c == '\\') { backslashes++; continue; }
      if (c == '"') { quoted.Append('\\', backslashes * 2 + 1); quoted.Append('"'); backslashes = 0; continue; }
      quoted.Append('\\', backslashes); backslashes = 0; quoted.Append(c);
    }
    quoted.Append('\\', backslashes * 2);
    quoted.Append('"');
    return quoted.ToString();
  }

  static int Run(string[] args, int start) {
    StringBuilder commandLine = new StringBuilder();
    for (int i = start; i < args.Length; i++) {
      if (i > start) commandLine.Append(' ');
      commandLine.Append(Quote(args[i]));
    }
    IntPtr[] std = new IntPtr[] { GetStdHandle(-10), GetStdHandle(-11), GetStdHandle(-12) };
    // Pipes and files are handed over explicitly and nothing else is inherited; a console
    // (a terminal's pseudo-console) is attached to by the child itself.
    List<IntPtr> inherited = new List<IntPtr>();
    foreach (IntPtr handle in std) {
      if (handle == IntPtr.Zero || handle == (IntPtr)(-1)) continue;
      uint type = GetFileType(handle);
      if (type == 1 || type == 3) {
        SetHandleInformation(handle, 1, 1);
        if (!inherited.Contains(handle)) inherited.Add(handle);
      }
    }
    StartupInfoEx si = new StartupInfoEx();
    si.StartupInfo.cb = Marshal.SizeOf(typeof(StartupInfoEx));
    IntPtr list = IntPtr.Zero, handles = IntPtr.Zero;
    // The command runs in a job of this join's own, nested in the container: when this join ends,
    // however it ends, the command and everything it started end with it, as the provider's own
    // process group would. The container still counts every one of them while they run.
    IntPtr own = CreateJobObjectW(IntPtr.Zero, null);
    if (own == IntPtr.Zero) { Console.Error.WriteLine("t3-custody: no job for the command"); return 75; }
    ExtendedLimit ownLimit = new ExtendedLimit();
    ownLimit.Basic.LimitFlags = KillOnJobClose;
    if (!SetInformationJobObject(own, 9, ref ownLimit, Marshal.SizeOf(typeof(ExtendedLimit)))) { Console.Error.WriteLine("t3-custody: no limit for the command"); return 75; }
    uint flags = CreateSuspended;
    bool inherit = inherited.Count > 0;
    if (inherit) {
      si.StartupInfo.dwFlags = (int)StartfUseStdHandles;
      si.StartupInfo.hStdInput = std[0]; si.StartupInfo.hStdOutput = std[1]; si.StartupInfo.hStdError = std[2];
      IntPtr size = IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
      list = Marshal.AllocHGlobal(size);
      if (!InitializeProcThreadAttributeList(list, 1, 0, ref size)) throw new Win32Exception();
      handles = Marshal.AllocHGlobal(IntPtr.Size * inherited.Count);
      for (int i = 0; i < inherited.Count; i++) Marshal.WriteIntPtr(handles, i * IntPtr.Size, inherited[i]);
      if (!UpdateProcThreadAttribute(list, 0, HandleListAttribute, handles, (IntPtr)(IntPtr.Size * inherited.Count), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
      si.lpAttributeList = list;
      flags |= ExtendedStartupInfoPresent;
    }
    ProcessInformation pi;
    bool started = CreateProcessW(null, commandLine, IntPtr.Zero, IntPtr.Zero, inherit, flags, IntPtr.Zero, null, ref si, out pi);
    int spawnError = Marshal.GetLastWin32Error();
    if (list != IntPtr.Zero) { DeleteProcThreadAttributeList(list); Marshal.FreeHGlobal(list); }
    if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
    if (!started) { Console.Error.WriteLine("t3-custody: cannot start " + args[start] + " (" + spawnError + ")"); return 127; }
    if (!AssignProcessToJobObject(own, pi.hProcess)) {
      Console.Error.WriteLine("t3-custody: cannot place " + args[start] + " (" + Marshal.GetLastWin32Error() + ")");
      TerminateProcess(pi.hProcess, 76);
      CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
      return 76;
    }
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    WaitForSingleObject(pi.hProcess, Infinite);
    uint code;
    GetExitCodeProcess(pi.hProcess, out code);
    CloseHandle(pi.hProcess);
    return (int)code;
  }
}
`;
