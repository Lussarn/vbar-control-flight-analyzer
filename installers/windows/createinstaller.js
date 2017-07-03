const createWindowsInstaller = require('electron-winstaller').createWindowsInstaller
const path = require('path')

const globals = require('../../src/VBCGlobals');

getInstallerConfig()
	.then(createWindowsInstaller)
	.catch((error) => {
	console.error(error.message || error)
	process.exit(1)
})


function getInstallerConfig () {
	console.log('creating windows installer')
	const rootPath = path.join('./')
	const outPath = path.join(rootPath, 'dist')

	return Promise.resolve({
		appDirectory: path.join(outPath, "VBCAnalyzer-win32-" + process.arch + "/"),
		authors: 'Linus Larsson',
		noMsi: true,
		outputDirectory: path.join(outPath, 'windows-installer'),
		exe: 'VBCAnalyzer.exe',
		setupExe: "VBCAnalyzerInstaller-v" + globals.PROGRAM_VERSION + ".exe",
		setupIcon: path.join(rootPath, 'src', 'ui', 'asset', 'logo', 'logo.ico'),
		loadingGif: path.join(rootPath, 'src', 'ui', 'asset', 'logo', 'installer.gif')
	})
}
