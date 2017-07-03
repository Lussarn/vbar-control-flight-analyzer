const path = require("path");
const electron = require("electron");
const os = require("os");
const async = require("async");
var ref = require("ref");
var ffi = require('ffi')
const StructType = require("ref-struct");

const backend = ("./VCBBackend");

module.exports = {

	// Returns platform specific configuration directory
	getConfigDir: function() {
		return this.getHomePath();
	},

	// Returns database filename
	getDBFilename: function() {
		return path.join(this.getConfigDir(), '.vcontrol.db');
	},

	// String pad
	pad: function(n, width, z) {
		z = z || '0';
		n = n + '';
		return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
	},

	// load image as electron nativeImage
	loadAssetImage: function(filename) {
		var p = path.join('./src/ui/asset/image/', filename);
		var image = electron.nativeImage.createFromPath(p);
		if (image.isEmpty()) console.log("WARN: unable to read image: " + p);
		return image;
	},

	// Returns html encoded string
	html: function(string) {
		var entityMap = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': '&quot;',
			"'": '&#39;',
			"/": '&#x2F;'
		};

		return String(string).replace(/[&<>"'\/]/g, function (s) {
			return entityMap[s];
		});
	},

	// Return true if str ends with suffix
	endsWith: function(str, suffix) {
		return str.indexOf(suffix, str.length - suffix.length) !== -1;
	},

	// Convert Date to iso8601 (YYYY-MM-DD HH:MM:SS)
	iso8601: function(datetime) {
		return datetime.getFullYear() + "-" +
			util.pad(datetime.getMonth() + 1, 2)+ "-" +
			util.pad(datetime.getDate(), 2)+ " " +
			util.pad(datetime.getHours(), 2) + ":" +
			util.pad(datetime.getMinutes(), 2) + ":" +
			util.pad(datetime.getSeconds(), 2);
	},

	/* For a given date, get the ISO week number
	 *
	 * Based on information at:
	 *
	 *    http://www.merlyn.demon.co.uk/weekcalc.htm#WNR
	 *
	 * Algorithm is to find nearest thursday, it's year
	 * is the year of the week number. Then get weeks
	 * between that date and the first day of that year.
	 *
	 * Note that dates in one year can be weeks of previous
	 * or next year, overlap is up to 3 days.
	 *
	 * e.g. 2014/12/29 is Monday in week  1 of 2015
	 *      2012/1/1   is Sunday in week 52 of 2011
	 */
	getWeekNumber : function (d) {
		// Copy date so don't modify original
		d = new Date(+d);
		d.setHours(0,0,0,0);
		// Set to nearest Thursday: current date + 4 - current day number
		// Make Sunday's day number 7
		d.setDate(d.getDate() + 4 - (d.getDay()||7));
		// Get first day of year
		var yearStart = new Date(d.getFullYear(),0,1);
		// Calculate full weeks to nearest Thursday
		var weekNo = Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
		// Return array of year and week number
		return [d.getFullYear(), weekNo];
	},

	/**
	 * Get home Path
	 */
	getHomePath: function() {
		if (process.platform == "win32") {
			// Win32 uses windows API:s fort home path,
			// This seem to work 100%
			var att = StructType({
				data1: ref.types.uint32,
				data2: ref.types.uint16,
				data3: ref.types.uint16,
				data4_0: ref.types.uint8,
				data4_1: ref.types.uint8,
				data4_2: ref.types.uint8,
				data4_3: ref.types.uint8,
				data4_4: ref.types.uint8,
				data4_5: ref.types.uint8,
				data4_6: ref.types.uint8,
				data4_7: ref.types.uint8
			});

			var guid = new att;
			guid.data1 = 0x5E6C858F;
			guid.data2 = 0x0E22;
			guid.data3 = 0x4760;
			guid.data4_0 = 0x9A;
			guid.data4_1 = 0xFE;
			guid.data4_2 = 0xEA;
			guid.data4_3 = 0x33;
			guid.data4_4 = 0x17;
			guid.data4_5 = 0xB6;
			guid.data4_6 = 0x71;
			guid.data4_7 = 0x73;

			var stringPtrType = ref.refType("string");
			var shell32 = ffi.Library("Shell32.dll",
				{
					"SHGetKnownFolderPath": [ref.types.ulong, [ref.refType(att), ref.types.ulong, "string", stringPtrType ], { abi: ffi.FFI_STDCALL }],
				}
			);

			var pathPtr = ref.alloc(stringPtrType);
			var p = shell32.SHGetKnownFolderPath(guid.ref(), 0, null, pathPtr);
			var pathBuffer = pathPtr.deref().reinterpretUntilZeros(2);
			return pathBuffer.toString("ucs2");
		}
		return os.homedir();
	}
};
