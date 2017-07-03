const async = require("async");
const fs = require("fs");
const util = require("./VBCUtil");
const backend = require("./VBCBackend");

module.exports = {
	// KML Save
	save: function(logId, functionCallback) {

		async.waterfall([
			// get filename
			function(callback) {
				KMLDialog(function(err, filename) {
					if (err) return callback(err);
					callback(null, filename);
				});
			},
			// get log
			function (filename, callback) {
				if (filename === false) return callback(null, false);
				KMLLog(logId, function(err, log) {
					if (err) return callback(err);
					callback(null, filename, log)
				});
			},
			// get info
			function (filename, log, callback) {
				if (filename === false) return callback(null, false);
				backend.getInfoByLogId(logId, function(err, info) {
					if (err) return callback(err);
					callback(null, filename, log, info)
				});
			},
			// write KML
			function (filename, log, info, callback) {
				if (log.length == 0) callback(null);
				KMLWrite(filename, log, info, function(err) {
					callback(err);
				});
			}
		], function(err) {
			functionCallback(err);
		})
	}
};

KMLDialog = function(callback) {
	dialog.showSaveDialog(
		{
			title: "Save KML file", 
			filters: [ 
				{ name: "KML Files", extensions: ["kml"] },
				{ name: "All Files", extensions: ["*"] } 
			]
		},
		function (filename) {
			if (filename === undefined) {
				return callback(null, false);
			}
			return callback(null, filename);
		}
	);
};

KMLLog = function(logId, callback) {
	backend.getUiLog(logId, function(err, uiLog) {
		if (err) return callback(err);
		backend.getGPSLog(logId, function(err, gpsLog) {
			if (err) return callback(err);

			data = [];
			var index = 0;
			// Merge UI and GPS Logs
			for (var i = 0; i < gpsLog.data.length; i++) {

				var rowGps = gpsLog.data[i];
				var timestampGpsRow = rowGps.sec + gpsLog.start.getTime() / 1000;

				// Check if we have moved
				if (index > 0 && 
					rowGps.height == data[index - 1].height && 
					rowGps.longitude == data[index - 1].longitude && 
					rowGps.latitude == data[index - 1].latitude) {
					continue;
				} 

				var row = [];
				row.sec = rowGps.sec;
				row.height = rowGps.height;
				row.speed = rowGps.speed;
				row.longitude = rowGps.longitude;
				row.latitude = rowGps.latitude;

				// Find in UI log
				var nearestTimestamp = -1;
				var nearestIndex = -1;
				var rowUi;
				for (var j = 0; j < uiLog.data.length; j++) {
					rowUi = uiLog.data[j];
					timestampUiRow = rowUi.sec + uiLog.start.getTime() / 1000;
					if (nearestTimestamp == -1 || Math.abs(timestampGpsRow - timestampUiRow) < nearestTimestamp) {
						nearestTimestamp = Math.abs(timestampGpsRow - timestampUiRow);
						nearestIndex = j;
					}
				}

				rowUi = uiLog.data[nearestIndex];
				row.voltage = rowUi.voltage;
				row.current = rowUi.current;
				row.headspeed = rowUi.headspeed;
				row.pwm = rowUi.pwm;
				row.usedCapacity = rowUi.usedCapacity;

				index++;
				data.push(row);
			}

			return callback(err, data);

		});
	});
}

