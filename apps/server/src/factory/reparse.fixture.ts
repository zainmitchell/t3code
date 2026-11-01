// @effect-diagnostics nodeBuiltinImport:off - builds disposable reparse-point fixtures for tests.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/**
 * On Windows, an NTFS mount point (IO_REPARSE_TAG_MOUNT_POINT) at `alias` whose substitute name
 * addresses `target` through its volume GUID. Node's lstat reports it as a plain directory, not a
 * link, which is the fixture a predecessor check must still refuse. Elsewhere, a directory symlink.
 */
export const createVolumeJunction = (target: string, alias: string): void => {
  // The path module, not a runtime global, tells a Windows host apart.
  if (NodePath.sep !== "\\") {
    NodeFS.symlinkSync(target, alias, "dir");
    return;
  }
  NodeFS.mkdirSync(alias);
  const script = NodePath.join(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "reparse-fixture-")),
    "volume-junction.ps1",
  );
  NodeFS.writeFileSync(script, VOLUME_JUNCTION_PS1);
  try {
    const out = NodeChildProcess.execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        NodePath.resolve(target),
        NodePath.resolve(alias),
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (!out.includes("set 1")) throw new Error(`volume junction not set: ${out}`);
  } finally {
    NodeFS.rmSync(NodePath.dirname(script), { recursive: true, force: true });
  }
};

// FSCTL_SET_REPARSE_POINT with a REPARSE_DATA_BUFFER whose substitute name is \??\Volume{GUID}\<path>.
const VOLUME_JUNCTION_PS1 = String.raw`
param([string]$Target, [string]$Alias)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Reparse {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool DeviceIoControl(IntPtr handle, uint code, byte[] inBuffer, uint inSize, IntPtr outBuffer, uint outSize, out uint returned, IntPtr overlapped);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool GetVolumeNameForVolumeMountPointW(string mountPoint, System.Text.StringBuilder name, uint length);
}
"@
$root = [System.IO.Path]::GetPathRoot($Target)
$volume = New-Object System.Text.StringBuilder 1024
if (-not [Reparse]::GetVolumeNameForVolumeMountPointW($root, $volume, 1024)) { throw "no volume for $root" }
$substitute = "\??\" + $volume.ToString().Substring(4) + $Target.Substring($root.Length)
$sub = [System.Text.Encoding]::Unicode.GetBytes($substitute)
$print = [System.Text.Encoding]::Unicode.GetBytes($Target)
$data = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($data)
$w.Write([uint16]0); $w.Write([uint16]$sub.Length); $w.Write([uint16]($sub.Length + 2)); $w.Write([uint16]$print.Length)
$w.Write($sub); $w.Write([byte[]]@(0,0)); $w.Write($print); $w.Write([byte[]]@(0,0))
$payload = $data.ToArray()
$buffer = New-Object System.IO.MemoryStream
$b = New-Object System.IO.BinaryWriter($buffer)
# IO_REPARSE_TAG_MOUNT_POINT = 0xA0000003; written as decimal because PowerShell 5.1 reads the hex literal as a negative Int32.
$b.Write([uint32]2684354563); $b.Write([uint16]$payload.Length); $b.Write([uint16]0); $b.Write($payload)
$bytes = $buffer.ToArray()
$handle = [Reparse]::CreateFileW($Alias, 0x40000000, 7, [IntPtr]::Zero, 3, 0x02200000, [IntPtr]::Zero)
if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1)) { throw "open alias failed" }
$returned = [uint32]0
$ok = [Reparse]::DeviceIoControl($handle, 0x900A4, $bytes, [uint32]$bytes.Length, [IntPtr]::Zero, 0, [ref]$returned, [IntPtr]::Zero)
$err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
[void][Reparse]::CloseHandle($handle)
Write-Output ("set " + [int][bool]$ok + " error " + $err)
`;
