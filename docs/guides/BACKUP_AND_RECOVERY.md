# Disaster Recovery & Backup Procedures: HostelGuard Enterprise

## 1. Hot Database Backup Strategy (SQLite WAL Mode)

Because the database operates in WAL mode (`journal_mode = WAL`), simply copying the main `.sqlite` file while transactions are running can lead to an incomplete snapshot if writes are buffered in `.sqlite-wal`.

### Recommended Hot Backup Command
Use SQLite's native `.backup` online utility or the `VACUUM INTO` command:
```powershell
# Using SQLite CLI:
sqlite3 "backend/data/hostel_attendance.sqlite" "VACUUM INTO 'backend/data/backups/backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sqlite';"
```

This guarantees an atomic, non-locking, crash-consistent snapshot.

---

## 2. Automated Scheduled Backup Script

Create a scheduled task on Windows or cron job on Linux running daily at 02:00 AM:

```powershell
# backup_daily.ps1
$SourceDb = "E:\attendence_Hostel_system\backend\data\hostel_attendance.sqlite"
$BackupDir = "E:\attendence_Hostel_system\backend\data\backups"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$TargetFile = Join-Path $BackupDir "hostel_attendance_$Timestamp.sqlite"

if (!(Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

sqlite3 $SourceDb "VACUUM INTO '$TargetFile';"
Write-Host "Backup created: $TargetFile"

# Retain backups for 30 days
Get-ChildItem -Path $BackupDir -Filter "*.sqlite" |
    Where-Object { $_.CreationTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item
```

---

## 3. Recovery & Rollback Procedure

In the event of hardware failure or accidental data corruption:
1. Stop backend services:
   ```powershell
   # Stop Node.js process
   Stop-Process -Name "node" -Force
   ```
2. Archive the current corrupt database and associated WAL files:
   ```powershell
   Move-Item "backend/data/hostel_attendance.sqlite*" "backend/data/corrupted_archive/"
   ```
3. Copy the desired backup snapshot:
   ```powershell
   Copy-Item "backend/data/backups/hostel_attendance_20261014.sqlite" "backend/data/hostel_attendance.sqlite"
   ```
4. Verify database integrity:
   ```powershell
   sqlite3 "backend/data/hostel_attendance.sqlite" "PRAGMA integrity_check;"
   # Expected output: ok
   ```
5. Restart application services:
   ```powershell
   .\start_all.bat
   ```
