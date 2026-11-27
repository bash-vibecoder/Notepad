# CI only: exercise the real shell dialog using its filename keyboard shortcut.
param([long]$WindowHandle, [string]$FilePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DialogFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
[void][DialogFocus]::SetForegroundWindow([IntPtr]$WindowHandle)
Start-Sleep -Milliseconds 250
if ([DialogFocus]::GetForegroundWindow() -ne [IntPtr]$WindowHandle) {
    throw 'The native dialog could not receive keyboard input'
}
# Clipboard paste preserves Unicode and treats SendKeys metacharacters literally.
Set-Clipboard -Value $FilePath
[System.Windows.Forms.SendKeys]::SendWait('%n')
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait('^a')
[System.Windows.Forms.SendKeys]::SendWait('^v')
[System.Windows.Forms.SendKeys]::SendWait('{TAB}')
Start-Sleep -Milliseconds 150
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
[void](New-Item -ItemType Directory -Force 'build/screenshots')
$bitmap.Save((Join-Path (Get-Location) 'build/screenshots/shared-native-dialog.png'))
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "Native filename keyboard input: $FilePath"
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
