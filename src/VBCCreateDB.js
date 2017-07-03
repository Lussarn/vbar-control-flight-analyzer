module.exports = {
	create: function (dbConn, callback) {
		dbConn.serialize(function() {
			dbConn.run("CREATE TABLE IF NOT EXISTS battery (id INTEGER PRIMARY KEY autoincrement NOT NULL, name TEXT)");

			dbConn.run("CREATE TABLE IF NOT EXISTS model (id INTEGER PRIMARY KEY autoincrement NOT NULL, type VARCHAR(20), name TEXT, image BLOB, thumb BLOB, info TEXT)");
			dbConn.run("ALTER TABLE model ADD type VARCHAR(20)", function(err) {});
			dbConn.run("ALTER TABLE model ADD image BLOB", function(err) {});
			dbConn.run("ALTER TABLE model ADD thumb BLOB", function(err) {});
			dbConn.run("ALTER TABLE model ADD info TEXT", function(err) {});

			dbConn.run("CREATE TABLE IF NOT EXISTS batterylog (id INTEGER PRIMARY KEY autoincrement, date datetime, batteryid INTEGER, modelid INTEGER, duration INTEGER, capacity INTEGER, used INTEGER, minvoltage NUMERIC(3,1), maxampere NUMERIC(3,1), uid NUMERIC(3,1))");
			dbConn.run("CREATE TABLE IF NOT EXISTS variable (name VARCHAR(255) PRIMARY KEY, value TEXT)");

			dbConn.run("CREATE TABLE IF NOT EXISTS vbarlog (id INTEGER PRIMARY KEY autoincrement, logid INTEGER, original_filename VARCHAR(255), model VARCHAR(255), date DATETIME, severity INTEGER, message VARCHAR(255))");
			dbConn.run("CREATE INDEX IF NOT EXISTS idx_vbar_logid ON vbarlog (logid)");

			dbConn.run("CREATE TABLE IF NOT EXISTS uilog (id INTEGER PRIMARY KEY autoincrement, logid INTEGER, original_filename VARCHAR(255), model VARCHAR(255), date DATETIME, ampere NUMERIC(3,1), voltage NUMERIC(3,1), usedcapacity NUMERIC(3,1), headspeed INTEGER, pwm INTEGER)");
			dbConn.run("CREATE INDEX IF NOT EXISTS idx_ui_logid ON uilog (logid)");
			dbConn.run("ALTER TABLE uilog ADD temp INTEGER", function(err) {});

			dbConn.run("CREATE TABLE IF NOT EXISTS gpslog (id INTEGER PRIMARY KEY autoincrement, logid INTEGER, original_filename VARCHAR(255), model VARCHAR(255), date DATETIME, latitude NUMERIC(2,6), longitude NUMERIC(2,6), height INTEGER, speed INTEGER)");
			dbConn.run("CREATE INDEX IF NOT EXISTS idx_gps_logid ON gpslog (logid)");
			callback();
		});
	}
}