KMLWrite = function(filename, log, info, callback) {
	var i, row;
	var c = "";	
	c += '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
	c += '<kml xmlns="http://earth.google.com/kml/2.2">\n';
	c += '   <Document>\n';
	c += '      <name>VBar Control flkight path</name>\n';
	c += '      <description>\n';
	c += '      </description>\n';
	c += '      <open>0</open>\n';
	c += '      <Folder>\n';
	c += '         <name>Max altitude</name>\n';
	c += '         <open>0</open>\n';
	c += '         <visibility>1</visibility>\n';
	c += '         <Placemark>\n';
	c += '            <name>Altitude</name>\n';
	c += '            <Style>\n';
	c += '               <LineStyle>\n';
	c += '                  <color>99ffaa00</color>\n';
	c += '                  <width>3</width>\n';
	c += '               </LineStyle>\n';
	c += '               <PolyStyle>\n';
	c += '                  <color>99ffaa00</color>\n';
	c += '                  <colorMode>normal</colorMode>\n';
	c += '               </PolyStyle>\n';
	c += '            </Style>\n';
	c += '            <LineString>\n';
	c += '               <tessellate>0</tessellate>';
	c += '               <altitudeMode>absolute</altitudeMode>\n';
	c += '               <coordinates>\n';
	for (i = 0; i < log.length; i++) {
		c += "                  " + log[i].longitude + "," + log[i].latitude + "," + log[i].height + "\n";
	}
	c += '               </coordinates>\n';
	c += '            </LineString>\n';
	c += '         </Placemark>\n';
	c += '         <Folder>\n';
	c += '            <name>Details Speed (GPS) km/h</name>\n';
	c += '            <open>0</open>\n';
	c += '            <visibility>1</visibility>\n';

	var maxSpeedIndex = 0;
	var maxHeightIndex = 0;
	var maxSpeed = 0;
	var maxHeight = 0;
	for (i = 0; i < log.length; i++) {
		row = log[i];
		if (row.height > maxHeight) {
			maxHeightIndex = i;
			maxHeight = row.height;
		}
		if (row.speed > maxSpeed) {
			maxSpeedIndex = i;
			maxSpeed = row.speed;	
		}
	}

	for (i = 0; i < log.length; i++) {
		row = log[i];
		c += '            <Placemark>\n';

		if (i == 0) {
			c += '              <name>' + util.html(info) + '</name>\n';
		} else if (i == maxSpeedIndex) {
			c += '              <name>Max speed: ' + row.speed + 'kmh</name>\n';
		} else if (i == maxHeightIndex) {
 			c += '              <name>Max altitude: ' + row.height + 'm</name>\n';
		}

		c += '              <description>\n';
		c += '                 <![CDATA[\n';
		c += '                    <table>\n';
		c += '                       <tr>\n';
		c += '                          <td width=160>\n';
		c += '                             Sec: ' + (Math.round(row.sec * 10) / 10) + '<br><hr>\n';
		c += '                             <b>Speed: ' + row.speed + 'kmh </b><br>\n';
		c += '                             Altitude: ' + row.height + 'm<br><hr>\n';
		c += '                             Voltage: ' + row.voltage + 'V<br>\n';
		c += '                             Current: ' + row.current + 'A<br>\n';
		c += '                             Power: ' + Math.round(row.voltage * row.current) + 'W<br>\n';
		c += '                             Headspeed: ' + row.headspeed +'rpm<br>\n';
		c += '                             PWM: ' + row.pwm + '%\n';
		c += '                          </td>\n';
		c += '                       </tr>\n';
		c += '                    </table>\n';
		c += '                 ]]>\n';
		c += '              </description>\n';
		c += '              <Style>\n';
		c += '                <IconStyle>\n';

		var iconColor = Math.round(255 - Number(row.speed));
		if (iconColor < 0) iconColor =0;
		iconColor="ff00" + iconColor.toString(16) + "ff";
		c += '                  <color>' + iconColor+ '</color>\n';

		c += '                  <scale>0.50</scale>\n';
		c += '                  <Icon>\n';
		c += '                    <href>http://maps.google.com/mapfiles/kml/shapes/target.png</href>\n';
		c += '                  </Icon>\n';
		c += '                </IconStyle>\n';
		c += '                <LabelStyle>\n';
		c += '                  <color>ff00ff00</color>\n';
		c += '                  <scale>1.2</scale>\n';
		c += '                </LabelStyle>\n';
		c += '              </Style>\n';
		c += '              <Point>\n';
		c += '                <extrude>1</extrude>\n';
		c += '                <altitudeMode>absolute</altitudeMode>\n';
		c += '                <coordinates>' + row.longitude + "," + row.latitude + "," + row.height +'</coordinates>\n';
		c += '              </Point>\n';
		c += '            </Placemark>\n';
	}
	c += '         </Folder>\n';
	c += '      </Folder>\n';
	c += '   </Document>\n';
	c += '</kml>\n';

	try {
		fs.writeFileSync(filename, c);
	} catch(err) {
		return callback(err);
	}
	callback(null);
}

