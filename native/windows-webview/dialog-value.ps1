# CI only: address the shell's accessible filename field, including DirectUI.
param([long]$WindowHandle, [string]$FilePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$WindowHandle)
$editCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit)
$comboCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::ComboBox)
$condition = New-Object System.Windows.Automation.OrCondition($editCondition, $comboCondition)
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    foreach ($edit in $edits) {
        $name = $edit.Current.Name.Replace('&', '')
        if ($name -notmatch '^(File name|Folder)(:|$)') { continue }
        $value = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($value.Current.IsReadOnly) { continue }
        $value.SetValue($FilePath)
        if ($value.Current.Value -ne $FilePath) { throw 'Filename field did not retain the test path' }
        Write-Output "Native filename field: $($edit.Current.AutomationId) $name $FilePath"
        exit 0
    }
    Start-Sleep -Milliseconds 250
}
foreach ($edit in $edits) {
    Write-Output "Available field: $($edit.Current.ControlType.ProgrammaticName) $($edit.Current.AutomationId) $($edit.Current.Name)"
}
throw 'The native filename field was not accessible'
