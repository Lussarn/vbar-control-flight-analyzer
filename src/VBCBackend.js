
"use strict";

const electron = require('electron');
const ref = require('ref');
const ffi = require('ffi');
const path = require('path');
const fs = require("fs");
const async = require('async');
const sqlite3 = require('sqlite3').verbose();
const drivelist = require('drivelist');
const sb = require("singlebyte");

const util = require('./VBCUtil');
const createdb = require('./VBCCreateDB');
const vcpath = require("./VBCVCPath");

var VBCBackend = function VBCBackend() {

	// Database connection
	var dbConn = null;

	// Path to vcontrol
	var vcontrolPath = null;

	// Importer process
	var importer = null;

	// Standard callback function
	var logCallback = function(err) { if (err) console.log(err) };

	// Persistent variable get
	this.variableGet = function(key, def, callback) {
		db().get("SELECT value FROM variable WHERE name=$name",
			{ $name: key },
			function (err, row) {
				if (typeof callback !== "function") callback = logCallback;
				if (err) return callback(err);
				if (typeof row === "undefined") return callback(err, def);
				return callback(null, row.value);
			}
		);
	}

	// Persistent variable set
	this.variableSet = function(key, value, callback) {
		db().run("INSERT OR REPLACE INTO variable (name, value) VALUES ($name, $value)",
			{ $name: key, $value: value },
			function (err) {
				if (typeof callback !== "function") callback = logCallback;
				return callback(err);
			}
		);
	}

	// Get GUI dimensions
	this.getWindowDimensions = function(callback) {
		var self = this;
		async.parallel([
			function(callback) {
				self.variableGet("gui-window-width", "1338",
					function(err, value) {
						if (err) return callback(err);
						callback(err, Number(value));
					}
				);
			},
			function(callback) {
				self.variableGet("gui-window-height", "800",
					function(err, value) {
						if (err) return callback(err);
						callback(err, Number(value));
					}
				)
			}
		], function(err, results) {
			if (typeof callback !== "function") callback = logCallback;
			if (err) return callback(err);
			callback(err, { "width": results[0], "height": results[1] });
		});
	}

	// Set GUI dimensions
	this.setWindowDimensions = function(width, height, callback) {
		var self = this;
		async.parallel([
			function(callback) {
				self.variableSet("gui-window-width", width,
					function(err) {
						callback(err);
					}
				);
			},
			function(callback) {
				self.variableSet("gui-window-height", height,
					function(err) {
						callback(err);
					}
				)
			}
		], function(err, results) {
			if (typeof callback !== "function") callback = logCallback;
			callback(err);
		});
	}

	/**
	 * Read Batteries
	 */
	this.getBatteries = function(dateStart, dateEnd, callback) {
		var batteries = [];
		if (dateStart === null) dateStart = '1970-01-01';
		if (dateEnd === null) dateEnd = '9999-01-01';

		db().each("\
			SELECT b.id, b.name, count(*) as cycles \
				FROM battery b \
				LEFT JOIN batterylog bl ON bl.batteryid = b.id \
				WHERE date >= $dateStart AND date < $dateEnd AND bl.used * 4 > bl.capacity GROUP BY b.id;",
			{
				$dateStart: dateStart,
				$dateEnd: dateEnd
			},
			function(err, row) {
				if (err != null) callback(err);
				var battery = {
					batteryId: row.id,
					name: row.name,
					cycles: row.cycles
				};
				batteries.push(battery);
			},
			function (err) {
				if (err) {
 					callback(err);
 				} else {
 					callback(null, batteries);
 				}
			}
		);
	};

	/**
	 * Read Models
	 */
	this.getModels = function(dateStart, dateEnd, callback) {
		var models = [];
		if (dateStart === null) dateStart = '1970-01-01';
		if (dateEnd === null) dateEnd = '9999-01-01';

		db().each("\
			SELECT m.id, m.name, m.type, m.thumb, m.info, count(*) as cycles \
				FROM model m \
				LEFT JOIN batterylog bl ON bl.modelid=m.id \
				WHERE date >= $dateStart AND date < $dateEnd AND bl.used * 4 > bl.capacity GROUP BY m.id;",
			{
				$dateStart: dateStart,
				$dateEnd: dateEnd
			},
			function(err, row) {
				if (err != null) callback(err);
				var model = {
					modelId: row.id,
					name: row.name,
					type: row.type,
					thumb: row.thumb,
					info: row.info,
					cycles: row.cycles
				};

				if (model.thumb == null) {
					switch (model.type) {
						case 'AIRPLANE':
						case 'VBASIC':
			                model.thumb = util.loadAssetImage("airplane.png");
							break;
						case 'MULTIROTOR':
			                model.thumb = util.loadAssetImage("multirotor.png");
							break;
						default:
			                model.thumb = util.loadAssetImage("helicopter.png");
					}
				} else {
					// TODO: Unserialize thumb to nativeImage
				}

				models.push(model);
			},
			function (err) {
				if (err) {
 					callback(err);
 				} else {
 					callback(null, models);
 				}
			}
		);
	};

	/**
	 * Read Gear
	 */
	this.getGear = function(dateStart, dateEnd, scaleFactor, callback) {
   	var gear = {};
   	var backend = this;

	 	async.waterfall([
	 		// Read batteries from DB
	 		function(callback) {
		 		backend.getBatteries(dateStart, dateEnd, function(err, batteries) {
		 			if (!err) gear.batteries = batteries;
		 			callback(err);
		 		});
	 		},

	 		// Read models from DB
	 		function(callback) {
		 		backend.getModels(dateStart, dateEnd, function(err, models) {
		 			if (!err) gear.models = models;
		 			callback(err);
		 		});
	 		}
	 	], function(err) {
	 		if (err) {
	 			callback(err);
	 		} else {
	 			callback(null, gear);
	 		}
	 	});
	};

	/**
	 * Extract cycles
	 *
	 * batteryId, modelId, dateStart, dateEnd may be null
	 * allCycles is boolean (if false only > 1/4 capacity is returned)
	 **/
	this.getCycles = function(modelId, batteryId, dateStart, dateEnd, allCycles, callback) {
		var sql = "\
			SELECT l.id, b.name AS batteryname, m.name AS modelname, m.id as modelid, l.date, l.duration, l.capacity, l.used, l.minvoltage, l.maxampere, l.uid, \
				(SELECT COUNT(*) > 1 FROM vbarlog vbl WHERE l.id=vbl.logid) AS havevbarlog, \
				(SELECT COUNT(*) > 1 FROM uilog ul WHERE l.id=ul.logid) AS haveuilog, \
				(SELECT COUNT(*) > 1 FROM gpslog ul WHERE l.id=ul.logid) AS havegpslog, \
				(SELECT COUNT(*) > 1 FROM vbarlog vbl WHERE l.id=vbl.logid AND (severity=4 AND (message not like '%Extreme Vibration%' AND message not like '%Gefaehrliche Vibrationen%'))) AS havevbarlogproblem \
				FROM batterylog l \
				LEFT JOIN battery b on b.id=l.batteryid \
				LEFT JOIN model m on m.id=l.modelid";

		if (!allCycles)
			sql += " WHERE l.used * 4 > l.capacity";

		if (batteryId != null)
			sql += " AND l.batteryid=" + batteryId;

		if (modelId != null)
			sql += " AND l.modelid=" + modelId;

		if (dateStart != null)
			sql += " AND l.date >= '" + dateStart + "'";

		if (dateEnd != null)
			sql += " AND l.date < '" + dateEnd + "'";

		sql += " ORDER BY date";

		var sessionCount = 0;
		var cycles = 0;
		var capacityUsed = 0;
		var durationTotalSec = 0;
		var data = [];

		var dateOld = new Date(1970, 1, 1);
		db().all(sql, function(err, rows) {
			if (err) return callback(err);
			rows.forEach(function (row) {
				// Skip if model name is null
				if (row.modelname == null) return;

				// Calculate the session based on date
				var date = new Date(row.date);
				var deltaSeconds = (date - dateOld) / 1000;
				if (deltaSeconds > 60 * 60 * 3)
					sessionCount++;

				capacityUsed += row.used;
				cycles += 1;
				var durationStr = util.pad(Math.floor(row.duration / 60), 2) + ":" + util.pad(row.duration % 60, 2);
				durationTotalSec += row.duration;
				var used = row.used + ' (' + Math.floor(row.used / row.capacity * 100) + '%)';


				data.push({
					logId: row.id,
					date: new Date(row.date),
					battery: row.batteryname,
					modelId: row.modelid,
					model: row.modelname,
					duration: durationStr,
					capacity: row.capacity,
					used: used,
					minv: row.minvoltage,
					maxa: row.maxampere,
					idlev: row.uid,
					session: sessionCount,
					haveVBarLog: row.havevbarlog,
					haveUILog: row.haveuilog,
					haveGPSLog: row.havegpslog,
					haveVBarLogProblem: row.havevbarlogproblem
				});

				dateOld = date;
			});

			capacityUsed = (capacityUsed / 1000).toFixed(2);


			var durationTotalStr = util.pad(Math.floor(durationTotalSec / 3600), 2) + ":"
				+ util.pad(Math.floor((durationTotalSec % 3600) / 60), 2) + ":"
				+ util.pad(Math.floor(durationTotalSec % 60), 2);


			var totals = {
				cycles: cycles,
				used: capacityUsed,
				duration: durationTotalStr,
				sessions: sessionCount
			}

			callback(null, { data: data, totals: totals });

		});
	};

	/**
	 * Read weeks
	 */
	this.getWeeks = function(modelId, batteryId, dateStart, dateEnd, groupBy, callback) {
		this.getCycles(modelId, batteryId, dateStart, dateEnd, false, function(err, data) {
			if (err) return callback(err);
			var out = {};
			var lastWeek = null;
			var groups = {};
			var firstYear = null;
			var lastYear = null;
			if (data.data.length > 0) {
				for (var i = 0; i < data.data.length; i++) {
					var dateCurrent = data.data[i].date;
					var dates = util.getWeekNumber(dateCurrent);
					var currentYear = dates[0];
					var currentWeek = dates[1];
					var week = currentYear + " - " + util.pad(currentWeek, 2);

					if (firstYear == null) firstYear = currentYear;
					lastYear = currentYear;

					if (groupBy == 'model') {
						if (typeof groups[data.data[i].model] === "undefined") groups[data.data[i].model] = 0;
						groups[data.data[i].model]++;
					} else {
						if (typeof groups[data.data[i].battery] === "undefined") groups[data.data[i].battery] = 0;
						groups[data.data[i].battery]++;
					}

					if (lastWeek !== null && lastWeek != week) {
						out[lastWeek] = groups;
						groups = {};
					}
					lastWeek = week;
				}
				out[week] = groups;
			}

			var out2 = [];
			for (var year = firstYear; year <= lastYear; year++) {
				for (week = 1; week <= 52; week++) {
					var key = year + " - " + util.pad(week, 2);
					if (typeof out[key] == "undefined") {
						out2.push({week: key, groups: {}});
					} else {
						out2.push({week: key, groups: out[key]});
					}
				}
			}

			callback(null, out2);
		});
	}

	/**
	 * Read seasons
	 */
	this.getSeasons = function(callback) {
		var seasons = [];

		db().all("SELECT STRFTIME('%Y', date) AS season, COUNT(date) AS count FROM batterylog WHERE used * 4 > capacity GROUP BY season",
			function(err, rows) {
	   		if (err) return callback(err);
				rows.forEach(function (row) {
					seasons.push({
						year: row.season,
						count: row.count
					});
				});
				return callback(null, seasons);
			}
		);
	};

	/**
	 * Read UI log
	 */
	this.getUiLog = function (logId, callback) {
		var out = [];
		var clipStart = false;
		var clipEnd = false;
		var lastNotZero = 0;
		var firstNotZero = 0;
		var RPMFirst = false;
		var RPMLast = false;
		var i = 0;

		db().all("SELECT model, date, ampere, voltage, usedcapacity, headspeed, pwm, temp FROM uilog WHERE logid=$logId",
			{ $logId: logId },
			function(err, rows) {
	        	if (err) return callback(err);
				rows.forEach(function (row) {

					if (RPMFirst === false) RPMFirst = new Date(row.date);
					RPMLast = new Date(row.date);

					if (clipStart === false && row.headspeed != 0)
						clipStart = new Date(row.date);

					if (firstNotZero === 0 && row.headspeed != 0)
						firstNotZero = i;

					out.push({
						model: row.model,
						current: Number(row.ampere),
						voltage: Number(row.voltage),
						usedCapacity: Number(row.usedcapacity),
						headspeed: Number(row.headspeed),
						pwm: Number(row.pwm),
						temp: Number(row.temp)
					});

					if (row.headspeed != 0) {
						lastNotZero = i;
						clipEnd = new Date(row.date);
					}
					i++;

				});

				if (clipStart === false) {
					clipStart = RPMFirst;
					clipEnd = RPMLast;
				} else {
					out = out.slice(firstNotZero, lastNotZero);
				}

				// Now we shuold evenly distribute end over the
				// seconds in clipStart and clipEnd
				// We need to know the number of seconds beetween clipStart and clipEnd
				var duration = (new Date(clipEnd) - new Date(clipStart)) / 1000;
				for (i = 0; i < out.length; i++) {
					out[i].sec = (i / out.length) * duration;
				}

				callback(null, { start: clipStart,  data: out } );
			}
		);
	};

	/**
	 * Read GPS log
	 */
	this.getGPSLog = function (logId, callback) {
		var out = [];
		var firstDate = false;
		var lastDate = false;
		db().all("SELECT model, date, longitude, latitude, height, speed FROM gpslog WHERE logid=$logId",
			{ $logId: logId },
			function(err, rows) {
	        	if (err) return callback(err);
				rows.forEach(function (row) {
					if (firstDate == false) {
						firstDate = new Date(row.date);
					}
					lastDate = new Date(row.date);

					out.push({
						'model': row["model"],
						'longitude': row["longitude"],
						'latitude': row["latitude"],
						'height': row["height"],
						'speed': row["speed"]
					});
				});

				if (firstDate === false) return callback(null, null);

				var dur = (lastDate.getTime() - firstDate.getTime()) / 1000;
				for (var i = 0; i < out.length; i++) {
					out[i].sec = i / (out.length) * dur;
				}
				callback(null, { "start": firstDate, "data" : out });
			}
		);
	};

	/**
	 * Get combined telemetry log
	 */
	this.getTelemetryLog = function(logId, callback) {
		var self = this;
		async.waterfall([
			function(asyncCallback) {
				self.getUiLog(logId, function(err, uiData) {
					if (err) return callback(err);
					asyncCallback(err, uiData);
				});
			},

			// Read model logs
			function(uiData, asyncCallback) {
				self.getGPSLog(logId, function(err, gpsData) {
					if (err) return callback(err);
					asyncCallback(err, uiData, gpsData);
				});
			},

			// Combine
			function(uiData, gpsData, asyncCallback) {
				if (gpsData == null) {
					// Mock GPS data
					gpsData = Object;
					gpsData.data = [];
					gpsData.data.push({sec: 0, speed: 0, height: 0, longitude: 0, latitude: 0});
					gpsData.start = uiData.start;
				}

				for (var j = 0; j < uiData.data.length; j++) {
					var row = uiData.data[j];
					var timestampUiRow = row["sec"] + (uiData["start"].getTime() / 1000);
					var nearestTimestamp = null;
					var nearestIndex = -1;
					for (var i = 0; i < gpsData.data.length; i++) {
						var rowGps = gpsData.data[i];
						var timestampGpsRow = rowGps["sec"] + (gpsData["start"].getTime() / 1000);
						if (nearestIndex == -1 || Math.abs(timestampUiRow - timestampGpsRow) < nearestTimestamp) {
							nearestTimestamp = Math.abs(timestampUiRow - timestampGpsRow);
							nearestIndex = i;
						}
					}
					uiData.data[j].height = gpsData.data[nearestIndex].height;
					uiData.data[j].speed = gpsData.data[nearestIndex].speed;
					uiData.data[j].longitude = gpsData.data[nearestIndex].longitude;
					uiData.data[j].latitude = gpsData.data[nearestIndex].latitude;
				}
				return callback(null, uiData);
			}
		], function(err) {
				if (err) return callback(err);
		});
	}

	/**
	 * Read basic flight info by logid
	 */
	this.getInfoByLogId = function (logId, callback) {
		var info = null;

		db().get("\
				SELECT b.name as batteryname, m.name as modelname, l.date \
				FROM batterylog l \
				LEFT JOIN battery b on b.id=l.batteryid \
				LEFT JOIN model m on m.id=l.modelid \
				WHERE l.id=$logId",
			{ $logId: logId },
			function(err, row) {
				if (err) return callback(err);
				if (typeof row !== 'undefined') {
					info = [];
					info.model = row.modelname;
					info.battery = row.batteryname;
					info.date = row.date;
				}
				return callback(null, info);
			}
		);
	};

	/**
	 * Read model info
	 */
	this.getModelInfo = function (modelId, callback) {
		var info = null;

		var self = this;
		db().get("SELECT name, type, info, image FROM model WHERE id=$modelId",
			{ $modelId: modelId },
			function(err, row) {
				if (err) return callback(err);
				if (typeof row !== 'undefined') {
					info = [];
					info.modelId = modelId;
					info.name = row.name;
					info.type = row.type;
					info.info = row.info == null ? "" : row.info;
					info.image = row.image;
					if (info.image != null) {
						info.image = electron.nativeImage.createFromBuffer(info.image);
					}

					var data = self.getCycles(modelId, null, null, null, false, function(err, cycles) {
						if (err) return callback(err);
						if (cycles.data.length == 0) {
							info.firstCycle = null;
							info.lastCycle = null;
						} else {
							info.firstCycle = cycles.data[0].date;
							info.lastCycle = cycles.data[cycles.data.length - 1].date;
						}
						info.cycles = cycles.totals.cycles;
						info.flightTime = cycles.totals.duration;
						return callback(null, info);
					});
				}
			}
		);
	};

	/**
	 * Read Vbar log
	 */
	this.getVBarLog = function (logId, callback) {
		var info = null;

		db().all("\
				SELECT  model, date, severity, message FROM vbarlog WHERE logid=$logId",
			{ $logId: logId },
			function(err, rows) {
				if (err) return callback(err);
				return callback(null, rows);
			}
		);
	};

	/**
	 * Set model info
	 */
	this.setModelInfo = function(modelId, info, callback) {
      db().run("UPDATE model set info=$info WHERE id = $modelId", {
          $modelId: modelId,
          $info: info
		}, function(err) {
			if (typeof callback === "undefined") return;
			if (err) return callback(err);
			callback(null);
		});
	};


	/**
	 * Set mode image
	 */
	this.setModelImage = function(modelId, image, callback) {
		var png = null;
		if (image) png = image.toPNG();
		db().run("UPDATE model SET image=$png WHERE id=$modelId", {
			$png: png,
			$modelId: modelId
		}, function(err) {
			if (typeof callback === "undefined") return;
			if (err) return callback(err);
			callback(null);
		});
	}


	/**
	 * Find VControl
	 */
	var vcontrolPathTimer = setInterval(function() {
		if (vcontrolPath == null) {
			// check for a hardcode file in base dir
			if (fs.existsSync("hardcode")) {
				try {
					vcontrolPath = fs.readFileSync("hardcode", "utf8").trim();
					return;
				} catch (error) {
					console.log("hardcode: " + error);
				}
			}
			// Check if VControl is mounted, returns null if not
			vcontrolPath = vcpath.getVControlPath();
		} else {
			// Will never disconnect a hardcode
			if (fs.existsSync("hardcode")) return;

			// Check remove of vcontrol
			fs.exists(path.join(vcontrolPath, "vcontrol.id"), function(exists) {
				if (!exists) {
					vcontrolPath = null;
				}
			});
		}
	}, 1000);

	var importerStatusCallback;
	var importerVControlPath;

	this.importLogs = function(statusCallback) {
		importerStatusCallback = statusCallback;
		importerVControlPath = vcontrolPath;

		if (vcontrolPath == null) {
			importerStatusCallback({ completed: true, status: "VControl not connected"});
			return;
		}

		importerStart();
	}

	/**
	 * Return VControl patch or null if not found
	 */
	this.getVcontrolPath = function() {
		return vcontrolPath;
	};

	/**
	 *
	 */
	this.init = function(callback) {
		dbConn = new sqlite3.Database(util.getDBFilename());
		createdb.create(dbConn, callback);
	};

	/**
	 * Returns connection to DB!
	 */
	var db = function() {
		return dbConn;
	};

	// --------------------------------------------
	// ------- ASYNC BULK IMPORTER, UGH! ----------
	// --------------------------------------------

	function importerStart() {
		importerStatusCallback({
			completed: false,
			status: "Reading directory structure...",
			percent: 0
		});

		var modelLogFileSets = getModelLogFileSets();
		if (modelLogFileSets === false) {
			importerStatusCallback({
				completed: true,
				status: "Import aborted!",
				percent: 100
			});
			return;
		}

		async.waterfall([
			function(callback) {
				getBatteryLogFileSets(function(err, batteryLogFileSets) {
					callback(err, batteryLogFileSets);
				});
			},

			// Read model logs
			function(batteryLogFileSets, callback) {
				readModelLogs(modelLogFileSets, function(err, modelLogs) {
					callback(err, batteryLogFileSets, modelLogs);
				});
			},

			// Read battery logs
			function(batteryLogFileSets, modelLogs, callback) {
				readBatteryLogs(batteryLogFileSets, modelLogs, function(err, batteryLogs) {
					callback(err, modelLogs, batteryLogs);
				});
			},

			// Import!
			function(modelLogs, batteryLogs, callback) {
				importBatteryLogs(batteryLogs, function(err) {
					callback();
				});
			},

			], function(err) {
				if (err) {
					callback(err);
				} else {
					importerStatusCallback({
						completed: true,
						status: "Imported all done...",
						percent: 0
					});
				}
		});

	}

	/**
	 * Returns an fileset array with the model log files on the vcontrol
	 */
	var getModelLogFileSets = function() {
		// Log path on VControl
		var logPath = path.join(importerVControlPath, "log");

		// First level inlog dir are model name
		var modelNames = null;
		try {
			var modelNames = fs.readdirSync(logPath);
		} catch (error) {
			return false;
		}

		var modelLogFileSets = [];

		// fill in modelLogFileSets filenames etc from the vcontrol
		for (let modelName of modelNames) {
			// Model needs to be directory
			if (!fs.lstatSync(path.join(logPath, modelName)).isDirectory()) continue;

			// The files in one model directory
			try {
				var filenames = fs.readdirSync(path.join(logPath, modelName));
			} catch (error) {
				continue;
			}
			for (let filename of filenames) {
				for (let suffix of ["_vbar.log", "_vcp.log", "_vplane.log", "_vbasic.log"]) {
					if (util.endsWith(filename, suffix)) {
						var modelLogFileSet = [];
						modelLogFileSet.model = modelName.replace("_", " ");
						modelLogFileSet.directory = path.join(logPath, modelName);
						modelLogFileSet.number = filename.substring(0, filename.indexOf('_'));
						modelLogFileSet.vbarLog = filename;
						modelLogFileSet.uiLog = null;
						// Check for ui log filename
						for (suffix of ["_ui.csv", "_kon.csv", "_sco.csv", "_yge.csv"]) {
							let  uiFilename = path.join(logPath, modelName, modelLogFileSet.number + suffix);
							try {
								if (!fs.lstatSync(uiFilename).isFile()) continue;
							} catch (error) {
								continue;
							}
							modelLogFileSet.uiLog = modelLogFileSet.number + suffix;
						}

						// Check for GPS log
						modelLogFileSet.gpsLog = null;
						let gpsFilename = path.join(logPath, modelName, modelLogFileSet.number + "_gps.csv");
						try {
							if (fs.lstatSync(gpsFilename).isFile()) {
								modelLogFileSet.gpsLog = modelLogFileSet.number + "_gps.csv";
							}
						} catch (error) { }

						// add to fileset
						modelLogFileSets.push(modelLogFileSet);
					}
				}
			}
		}
		return modelLogFileSets;
	}

	var readModelLogs = function(modelLogFileSets, callback, modelLogs) {
		if (typeof modelLogs === "undefined") modelLogs = [];
		if (modelLogFileSets.length == 0) return callback(null, modelLogs);

		var modelLogFileSet = modelLogFileSets.shift(0);

		importerStatusCallback({
			completed: false,
			status: "Reading logs for model: " + modelLogFileSet.model,
			percent: modelLogs.length / (modelLogFileSets.length + modelLogs.length) * 100
		});

		async.waterfall([
			// Read VBar Log
			function(callback) {
				readModelLogsVbar(modelLogFileSet, function(err, log) {
					if (err) {} // TODO: HANDLE ME
					if (log == null) return callback(null, null);
					modelLogs.push(log);
					callback(err, log);
				});
			},

			// Read UI Log
			function(log, callback) {
				if (log != null) {
					readModelLogsUI(log, function(err, uiLogLines) {
						log.uiLogLines = uiLogLines;
						callback(err, log);
					});
				} else {
					callback(null, log);
				}
			},

			// Read GPS Log
			function(log, callback) {
				if (log != null) {
					readModelLogsGPS(log, function(err, gpsLogLines) {
						log.gpsLogLines = gpsLogLines;
						callback(err);
					});
				} else {
					callback(null);
				}
			},

			], function(err) {
				if (err) {
					callback(err);
				} else {
					return readModelLogs(modelLogFileSets, callback, modelLogs);
				}
		});
	}

	var readModelLogsVbar = function(modelLogFileSet, callback) {
		// ------------------------------------
		// ------------- VBAR LOG  ------------
		// ------------------------------------
		var log = {};
		log.fileset = modelLogFileSet;
		log.vbarLogLines = [];
		fs.readFile(path.join(modelLogFileSet.directory, modelLogFileSet.vbarLog), function(err, vbarLogContent) {
			if (err) {} // TODO: HANDLE
			vbarLogContent = sb.bufToStr(vbarLogContent, "latin-1");

			let vbarLogLines = vbarLogContent.split(/\r\n|\r|\n/g);
			// Last hour handle log rollover on date
			let lastHour = -1, date = null;
			// Keep a reference to the date throughout log reading
			for (let vbarLogLine of vbarLogLines) {
				let line = {};

				// Handle the first line and continue
				let m = vbarLogLine.match(/(?:VBar|VCopter|VPlane|VBasic) Start -- (.*?) -- (\d\d)\.(\d\d)\.(\d\d\d\d) -- (\d\d):(\d\d):(\d\d)/);
				if (m !== null) {
					date = new Date(m[4] + "-" + m[3] + "-" + m[2]);
					line.severity = 0;
					line.content = vbarLogLine;
					line.datetime = new Date(date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + " " + m[5] + ":" + m[6] + ":" + m[7]);
					log.model = m[1];
					log.startDatetime = line.datetime;
					line.originalFilename = modelLogFileSet.vbarLog;
					log.vbarLogLines.push(line);
					lastHour = m[4];
					continue;
				}

				// No first line has apparently been reached, hard error on this log!
				if (log.vbarLogLines.length == 0) return callback(null, null);

				// Handle last line
				m = vbarLogLine.match(/(?:VBar|VCopter|VPlane|VBasic) Logfile End.*?(\d\d)\.(\d\d)\.(\d\d\d\d) -- (\d\d):(\d\d):(\d\d)/);
				if (m !== null) {
					let datetime = new Date(m[3] + "-" + m[2] + "-" + m[1] + " " + m[4] + ":" + m[5] + ":" + m[6]);
					line.severity = 0;
					line.content = vbarLogLine;
					line.datetime = datetime;
					log.endDatetime = line.datetime;
					line.originalFilename = modelLogFileSet.vbarLog;
					log.vbarLogLines.push(line);
					break;
				}

				m = vbarLogLine.match(/(\d\d):(\d\d):(\d\d);(\d);/);
				// No match, this is an logfile error. throw away that row.
				if (m === null) continue;

				// Hour rollover
				if (m[1] < lastHour) date.setDate(date.getDate() + 1);
				lastHour = m[1];

				// Normal line
				line.severity = m[4];
				line.content = vbarLogLine;
				line.datetime = new Date(date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + " " + m[1] + ":" + m[2] + ":" + m[3]);
				line.originalFilename = modelLogFileSet.vbarLog;
				log.vbarLogLines.push(line);
			}
			// Skip this log if no valid vbar logfile is extracted
			if (typeof log.startDatetime == "undefined" || typeof log.endDatetime == "undefined" ) return callback(null, null);
			return callback(null, log);
		});
	}

	var readModelLogsUI = function(log, callback) {
		// ------------------------------------
		// -------------- UI LOG  -------------
		// ------------------------------------
		if (log.fileset.uiLog == null) return callback(null, null);
		var uiLogLines = [];

		fs.readFile(path.join(log.fileset.directory, log.fileset.uiLog), function(err, uiLogContent) {
			if (err) callback(err);

			uiLogContent = sb.bufToStr(uiLogContent, "latin-1");

			let logLines = uiLogContent.split(/\r\n|\r|\n/g);
			if (logLines.length < 3) return callback(null, null);

			// Map columns
			let columns = logLines.shift().split(";");
			let indexColDate = null, indexColCurrent = null, indexColVoltage = null, indexColCapacity = null, indexColHeadspeed = null, indexColPWM = null, indexColTemp = null;
/*
			if ((indexColDate = columns.indexOf("Date")) == -1) return callback(null, null);
			if ((indexColCurrent = columns.indexOf("I(A)")) == -1) return callback(null, null);
			if ((indexColVoltage = columns.indexOf("U(V)")) == -1) return callback(null, null);
			if ((indexColCapacity = columns.indexOf("(Q)mAh")) == -1) return callback(null, null);
			if ((indexColHeadspeed = columns.indexOf("Headspeed(rpm)")) == -1) return callback(null, null);
			if ((indexColPWM = columns.indexOf("PWM(%)")) == -1) return callback(null, null);
*/
			if ((indexColDate = indexOfFirst(columns, ["Date"])) == -1) return callback(null, null);
			if ((indexColCurrent = indexOfFirst(columns, ["I(A)"])) == -1) return callback(null, null);
			if ((indexColVoltage = indexOfFirst(columns, ["U(V)"])) == -1) return callback(null, null);
			if ((indexColCapacity = indexOfFirst(columns, ["(Q)mAh"])) == -1) return callback(null, null);
			if ((indexColHeadspeed = indexOfFirst(columns, ["Headspeed(rpm)"])) == -1) return callback(null, null);
			if ((indexColPWM = indexOfFirst(columns, ["PWM(%)"])) == -1) return callback(null, null);

			// Temp is optional (-1) if not there
			indexColTemp = indexOfFirst(columns, ["Temp(C)"]);

			// last hour and startDate needed for log rollover
			let lastHour = -1;
			let date = new Date(log.startDatetime.getFullYear() + "-" + (log.startDatetime.getMonth() + 1) + "-" + log.startDatetime.getDate());
			let lineNumber = 1;
			for (let logLine of logLines) {
				lineNumber++;
				// last line is empty
				if (logLine == "") continue;

				let line = {};
				columns = logLine.split(";");
				let hour = null;
				let min = null;
				let sec = null;
				try {
					var m = columns[indexColDate].match(/(\d\d):(\d\d):(\d\d)/);
					hour = m[1];
					min = m[2];
					sec = m[3];
				} catch (error) {
					console.log(path.join(log.fileset.directory, log.fileset.uiLog) + ": " + lineNumber + "\n" + error);
					continue;
				}

				if (hour < lastHour) date.setDate(date.getDate() + 1);
				lastHour = hour;

				line.datetime = new Date(date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + " " + hour + ":" + min + ":" + sec);
				try {
					line.current = columns[indexColCurrent];
					line.voltage = columns[indexColVoltage];
					line.capacity = columns[indexColCapacity];
					line.headspeed = columns[indexColHeadspeed];
					line.pwm = columns[indexColPWM];
					line.temp = (indexColTemp > -1) ? columns[indexColTemp] : 0;

					line.uiFilename = log.fileset.uiLog;
				} catch (error) {
					console.log(path.join(log.fileset.directory, log.fileset.uiLog) + ": " + lineNumber + "\n" + error);
				}
				uiLogLines.push(line);
			}
			callback(null, uiLogLines);
		});
	}

	/**
	 * Multi index of returning the first occurance of the first searchString
	 */
	var indexOfFirst = function (input, searchStrings) {
	  var index = -1;
		for (let searchString of searchStrings) {
	  	if ((index = input.indexOf(searchString)) !== -1) {
				return index;
	    }
	  }
	  return -1;
	}

	var readModelLogsGPS = function(log, callback) {
		// ------------------------------------
		// ------------- GPS LOG  -------------
		// ------------------------------------
		if (log.fileset.gpsLog == null) return callback(null, null);
		var gpsLogLines = [];

		fs.readFile(path.join(log.fileset.directory, log.fileset.gpsLog), function(err, gpsLogContent) {
			if (err) callback(err);
			gpsLogContent = sb.bufToStr(gpsLogContent, "latin-1");

			var logLines = gpsLogContent.split(/\r\n|\r|\n/g);
			if (logLines.length < 3) return callback(null, null);;

			// Map columns
			let columns = logLines.shift().split(";");
			// Error in log format, hard map columns
			let indexColDate = null, indexColLatitude = null, indexColLongitude = null, indexColHeight = null, indexColSpeed = null;
			indexColDate = 0;
			indexColLatitude = 1;
			indexColLongitude = 2;
			indexColHeight = 3;
			indexColSpeed = 4;

			// last hour and startDate needed for log rollover
			let lastHour = -1;
			let date = new Date(log.startDatetime.getFullYear() + "-" + (log.startDatetime.getMonth() + 1) + "-" + log.startDatetime.getDate());
			let lineNumber = 1;
			for (let logLine of logLines) {
				lineNumber++;
				// last line is empty
				if (logLine == "") continue;

				let line = {};
				columns = logLine.split(";");
				if (columns.length < 5) continue;
				let hour = null;
				let min = null;
				let sec = null;
				try {
					let m = columns[indexColDate].match(/(\d\d):(\d\d):(\d\d)/);
					hour = m[1];
					min = m[2];
					sec = m[3];
				} catch (error) {
					console.log(path.join(log.fileset.directory, log.fileset.gpsLog) + ": " + lineNumber + "\n" + error);
					continue;
				}

				if (hour < lastHour) date.setDate(date.getDate() + 1);
				lastHour = hour;

				line.datetime = new Date(date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + " " + hour + ":" + min + ":" + sec);
				try {
					line.latitude = columns[indexColLatitude];
					line.longitude = columns[indexColLongitude];
					line.height = columns[indexColHeight];
					line.speed = columns[indexColSpeed];
				} catch (error) {
					console.log(path.join(log.fileset.directory, log.fileset.gpsLog) + ": " + lineNumber + "\n" + error);
				}
				gpsLogLines.push(line);
			}
			callback(null, gpsLogLines);
		});
	}

	var getBatteryLogFileSets = function(callback) {
		// Log path on VControl
		var logPath = path.join(importerVControlPath, "battery");
		var batteryLogFileSets = [];
		// Read betteryDirs
		var batteryDirs = null;
		try {
			var batteryDirs = fs.readdirSync(logPath);
		} catch (error) {
			return callback(new Error("Unable to read battery dir: " + logPath));
		}

		db().all("SELECT id, name FROM battery", function(err, rows) {
			var batteryMap = [];
			for (var row of rows) {
				batteryMap[row.name] = row.id;
			}

			// Find batterydirs, name and log.csv must be there
			for (let i = 0; i < batteryDirs.length; i++) {
				let batteryDir = batteryDirs[i];
				let batteryNamePath = path.join(logPath, batteryDir, "name");
				let batteryLogPath = path.join(logPath, batteryDir, "log.csv");
				try {
					if (fs.lstatSync(batteryLogPath).isFile()) {
						let battery = [];
						battery.name = fs.readFileSync(batteryNamePath);
						battery.name = sb.bufToStr(battery.name, "latin-1").replace(/[\x00]/g, "");
						if (typeof batteryMap[battery.name] === "undefined" ) {
							batteryLogFileSets = null;
							db().run("INSERT INTO battery (name) VALUES ($name)", { $name: battery.name }, function(err) {
								return getBatteryLogFileSets(callback);
							});
							return;
						}
						battery.id = batteryMap[battery.name];
						battery.directory = path.join(logPath, batteryDir);
						batteryLogFileSets.push(battery);
					}
				} catch (error) { console.log(error); }
			}
			return callback(null, batteryLogFileSets);
		});
	}

	var readBatteryLogs = function(batteryLogFileSets, modelLogs, callback, batteryLogs) {
		if (typeof batteryLogs === "undefined") batteryLogs = [];
		if (batteryLogFileSets.length == 0) return callback(null, batteryLogs);

		var batteryLogFileSet = batteryLogFileSets.shift(0);

		importerStatusCallback({
			completed: false,
			status: "Reading logs for battery: " + batteryLogFileSet.name,
			percent: batteryLogs.length / (batteryLogFileSets.length + batteryLogs.length) * 100
		});

		async.waterfall([
			// Read Battery Log
			function(callback) {
				readBatteryLog(batteryLogFileSet, modelLogs, function(err, log) {
					if (err) return callback(err); // TODO: HANDLE ME
					if (log.logLines == null) return callback(null, null);
					for (let line of log.logLines) {
						batteryLogs.push(line);
					}
					callback(err);
				});
			},

			], function(err) {
				if (err) {
					callback(err);
				} else {
					return readBatteryLogs(batteryLogFileSets, modelLogs, callback, batteryLogs);
				}
		});
	}

	var readBatteryLog = function(batteryLogFileSet, modelLogs, callback) {
		// ------------------------------------
		// ----------- BATTERY LOG  -----------
		// ------------------------------------
		var log = {};
		log.fileset = batteryLogFileSet;
		log.logLines = [];

		db().all("SELECT id, name FROM model", function(err, rows) {
			var modelMap = [];
			for (var row of rows) {
				modelMap[row.name] = row.id;
			}

			fs.readFile(path.join(batteryLogFileSet.directory, "log.csv"), function(err, logContent) {
				if (err) {} // TODO: HANDLE
				logContent = sb.bufToStr(logContent, "latin-1");

				let logLines = logContent.split(/\r\n|\r|\n/g);
				for (let logLine of logLines) {
					var line = [];

					var cols = logLine.split(';');
					if (cols.length < 8) continue;

					let columnDate = cols.shift(0)
					try {
						var m = columnDate.match(/(\d\d)\.(\d\d)\.(\d\d\d\d) (\d\d):(\d\d):(\d\d)/);
						let datetime = new Date(m[3] + "-" + m[2] + "-" + m[1] + " " + m[4] + ":" + m[5] + ":" + m[6]);
						line.datetime = datetime;
						var year = m[3];
					} catch (error) {
						continue;
					}

					// Clock not set!
					if (year < 2013) continue;

					line.capacity = cols.shift(0);
					line.used = cols.shift(0);
					line.duration = cols.shift(0);
					line.minV = cols.shift(0);
					line.maxA = cols.shift(0);
					line.idleV = cols.shift(0);
					line.modelName = cols.shift(0).trim();

					if (typeof modelMap[line.modelName] === "undefined") {
						log = null;
						db().run("INSERT INTO model (name) VALUES ($name)", { $name: line.modelName }, function(err) {
							return readBatteryLog(batteryLogFileSet, modelLogs, callback);
						});
						return;
					}
					line.modelId = modelMap[line.modelName];
					line.batteryId = batteryLogFileSet.id;
					line.batteryName = batteryLogFileSet.name;

					// Find model logs
					var logCandidates = modelLogs.filter(function(log) { return (log.model == line.modelName); });
					// Do not write log if the model have been delete from the log directory
					if (logCandidates.length == 0) continue;
					line.modelLog = null;
					for (var modelLog of logCandidates) {
						if (modelLog.startDatetime.getTime() <= line.datetime.getTime() && modelLog.endDatetime.getTime() >= line.datetime.getTime()) {
							line.modelLog = modelLog;
							break;
						}
					}

					// Set type of model, derived from the filename of the vbar log
					if (line.modelLog != null) {
						var type = null;
						if (line.modelLog.fileset.vbarLog.search("_vbar.log") > 0) type = "HELICOPTER";
						if (line.modelLog.fileset.vbarLog.search("_vplane.log") > 0) type = "AIRPLANE";
						if (line.modelLog.fileset.vbarLog.search("_vcp.log") > 0) type = "MULTIROTOR";
						if (line.modelLog.fileset.vbarLog.search("_vbasic.log") > 0) type = "VBASIC";
						if (type != null) {
							db().run("UPDATE model SET type=$type WHERE id = $modelid AND type IS NULL", { $type: type, $modelid: line.modelId }, function(err) {
							});
						}
					}

					log.logLines.push(line);
				}
				callback(null, log);
			});
		});
	}

	var importBatteryLogs = function(batteryLogs, callback, numLogs) {
		if (batteryLogs.length == 0) {
			db().run("COMMIT");
			return callback(null);
		}
		if (typeof numLogs === "undefined") {
			numLogs = batteryLogs.length;
			db().run("BEGIN TRANSACTION");
		}

		var batteryLog = batteryLogs.shift(0);

		importerStatusCallback({
			completed: false,
			status: "Importing for battery: " + batteryLog.batteryName,
			percent: (numLogs - batteryLogs.length) / numLogs * 100
		});

		async.waterfall([
			// Read VBar Log
			function(callback) {
				importBatteryRow(batteryLog, function(err, logId) {
					if (err) {
						db().run("ROLLBACK");
						return callback(err);
					}
					callback(err, batteryLog, logId);
				});
			},

			function(batteryLog, logId, callback) {
				if (logId === false || batteryLog.modelLog === null) return callback(null, batteryLog, logId);
				importVBarRows(batteryLog, logId, function(err) {
					if (err) {
						db().run("ROLLBACK");
						return callback(err);
					}
					callback(err, batteryLog, logId);
				});
			},

			function(batteryLog, logId, callback) {
				if (logId === false || batteryLog.modelLog === null) return callback(null, batteryLog, logId);
				importUiRows(batteryLog, logId, function(err) {
					if (err) {
						db().run("ROLLBACK");
						return callback(err);
					}
					callback(err, batteryLog, logId);
				});
			},

			function(batteryLog, logId, callback) {
				if (logId === false || batteryLog.modelLog === null) return callback(null, batteryLog, logId);
				importGPSRows(batteryLog, logId, function(err) {
					if (err) {
						db().run("ROLLBACK");
						return callback(err);
					}
					callback(err);
				});
			},

			], function(err) {
				if (err) {
					db().run("ROLLBACK");
					callback(err);
				} else {
					return importBatteryLogs(batteryLogs, callback, numLogs);
				}
		});

	}

	var importBatteryRow = function (batteryLog, callback) {
		db().get("SELECT COUNT(*) AS cnt FROM batterylog WHERE batteryid=$batteryId and date=$date",
			[batteryLog.batteryId, util.iso8601(batteryLog.datetime)], function(err, row) {
				if (err) return callback(err);
				if (row.cnt !== 0) return callback(err, false);
				db().run("INSERT INTO batterylog (date, batteryid, modelid, duration, capacity, used, minvoltage, maxampere, uid) VALUES (?,?,?,?,?,?,?,?,?)", [
					util.iso8601(batteryLog.datetime),
					batteryLog.batteryId,
					batteryLog.modelId,
					batteryLog.duration,
					batteryLog.capacity,
					batteryLog.used,
					batteryLog.minV,
					batteryLog.maxA,
					batteryLog.idleV], function(err) {
						return callback(err, this.lastID);
					});
		});
	}

	var importVBarRows = function(batteryLog, logId, callback) {
		if (batteryLog.modelLog.vbarLogLines === null) return callback(null);
		if (batteryLog.modelLog.vbarLogLines.length == 0) return callback(null);

		var logLine = batteryLog.modelLog.vbarLogLines.shift(0);
		dbConn.run('INSERT INTO vbarlog (logid, original_filename, model, date, severity, message) VALUES (?,?,?,?,?,?)', [
			logId,
			logLine.originalFilename,
			logLine.model,
			util.iso8601(logLine.datetime),
			logLine.severity,
			logLine.content],
			function(err) {
				importVBarRows(batteryLog, logId, callback);
			});
	}

	var importUiRows = function(batteryLog, logId, callback) {
		if (batteryLog.modelLog.uiLogLines === null) return callback(null);
		if (batteryLog.modelLog.uiLogLines.length == 0) return callback(null);

		var uiLogLine = batteryLog.modelLog.uiLogLines.shift(0);
		dbConn.run('INSERT INTO uilog (logid, original_filename, model, date, ampere, voltage, usedcapacity, headspeed, pwm, temp) VALUES (?,?,?,?,?,?,?,?,?,?)', [
			logId,
			uiLogLine.uiFilename,
			uiLogLine.modelName,
			util.iso8601(uiLogLine.datetime),
			uiLogLine.current,
			uiLogLine.voltage,
			uiLogLine.capacity,
			uiLogLine.headspeed,
			uiLogLine.pwm,
			uiLogLine.temp],
			function(err) {
				importUiRows(batteryLog, logId, callback);
			});
	}

	var importGPSRows = function(batteryLog, logId, callback) {
		if (batteryLog.modelLog.gpsLogLines === null) return callback(null);
		if (batteryLog.modelLog.gpsLogLines.length == 0) return callback(null);

		var logLine = batteryLog.modelLog.gpsLogLines.shift(0);
		db().run("INSERT INTO gpslog (logid, original_filename, model, date, latitude, longitude, height, speed) VALUES(?,?,?,?,?,?,?,?)", [
			logId,
			logLine.gpsFilename,
			logLine.modelName,
			util.iso8601(logLine.datetime),
			logLine.longitude,
			logLine.latitude,
			logLine.height,
			logLine.speed],
			function(err) {
				if (err) return callback(err);
				importGPSRows(batteryLog, logId, callback);
			});
	}

}

// Singleton the VBCBackend
VBCBackend.instance = null;

VBCBackend.getInstance = function(){
    if(this.instance === null){
        this.instance = new VBCBackend();
    }
    return this.instance;
}

module.exports = VBCBackend.getInstance();
