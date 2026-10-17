# Create a Bootable Windows USB

## 1. Partition the Drive

Open Command Prompt as Administrator and run the following commands in order:

1. Open the disk partition utility:
```cmd
diskpart
```

2. List all connected storage drives:
```cmd
list disk
```

3. Select your USB drive (**`X` is your USB disk number**):
```cmd
select disk X
```

4. Wipe all existing data and partitions from the USB:
```cmd
clean
```

5. Initialize the disk as GPT for UEFI booting:
```cmd
convert gpt
```

6. Create a primary partition for the boot files:
```cmd
create partition primary size=1024
```

7. Format as FAT32 and label it `BOOT`:
```cmd
format fs=fat32 quick label="BOOT"
```

8. Assign a drive letter so it appears in File Explorer:
```cmd
assign
```

9. Create another partition using the remaining space on the USB:
```cmd
create partition primary
```

10. Format the partition as NTFS and label it `DATA`:
```cmd
format fs=ntfs quick label="DATA"
```

11. Assign a drive letter to the partition:
```cmd
assign
```

12. Close the diskpart utility:
```cmd
exit
```

## 2. Copy ISO Files

Mount your Windows ISO file by double-clicking it, then run the following commands (replace `F:` with your mounted ISO drive letter, `D:` with your `BOOT` partition letter, and `E:` with your `DATA` partition letter):

1. Copy everything except the `sources` folder from the ISO to the `BOOT` (FAT32) partition:
```cmd
robocopy F:\ D:\ /E /XD sources
```

2. Copy only `boot.wim` from the ISO's `sources` folder into `BOOT\sources\`:
```cmd
robocopy F:\sources D:\sources boot.wim
```

3. Copy the entire ISO to the `DATA` (NTFS) partition:
```cmd
robocopy F:\ E:\ /E
```
