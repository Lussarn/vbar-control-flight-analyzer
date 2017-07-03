const ref = require("ref");
const ffi = require("ffi");
const fs = require("fs");
const path = require("path");

///////////////////////////////////////////////////////////////////////////////
//////// VBAR CONTROL PATH WIN32 //////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
function getVControlPath_win32() {
   // vcontrol variable
   var vcontrolPath = null;

   // Check insertion of vcontrol WIN32
   var kernel32 = ffi.Library( 'kernel32.dll' ,
   {
      // ULONG __stdcall GetLogicalDrives();
      'GetLogicalDrives' : [ ref.types.ulong , [] , {abi : ffi.FFI_STDCALL }  ],
      'GetDriveTypeA' : [ ref.types.uint , [ ref.types.CString] , {abi : ffi.FFI_STDCALL }  ],
   });

   var bitmask = kernel32.GetLogicalDrives();
   var i;
   for (i = 0; i < 26; i++) {
      var bit = 2 ** i;
      if (bit & bitmask) {
         var mountpoint = String.fromCharCode(65 + i) + ":\\";
         var driveType =  kernel32.GetDriveTypeA(mountpoint);
         if (driveType == 2) {
            if (fs.existsSync(path.join(mountpoint, "vcontrol.id"))) {
               vcontrolPath = mountpoint;
               break;
            }
         }
      }
   }
   return vcontrolPath;
}

///////////////////////////////////////////////////////////////////////////////
//////// VBAR CONTROL PATH LINUX //////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
function getVControlPath_linux() {
   // vcontrol variable
   var vcontrolPath = null;

   // Read mtab for all mounts
   var lines = fs.readFileSync("/etc/mtab", "utf8").trim().split("\n");
   var mountpoints = {};
   for (var i = 0; i < lines.length; i++) {
   	var cols = lines[i].split(" ");
   	var dev = cols[0];
   	var mountpoint = cols[1];
      mountpoints[dev] = mountpoint;
   }

   // Declare types needed for udev
   var udevType = ref.refType("void *");
   var udevEnumerateType = ref.refType("void *");
   var udevListEntryType = ref.refType("void *");
   var udevDeveiceType = ref.refType("void *");

   // Register udev library
   var udev = ffi.Library('libudev.so.1', {
      "udev_new": [ udevType, [] ],
      "udev_enumerate_new": [ udevEnumerateType, [ udevType ]],
      "udev_enumerate_add_match_subsystem": [ "void", [ udevEnumerateType, "string" ]],
      "udev_enumerate_add_match_property": [ "void", [ udevEnumerateType, "string", "string"]],
      "udev_enumerate_add_match_parent": [ "void", [ udevEnumerateType, udevDeveiceType ]],
      "udev_enumerate_scan_devices": [ "void", [ udevEnumerateType ]],
      "udev_enumerate_get_list_entry": [ udevListEntryType, [ udevEnumerateType ]],
      "udev_list_entry_get_next": [ udevListEntryType, [ udevListEntryType ]],
      "udev_list_entry_get_name": [ "string", [ udevListEntryType ]],
      "udev_device_new_from_syspath": [ udevDeveiceType, [ udevType, "string" ]],
      "udev_device_get_devnode": [ "string", [ udevDeveiceType]],
      "udev_device_get_parent_with_subsystem_devtype": [ udevDeveiceType, [ udevDeveiceType, "string", "string" ]],
      "udev_device_get_property_value": [ "string", [ udevDeveiceType, "string" ]],
      "udev_device_get_sysattr_value": [ "string", [ udevDeveiceType, "string" ]],
      "udev_device_unref": [ "void", [ udevDeveiceType ]],
      "udev_enumerate_unref": [ "void", [ udevEnumerateType ]],
      "udev_unref": [ "void", [ udevType ]],
   });

   // Create udev context
   var udevContext = udev.udev_new();

   // Enumerate drives
   var udevEnumerate = udev.udev_enumerate_new(udevContext);
   udev.udev_enumerate_add_match_subsystem(udevEnumerate, "scsi");
   udev.udev_enumerate_add_match_property(udevEnumerate, "DEVTYPE", "scsi_device");
   udev.udev_enumerate_scan_devices(udevEnumerate);
   var devListEntry = udev.udev_enumerate_get_list_entry(udevEnumerate);

   // Loop drives
   while(true) {
      if (devListEntry.isNull()) break;

      var sysPath = udev.udev_list_entry_get_name(devListEntry);
      var udevDeviceSCSI = udev.udev_device_new_from_syspath(udevContext, sysPath);
      var udevDeviceBlock = udevGetChild(udev, udevContext, udevDeviceSCSI, "block");
      var udevDeviceSCSIDisk = udevGetChild(udev, udevContext, udevDeviceSCSI, "scsi_disk");
      var udevDeviceUSB = udev.udev_device_get_parent_with_subsystem_devtype(udevDeviceSCSI, "usb", "usb_device");

      if (!udevDeviceBlock.isNull() && !udevDeviceSCSIDisk.isNull() && !udevDeviceUSB.isNull()) {
         var devNode = udev.udev_device_get_devnode(udevDeviceBlock);
         if (typeof mountpoints[devNode] == "string" && fs.existsSync(path.join(mountpoints[devNode], "vcontrol.id"))) {
            vcontrolPath = mountpoints[devNode];
         }
      }

      // Free device resources
      if (udevDeviceSCSIDisk !== null)
         udev.udev_device_unref(udevDeviceSCSIDisk);

      if (udevDeviceBlock !== null)
         udev.udev_device_unref(udevDeviceBlock);

      udev.udev_device_unref(udevDeviceSCSI);

      if (vcontrolPath !== null) break;

      devListEntry = udev.udev_list_entry_get_next(devListEntry);
   }

   // Free memory
   udev.udev_enumerate_unref(udevEnumerate);
   udev.udev_unref(udevContext);

   return vcontrolPath;
}

function udevGetChild(udev, udevContext, udevDevice, subsystem) {
   var udevEnumerate = udev.udev_enumerate_new(udevContext);

   udev.udev_enumerate_add_match_parent(udevEnumerate, udevDevice);
   udev.udev_enumerate_add_match_subsystem(udevEnumerate, subsystem);
   udev.udev_enumerate_scan_devices(udevEnumerate);

   var udevListEntry = udev.udev_enumerate_get_list_entry(udevEnumerate);
   var sysPath = udev.udev_list_entry_get_name(udevListEntry);
   var child = udev.udev_device_new_from_syspath(udevContext, sysPath);

   udev.udev_enumerate_unref(udevEnumerate);

   return child;
}

///////////////////////////////////////////////////////////////////////////////
//////// VBAR CONTROL PATH DARWIN /////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
function getVControlPath_darwin() {
	var files = fs.readdirSync("/Volumes");
	for (var i = 0; i < files.length; i++) {
		var file = path.join("/Volumes", files[i], "vcontrol.id");
		if (fs.existsSync(file)) {
			return path.join("/Volumes", files[i]);
		}
	}
   return null;
}

///////////////////////////////////////////////////////////////////////////////
//////// EXPORT MODULES ///////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
module.exports = {
   getVControlPath: function() {
      if (process.platform == "win32")
         return getVControlPath_win32();
      if (process.platform == "linux")
         return getVControlPath_linux();
      if (process.platform == "darwin")
         return getVControlPath_darwin();
      return null;
   }
};
