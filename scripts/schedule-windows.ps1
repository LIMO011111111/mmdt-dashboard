# Registers a daily Windows Task Scheduler job (06:00) that rebuilds the dashboard.
# Run once in PowerShell:  .\scripts\schedule-windows.ps1     (remove with -Remove)
param([switch]$Remove, [string]$At = "06:00")

$name = "mmdt-dashboard build"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if ($Remove) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Host "Removed task '$name'."
    exit
}
$py = (Get-Command py -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command python -ErrorAction Stop).Source }
$action = New-ScheduledTaskAction -Execute $py -Argument "scripts\build_dashboard.py" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Task '$name' runs daily at $At in $root (also when the time was missed while the PC was off)."
