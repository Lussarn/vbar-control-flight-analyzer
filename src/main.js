//handle setupevents as quickly as possible
const setupEvents = require('../installers/setupEvents')
if (setupEvents.handleSquirrelEvent()) {
	// squirrel event handled and app will exit in 1000ms, so don't do anything else
	return;
}

const electron = require("electron");
const app = electron.app;
const BrowserWindow = electron.BrowserWindow
const ipc = electron.ipcMain;
const commandLineArgs = require("command-line-args");

const backend = require("./VBCBackend");
const util = require("./VBCUtil");

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;
var baseDir = `file://${__dirname}/`;

// Commandline options
const optionDefinitions = [
	{ name: 'debug', alias: 'd', type: Boolean }
];
const options = commandLineArgs(optionDefinitions);

function createWindow (width, height) {
	// Create the browser window.
	mainWindow = new BrowserWindow({width: width, height: height, show: false });

	if (options.debug) {
		// Open the DevTools.
		mainWindow.webContents.openDevTools()
	} else {
		// Remove default menu
		mainWindow.setMenu(null);
	}

	// and load the index.html of the app.
	mainWindow.loadURL(baseDir + "ui/main.html");
	mainWindow.on("ready-to-show", function() { mainWindow.show(); });

	// Emitted when the window is closed.
	mainWindow.on('closed', function () {
		// Close all open auxilary windows
		for (var i = 0; i < telemetryWindows.length; i++) {
			if (typeof telemetryWindows[i] !== "undefined") {
				telemetryWindows[i].close();
			}
		}
		for (var i = 0; i < vbarLogWindows.length; i++) {
			if (typeof vbarLogWindows[i] !== "undefined") {
				vbarLogWindows[i].close();
			}
		}
		for (var i = 0; i < mapWindows.length; i++) {
			if (typeof mapWindows[i] !== "undefined") {
				mapWindows[i].close();
			}
		}
	});
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', function() {
	backend.init(function() {
		backend.getWindowDimensions(function(err, dimensions) {
			if (err) return console.log(err);
			createWindow(dimensions.width, dimensions.height);
		});
	});
});

// Quit when all windows are closed.
app.on('window-all-closed', function () {
	// On OS X it is common for applications and their menu bar
	// to stay active until the user quits explicitly with Cmd + Q
	//  if (process.platform !== 'darwin') {
	app.quit()
	//  }
})

//app.on('activate', function () {
	// On OS X it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
//	if (mainWindow === null) {
//		createWindow()
//	}
//})

// Setup telemetry windows
var telemetryWindows = [];
ipc.on('load-telemetry', function (event, logId) {

	// If telemetry is already open, focus it
	if (typeof telemetryWindows[logId] !== "undefined") {
		telemetryWindows[logId].focus();
		return;
	}

	w = new BrowserWindow({width: 1338, height: 800, show: false })
	if (options.debug) {
		// Open the DevTools.
		w.webContents.openDevTools()
	} else {
		// Remove default menu
		w.setMenu(null);
	}
	w.loadURL(baseDir + "ui/telemetry.html?logid=" + logId);
	telemetryWindows[logId] = w;
	w.on('closed', function () {
		delete telemetryWindows[logId];
	});

	w.on("ready-to-show", function() { w.show(); w.webContents.send("init", logId) });
});

// Setup VBar log windows
var vbarLogWindows = [];
ipc.on('load-vbarlog', function (event, logId) {

	// If telemetry is already open, focus it
	if (typeof vbarLogWindows[logId] !== "undefined") {
		vbarLogWindows[logId].focus();
		return;
	}

	w = new BrowserWindow({width: 700, height: 800, show: false })
	if (options.debug) {
		// Open the DevTools.
		w.webContents.openDevTools()
	} else {
		// Remove default menu
		w.setMenu(null);
	}
	w.loadURL(baseDir + "ui/vbarlog.html?logid=" + logId);
	vbarLogWindows[logId] = w;
	w.on('closed', function () {
		delete vbarLogWindows[logId];
	});

	w.on("ready-to-show", function() { w.show(); w.webContents.send("init", logId) });
});

// Setup Cesium Map windows
var mapWindows = [];
ipc.on('load-map', function (event, logId) {

	// If map is already open, focus it
	if (typeof mapWindows[logId] !== "undefined") {
		mapWindows[logId].focus();
		return;
	}

	w = new BrowserWindow({width: 1338, height: 800, show: false })
	if (options.debug) {
		// Open the DevTools.
		w.webContents.openDevTools()
	} else {
		// Remove default menu
		w.setMenu(null);
	}
	w.loadURL(baseDir + "ui/map.html?logid=" + logId);
	mapWindows[logId] = w;
	w.on('closed', function () {
		delete mapWindows[logId];
	});

	w.on("ready-to-show", function() { w.show(); w.webContents.send("init", logId) });
});
